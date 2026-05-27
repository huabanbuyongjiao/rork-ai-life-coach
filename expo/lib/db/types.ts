/**
 * TypeScript mirror of the Postgres schema (see lib/supabase/schema.sql).
 * Keep in sync when migrating the DB.
 */
export type TaskStatus = "pending" | "doing" | "done" | "archived";
export type Priority = "low" | "medium" | "high";
export type GoalHorizon = "short" | "medium" | "long";
export type AgentType =
  | "research"
  | "execution"
  | "monitoring"
  | "optimization";
export type AgentState =
  | "created"
  | "active"
  | "running"
  | "paused"
  | "completed"
  | "failed";
export type AgentCycle = "real_time" | "event_triggered" | "daily" | "weekly";
export type MemoryType = "fact" | "behavior" | "relation" | "insight";
export type EventSource = "user" | "system" | "import" | "ai";
export type ConflictKind =
  | "task_task"
  | "task_event"
  | "goal_goal"
  | "agent_agent"
  | "memory_memory"
  | "time_overlap";
export type ConflictStatus = "open" | "resolved" | "dismissed";

export type Task = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  linked_goal_id: string | null;
  estimated_minutes: number | null;
  deadline: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type Goal = {
  id: string;
  user_id: string;
  title: string;
  rationale: string | null;
  horizon: GoalHorizon;
  progress: number;
  parent_goal_id: string | null;
  locked: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type Agent = {
  id: string;
  user_id: string;
  objective: string;
  type: AgentType;
  state: AgentState;
  priority: Priority;
  linked_goal_id: string | null;
  update_cycle: AgentCycle;
  confidence: number;
  input_stream: unknown[];
  output_stream: unknown[];
  memory_links: string[];
  last_update: string | null;
  next_update: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type EventRecord = {
  id: string;
  user_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  source: EventSource;
  external_id: string | null;
  locked: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type MemoryNode = {
  id: string;
  user_id: string;
  type: MemoryType;
  content: string;
  confidence: number;
  decay_rate: number;
  source: string | null;
  evidence_count: number;
  last_seen_at: string;
  embedding: number[] | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type MemoryEdge = {
  id: string;
  user_id: string;
  from_node: string;
  to_node: string;
  relation: string;
  weight: number;
  created_at: string;
};

export type ConflictLog = {
  id: string;
  user_id: string;
  kind: ConflictKind;
  severity: number;
  status: ConflictStatus;
  subject_ids: string[];
  options: { id: string; label: string; action: unknown }[];
  resolution: unknown | null;
  created_at: string;
  resolved_at: string | null;
};
