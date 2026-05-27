import * as Calendar from "expo-calendar";
import { Platform } from "react-native";

import type { ScheduleItem } from "@/types/aurora";

const CAL_TITLE = "Aurora";

async function getOrCreateAuroraCalendar(): Promise<string | null> {
  const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const existing = cals.find((c) => c.title === CAL_TITLE && c.allowsModifications);
  if (existing) return existing.id;

  if (Platform.OS === "ios") {
    const sources = await Calendar.getSourcesAsync();
    const local =
      sources.find((s) => s.type === Calendar.SourceType.LOCAL) ||
      sources.find((s) => s.name === "iCloud") ||
      sources[0];
    if (!local) return null;
    return Calendar.createCalendarAsync({
      title: CAL_TITLE,
      color: "#F4B860",
      entityType: Calendar.EntityTypes.EVENT,
      sourceId: local.id,
      source: { id: local.id, name: local.name, type: local.type },
      name: CAL_TITLE,
      ownerAccount: local.name,
      accessLevel: Calendar.CalendarAccessLevel.OWNER,
    });
  }

  // Android: pick a writable calendar or fall back to first
  const writable = cals.find((c) => c.allowsModifications);
  return writable ? writable.id : cals[0]?.id ?? null;
}

/** Parse a free-form time string into an hour [0-23]. Returns null when unknown. */
function parseTimeHour(time: string): { h: number; m: number } | null {
  const t = (time || "").trim();
  if (!t) return null;
  const hm = t.match(/(\d{1,2})[:：](\d{2})/);
  if (hm) return { h: Math.min(23, parseInt(hm[1], 10)), m: parseInt(hm[2], 10) };
  const h = t.match(/(\d{1,2})\s*(?:点|时)/);
  if (h) {
    let hr = parseInt(h[1], 10);
    if (/下午|晚|傍晚/.test(t) && hr < 12) hr += 12;
    if (/上午|早/.test(t) && hr === 12) hr = 0;
    return { h: Math.min(23, hr), m: 0 };
  }
  if (/早/.test(t)) return { h: 8, m: 0 };
  if (/上午/.test(t)) return { h: 10, m: 0 };
  if (/中午/.test(t)) return { h: 12, m: 0 };
  if (/下午/.test(t)) return { h: 15, m: 0 };
  if (/傍晚/.test(t)) return { h: 18, m: 0 };
  if (/晚/.test(t)) return { h: 20, m: 0 };
  if (/凌晨/.test(t)) return { h: 1, m: 0 };
  return null;
}

function buildDateRange(item: ScheduleItem): { start: Date; end: Date; allDay: boolean } {
  const base = item.date ? new Date(item.date + "T00:00:00") : new Date();
  const parsed = parseTimeHour(item.time);
  if (!parsed) {
    const start = new Date(base);
    start.setHours(9, 0, 0, 0);
    const end = new Date(start);
    end.setHours(start.getHours() + 1);
    return { start, end, allDay: true };
  }
  const start = new Date(base);
  start.setHours(parsed.h, parsed.m, 0, 0);
  const end = new Date(start);
  end.setHours(end.getHours() + 1);
  return { start, end, allDay: false };
}

export async function ensureCalendarPermission(): Promise<boolean> {
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  return status === "granted";
}

async function ensureRemindersPermission(): Promise<boolean> {
  if (Platform.OS !== "ios") return false;
  try {
    const { status } = await Calendar.requestRemindersPermissionsAsync();
    return status === "granted";
  } catch {
    return false;
  }
}

/** Normalize a title for fuzzy comparison with existing calendar events. */
function normTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(
      /[\s·・｜\.,!！，。:：、（）()\[\]【】"'“”‘’\-_]/g,
      ""
    )
    // Strip emoji and pictographs so "健身 🏋" matches "健身".
    .replace(
      /[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE0F}\u{200D}]/gu,
      ""
    )
    .trim();
}

/**
 * Stricter fuzzy match: only flag as duplicate if titles are essentially the
 * same thing, not just sharing a couple of common Chinese characters.
 */
function isLikelyDup(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  // Short reminder titles (e.g. "健身" / "跑步") fully contained in a longer
  // event title ("健身房教练课") are almost always referring to the
  // same thing. Treat 2-char full containment as a dup.
  if (shorter.length >= 2 && longer.includes(shorter)) return true;
  // Otherwise require >= 60% overlap by long common substring.
  if (shorter.length < 4) return false;
  const need = Math.max(3, Math.ceil(shorter.length * 0.6));
  for (let i = 0; i + need <= shorter.length; i++) {
    const sub = shorter.slice(i, i + need);
    if (longer.includes(sub)) return true;
  }
  return false;
}

/**
 * Returns true if iOS already has an event OR reminder on the same day whose
 * title fuzzy-matches the incoming item (e.g. "健身" reminder already exists,
 * we should not duplicate it).
 */
async function alreadyOnCalendar(
  item: ScheduleItem,
  start: Date,
  calendarIds: string[],
  reminderListIds: string[]
): Promise<boolean> {
  try {
    const dayStart = new Date(start);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(start);
    dayEnd.setHours(23, 59, 59, 999);
    const want = normTitle(item.title);
    if (want.length === 0) return false;

    const existing = await Calendar.getEventsAsync(
      calendarIds,
      dayStart,
      dayEnd
    );
    const eventDup = existing.some((e) => {
      const have = normTitle(e.title || "");
      if (!have) return false;
      return isLikelyDup(want, have);
    });
    if (eventDup) return true;

    if (Platform.OS === "ios" && reminderListIds.length > 0) {
      try {
        const reminders = await Calendar.getRemindersAsync(
          reminderListIds,
          null,
          dayStart,
          dayEnd
        );
        const remDup = reminders.some((r) => {
          const have = normTitle(r.title || "");
          if (!have) return false;
          return isLikelyDup(want, have);
        });
        if (remDup) return true;
      } catch (err) {
        console.warn("[calendar] reminders read failed", err);
      }
    }
    return false;
  } catch (err) {
    console.warn("[calendar] dedup check failed", err);
    return false;
  }
}

/** All readable EVENT calendars EXCLUDING Aurora's own calendar (so we only
 * dedup against the user's pre-existing events / reminders). */
async function getReadableCalendarIds(excludeId?: string): Promise<string[]> {
  const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  return cals
    .filter((c) => c.title !== CAL_TITLE && c.id !== excludeId)
    .map((c) => c.id);
}

async function getReminderListIds(): Promise<string[]> {
  if (Platform.OS !== "ios") return [];
  try {
    const lists = await Calendar.getCalendarsAsync(Calendar.EntityTypes.REMINDER);
    return lists.map((c) => c.id);
  } catch {
    return [];
  }
}

export async function addItemToCalendar(
  item: ScheduleItem
): Promise<string | null> {
  const ok = await ensureCalendarPermission();
  if (!ok) throw new Error("未获得日历权限");
  await ensureRemindersPermission();
  const calId = await getOrCreateAuroraCalendar();
  if (!calId) throw new Error("找不到可写入的日历");
  const { start, end, allDay } = buildDateRange(item);
  const allCals = await getReadableCalendarIds(calId);
  const reminderLists = await getReminderListIds();
  if (allCals.length > 0 && (await alreadyOnCalendar(item, start, allCals, reminderLists))) {
    throw new Error("日历中已存在同样的事件·跳过");
  }
  const eventId = await Calendar.createEventAsync(calId, {
    title: item.title,
    startDate: start,
    endDate: end,
    allDay,
    notes: `Aurora · ${item.kind}`,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  return eventId;
}

export type BulkSyncResult = {
  added: number;
  skipped: number;
  eventIds: string[];
};

export async function addManyToCalendar(
  items: ScheduleItem[]
): Promise<BulkSyncResult> {
  if (items.length === 0) return { added: 0, skipped: 0, eventIds: [] };
  const ok = await ensureCalendarPermission();
  if (!ok) throw new Error("未获得日历权限");
  await ensureRemindersPermission();
  const calId = await getOrCreateAuroraCalendar();
  if (!calId) throw new Error("找不到可写入的日历");
  const allCals = await getReadableCalendarIds(calId);
  const reminderLists = await getReminderListIds();
  let added = 0;
  let skipped = 0;
  const eventIds: string[] = [];
  for (const item of items) {
    const { start, end, allDay } = buildDateRange(item);
    try {
      const dup =
        (allCals.length > 0 || reminderLists.length > 0) &&
        (await alreadyOnCalendar(item, start, allCals, reminderLists));
      if (dup) {
        skipped += 1;
        continue;
      }
      const id = await Calendar.createEventAsync(calId, {
        title: item.title,
        startDate: start,
        endDate: end,
        allDay,
        notes: `Aurora · ${item.kind}`,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      eventIds.push(id);
      added += 1;
    } catch (err) {
      console.warn("[calendar] add failed", err);
    }
  }
  return { added, skipped, eventIds };
}

export type ImportedCalendarItem = {
  title: string;
  time: string;
  date: string;
  kind: ScheduleItem["kind"];
  iosId?: string;
  iosType?: "event" | "reminder";
};

/** Read iOS calendar events + reminders and return as schedule-like items.
 * Excludes events in Aurora's own calendar so we don't double-import. */
export async function readFromCalendar(): Promise<ImportedCalendarItem[]> {
  const ok = await ensureCalendarPermission();
  if (!ok) throw new Error("未获得日历权限");
  await ensureRemindersPermission();

  const auroraCal = await getOrCreateAuroraCalendar();

  // All readable EVENT calendars EXCEPT Aurora's own
  const eventCals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const eventCalIds = eventCals
    .filter((c) => c.id !== auroraCal)
    .map((c) => c.id);

  // Look ahead 6 weeks and back 1 week
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 7);
  const to = new Date(now);
  to.setDate(to.getDate() + 42);

  const items: ImportedCalendarItem[] = [];

  // Read events (max 200)
  if (eventCalIds.length > 0) {
    try {
      const events = await Calendar.getEventsAsync(eventCalIds, from, to);
      for (const e of events) {
        if (!e.title || e.title.trim().length === 0) continue;
        const start = new Date(e.startDate);
        const date = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
        const hh = String(start.getHours()).padStart(2, "0");
        const mm = String(start.getMinutes()).padStart(2, "0");
        const time = e.allDay ? "全天" : `${hh}:${mm}`;
        items.push({
          title: e.title,
          time,
          date,
          kind: "other",
          iosId: e.id,
          iosType: "event",
        });
      }
    } catch (err) {
      console.warn("[calendar] read events failed", err);
    }
  }

  // Read reminders (iOS only)
  if (Platform.OS === "ios") {
    try {
      const reminderLists = await Calendar.getCalendarsAsync(Calendar.EntityTypes.REMINDER);
      const reminderIds = reminderLists.map((c) => c.id);
      if (reminderIds.length > 0) {
        const reminders = await Calendar.getRemindersAsync(reminderIds, null, from, to);
        for (const r of reminders) {
          if (!r.title || r.title.trim().length === 0) continue;
          if (r.completed) continue; // skip completed reminders
          // If the reminder has no real due date, mark it as undated
          // (date = "") so today/week/month views don't show it; it
          // lives in a separate "提醒事项" section.
          if (!r.dueDate) {
            items.push({
              title: r.title,
              time: "",
              date: "",
              kind: "other",
              iosId: r.id,
              iosType: "reminder",
            });
            continue;
          }
          const dd = new Date(r.dueDate);
          const date = `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, "0")}-${String(dd.getDate()).padStart(2, "0")}`;
          const hh = String(dd.getHours()).padStart(2, "0");
          const mm = String(dd.getMinutes()).padStart(2, "0");
          items.push({
            title: r.title,
            time: `${hh}:${mm}`,
            date,
            kind: "other",
            iosId: r.id,
            iosType: "reminder",
          });
        }
      }
    } catch (err) {
      console.warn("[calendar] read reminders failed", err);
    }
  }

  return items;
}

/** Set the completion state of an iOS reminder so the app and iOS stay in
 * sync when the user checks/unchecks an imported reminder. Silently no-ops
 * for non-reminder items and on non-iOS platforms. */
export async function setIOSReminderCompleted(
  reminderId: string,
  completed: boolean
): Promise<boolean> {
  if (Platform.OS !== "ios" || !reminderId) return false;
  try {
    const ok = await ensureRemindersPermission();
    if (!ok) return false;
    await Calendar.updateReminderAsync(reminderId, { completed });
    return true;
  } catch (err) {
    console.warn("[calendar] update reminder completion failed", err);
    return false;
  }
}

/** Delete events created via Aurora (used for undoing a bulk sync). */
export async function removeFromCalendar(eventIds: string[]): Promise<number> {
  if (eventIds.length === 0) return 0;
  let removed = 0;
  for (const id of eventIds) {
    try {
      await Calendar.deleteEventAsync(id);
      removed += 1;
    } catch (err) {
      console.warn("[calendar] delete failed", err);
    }
  }
  return removed;
}
