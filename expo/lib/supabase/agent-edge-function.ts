/**
 * AI Life OS — Agent Runner (Supabase Edge Function)
 *
 * Deploy: supabase functions deploy agent-runner
 * Schedule via pg_cron (see schema.sql): cron.schedule('agent_tick', '* * * * *', ...)
 *
 * This function:
 * 1. Queries all due agents across all users (service_role bypasses RLS)
 * 2. For each agent, loads linked memory/goals/tasks
 * 3. Calls the LLM to produce a structured execution decision
 * 4. Creates tasks, updates memory, advances agent state
 *
 * Runtime: Deno (Supabase Edge Functions)
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

// ── Config ────────────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LLM_URL = Deno.env.get("LLM_CHAT_URL")!;           // OpenAI-compatible endpoint
const LLM_KEY = Deno.env.get("LLM_API_KEY")!;
const LLM_MODEL = Deno.env.get("LLM_MODEL") ?? "gpt-4o-mini";
const AUTH_SECRET = Deno.env.get("AGENT_RUNNER_SECRET") ?? "";  // shared secret for HTTP auth

// ── LLM types ─────────────────────────────────────────────────────────────

type LlmMessage = { role: "system" | "user"; content: string };

type AgentDecision = {
  state: "active" | "paused" | "completed" | "failed";
  summary: string | null;
  new_tasks: Array<{
    title: string;
    description?: string;
    priority?: "low" | "medium" | "high";
    estimated_minutes?: number;
  }> | null;
  memory_updates: Array<{
    type: "fact" | "behavior" | "relation" | "insight";
    content: string;
    confidence?: number;
  }> | null;
  insight: string | null;
  terminate: boolean;
  rationale: string | null;
};

// ── LLM call ──────────────────────────────────────────────────────────────

async function chatJson<T>(messages: LlmMessage[]): Promise<T | null> {
  const res = await fetch(LLM_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LLM_KEY}`,
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages,
      temperature: 0.3,
      max_tokens: 1000,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`LLM error ${res.status}:`, text.slice(0, 200));
    return null;
  }
  const data = await res.json();
  const raw: string = data.choices?.[0]?.message?.content ?? "";
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Try extracting JSON from markdown code fence
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    try {
      return JSON.parse(cleaned) as T;
    } catch {
      return null;
    }
  }
}

// ── Agent execution prompt (mirrors agent-runtime.ts) ─────────────────────

const PROMPT = `You are an AI Life OS Agent Runtime worker. You are given ONE agent and its full context. Your job is to produce a structured execution step.

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
- Tasks must have an action verb and be specific.`;

// ── Context builder ───────────────────────────────────────────────────────

function buildContext(agent: Record<string, unknown>, goal: Record<string, unknown> | null, memoryNodes: Record<string, unknown>[], tasks: Record<string, unknown>[]): string {
  const lines: string[] = [];
  const out = (agent.output_stream as Array<{ at: string; summary?: string }>) ?? [];

  lines.push(`## Agent: ${agent.objective}`);
  lines.push(`Type: ${agent.type} | State: ${agent.state} | Priority: ${agent.priority}`);
  lines.push(`Confidence: ${Number(agent.confidence).toFixed(2)}`);

  if (goal) {
    lines.push(`\n## Linked Goal: ${goal.title}`);
    lines.push(`Progress: ${(Number(goal.progress) * 100).toFixed(0)}%`);
  }

  if (tasks.length > 0) {
    lines.push(`\n## Linked Tasks (${tasks.length} open)`);
    for (const t of tasks) {
      lines.push(`- [${t.status}] ${t.title}`);
    }
  }

  if (memoryNodes.length > 0) {
    lines.push(`\n## Linked Memory (${memoryNodes.length} nodes)`);
    for (const n of memoryNodes) {
      lines.push(`- [${n.type}] ${String(n.content).slice(0, 200)}`);
    }
  }

  if (out.length > 0) {
    lines.push(`\n## Recent Outputs (${out.length})`);
    for (const e of out.slice(-3)) {
      lines.push(`- ${e.at}: ${e.summary ?? "(no summary)"}`);
    }
  }

  return lines.join("\n");
}

function nextUpdateAt(cycle: string): string {
  const now = Date.now();
  const ms =
    cycle === "real_time" ? 60_000
    : cycle === "daily" ? 24 * 3600_000
    : cycle === "weekly" ? 7 * 24 * 3600_000
    : 6 * 3600_000;
  return new Date(now + ms).toISOString();
}

// ── Main handler ──────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Auth check
  if (AUTH_SECRET) {
    const auth = req.headers.get("authorization") ?? "";
    const got = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (got !== AUTH_SECRET) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Query all due agents across all users (service_role bypasses RLS)
  const nowIso = new Date().toISOString();
  const { data: dueAgents, error: queryErr } = await client
    .from("agents")
    .select("*")
    .in("state", ["active", "running"])
    .or(`next_update.is.null,next_update.lte.${nowIso}`)
    .limit(50);  // batch size — process in waves

  if (queryErr) {
    console.error("query error:", queryErr);
    return new Response(JSON.stringify({ error: queryErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results: Array<{ id: string; newState: string; summary: string }> = [];

  for (const agent of (dueAgents ?? [])) {
    try {
      // Load linked context
      const [goalRes, tasksRes, memoryRes] = await Promise.all([
        agent.linked_goal_id
          ? client.from("goals").select("*").eq("id", agent.linked_goal_id).single()
          : Promise.resolve({ data: null }),
        client.from("tasks").select("*").eq("linked_goal_id", agent.linked_goal_id).in("status", ["pending", "doing"]),
        client.from("memory_nodes").select("*").in("id", (agent.memory_links as string[]) ?? []),
      ]);

      const goal = goalRes.data;
      const tasks = tasksRes.data ?? [];
      const memoryNodes = memoryRes.data ?? [];

      // Build context and call LLM
      const ctx = buildContext(agent, goal, memoryNodes, tasks);
      const decision = await chatJson<AgentDecision>([
        { role: "system", content: PROMPT },
        { role: "user", content: ctx },
      ]);

      if (!decision) {
        // LLM failed → pause agent
        await client.from("agents").update({
          state: "paused",
          last_update: nowIso,
          next_update: nextUpdateAt((agent.update_cycle as string) ?? "event_triggered"),
        }).eq("id", agent.id);
        results.push({ id: agent.id as string, newState: "paused", summary: "LLM call failed" });
        continue;
      }

      // ── Create tasks ────────────────────────────────────────────────
      for (const t of (decision.new_tasks ?? [])) {
        await client.from("tasks").insert({
          user_id: agent.user_id,
          title: t.title,
          description: t.description ?? null,
          priority: t.priority ?? "medium",
          estimated_minutes: t.estimated_minutes ?? null,
          linked_goal_id: agent.linked_goal_id,
        });
      }

      // ── Create / update memory ──────────────────────────────────────
      const newMemoryIds: string[] = [];
      for (const m of (decision.memory_updates ?? [])) {
        const { data: mem } = await client.from("memory_nodes").insert({
          user_id: agent.user_id,
          type: m.type,
          content: m.content,
          confidence: m.confidence ?? 0.55,
          source: `agent:${agent.id}`,
        }).select("id").single();
        if (mem) newMemoryIds.push(mem.id as string);
      }

      // ── Update agent state ──────────────────────────────────────────
      const newState = decision.terminate ? "completed" : (decision.state ?? "active");
      const mergedLinks = [...new Set([...(agent.memory_links as string[]), ...newMemoryIds])];

      await client.from("agents").update({
        state: newState,
        last_update: nowIso,
        next_update: (newState === "completed" || newState === "failed") ? null : nextUpdateAt((agent.update_cycle as string) ?? "event_triggered"),
        confidence: decision.terminate ? 1 : Math.min(1, ((agent.confidence as number) ?? 0.5) + 0.02),
        memory_links: mergedLinks,
        output_stream: [
          ...((agent.output_stream as unknown[]) ?? []),
          { at: nowIso, state: newState, summary: decision.summary, insight: decision.insight },
        ],
      }).eq("id", agent.id);

      results.push({ id: agent.id as string, newState, summary: decision.summary ?? "" });
    } catch (err) {
      console.error(`agent ${agent.id} failed:`, err);
      // Pause on error to prevent tight retry loops
      await client.from("agents").update({
        state: "paused",
        last_update: nowIso,
        next_update: nextUpdateAt("event_triggered"),
      }).eq("id", agent.id);
      results.push({ id: agent.id as string, newState: "paused", summary: "execution error" });
    }
  }

  return new Response(
    JSON.stringify({ processed: results.length, results }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
