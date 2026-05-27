import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import type { ScheduleItem } from "@/types/aurora";

// Foreground display config — show the alert + play a sound when a
// reminder fires while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowAlert: true,
  }),
});

export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    const cur = await Notifications.getPermissionsAsync();
    if (cur.status === "granted") return true;
    const req = await Notifications.requestPermissionsAsync();
    return req.status === "granted";
  } catch (err) {
    console.warn("[notif] perm error", err);
    return false;
  }
}

function parseHHMM(time: string): { h: number; m: number } | null {
  const t = (time || "").trim();
  if (!t) return null;
  const hm = t.match(/(\d{1,2})[:：](\d{2})/);
  if (hm) return { h: Math.min(23, parseInt(hm[1], 10)), m: parseInt(hm[2], 10) };
  const h = t.match(/(\d{1,2})\s*(?:点|时)/);
  if (h) {
    let hr = parseInt(h[1], 10);
    if (/下午|晚|傍晚/.test(t) && hr < 12) hr += 12;
    return { h: Math.min(23, hr), m: 0 };
  }
  if (/早/.test(t)) return { h: 8, m: 0 };
  if (/上午/.test(t)) return { h: 10, m: 0 };
  if (/中午/.test(t)) return { h: 12, m: 0 };
  if (/下午/.test(t)) return { h: 15, m: 0 };
  if (/晚/.test(t)) return { h: 20, m: 0 };
  return null;
}

function buildTriggerDate(item: ScheduleItem): Date | null {
  const base = item.date ? new Date(item.date + "T00:00:00") : new Date();
  const parsed = parseHHMM(item.time);
  if (!parsed) return null; // skip items without a real time
  base.setHours(parsed.h, parsed.m, 0, 0);
  // Fire 10 minutes before the event for a "heads up"
  base.setMinutes(base.getMinutes() - 10);
  if (base.getTime() < Date.now() + 30_000) return null;
  return base;
}

/**
 * Cancel all previously scheduled Aurora reminders and re-create them based on
 * the current schedule. Items without a parseable time, items in the past,
 * and completed items are skipped.
 */
export async function rescheduleAll(items: ScheduleItem[]): Promise<number> {
  if (Platform.OS === "web") return 0;
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch (err) {
    console.warn("[notif] cancel failed", err);
  }
  let count = 0;
  for (const s of items) {
    if (s.done) continue;
    const when = buildTriggerDate(s);
    if (!when) continue;
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `${s.time} · ${s.title}`,
          body: "Aurora 提醒：还有 10 分钟",
          sound: "default",
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: when,
        },
      });
      count += 1;
    } catch (err) {
      console.warn("[notif] schedule failed", err);
    }
  }
  return count;
}

export async function cancelAllReminders(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch (err) {
    console.warn("[notif] cancel all failed", err);
  }
}
