import {
  buildTodayPlanFromFocus,
  createLifeOSIntake,
  type LifeOSIntake,
  type LifeOSPlan,
} from "@/lib/lifeos";
import type { ScheduleItem, TodayFocus } from "@/types/aurora";

export type LifeOSIntakeRequest = {
  rawInput: string;
  source?: "chatgpt" | "claude" | "capture" | "manual" | "webhook" | string;
  timestamp?: string;
  conversationSummary?: string;
  externalConversationId?: string;
};

export type LifeOSStoredIntake = {
  id: string;
  receivedAt: string;
  request: LifeOSIntakeRequest;
};

export type LifeOSIntakeResult = {
  intake: LifeOSIntake;
  plan: LifeOSPlan;
};

export function planFromParsedFocus(
  request: LifeOSIntakeRequest,
  focus: TodayFocus,
  existingSchedule: ScheduleItem[],
): LifeOSIntakeResult {
  const intake = {
    ...createLifeOSIntake(request.rawInput, request.source ?? "chatgpt", {
      timestamp: request.timestamp,
      conversationSummary: request.conversationSummary,
      externalConversationId: request.externalConversationId,
    }),
  };
  return {
    intake,
    plan: buildTodayPlanFromFocus(focus, existingSchedule, new Date(intake.timestamp)),
  };
}
