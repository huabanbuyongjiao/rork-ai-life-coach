export type ModuleColor =
  | "amber"
  | "lavender"
  | "mint"
  | "sky"
  | "rose"
  | "peach";

export type LifeModule = {
  id: string;
  title: string;
  summary: string;
  color: ModuleColor;
  progress: number;
  /** AI-expanded detail in markdown (key steps, recommendations). */
  detail?: string;
  /** When the detail was last generated. */
  detailUpdatedAt?: number;
};

export type ScheduleItem = {
  id: string;
  time: string;
  title: string;
  kind: "study" | "work" | "sleep" | "health" | "break" | "other";
  done?: boolean;
  /** ISO YYYY-MM-DD — the calendar date this task belongs to. If absent,
   * treated as today. Historical tasks keep their original date and are NEVER
   * auto-moved forward. */
  date?: string;
  /** Timestamp (ms) when the task was marked done. Lets us preserve completion
   * history on the original date. */
  completedAt?: number;
  /** Lifecycle status. Derived from `done` for backwards compat. */
  status?: "pending" | "done";
  /** When true, AI reconcile / AI edit will skip this item. Set automatically
   * for items imported from iOS calendar / reminders, and can be toggled
   * manually per item. */
  locked?: boolean;
  /** Where this item came from. "ios" = imported from iOS calendar/reminders;
   * "plan" = added from a milestone / module / coach plan; otherwise manual/ai. */
  source?: "ios" | "plan" | "ai" | "manual";
  /** When source === "ios", the original event / reminder id so we can mirror
   * completion back (mark the iOS reminder done when the user checks it). */
  iosId?: string;
  /** Type of the iOS-side record. Only reminders support completion sync. */
  iosType?: "event" | "reminder";
};

export type AgentTask = {
  id: string;
  title: string;
  description: string;
  kind: "homework" | "checkin" | "research" | "draft" | "plan" | "other";
  status?: "suggested" | "running" | "done";
  result?: string;
  /** User pinned this agent to the top of the list. */
  pinned?: boolean;
};

export type UserContext = {
  facts: string[];
  modules: LifeModule[];
};

export type ChatFileAttachment = {
  name: string;
  size: number;
  mimeType: string;
  /** Inlined text content for text-like files (truncated). */
  textPreview?: string;
};

export type ChatMessageRecord = {
  id: string;
  role: "user" | "assistant";
  text: string;
  images?: string[]; // data URIs
  files?: ChatFileAttachment[];
  createdAt: number;
};

export type ChatSession = {
  id: string;
  title: string;
  createdAt: number;
  endedAt: number;
  messages: ChatMessageRecord[];
};

export type Milestone = {
  title: string;
  when: string;
  done?: boolean;
  /** Concrete sub-steps the user can act on day-to-day. */
  tasks?: { title: string; done?: boolean }[];
  /** When true, Aurora will NOT auto-rewrite this milestone. Locked
   * automatically when any of its tasks is added to the weekly plan. */
  locked?: boolean;
};

export type Goal = {
  id: string;
  title: string;
  horizon: string;
  summary: string;
  milestones: Milestone[];
  createdAt: number;
  /** When locked, Aurora will NOT auto-rewrite this goal/milestones from chat. */
  locked?: boolean;
};
