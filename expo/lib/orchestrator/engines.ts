/**
 * Concrete engines. Each engine takes a normalized payload (the Orchestrator's
 * `ExecutionPlan.payload`) and performs the write — after the Conflict Engine
 * has cleared it OR a user-confirmation flag is set.
 */
import { Agents, Events, Goals, Tasks } from "../db/repo";
import type {
  Agent,
  AgentCycle,
  AgentType,
  EventRecord,
  Goal,
  GoalHorizon,
  MemoryNode,
  MemoryType,
  Priority,
  Task,
} from "../db/types";
import { AgentRuntime } from "./agent-runtime";
import { ConflictEngine } from "./conflict";
import { MemoryGraph } from "./memory-graph";

// ---------- Task Engine ----------------------------------------------------
export type TaskInput = {
  title: string;
  description?: string;
  priority?: Priority;
  estimated_minutes?: number;
  deadline?: string | null;
  linked_goal_id?: string | null;
};

export const TaskEngine = {
  async create(
    input: TaskInput,
    opts: { allowDuplicate?: boolean } = {}
  ): Promise<{ task: Task | null; conflict: Task | null }> {
    const dup = await ConflictEngine.checkTaskDup(input.title);
    if (dup && !opts.allowDuplicate) {
      await ConflictEngine.record({
        kind: "task_task",
        severity: 0.6,
        subjectIds: [dup.id],
        options: [
          { id: "merge", label: "Merge into existing", action: { id: dup.id } },
          { id: "create_anyway", label: "Create as new", action: {} },
          { id: "cancel", label: "Cancel", action: {} },
        ],
      });
      return { task: null, conflict: dup };
    }
    const task = await Tasks.create(input);
    return { task, conflict: null };
  },
};

// ---------- Goal Engine ----------------------------------------------------
export type GoalInput = {
  title: string;
  rationale?: string;
  horizon?: GoalHorizon;
};

export const GoalEngine = {
  async create(input: GoalInput): Promise<Goal> {
    return Goals.create(input);
  },
};

// ---------- Agent Engine ---------------------------------------------------
export type AgentInput = {
  objective: string;
  type?: AgentType;
  update_cycle?: AgentCycle;
  priority?: Priority;
  linked_goal_id?: string | null;
};

export const AgentEngine = {
  async spawn(
    input: AgentInput
  ): Promise<{ agent: Agent | null; merged_into: Agent | null }> {
    const dup = await ConflictEngine.checkAgentDup(input.objective);
    if (dup) {
      // Strengthen existing agent rather than create a parallel one.
      const merged = await Agents.update(dup.id, {
        confidence: Math.min(1, dup.confidence + 0.05),
        last_update: new Date().toISOString(),
      });
      return { agent: null, merged_into: merged };
    }
    const agent = await Agents.create({ ...input, state: "active" });
    return { agent, merged_into: null };
  },

  /**
   * Periodic tick — runs each due agent through the full LLM-powered
   * execution loop (load context → LLM decision → apply outputs → advance).
   * Delegates to AgentRuntime for the actual execution.
   */
  async tickDue(): Promise<Agent[]> {
    const results = await AgentRuntime.tickAll();
    // Re-fetch agents to return fresh state.
    const ids = results.map((r) => r.agentId);
    if (ids.length === 0) return [];
    const all = await Agents.list();
    return all.filter((a) => ids.includes(a.id));
  },
};

// ---------- Event Engine ---------------------------------------------------
export type EventInput = {
  title: string;
  starts_at: string;
  ends_at: string;
  source?: "user" | "system" | "import" | "ai";
};

export const EventEngine = {
  async create(
    input: EventInput,
    opts: { allowOverlap?: boolean } = {}
  ): Promise<{ event: EventRecord | null; overlaps: EventRecord[] }> {
    const overlaps = await ConflictEngine.checkTimeOverlap(
      input.starts_at,
      input.ends_at
    );
    if (overlaps.length > 0 && !opts.allowOverlap) {
      await ConflictEngine.record({
        kind: "time_overlap",
        severity: 0.7,
        subjectIds: overlaps.map((e) => e.id),
        options: [
          { id: "keep_existing", label: "Keep existing", action: {} },
          {
            id: "create_anyway",
            label: "Create overlapping event",
            action: input,
          },
          { id: "cancel", label: "Cancel", action: {} },
        ],
      });
      return { event: null, overlaps };
    }
    const event = await Events.create(input);
    return { event, overlaps: [] };
  },
};

// ---------- Memory Engine --------------------------------------------------
export type MemoryInput = {
  type: MemoryType;
  content: string;
  source?: string;
  confidence?: number;
};

export const MemoryEngine = {
  /**
   * Ingest a memory through the Living Semantic Graph:
   *  - identical → reinforce (no duplicate)
   *  - contradictory → soften both sides, write conflict_log, keep both for user
   *  - related → create node + auto-link as graph edges (no orphan nodes)
   *  - novel → create node
   *
   * See `lib/orchestrator/memory-graph.ts` for the full algorithm.
   */
  async ingest(
    input: MemoryInput
  ): Promise<{ node: MemoryNode | null; reinforced: string | null }> {
    const r = await MemoryGraph.ingest(input);
    if (r.action === "reinforced") return { node: null, reinforced: r.targetId };
    if (r.action === "contradicted") return { node: r.node, reinforced: null };
    return { node: r.node, reinforced: null };
  },

  /** Re-export graph operations so callers only need MemoryEngine. */
  neighbors: MemoryGraph.neighbors,
  search: MemoryGraph.search,
  decay: MemoryGraph.decay,
  prune: MemoryGraph.prune,
  deriveInsights: MemoryGraph.deriveInsights,
};
