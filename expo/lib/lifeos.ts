import type { ScheduleItem, TodayFocus } from "@/types/aurora";

export type IntakeSource =
  | "capture"
  | "chatgpt"
  | "claude"
  | "manual"
  | "webhook";

export type LifeOSIntake = {
  rawInput: string;
  source: IntakeSource | string;
  timestamp: string;
  conversationSummary?: string;
  externalConversationId?: string;
};

export type LifeOSPlan = {
  nowCard: TodayFocus;
  timeline: ScheduleItem[];
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toHHMM(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60 * 1000);
}

function roundUpToFive(d: Date): Date {
  const next = new Date(d);
  const minute = next.getMinutes();
  const rounded = Math.ceil(minute / 5) * 5;
  next.setMinutes(rounded, 0, 0);
  return next;
}

function inferKind(title: string): ScheduleItem["kind"] {
  if (/睡|休息|午休|break/i.test(title)) return "break";
  if (/健身|运动|跑步|walk|gym/i.test(title)) return "health";
  if (/课|考试|报告|复习|学习|作业|study|exam/i.test(title)) return "study";
  if (/项目|工作|写|改|做|开发|work|code/i.test(title)) return "work";
  return "other";
}

export function createLifeOSIntake(
  rawInput: string,
  source: IntakeSource | string = "capture",
  options?: {
    timestamp?: string;
    conversationSummary?: string;
    externalConversationId?: string;
  },
): LifeOSIntake {
  return {
    rawInput,
    source,
    timestamp: options?.timestamp ?? new Date().toISOString(),
    conversationSummary: options?.conversationSummary,
    externalConversationId: options?.externalConversationId,
  };
}

export function buildTodayPlanFromFocus(
  focus: TodayFocus,
  existingSchedule: ScheduleItem[],
  now: Date = new Date(),
): LifeOSPlan {
  const start = roundUpToFive(now);
  const end = addMinutes(start, focus.duration);
  const date = toISODate(start);
  const startTime = toHHMM(start);
  const endTime = toHHMM(end);
  const existing = existingSchedule.find(
    (item) =>
      (item.date ?? date) === date &&
      item.source === "ai" &&
      item.title.trim() === focus.task.trim(),
  );

  const timelineItem: ScheduleItem = {
    id: existing?.id ?? `lifeos_${Date.now().toString(36)}`,
    time: `${startTime}-${endTime}`,
    startTime,
    endTime,
    title: focus.task,
    kind: inferKind(focus.task),
    date,
    status: existing?.status ?? "pending",
    done: existing?.done,
    priority: focus.status === "high" ? "high" : "medium",
    minimumAction: focus.nextAction,
    reason: focus.tip || "由 Capture 自动生成的当前行动。",
    source: "ai",
  };

  return {
    nowCard: focus,
    timeline: [timelineItem],
  };
}

export function mergeTodayPlanIntoSchedule(
  schedule: ScheduleItem[],
  plan: LifeOSPlan,
): ScheduleItem[] {
  const byId = new Map(schedule.map((item) => [item.id, item]));
  for (const item of plan.timeline) {
    byId.set(item.id, { ...byId.get(item.id), ...item });
  }
  return Array.from(byId.values());
}
