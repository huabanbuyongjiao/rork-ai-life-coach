/**
 * Typed CRUD repository for every core entity.
 * Every write goes through here so we have a single audit / validation surface.
 * RLS in Postgres enforces user isolation — these helpers just inject user_id.
 */
import { requireUserId, supabase } from "../supabase/client";
import type {
  Agent,
  AgentState,
  ConflictLog,
  EventRecord,
  Goal,
  MemoryEdge,
  MemoryNode,
  Task,
  TaskStatus,
} from "./types";

// ---------- Tasks ----------------------------------------------------------
export const Tasks = {
  async list(): Promise<Task[]> {
    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as Task[];
  },
  async create(input: Partial<Task> & Pick<Task, "title">): Promise<Task> {
    const user_id = await requireUserId();
    const { data, error } = await supabase
      .from("tasks")
      .insert({ ...input, user_id })
      .select()
      .single();
    if (error) throw error;
    return data as Task;
  },
  async update(id: string, patch: Partial<Task>): Promise<Task> {
    const { data, error } = await supabase
      .from("tasks")
      .update(patch)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data as Task;
  },
  async setStatus(id: string, status: TaskStatus): Promise<void> {
    const { error } = await supabase.from("tasks").update({ status }).eq("id", id);
    if (error) throw error;
  },
  async remove(id: string): Promise<void> {
    const { error } = await supabase.from("tasks").delete().eq("id", id);
    if (error) throw error;
  },
};

// ---------- Goals ----------------------------------------------------------
export const Goals = {
  async list(): Promise<Goal[]> {
    const { data, error } = await supabase
      .from("goals")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as Goal[];
  },
  async create(input: Partial<Goal> & Pick<Goal, "title">): Promise<Goal> {
    const user_id = await requireUserId();
    const { data, error } = await supabase
      .from("goals")
      .insert({ ...input, user_id })
      .select()
      .single();
    if (error) throw error;
    return data as Goal;
  },
  async update(id: string, patch: Partial<Goal>): Promise<Goal> {
    const { data, error } = await supabase
      .from("goals")
      .update(patch)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data as Goal;
  },
  async remove(id: string): Promise<void> {
    const { error } = await supabase.from("goals").delete().eq("id", id);
    if (error) throw error;
  },
};

// ---------- Agents ---------------------------------------------------------
export const Agents = {
  async list(): Promise<Agent[]> {
    const { data, error } = await supabase
      .from("agents")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as Agent[];
  },
  async create(
    input: Partial<Agent> & Pick<Agent, "objective">
  ): Promise<Agent> {
    const user_id = await requireUserId();
    const { data, error } = await supabase
      .from("agents")
      .insert({ ...input, user_id, state: input.state ?? "active" })
      .select()
      .single();
    if (error) throw error;
    return data as Agent;
  },
  async update(id: string, patch: Partial<Agent>): Promise<Agent> {
    const { data, error } = await supabase
      .from("agents")
      .update(patch)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data as Agent;
  },
  async setState(id: string, state: AgentState): Promise<void> {
    const { error } = await supabase.from("agents").update({ state }).eq("id", id);
    if (error) throw error;
  },
  async dueForUpdate(): Promise<Agent[]> {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from("agents")
      .select("*")
      .in("state", ["active", "running"])
      .or(`next_update.is.null,next_update.lte.${nowIso}`);
    if (error) throw error;
    return (data ?? []) as Agent[];
  },
};

// ---------- Events ---------------------------------------------------------
export const Events = {
  async listInRange(fromIso: string, toIso: string): Promise<EventRecord[]> {
    const { data, error } = await supabase
      .from("events")
      .select("*")
      .gte("starts_at", fromIso)
      .lte("starts_at", toIso)
      .order("starts_at", { ascending: true });
    if (error) throw error;
    return (data ?? []) as EventRecord[];
  },
  async create(
    input: Partial<EventRecord> & Pick<EventRecord, "title" | "starts_at" | "ends_at">
  ): Promise<EventRecord> {
    const user_id = await requireUserId();
    const { data, error } = await supabase
      .from("events")
      .insert({ ...input, user_id })
      .select()
      .single();
    if (error) throw error;
    return data as EventRecord;
  },
  async remove(id: string): Promise<void> {
    const { error } = await supabase.from("events").delete().eq("id", id);
    if (error) throw error;
  },
};

// ---------- Memory ---------------------------------------------------------
export const Memory = {
  async list(limit = 200): Promise<MemoryNode[]> {
    const { data, error } = await supabase
      .from("memory_nodes")
      .select("*")
      .order("last_seen_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as MemoryNode[];
  },
  async create(input: Partial<MemoryNode> & Pick<MemoryNode, "type" | "content">): Promise<MemoryNode> {
    const user_id = await requireUserId();
    const { data, error } = await supabase
      .from("memory_nodes")
      .insert({ ...input, user_id })
      .select()
      .single();
    if (error) throw error;
    return data as MemoryNode;
  },
  async update(id: string, patch: Partial<MemoryNode>): Promise<MemoryNode> {
    const { data, error } = await supabase
      .from("memory_nodes")
      .update(patch)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data as MemoryNode;
  },
  /** Strengthen an existing node (called when the same fact recurs). */
  async reinforce(id: string, gain = 0.08): Promise<void> {
    const { data, error } = await supabase
      .from("memory_nodes")
      .select("confidence, evidence_count")
      .eq("id", id)
      .single();
    if (error) throw error;
    const next = Math.min(1, (data?.confidence ?? 0.5) + gain);
    await supabase
      .from("memory_nodes")
      .update({
        confidence: next,
        evidence_count: (data?.evidence_count ?? 1) + 1,
        last_seen_at: new Date().toISOString(),
      })
      .eq("id", id);
  },
  async similar(embedding: number[], k = 5, threshold = 0.78): Promise<
    { id: string; type: string; content: string; confidence: number; similarity: number }[]
  > {
    const { data, error } = await supabase.rpc("match_memory", {
      query_embedding: embedding,
      match_threshold: threshold,
      match_count: k,
    });
    if (error) throw error;
    return (data ?? []) as {
      id: string;
      type: string;
      content: string;
      confidence: number;
      similarity: number;
    }[];
  },
  async addEdge(
    from_node: string,
    to_node: string,
    relation: string,
    weight = 0.5
  ): Promise<MemoryEdge | null> {
    const user_id = await requireUserId();
    const { data, error } = await supabase
      .from("memory_edges")
      .upsert(
        { user_id, from_node, to_node, relation, weight },
        { onConflict: "from_node,to_node,relation" }
      )
      .select()
      .single();
    if (error) return null;
    return data as MemoryEdge;
  },
};

// ---------- Conflicts -----------------------------------------------------
export const Conflicts = {
  async open(): Promise<ConflictLog[]> {
    const { data, error } = await supabase
      .from("conflict_log")
      .select("*")
      .eq("status", "open")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as ConflictLog[];
  },
  async create(
    input: Pick<ConflictLog, "kind" | "subject_ids"> &
      Partial<Pick<ConflictLog, "severity" | "options">>
  ): Promise<ConflictLog> {
    const user_id = await requireUserId();
    const { data, error } = await supabase
      .from("conflict_log")
      .insert({ ...input, user_id })
      .select()
      .single();
    if (error) throw error;
    return data as ConflictLog;
  },
  async resolve(id: string, resolution: unknown): Promise<void> {
    const { error } = await supabase
      .from("conflict_log")
      .update({
        status: "resolved",
        resolution,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) throw error;
  },
  async dismiss(id: string): Promise<void> {
    const { error } = await supabase
      .from("conflict_log")
      .update({ status: "dismissed", resolved_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
  },
};

// ---------- Orchestrator audit log ----------------------------------------
export const AuditLog = {
  async write(entry: {
    input: string;
    intent: string;
    confidence: number;
    mode: string;
    action: unknown;
    rationale: string;
  }): Promise<void> {
    const user_id = await requireUserId();
    await supabase.from("orchestrator_log").insert({ ...entry, user_id });
  },
};
