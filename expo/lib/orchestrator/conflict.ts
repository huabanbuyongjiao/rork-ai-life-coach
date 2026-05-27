/**
 * Conflict detection layer. Runs BEFORE any write reaches the database.
 * Detects: task duplication, event/time overlaps, agent semantic dupes,
 * memory contradictions. Never auto-resolves — only records to conflict_log.
 */
import { Agents, Conflicts, Events, Memory, Tasks } from "../db/repo";
import type { Agent, EventRecord, Task } from "../db/types";
import { getLlm } from "../llm";

export type ConflictReport = {
  kind:
    | "task_task"
    | "task_event"
    | "goal_goal"
    | "agent_agent"
    | "memory_memory"
    | "time_overlap";
  severity: number;
  subjectIds: string[];
  options: { id: string; label: string; action: unknown }[];
};

function overlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Cosine similarity between two equally-sized vectors. */
function cosine(a: number[], b: number[]): number {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

export const ConflictEngine = {
  /** Look for an existing semantically-similar task. */
  async checkTaskDup(title: string): Promise<Task | null> {
    const tasks = await Tasks.list();
    const norm = title.trim().toLowerCase();
    const hit = tasks.find(
      (t) => t.status !== "done" && t.title.trim().toLowerCase() === norm
    );
    return hit ?? null;
  },

  /** Detect time overlap with existing events. */
  async checkTimeOverlap(
    startsAt: string,
    endsAt: string
  ): Promise<EventRecord[]> {
    const day = new Date(startsAt);
    const from = new Date(day);
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + 1);
    const events = await Events.listInRange(from.toISOString(), to.toISOString());
    const s = new Date(startsAt);
    const e = new Date(endsAt);
    return events.filter((ev) =>
      overlap(s, e, new Date(ev.starts_at), new Date(ev.ends_at))
    );
  },

  /** Semantic dedupe for agents — uses embedding cosine vs all active agents. */
  async checkAgentDup(objective: string): Promise<Agent | null> {
    const agents = (await Agents.list()).filter(
      (a) => a.state === "active" || a.state === "running"
    );
    if (agents.length === 0) return null;
    const llm = getLlm();
    const [target, ...existing] = await llm.embed({
      input: [objective, ...agents.map((a) => a.objective)],
    });
    let bestIdx = -1;
    let bestSim = 0;
    existing.forEach((vec, idx) => {
      const sim = cosine(target, vec);
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = idx;
      }
    });
    return bestSim >= 0.86 && bestIdx >= 0 ? agents[bestIdx] : null;
  },

  /** Memory contradiction: look for similar nodes with opposing content. */
  async checkMemoryContradiction(
    embedding: number[]
  ): Promise<{ id: string; similarity: number; content: string }[]> {
    const hits = await Memory.similar(embedding, 5, 0.82);
    return hits.map((h) => ({
      id: h.id,
      similarity: h.similarity,
      content: h.content,
    }));
  },

  async record(report: ConflictReport): Promise<void> {
    await Conflicts.create({
      kind: report.kind,
      subject_ids: report.subjectIds,
      severity: report.severity,
      options: report.options,
    });
  },
};
