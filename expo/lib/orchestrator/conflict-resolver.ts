/**
 * Conflict Resolution Engine — executes the user's chosen resolution action.
 *
 * When the ConflictEngine detects a conflict, it records a conflict_log row
 * with `options[]` — each option has an `id` + `action` payload. The user picks
 * an option via the UI, and the Resolver carries it out.
 *
 * Supported strategies:
 *   - merge      Merge two entities into one (tasks, agents, goals, memory)
 *   - split      Split overlapping time across two events
 *   - keep       Keep one side, drop the other
 *   - keep_both  Keep both but mark low confidence / pause low-priority agent
 *   - cancel     Dismiss the conflict without any write
 */

import { Agents, Conflicts, Events, Goals, Memory, Tasks } from "../db/repo";
import type {
  Agent,
  ConflictLog,
  EventRecord,
  Goal,
  MemoryNode,
  Task,
} from "../db/types";

// ── Public types ──────────────────────────────────────────────────────────

export type ResolutionOutcome = {
  /** Human-readable message for the UI. */
  message: string;
  /** Ids that were affected (created, updated, deleted). */
  affectedIds: string[];
};

// ── Main entry point ──────────────────────────────────────────────────────

export const ConflictResolver = {
  /**
   * Resolve an open conflict by executing the user-chosen option.
   * After execution the conflict is marked as resolved.
   */
  async resolve(
    conflictId: string,
    optionId: string,
  ): Promise<ResolutionOutcome> {
    const conflict = await Conflicts.open().then(
      (rows) => rows.find((c) => c.id === conflictId) ?? null,
    );
    if (!conflict) throw new Error(`Conflict ${conflictId} not found`);
    if (conflict.status !== "open")
      throw new Error(`Conflict ${conflictId} is already ${conflict.status}`);

    const chosen = conflict.options.find(
      (o: { id: string }) => o.id === optionId,
    );
    if (!chosen) throw new Error(`Option ${optionId} not found in conflict`);

    // Execute
    const outcome = await executeResolution(conflict, chosen);

    // Mark resolved
    await Conflicts.resolve(conflictId, { chosen: optionId });

    return outcome;
  },

  /** Dismiss without action. */
  async dismiss(conflictId: string): Promise<void> {
    await Conflicts.dismiss(conflictId);
  },
};

// ── Resolution dispatcher ─────────────────────────────────────────────────

async function executeResolution(
  conflict: ConflictLog,
  option: { id: string; label: string; action: unknown },
): Promise<ResolutionOutcome> {
  switch (conflict.kind) {
    case "task_task":
      return resolveTaskVsTask(conflict, option);
    case "task_event":
      return resolveTaskVsEvent(conflict, option);
    case "goal_goal":
      return resolveGoalVsGoal(conflict, option);
    case "agent_agent":
      return resolveAgentVsAgent(conflict, option);
    case "memory_memory":
      return resolveMemoryVsMemory(conflict, option);
    case "time_overlap":
      return resolveTimeOverlap(conflict, option);
    default:
      return { message: "Unknown conflict kind.", affectedIds: [] };
  }
}

// ── Task vs Task ──────────────────────────────────────────────────────────

async function resolveTaskVsTask(
  conflict: ConflictLog,
  option: { id: string; action: unknown },
): Promise<ResolutionOutcome> {
  const [existingId] = conflict.subject_ids;
  const act = option.action as Record<string, unknown> | undefined;

  if (option.id === "merge") {
    // Merge the new task into the existing one — just reinforce the existing,
    // the new task was never created (the engine blocked it).
    // If the action carries a new task payload, update the existing task.
    if (act && act.title) {
      await Tasks.update(existingId, {
        title: act.title as string,
        description: (act.description as string) ?? undefined,
        priority: (act.priority as string) ?? undefined,
      } as Partial<Task>);
    }
    return {
      message: `Merged into existing task.`,
      affectedIds: [existingId],
    };
  }

  if (option.id === "create_anyway") {
    // The caller (Orchestrator.commit) already has the payload; re-run
    // TaskEngine.create with allowDuplicate to force-create.
    if (act && act.title) {
      const { task } = await Tasks.create({
        title: act.title as string,
        description: (act.description as string) ?? undefined,
        priority: (act.priority as string) ?? undefined,
      } as Partial<Task> & Pick<Task, "title">);
      return { message: `Created as new task.`, affectedIds: [task.id] };
    }
    return { message: `Duplicate allowed (no payload).`, affectedIds: [] };
  }

  if (option.id === "cancel") {
    return { message: `Cancelled — no task created.`, affectedIds: [] };
  }

  return { message: `Resolved.`, affectedIds: [] };
}

// ── Task vs Event ─────────────────────────────────────────────────────────

async function resolveTaskVsEvent(
  _conflict: ConflictLog,
  option: { id: string; action: unknown },
): Promise<ResolutionOutcome> {
  if (option.id === "keep_task") return { message: "Task kept.", affectedIds: [] };
  if (option.id === "keep_event") return { message: "Event kept.", affectedIds: [] };
  if (option.id === "keep_both") return { message: "Both kept.", affectedIds: [] };
  return { message: "Resolved.", affectedIds: [] };
}

// ── Goal vs Goal ──────────────────────────────────────────────────────────

async function resolveGoalVsGoal(
  conflict: ConflictLog,
  option: { id: string; action: unknown },
): Promise<ResolutionOutcome> {
  const [existingId] = conflict.subject_ids;
  const act = option.action as Record<string, unknown> | undefined;

  if (option.id === "merge") {
    if (act && act.title) {
      await Goals.update(existingId, {
        title: act.title as string,
        rationale: (act.rationale as string) ?? undefined,
      } as Partial<Goal>);
    }
    return { message: "Goals merged.", affectedIds: [existingId] };
  }

  if (option.id === "create_anyway") {
    if (act && act.title) {
      const goal = await Goals.create({
        title: act.title as string,
        rationale: (act.rationale as string) ?? undefined,
        horizon: (act.horizon as string) ?? undefined,
      } as Partial<Goal> & Pick<Goal, "title">);
      return { message: "Goal created.", affectedIds: [goal.id] };
    }
    return { message: "New goal created.", affectedIds: [] };
  }

  if (option.id === "cancel") {
    return { message: "Cancelled.", affectedIds: [] };
  }

  return { message: "Resolved.", affectedIds: [] };
}

// ── Agent vs Agent ────────────────────────────────────────────────────────

async function resolveAgentVsAgent(
  conflict: ConflictLog,
  option: { id: string; action: unknown },
): Promise<ResolutionOutcome> {
  const [existingId] = conflict.subject_ids;
  const act = option.action as Record<string, unknown> | undefined;

  if (option.id === "merge") {
    // Boost the existing agent's confidence
    const agent = await Agents.update(existingId, {
      confidence: 1,
    } as Partial<Agent>);
    return {
      message: `Merged into "${agent.objective}".`,
      affectedIds: [existingId],
    };
  }

  if (option.id === "pause_low_priority") {
    // Pause the lower-priority agent
    await Agents.setState(existingId, "paused");
    return { message: "Lower-priority agent paused.", affectedIds: [existingId] };
  }

  if (option.id === "create_anyway") {
    if (act && act.objective) {
      // Force-spawn bypassing the dup check
      const agent = await Agents.create({
        objective: act.objective as string,
        type: (act.type as string) ?? undefined,
        update_cycle: (act.update_cycle as string) ?? undefined,
      } as Partial<Agent> & Pick<Agent, "objective">);
      return {
        message: `Agent "${agent.objective}" spawned.`,
        affectedIds: [agent.id],
      };
    }
    return { message: "Agent spawned.", affectedIds: [] };
  }

  if (option.id === "cancel") {
    return { message: "Cancelled.", affectedIds: [] };
  }

  return { message: "Resolved.", affectedIds: [] };
}

// ── Memory vs Memory ──────────────────────────────────────────────────────

async function resolveMemoryVsMemory(
  conflict: ConflictLog,
  option: { id: string; action: unknown },
): Promise<ResolutionOutcome> {
  const act = option.action as Record<string, unknown> | undefined;

  if (option.id === "keep_old") {
    // Drop the new (contradictory) node
    const dropId = act?.drop as string | undefined;
    if (dropId) {
      // Soft-delete: set confidence to 0 (decay/prune will clean it up)
      await Memory.update(dropId, { confidence: 0 } as Partial<MemoryNode>);
    }
    return {
      message: `Kept existing memory, discarded new.`,
      affectedIds: conflict.subject_ids,
    };
  }

  if (option.id === "keep_new") {
    const dropId = act?.drop as string | undefined;
    if (dropId) {
      await Memory.update(dropId, { confidence: 0 } as Partial<MemoryNode>);
    }
    return {
      message: `Kept new memory, discarded old.`,
      affectedIds: conflict.subject_ids,
    };
  }

  if (option.id === "keep_both") {
    // Both stay at low confidence — the system will re-evaluate as new data arrives
    return {
      message: `Both memories kept at low confidence.`,
      affectedIds: conflict.subject_ids,
    };
  }

  return { message: "Resolved.", affectedIds: [] };
}

// ── Time Overlap ──────────────────────────────────────────────────────────

async function resolveTimeOverlap(
  conflict: ConflictLog,
  option: { id: string; action: unknown },
): Promise<ResolutionOutcome> {
  const act = option.action as Record<string, unknown> | undefined;

  if (option.id === "keep_existing") {
    return {
      message: "Existing event kept, new event discarded.",
      affectedIds: conflict.subject_ids,
    };
  }

  if (option.id === "create_anyway") {
    if (act && act.title) {
      const event = await Events.create({
        title: act.title as string,
        starts_at: act.starts_at as string,
        ends_at: act.ends_at as string,
      } as Partial<EventRecord> & Pick<EventRecord, "title" | "starts_at" | "ends_at">);
      return {
        message: `Overlapping event "${event.title}" created.`,
        affectedIds: [event.id],
      };
    }
    return { message: "Overlapping event created.", affectedIds: [] };
  }

  if (option.id === "cancel") {
    return { message: "Cancelled.", affectedIds: [] };
  }

  return { message: "Resolved.", affectedIds: [] };
}
