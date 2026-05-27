import type { ScheduleItem } from "@/types/aurora";
import { chatJson } from "@/lib/ai";

/** Self-reported physical states. Each value is a unix-ms timestamp of the
 * LAST time the user did the thing. Absent = "we don't know yet". */
export type LifeStates = {
  lastMealAt?: number;
  lastShowerAt?: number;
  lastSleepAt?: number;
};

export type NowNeedKey = "eat" | "shower" | "sleep" | "break";

export type NowSuggestion =
  | {
      kind: "need";
      need: NowNeedKey;
      emoji: string;
      title: string;
      reason: string;
      estMin: number;
    }
  | {
      kind: "task";
      item: ScheduleItem;
      emoji: string;
      title: string;
      reason: string;
      estMin: number;
    };

const HOUR = 60 * 60 * 1000;

/** ISO YYYY-MM-DD from a Date in the user's local timezone. */
function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parse the leading HH:MM out of a schedule item's time string. */
function timeMinutes(t: string): number | null {
  const x = (t || "").trim();
  if (!x || /全天|all\s*day/i.test(x)) return null;
  const m = x.match(/(\d{1,2})[:：](\d{2})/);
  if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  return null;
}

function estimateMinutes(kind: ScheduleItem["kind"]): number {
  switch (kind) {
    case "study":
      return 25;
    case "work":
      return 30;
    case "health":
      return 20;
    case "break":
      return 10;
    case "sleep":
      return 30;
    default:
      return 15;
  }
}

/** Build the 3 candidate "human need" suggestions with their scores given the
 * current clock + the user's self-reported `lifeStates`. Each candidate is
 * returned only if it deserves to surface right now. */
function needCandidates(
  now: Date,
  lifeStates: LifeStates
): Array<{ s: NowSuggestion; score: number }> {
  const out: Array<{ s: NowSuggestion; score: number }> = [];
  const t = now.getTime();
  const hour = now.getHours();
  const min = hour * 60 + now.getMinutes();

  // ── HUNGER ────────────────────────────────────────────────────────────
  const inBreakfast = min >= 7 * 60 && min <= 9 * 60 + 30;
  const inLunch = min >= 11 * 60 + 30 && min <= 13 * 60 + 30;
  const inDinner = min >= 18 * 60 && min <= 20 * 60;
  const mealName = inBreakfast
    ? "早饭"
    : inLunch
    ? "午饭"
    : inDinner
    ? "晚饭"
    : "一顿饭";

  if (lifeStates.lastMealAt) {
    const sinceH = (t - lifeStates.lastMealAt) / HOUR;
    if (sinceH >= 5 && (inBreakfast || inLunch || inDinner)) {
      out.push({
        s: {
          kind: "need",
          need: "eat",
          emoji: "🍱",
          title: `去吃${mealName}`,
          reason: `已经 ${Math.round(sinceH)} 小时没吃东西 · ${
            inLunch ? "午餐时间" : inDinner ? "晚餐时间" : "早餐时间"
          }`,
          estMin: 30,
        },
        score: 100,
      });
    } else if (sinceH >= 7) {
      out.push({
        s: {
          kind: "need",
          need: "eat",
          emoji: "🍱",
          title: "吃点东西",
          reason: `已经 ${Math.round(sinceH)} 小时没吃了 · 先补充能量`,
          estMin: 25,
        },
        score: 90,
      });
    }
  } else if (inLunch || inDinner) {
    // No data: gentle nudge only during the actual meal window.
    out.push({
      s: {
        kind: "need",
        need: "eat",
        emoji: "🍱",
        title: `去吃${mealName}`,
        reason: `现在 ${String(hour).padStart(2, "0")}:${String(
          now.getMinutes()
        ).padStart(2, "0")} · ${inLunch ? "午餐时间" : "晚餐时间"}`,
        estMin: 30,
      },
      score: 75,
    });
  }

  // ── HYGIENE (shower) ──────────────────────────────────────────────────
  if (lifeStates.lastShowerAt) {
    const sinceH = (t - lifeStates.lastShowerAt) / HOUR;
    const sinceDays = sinceH / 24;
    if (sinceDays >= 2) {
      const days = Math.floor(sinceDays);
      out.push({
        s: {
          kind: "need",
          need: "shower",
          emoji: "🚿",
          title: "去洗个澡",
          reason: `已经 ${days} 天没洗澡 · 简单的卫生会让人立刻清醒`,
          estMin: 15,
        },
        score: days >= 3 ? 95 : 90,
      });
    }
  }

  // ── SLEEP ─────────────────────────────────────────────────────────────
  const isLate = hour >= 23 || hour < 4;
  if (lifeStates.lastSleepAt) {
    const sinceH = (t - lifeStates.lastSleepAt) / HOUR;
    if (sinceH >= 18) {
      out.push({
        s: {
          kind: "need",
          need: "sleep",
          emoji: "🌙",
          title: "去睡觉",
          reason: `已经 ${Math.round(sinceH)} 小时没睡 · 睡眠不足会拖累一切`,
          estMin: 30,
        },
        score: 95,
      });
    } else if (isLate && sinceH >= 14) {
      out.push({
        s: {
          kind: "need",
          need: "sleep",
          emoji: "🌙",
          title: "去睡觉",
          reason: `现在 ${String(hour).padStart(2, "0")}:${String(
            now.getMinutes()
          ).padStart(2, "0")} · 该休息了`,
          estMin: 30,
        },
        score: 85,
      });
    }
  } else if (isLate) {
    // No data + late: gentle low-score nudge that loses to anything else.
    out.push({
      s: {
        kind: "need",
        need: "sleep",
        emoji: "🌙",
        title: "去睡觉",
        reason: `现在 ${String(hour).padStart(2, "0")}:${String(
          now.getMinutes()
        ).padStart(2, "0")} · 已经很晚了`,
        estMin: 30,
      },
      score: 70,
    });
  }

  return out;
}

/** Build task candidates with scores. Overdue >> today >> future. */
function taskCandidates(
  now: Date,
  schedule: ScheduleItem[]
): Array<{ s: NowSuggestion; score: number }> {
  const todayKey = isoDate(now);
  const pending = schedule.filter(
    (it) => !it.done && it.date !== "" && (it.date ?? todayKey).length > 0
  );
  const out: Array<{ s: NowSuggestion; score: number }> = [];

  // Overdue → take the oldest.
  const overdue = pending.filter((s) => (s.date ?? todayKey) < todayKey);
  if (overdue.length > 0) {
    const pick = overdue
      .slice()
      .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))[0];
    const days = Math.max(
      1,
      Math.round(
        (new Date(todayKey).getTime() -
          new Date(pick.date ?? todayKey).getTime()) /
          (24 * HOUR)
      )
    );
    out.push({
      s: {
        kind: "task",
        item: pick,
        emoji: "⏰",
        title: pick.title,
        reason:
          days === 1
            ? "已过期 1 天 · 优先完成"
            : `已过期 ${days} 天 · 直接拖累节奏`,
        estMin: estimateMinutes(pick.kind),
      },
      score: days >= 2 ? 85 : 70,
    });
  }

  // Today → nearest upcoming.
  const todays = pending.filter((s) => (s.date ?? todayKey) === todayKey);
  if (todays.length > 0) {
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const pick = todays.slice().sort((a, b) => {
      const ka = timeMinutes(a.time);
      const kb = timeMinutes(b.time);
      const dist = (k: number | null): number =>
        k === null
          ? 1_000_000
          : k >= nowMin
          ? k - nowMin
          : 100_000 + (nowMin - k);
      return dist(ka) - dist(kb);
    })[0];
    const k = timeMinutes(pick.time);
    const reason =
      k === null
        ? "今天的安排 · 现在就开始"
        : k >= nowMin
        ? "今天接下来的安排"
        : "今天的安排 · 已稍微延后";
    out.push({
      s: {
        kind: "task",
        item: pick,
        emoji: "📌",
        title: pick.title,
        reason,
        estMin: estimateMinutes(pick.kind),
      },
      score: 60,
    });
  }

  // Future → next upcoming.
  const future = pending.filter((s) => (s.date ?? todayKey) > todayKey);
  if (future.length > 0 && out.length === 0) {
    const pick = future
      .slice()
      .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))[0];
    out.push({
      s: {
        kind: "task",
        item: pick,
        emoji: "🗓",
        title: pick.title,
        reason: "下一个待办 · 提前准备",
        estMin: estimateMinutes(pick.kind),
      },
      score: 20,
    });
  }

  return out;
}

/** Rule-based Now Engine (kept as a deterministic fallback when AI is
 * unavailable). Returns the single best suggestion across human needs and
 * tasks, or null if there's nothing meaningful to say. */
export function computeNow(input: {
  now: Date;
  schedule: ScheduleItem[];
  lifeStates: LifeStates;
}): NowSuggestion | null {
  const needs = needCandidates(input.now, input.lifeStates);
  const tasks = taskCandidates(input.now, input.schedule);
  const all = [...needs, ...tasks];
  if (all.length === 0) return null;
  // Highest score wins. Ties broken by needs first (basic human needs).
  all.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.s.kind === b.s.kind) return 0;
    return a.s.kind === "need" ? -1 : 1;
  });
  return all[0].s;
}

/** Build all viable candidates (needs + tasks) without final scoring — these
 * are handed to the LLM, which does the real "which one matters most right
 * now" reasoning. */
function buildCandidates(
  now: Date,
  schedule: ScheduleItem[],
  lifeStates: LifeStates
): NowSuggestion[] {
  // Reuse the rule-based candidate builders to enumerate options, then strip
  // the scores — the LLM picks the winner.
  const needs = needCandidates(now, lifeStates).map((c) => c.s);
  const tasks = taskCandidates(now, schedule).map((c) => c.s);
  // Also surface a few extra task candidates the rule engine might have
  // skipped (e.g. multiple overdue tasks) so the LLM has real choice.
  const todayKey = isoDate(now);
  const extraOverdue = schedule
    .filter((s) => !s.done && s.date && s.date !== "" && s.date < todayKey)
    .slice()
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))
    .slice(0, 4)
    .map((pick) => {
      const days = Math.max(
        1,
        Math.round(
          (new Date(todayKey).getTime() -
            new Date(pick.date ?? todayKey).getTime()) /
            (24 * HOUR)
        )
      );
      const s: NowSuggestion = {
        kind: "task",
        item: pick,
        emoji: "⏰",
        title: pick.title,
        reason: `已过期 ${days} 天`,
        estMin: estimateMinutes(pick.kind),
      };
      return s;
    });
  const extraToday = schedule
    .filter((s) => !s.done && (s.date ?? todayKey) === todayKey)
    .slice(0, 4)
    .map((pick) => {
      const s: NowSuggestion = {
        kind: "task",
        item: pick,
        emoji: "📌",
        title: pick.title,
        reason: pick.time ? `今天 ${pick.time}` : "今天",
        estMin: estimateMinutes(pick.kind),
      };
      return s;
    });

  // De-dupe (a task may appear in both the rule pick and extra list).
  const seen = new Set<string>();
  const all: NowSuggestion[] = [];
  for (const c of [...needs, ...tasks, ...extraOverdue, ...extraToday]) {
    const key = c.kind === "need" ? `need:${c.need}` : `task:${c.item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    all.push(c);
  }
  return all;
}

/** Compact, human-readable description of a candidate for the LLM prompt. */
function describeCandidate(c: NowSuggestion, idx: number): string {
  if (c.kind === "need") {
    return `${idx}. [need:${c.need}] ${c.emoji} ${c.title} — ${c.reason} (~${c.estMin}min)`;
  }
  const it = c.item;
  const d = it.date ? `date=${it.date}` : "undated";
  const t = it.time ? ` time=${it.time}` : "";
  const k = it.kind ? ` kind=${it.kind}` : "";
  return `${idx}. [task:${it.id}] ${c.emoji} ${it.title} — ${c.reason} (${d}${t}${k}, ~${c.estMin}min)`;
}

function formatLifeStates(now: Date, ls: LifeStates): string[] {
  const t = now.getTime();
  const fmt = (ts?: number): string => {
    if (!ts) return "未知";
    const h = (t - ts) / HOUR;
    if (h < 1) return `${Math.round(h * 60)} 分钟前`;
    if (h < 48) return `${Math.round(h)} 小时前`;
    return `${Math.round(h / 24)} 天前`;
  };
  return [
    `- 上次吃饭: ${fmt(ls.lastMealAt)}`,
    `- 上次洗澡: ${fmt(ls.lastShowerAt)}`,
    `- 上次睡觉: ${fmt(ls.lastSleepAt)}`,
  ];
}

const NOW_SYSTEM_PROMPT = `You are the "Now Engine" — the real-time decision core of an AI life assistant.
Your ONLY job: pick the SINGLE BEST next action for the user, RIGHT NOW.

Scoring priorities (highest first):
1. Basic human needs (hunger, sleep deprivation, hygiene) — these almost always win
2. Overdue tasks (longer overdue → more urgent)
3. Today's high-impact / time-sensitive tasks
4. Goal-aligned work

Rules:
- Pick ONE candidate from the provided list. Never invent new actions.
- If a basic human need is present and severe, it wins over any task.
- Be decisive, calm, minimal. No multi-option output.
- Reason must be 1 short sentence in Chinese, reference time / behavior / task / goal.
- Keep the title short and natural in Chinese.

Return JSON ONLY in this exact shape:
{
  "pickId": "need:eat" | "need:shower" | "need:sleep" | "task:<id>",
  "title": "<short Chinese title>",
  "reason": "<1 short Chinese sentence>",
  "emoji": "<one emoji>",
  "estMin": <integer minutes>
}`;

type AIPick = {
  pickId: string;
  title?: string;
  reason?: string;
  emoji?: string;
  estMin?: number;
};

/** AI-powered Now Engine. Enumerates candidates deterministically, then asks
 * the LLM to score & pick the winner with a 1-line Chinese explanation.
 * Falls back to the rule-based `computeNow` on any failure. */
export async function computeNowAI(input: {
  now: Date;
  schedule: ScheduleItem[];
  lifeStates: LifeStates;
}): Promise<NowSuggestion | null> {
  const candidates = buildCandidates(input.now, input.schedule, input.lifeStates);
  if (candidates.length === 0) return null;
  // Single candidate — no point asking the model.
  if (candidates.length === 1) return candidates[0];

  const candById = new Map<string, NowSuggestion>();
  candidates.forEach((c) => {
    const id = c.kind === "need" ? `need:${c.need}` : `task:${c.item.id}`;
    candById.set(id, c);
  });

  const userBlock = [
    `当前候选行动（只能从中挑 1 个）：`,
    ...candidates.map((c, i) => describeCandidate(c, i + 1)),
    "",
    `用户基本状态：`,
    ...formatLifeStates(input.now, input.lifeStates),
    "",
    `请从上面候选里挑出现在最该做的 1 件，按要求返回 JSON。`,
  ].join("\n");

  try {
    const pick = await chatJson<AIPick>({
      messages: [
        { role: "system", content: NOW_SYSTEM_PROMPT },
        { role: "user", content: userBlock },
      ],
      temperature: 0.2,
      max_tokens: 200,
    });
    if (!pick || !pick.pickId) {
      return computeNow(input);
    }
    const chosen = candById.get(pick.pickId);
    if (!chosen) return computeNow(input);
    // Let the model refine the user-facing copy, but preserve the candidate's
    // identity (need key or task item) so taps still work.
    return {
      ...chosen,
      title: (pick.title || chosen.title).trim(),
      reason: (pick.reason || chosen.reason).trim(),
      emoji: (pick.emoji || chosen.emoji).trim(),
      estMin:
        typeof pick.estMin === "number" && pick.estMin > 0
          ? Math.round(pick.estMin)
          : chosen.estMin,
    } as NowSuggestion;
  } catch {
    return computeNow(input);
  }
}
