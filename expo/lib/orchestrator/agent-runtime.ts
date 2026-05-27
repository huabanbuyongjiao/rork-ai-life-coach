/**
 * Agent Runtime Engine — the execution loop that makes Agents "live".
 *
 * Each agent tick:
 *   1. Load context (linked memory, goal, tasks)
 *   2. Build a structured LLM prompt with the full state
 *   3. LLM produces: status Δ, new tasks, memory updates, insights
 *   4. Apply outputs transactionally (tasks/memory/state)
 *   5. Advance next_update based on update_cycle
 *
 * Designed to run both client-side (manual trigger) and server-side
 * (Supabase Edge Function via pg_cron). The edge function imports
 * a minimal subset; the heavy LLM calls stay in the orchestrator.
 */
import { Agents, Goals, Memory, Tasks } from "../db/repo";
import type { Agent, AgentCycle, Goal, MemoryNode, Task } from "../db/types";
import { chatJson, getLlm } from "../llm";

// ── Agent execution result ──────────────────────────────────────────────

export type AgentTickResult = {
  agentId: string;
  objective: string;
  /** New state the agent transitioned into. */
  newState: string;
  /** Human-readable summary of what happened this tick. */
  summary: string;
  /** Tasks created during this tick. */
  createdTaskIds: string[];
  /** Memory nodes updated / created. */
  updatedMemoryIds: string[];
  /** An insight derived this tick (may be null). */
  insight: string | null;
  /** Next scheduled update (ISO). */
  nextUpdate: string;
};

// ── Session-level dedup: don't tick the same agent twice in one session ──

const tickedThisSession = new Set<string>();

// ── LLM prompt template ──────────────────────────────────────────────────

const AGENT_EXECUTION_PROMPT = `You are an AI Life OS Agent Runtime worker. You are given ONE agent and its full context. Your job is to produce a structured execution step.

You MUST output STRICT JSON only:

{
  "state": "active" | "paused" | "completed" | "failed",
  "summary": "one-sentence human-readable summary of what you did",
  "new_tasks": [
    { "title": "...", "description"?: "...", "priority"?: "low"|"medium"|"high", "estimated_minutes"?: number }
  ],
  "memory_updates": [
    { "type": "fact"|"behavior"|"relation"|"insight", "content": "...", "confidence"?: 0..1 }
  ],
  "insight": "derived conclusion or null",
  "terminate": false,
  "rationale": "why you chose this action"
}

Rules:
- ONLY create tasks when the agent's objective demands concrete action.
- Memory updates should capture facts/patterns/relations the agent observed.
- Set terminate=true when the agent's objective is fully satisfied (sets state=completed).
- If no progress is possible, set state=paused with rationale.
- NEVER fabricate facts — only derive from the provided context.
- NEVER create tasks for emotional venting or abstract wishes.
- Tasks must have an action verb and be specific.
- Confidence on memory_updates should reflect how certain the derived fact is (0..1).`;

// ── Public API ───────────────────────────────────────────────────────────

export const AgentRuntime = {
  /**
   * Execute one full tick for the given agent. Idempotent within a session
   * (won't tick the same agent twice). Returns null if skipped.
   */
  async execute(agentId: string): Promise<AgentTickResult | null> {
    if (tickedThisSession.has(agentId)) return null;
    tickedThisSession.add(agentId);

    const agent = await Agents.list().then((a) => a.find((x) => x.id === agentId));
    if (!agent) throw new Error(`Agent ${agentId} not found`);
    if (agent.state === "completed" || agent.state === "failed") return null;

    // ── 1. Load context ──────────────────────────────────────────────
    const [memoryNodes, goal, tasks] = await Promise.all([
      loadMemoryNodes(agent.memory_links),
      agent.linked_goal_id ? Goals.list().then((g) => g.find((x) => x.id === agent.linked_goal_id) ?? null) : Promise.resolve(null),
      Tasks.list().then((t) => t.filter((x) => x.linked_goal_id === agent.linked_goal_id && x.status !== "done" && x.status !== "archived")),
    ]);

    // ── 2. Build prompt ──────────────────────────────────────────────
    const contextBlock = buildContextBlock(agent, goal, memoryNodes, tasks);
    const llm = getLlm();

    // ── 3. Call LLM ──────────────────────────────────────────────────
    const decision = await chatJson<AgentDecision>({
      messages: [
        { role: "system", content: AGENT_EXECUTION_PROMPT },
        { role: "user", content: contextBlock },
      ],
      temperature: 0.3,
      maxTokens: 1000,
    });

    if (!decision) {
      // LLM failed — mark agent as paused with a note
      await Agents.update(agentId, {
        state: "paused",
        last_update: new Date().toISOString(),
        next_update: nextUpdateAt(agent.update_cycle),
        output_stream: [...agent.output_stream, { at: new Date().toISOString(), error: "LLM did not return valid JSON" }],
      } as Partial<Agent>);
      return {
        agentId,
        objective: agent.objective,
        newState: "paused",
        summary: "LLM call failed — agent paused.",
        createdTaskIds: [],
        updatedMemoryIds: [],
        insight: null,
        nextUpdate: nextUpdateAt(agent.update_cycle),
      };
    }

    // ── 4. Apply outputs ─────────────────────────────────────────────
    const createdTaskIds: string[] = [];
    const updatedMemoryIds: string[] = [];

    // Create tasks
    for (const t of (decision.new_tasks ?? [])) {
      try {
        const created = await Tasks.create({
          ...t,
          linked_goal_id: agent.linked_goal_id,
        });
        createdTaskIds.push(created.id);
      } catch {
        // best-effort; don't fail the whole tick
      }
    }

    // Update / create memory
    for (const m of (decision.memory_updates ?? [])) {
      try {
        const node = await Memory.create({
          type: m.type,
          content: m.content,
          confidence: m.confidence ?? 0.55,
          source: `agent:${agentId}`,
        });
        updatedMemoryIds.push(node.id);
        // Link to agent
        agent.memory_links.push(node.id);
      } catch {
        // best-effort
      }
    }

    // ── 5. Update agent state ────────────────────────────────────────
    const newState = decision.terminate ? "completed" : (decision.state ?? "active");
    const nextUp = newState === "completed" || newState === "failed" ? null : nextUpdateAt(agent.update_cycle);

    await Agents.update(agentId, {
      state: newState as Agent["state"],
      last_update: new Date().toISOString(),
      next_update: nextUp,
      confidence: decision.terminate ? 1 : Math.max(0, agent.confidence + 0.02),
      input_stream: [
        ...agent.input_stream,
        { at: new Date().toISOString(), tasks_snapshot: tasks.map((t) => t.id) },
      ] as unknown[],
      output_stream: [
        ...agent.output_stream,
        {
          at: new Date().toISOString(),
          state: newState,
          summary: decision.summary,
          created_tasks: createdTaskIds,
          memory_updates: updatedMemoryIds,
          insight: decision.insight,
        },
      ] as unknown[],
      memory_links: [...new Set(agent.memory_links)],
    } as Partial<Agent>);

    return {
      agentId,
      objective: agent.objective,
      newState,
      summary: decision.summary ?? "",
      createdTaskIds,
      updatedMemoryIds,
      insight: decision.insight ?? null,
      nextUpdate: nextUp ?? "",
    };
  },

  /**
   * Tick ALL due agents. Returns results for each agent that actually ran.
   * Safe to call from both client and edge function.
   */
  async tickAll(): Promise<AgentTickResult[]> {
    const due = await Agents.dueForUpdate();
    const results: AgentTickResult[] = [];

    // Run agents sequentially to avoid hammering the LLM API.
    // For a production-scale system, batch with a queue + worker pool.
    for (const agent of due) {
      try {
        const r = await AgentRuntime.execute(agent.id);
        if (r) results.push(r);
      } catch (err) {
        console.warn(`[agent-runtime] tick failed for ${agent.id}:`, err);
        // Mark as paused so it doesn't stall the queue
        try {
          await Agents.update(agent.id, {
            state: "paused",
            last_update: new Date().toISOString(),
            next_update: nextUpdateAt(agent.update_cycle),
          } as Partial<Agent>);
        } catch { /* best-effort */ }
      }
    }

    // Clear session dedup so next cron cycle can re-tick
    tickedThisSession.clear();
    return results;
  },

  /**
   * Reset session dedup — call between tick cycles if running long-lived.
   */
  resetDedup(): void {
    tickedThisSession.clear();
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────

type AgentDecision = {
  state: string;
  summary: string | null;
  new_tasks: Array<{
    title: string;
    description?: string;
    priority?: string;
    estimated_minutes?: number;
  }> | null;
  memory_updates: Array<{
    type: string;
    content: string;
    confidence?: number;
  }> | null;
  insight: string | null;
  terminate: boolean;
  rationale: string | null;
};

async function loadMemoryNodes(ids: string[]): Promise<MemoryNode[]> {
  if (!ids || ids.length === 0) return [];
  const all = await Memory.list(500);
  return all.filter((n) => ids.includes(n.id));
}

function buildContextBlock(
  agent: Agent,
  goal: Goal | null,
  memoryNodes: MemoryNode[],
  tasks: Task[],
): string {
  const lines: string[] = [];

  lines.push(`## Agent: ${agent.objective}`);
  lines.push(`Type: ${agent.type} | State: ${agent.state} | Priority: ${agent.priority}`);
  lines.push(`Update cycle: ${agent.update_cycle} | Confidence: ${agent.confidence.toFixed(2)}`);
  lines.push(`Last update: ${agent.last_update ?? "never"}`);
  lines.push("");

  if (goal) {
    lines.push(`## Linked Goal: ${goal.title}`);
    lines.push(`Horizon: ${goal.horizon} | Progress: ${(goal.progress * 100).toFixed(0)}%`);
    if (goal.rationale) lines.push(`Rationale: ${goal.rationale}`);
    lines.push("");
  }

  if (tasks.length > 0) {
    lines.push(`## Linked Tasks (${tasks.length} open)`);
    for (const t of tasks) {
      lines.push(`- [${t.status}] ${t.title} (priority: ${t.priority})${t.deadline ? ` deadline: ${t.deadline}` : ""}`);
    }
    lines.push("");
  }

  if (memoryNodes.length > 0) {
    lines.push(`## Linked Memory (${memoryNodes.length} nodes)`);
    for (const n of memoryNodes) {
      lines.push(`- [${n.type}] conf=${(n.confidence * 100).toFixed(0)}% ${n.content.slice(0, 200)}`);
    }
    lines.push("");
  }

  lines.push(`## Output stream (recent, ${agent.output_stream.length} entries)`);
  const recent = (agent.output_stream as Array<{ at: string; summary?: string }>).slice(-5);
  for (const entry of recent) {
    lines.push(`- ${entry.at}: ${entry.summary ?? "(no summary)"}`);
  }

  return lines.join("\n");
}

export function nextUpdateAt(cycle: AgentCycle): string {
  const now = Date.now();
  const ms =
    cycle === "real_time"
      ? 60_000 // 1 min
      : cycle === "daily"
      ? 24 * 3600_000
      : cycle === "weekly"
      ? 7 * 24 * 3600_000
      : 6 * 3600_000; // event_triggered → 6h fallback
  return new Date(now + ms).toISOString();
}
