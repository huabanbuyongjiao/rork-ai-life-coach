import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import {
  BookOpen,
  Briefcase,
  CalendarDays,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Check,
  Coffee,
  ExternalLink,
  Heart,
  Inbox,
  MessageCircle,
  Moon,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Sparkles,
  Target,
  Trash2,
  Wand2,
  X,
} from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Animated as RNAnimated,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Swipeable } from "react-native-gesture-handler";

import AuroraBackground from "@/components/AuroraBackground";
import GlassCard from "@/components/GlassCard";
import Markdown from "@/components/Markdown";
import ModuleCard from "@/components/ModuleCard";
import { theme } from "@/constants/theme";
import {
  addManyToCalendar,
  readFromCalendar,
  removeFromCalendar,
  setIOSReminderCompleted,
} from "@/lib/calendarSync";
import { getGreeting, suggestedSleepText } from "@/lib/timeUtils";
import { useAurora } from "@/providers/AuroraProvider";
import { computeNow, computeNowAI, type NowNeedKey } from "@/lib/nowEngine";
import { useQuery } from "@tanstack/react-query";
import { Bell, BellOff, Lock, LockOpen } from "lucide-react-native";
import {
  cancelAllReminders,
  ensureNotificationPermission,
  rescheduleAll,
} from "@/lib/notifications";
import { useGmail } from "@/providers/GmailProvider";
import type { Goal, LifeModule, ScheduleItem } from "@/types/aurora";
import { ChevronDown, ChevronUp } from "lucide-react-native";

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Sort key for a schedule item time string. All-day / empty / unknown
 * times go to the top (negative key); parseable HH:MM times sort by minute. */
function timeSortKey(t: string): number {
  const x = (t || "").trim();
  if (!x || /全天|all\s*day/i.test(x)) return -1;
  const m = x.match(/(\d{1,2})[:：](\d{2})/);
  if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  const h = x.match(/(\d{1,2})\s*(?:点|时)/);
  if (h) {
    let hr = parseInt(h[1], 10);
    if (/下午|晚|傍晚/.test(x) && hr < 12) hr += 12;
    return hr * 60;
  }
  if (/凌晨/.test(x)) return 60;
  if (/早/.test(x)) return 8 * 60;
  if (/上午/.test(x)) return 10 * 60;
  if (/中午/.test(x)) return 12 * 60;
  if (/下午/.test(x)) return 15 * 60;
  if (/傍晚/.test(x)) return 18 * 60;
  if (/晚/.test(x)) return 20 * 60;
  // Unknown time strings (e.g. "今天") go to the bottom of the list.
  return 24 * 60;
}

/** Pick an emoji that matches a goal title. Falls back to a generic target. */
function goalEmoji(title: string): string {
  const t = (title || "").toLowerCase();
  if (/健身|减肥|训练|跑步|运动|gym|fitness|exercise|workout/.test(t)) return "💪";
  if (/雅思|ielts|toefl|托福|英语|语言|口语/.test(t)) return "📚";
  if (/省钱|存钱|理财|储蓄|saving|money|finan|预算|budget/.test(t)) return "💰";
  if (/阅读|看书|读书|book|read/.test(t)) return "📖";
  if (/写作|博客|文章|写|writ|blog/.test(t)) return "✍️";
  if (/睡眠|早睡|sleep/.test(t)) return "🌙";
  if (/冥想|正念|meditat|mindful/.test(t)) return "🧘";
  if (/工作|事业|job|career/.test(t)) return "💼";
  if (/学习|考试|学业|study|exam|grade|gpa/.test(t)) return "🎓";
  if (/编程|代码|code|program|开发/.test(t)) return "💻";
  if (/项目|创业|startup|side\s*project/.test(t)) return "🚀";
  if (/旅行|travel|旅游/.test(t)) return "✈️";
  if (/饮食|饭|餐|diet|nutri/.test(t)) return "🥗";
  if (/水|喝水|water|hydrat/.test(t)) return "💧";
  if (/朋友|社交|family|social|relation/.test(t)) return "💞";
  return "🎯";
}

/** Compute goal progress 0–100. Prefers leaf task completion; falls back to
 * milestone completion when a goal hasn't been expanded into tasks yet. */
function computeGoalProgress(g: Goal): number {
  const allTasks = g.milestones.flatMap((m) => m.tasks ?? []);
  if (allTasks.length > 0) {
    const done = allTasks.filter((t) => t.done).length;
    return Math.round((done / allTasks.length) * 100);
  }
  if (g.milestones.length === 0) return 0;
  const done = g.milestones.filter((m) => m.done).length;
  return Math.round((done / g.milestones.length) * 100);
}

function buildWeek(anchor: Date): { iso: string; date: Date }[] {
  const start = new Date(anchor);
  const weekday = (start.getDay() + 6) % 7; // Monday=0
  start.setDate(start.getDate() - weekday);
  return Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return { iso: toISODate(d), date: d };
  });
}

const KINDS: ScheduleItem["kind"][] = [
  "study",
  "work",
  "sleep",
  "health",
  "break",
  "other",
];

function kindIcon(kind: ScheduleItem["kind"]) {
  switch (kind) {
    case "study":
      return BookOpen;
    case "work":
      return Briefcase;
    case "sleep":
      return Moon;
    case "health":
      return Heart;
    case "break":
      return Coffee;
    default:
      return Sparkles;
  }
}

function kindLabel(k: ScheduleItem["kind"]): string {
  return (
    { study: "学习", work: "工作", sleep: "睡眠", health: "健康", break: "休息", other: "其他" } as const
  )[k];
}

type MailProviderId = "icloud" | "outlook" | "qq" | "163";
type MailProviderConfig = {
  email: string;
  password: string;
  savedAt: number;
};
type MailConfigs = Partial<Record<MailProviderId, MailProviderConfig>>;

const MAIL_CONFIG_KEY = "aurora.mail.configs.v1";

const PROVIDER_STEPS: Record<MailProviderId, string[]> = {
  icloud: [
    "点上方橙色「生成专用密码」按钮，会跳转到 appleid.apple.com。",
    "用 Apple ID 登录 →「登录与安全」→「App 专用密码」→生成密码。",
    "名称随便填，例如 Aurora。",
    "拷贝生成的 16 位密码（带连字号）粘到下面的输入框。",
    "要先开启 Apple ID 两步验证才会看到这个选项。",
  ],
  outlook: [
    "点上方橙色按钮跳转到 account.microsoft.com/security。",
    "高级安全选项 → 应用密码 → 创建新应用密码。",
    "拷贝生成的密码粘到下面的输入框。",
    "未开两步验证的账号可以直接填登录密码。",
  ],
  qq: [
    "点上方橙色按钮跳到 QQ 邮箱授权码说明页。",
    "登录 QQ 邮箱 → 设置 → 账户 → 找到 POP3/IMAP/SMTP，开启 IMAP 服务。",
    "手机发验证短信，验证后会生成一个 16 位授权码。",
    "拷贝授权码粘到下面的输入框（不是 QQ 登录密码）。",
  ],
  "163": [
    "点上方橙色按钮跳到 163 邮箱授权码说明。",
    "登录 163 邮箱 → 设置 → POP3/SMTP/IMAP → 勾选「IMAP/SMTP 服务」。",
    "按提示验证手机号，生成一个客户端授权密码。",
    "拷贝该密码粘到下面的输入框（不是邮箱登录密码）。",
  ],
};

const PROVIDER_TUTORIAL_LABEL: Record<MailProviderId, string> = {
  icloud: "生成专用密码",
  outlook: "生成应用密码",
  qq: "生成 QQ 邮箱授权码",
  "163": "生成 163 授权密码",
};

const MAIL_PROVIDERS: ReadonlyArray<{
  id: MailProviderId;
  name: string;
  color: string;
  note: string;
  imapHost: string;
  imapPort: number;
  passwordLabel: string;
  passwordHint: string;
  passwordUrl: string;
}> = [
  {
    id: "icloud",
    name: "iCloud 邮箱",
    color: "#A1A1AA",
    note: "需要 Apple ID 专用密码",
    imapHost: "imap.mail.me.com",
    imapPort: 993,
    passwordLabel: "App 专用密码",
    passwordHint: "在 appleid.apple.com 生成一个 App 专用密码粘这里",
    passwordUrl: "https://appleid.apple.com/account/manage",
  },
  {
    id: "outlook",
    name: "Outlook / Microsoft 365",
    color: "#0078D4",
    note: "支持 outlook.com / hotmail.com / live.com",
    imapHost: "outlook.office365.com",
    imapPort: 993,
    passwordLabel: "账号密码或应用密码",
    passwordHint: "如果开了两步验证，需去微软账户中生成应用密码",
    passwordUrl: "https://account.microsoft.com/security",
  },
  {
    id: "qq",
    name: "QQ 邮箱",
    color: "#1AAD19",
    note: "需在 QQ 邮箱设置生成授权码",
    imapHost: "imap.qq.com",
    imapPort: 993,
    passwordLabel: "IMAP 授权码",
    passwordHint: "QQ 邮箱 → 设置 → 账户 → 开启 IMAP 后生成授权码",
    passwordUrl: "https://wx.mail.qq.com/list/readtemplate?name=app_intro.html#/agreement/authorizationCode",
  },
  {
    id: "163",
    name: "163 邮箱",
    color: "#E53935",
    note: "需开启 IMAP 服务并获取授权码",
    imapHost: "imap.163.com",
    imapPort: 993,
    passwordLabel: "客户端授权密码",
    passwordHint: "163 邮箱 → 设置 → POP3/SMTP/IMAP → 开启后获取授权码",
    passwordUrl: "https://help.mail.163.com/faqDetail.do?code=d7a5dc8471cd0c0e8b4287f3b25d4c33",
  },
];

export default function TodayScreen() {
  const router = useRouter();
  const {
    modules,
    schedule,
    facts,
    addScheduleItem,
    addScheduleFromAI,
    updateScheduleItem,
    editScheduleFromAI,
    deleteScheduleItem,
    goals,
    expandModule,
    addModuleDetailToPlan,
    addTextToPlan,
    chatAboutModule,
    removeModule,
    removeFact,
    updateFact,
    editFactWithAI,
    removeScheduleItems,
    updateModule,
    toggleLockScheduleItem,
    lifeStates,
    logLifeState,
  } = useAurora();
  const [editingModule, setEditingModule] = useState<
    { id: string; title: string; summary: string } | null
  >(null);
  const [remindersOpen, setRemindersOpen] = useState<boolean>(false);
  const [moduleChats, setModuleChats] = useState<
    Record<string, { role: "user" | "assistant"; text: string; id: string }[]>
  >({});
  const [moduleChatInput, setModuleChatInput] = useState<string>("");
  const [moduleChatErr, setModuleChatErr] = useState<string | null>(null);
  const [moduleChatAddingId, setModuleChatAddingId] = useState<string | null>(
    null
  );
  const [editingFact, setEditingFact] = useState<{ index: number; text: string } | null>(null);
  const [factEditMode, setFactEditMode] = useState<"ai" | "manual">("ai");
  const [factAiText, setFactAiText] = useState<string>("");
  const [factAiErr, setFactAiErr] = useState<string | null>(null);
  const [planAddedIds, setPlanAddedIds] = useState<string[]>([]);
  const [moduleToast, setModuleToast] = useState<string | null>(null);
  const [expandErr, setExpandErr] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState<boolean>(false);
  const [aiText, setAiText] = useState<string>("");
  const gmail = useGmail();
  const [gmailToast, setGmailToast] = useState<string | null>(null);
  const [calToast, setCalToast] = useState<string | null>(null);
  const [calBusy, setCalBusy] = useState<boolean>(false);
  const [mailPickerOpen, setMailPickerOpen] = useState<boolean>(false);
  const [providerSheet, setProviderSheet] = useState<MailProviderId | null>(null);
  const [mailConfigs, setMailConfigs] = useState<MailConfigs>({});
  useEffect(() => {
    AsyncStorage.getItem(MAIL_CONFIG_KEY)
      .then((raw) => {
        if (raw) {
          try {
            setMailConfigs(JSON.parse(raw) as MailConfigs);
          } catch {}
        }
      })
      .catch(() => {});
  }, []);
  const persistMailConfigs = useCallback((next: MailConfigs) => {
    setMailConfigs(next);
    AsyncStorage.setItem(MAIL_CONFIG_KEY, JSON.stringify(next)).catch(() => {});
  }, []);
  const [lastSyncIds, setLastSyncIds] = useState<string[]>([]);
  const [remindersOn, setRemindersOn] = useState<boolean>(false);
  useEffect(() => {
    AsyncStorage.getItem("aurora.reminders.on")
      .then((raw) => {
        if (raw === "1") setRemindersOn(true);
      })
      .catch(() => {});
  }, []);
  // Whenever reminders are on, re-schedule whenever the user's schedule changes.
  useEffect(() => {
    if (!remindersOn) return;
    rescheduleAll(schedule).catch(() => {});
  }, [remindersOn, schedule]);
  const [calUndoing, setCalUndoing] = useState<boolean>(false);
  const [calImporting, setCalImporting] = useState<boolean>(false);
  const [lastImportIds, setLastImportIds] = useState<string[]>([]);
  const greeting = useMemo(() => getGreeting(), []);
  const sleepHint = useMemo(() => suggestedSleepText(), []);

  // Tick every minute so time-of-day rules (lunch window, late-night, etc.)
  // re-evaluate without the user having to interact.
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  /** Rule-based Now suggestion — instant, used as fallback while AI is in
   * flight or if the AI call fails. */
  const ruleNow = useMemo(
    () => computeNow({ now: new Date(nowTick), schedule, lifeStates }),
    [nowTick, schedule, lifeStates]
  );

  /** AI-powered Now Engine — the LLM does the actual scoring & picks the
   * single best next action from the candidate list. Re-runs whenever the
   * schedule, life states, or the minute hand changes. */
  const nowAIKey = useMemo(() => {
    const minuteBucket = Math.floor(nowTick / 60_000);
    const scheduleSig = schedule
      .map((s) => `${s.id}:${s.done ? 1 : 0}:${s.date ?? ""}:${s.time ?? ""}`)
      .join("|");
    const lifeSig = `${lifeStates.lastMealAt ?? 0}/${lifeStates.lastShowerAt ?? 0}/${lifeStates.lastSleepAt ?? 0}`;
    return ["now-engine", minuteBucket, scheduleSig, lifeSig] as const;
  }, [nowTick, schedule, lifeStates]);

  const nowQuery = useQuery({
    queryKey: nowAIKey,
    queryFn: () =>
      computeNowAI({ now: new Date(nowTick), schedule, lifeStates }),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: 1,
  });
  const nowSuggestion = nowQuery.data ?? ruleNow;

  const dateStr = useMemo(() => {
    const d = new Date();
    return d.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  }, []);

  const [editingItem, setEditingItem] = useState<ScheduleItem | null>(null);
  const [composerOpen, setComposerOpen] = useState<boolean>(false);
  const [activeModuleId, setActiveModuleId] = useState<string | null>(null);
  const activeModule = useMemo(
    () => modules.find((m) => m.id === activeModuleId) ?? null,
    [modules, activeModuleId]
  );
  const [editMode, setEditMode] = useState<"manual" | "ai">("manual");
  const [aiEditText, setAiEditText] = useState<string>("");
  const todayISO = useMemo(() => toISODate(new Date()), []);
  const [selectedDate, setSelectedDate] = useState<string>(todayISO);
  const [weekAnchor, setWeekAnchor] = useState<Date>(() => new Date());
  const week = useMemo(() => buildWeek(weekAnchor), [weekAnchor]);

  const openNew = useCallback(() => {
    setEditingItem({
      id: `s_${Date.now().toString(36)}`,
      time: "",
      title: "",
      kind: "other",
      date: selectedDate,
    });
    setEditMode("manual");
    setAiEditText("");
    setComposerOpen(true);
  }, [selectedDate]);

  const openEdit = useCallback((s: ScheduleItem) => {
    setEditingItem(s);
    setEditMode("ai");
    setAiEditText("");
    setComposerOpen(true);
  }, []);

  const [viewMode, setViewMode] = useState<"day" | "week" | "month">("day");
  const [monthAnchor, setMonthAnchor] = useState<Date>(() => new Date());

  const [showCompleted, setShowCompleted] = useState<boolean>(false);
  const dayItems = useMemo(
    () =>
      schedule.filter((s) => {
        // Items explicitly marked as undated (date === "") live in the
        // standalone 提醒事项 section, not in day/week/month views.
        if (s.date === "") return false;
        const d = s.date ?? todayISO;
        return d === selectedDate;
      }),
    [schedule, selectedDate, todayISO]
  );
  const undatedReminders = useMemo(
    () => schedule.filter((s) => s.date === "" && !s.done),
    [schedule]
  );
  const filteredSchedule = useMemo(
    () => dayItems.filter((s) => !s.done).slice().sort((a, b) => timeSortKey(a.time) - timeSortKey(b.time)),
    [dayItems]
  );
  const completedToday = useMemo(
    () => dayItems.filter((s) => s.done),
    [dayItems]
  );

  const scheduleCountByDate = useMemo(() => {
    const map = new Map<string, number>();
    schedule.forEach((s) => {
      if (s.date === "") return; // undated items don't affect day counts
      const d = s.date ?? todayISO;
      map.set(d, (map.get(d) ?? 0) + 1);
    });
    return map;
  }, [schedule, todayISO]);

  const saveItem = useCallback(() => {
    if (!editingItem) return;
    if (!editingItem.title.trim()) return;
    const existing = schedule.find((s) => s.id === editingItem.id);
    if (existing) {
      updateScheduleItem(editingItem.id, editingItem);
    } else {
      addScheduleItem(editingItem);
    }
    setComposerOpen(false);
    setEditingItem(null);
    if (Platform.OS !== "web")
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => {}
      );
  }, [editingItem, schedule, addScheduleItem, updateScheduleItem]);

  const toggleDone = useCallback(
    (s: ScheduleItem) => {
      const nextDone = !s.done;
      updateScheduleItem(s.id, { done: nextDone });
      if (Platform.OS !== "web") Haptics.selectionAsync().catch(() => {});
      // Mirror completion back to iOS Reminders when this item came from iOS.
      if (s.source === "ios" && s.iosType === "reminder" && s.iosId) {
        setIOSReminderCompleted(s.iosId, nextDone).catch(() => {});
      }
    },
    [updateScheduleItem]
  );

  // Auto-dismiss the undo buttons after a few seconds so they don't sit in
  // the layout forever once the user has moved on.
  useEffect(() => {
    if (lastSyncIds.length === 0) return;
    const t = setTimeout(() => setLastSyncIds([]), 8000);
    return () => clearTimeout(t);
  }, [lastSyncIds]);
  useEffect(() => {
    if (lastImportIds.length === 0) return;
    const t = setTimeout(() => setLastImportIds([]), 8000);
    return () => clearTimeout(t);
  }, [lastImportIds]);

  return (
    <View style={styles.root}>
      <AuroraBackground />
      <SafeAreaView style={styles.flex} edges={["top"]}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          {/* Hero greeting */}
          <View style={styles.hero}>
            <Text style={styles.dateLabel}>{dateStr.toUpperCase()}</Text>
            <Text style={styles.greeting}>
              {greeting.text}
              <Text style={styles.greetingDim}>，</Text>
            </Text>
            <Text style={styles.tone}>{greeting.tone}</Text>
          </View>

          {/* Today Focus Goals — ambient strip, max 3 visible */}
          {goals.length > 0 && (
            <View style={styles.goalsStripWrap}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.goalsStrip}
              >
                {goals.slice(0, 3).map((g) => {
                  const pct = computeGoalProgress(g);
                  const emoji = goalEmoji(g.title);
                  return (
                    <Pressable
                      key={g.id}
                      onPress={() => {
                        if (Platform.OS !== "web")
                          Haptics.selectionAsync().catch(() => {});
                        router.push("/goals");
                      }}
                      style={({ pressed }) => [
                        styles.goalChip,
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <Text style={styles.goalChipEmoji}>{emoji}</Text>
                      <View style={{ flexShrink: 1, minWidth: 0 }}>
                        <Text style={styles.goalChipTitle} numberOfLines={1}>
                          {g.title}
                        </Text>
                        <View style={styles.goalChipBarTrack}>
                          <View
                            style={[
                              styles.goalChipBarFill,
                              { width: `${Math.max(2, Math.min(100, pct))}%` },
                            ]}
                          />
                        </View>
                      </View>
                      <Text style={styles.goalChipPct}>{pct}%</Text>
                    </Pressable>
                  );
                })}
                {goals.length > 3 && (
                  <Pressable
                    onPress={() => router.push("/goals")}
                    style={({ pressed }) => [
                      styles.goalChipMore,
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <Target size={13} color={theme.amber} />
                    <Text style={styles.goalChipMoreText}>
                      +{goals.length - 3}
                    </Text>
                  </Pressable>
                )}
              </ScrollView>
            </View>
          )}

          {/* Now Engine — one human-need-aware focus nudge */}
          {nowSuggestion && (
            <Pressable
              onPress={() => {
                if (Platform.OS !== "web")
                  Haptics.selectionAsync().catch(() => {});
                if (nowSuggestion.kind === "task") {
                  toggleDone(nowSuggestion.item);
                } else {
                  // Tapping a need card logs it as just-done (eat/shower/sleep).
                  logLifeState(nowSuggestion.need);
                }
              }}
              onLongPress={() => {
                if (nowSuggestion.kind === "task") openEdit(nowSuggestion.item);
              }}
              delayLongPress={300}
              style={({ pressed }) => [pressed && { opacity: 0.88 }]}
            >
              <GlassCard radius={20} style={styles.nudgeCard}>
                <View style={styles.nudgeHead}>
                  <Text style={styles.nudgeFlag}>🔥 Now</Text>
                  <View style={styles.nudgeEstWrap}>
                    <Text style={styles.nudgeEst}>
                      约 {nowSuggestion.estMin} 分钟
                    </Text>
                  </View>
                </View>
                <Text style={styles.nudgeTitle} numberOfLines={2}>
                  {nowSuggestion.emoji} {nowSuggestion.title}
                </Text>
                <View style={styles.nudgeFootRow}>
                  <Text style={styles.nudgeReason} numberOfLines={2}>
                    {nowSuggestion.reason}
                  </Text>
                  <Text style={styles.nudgeHint}>
                    {nowSuggestion.kind === "task"
                      ? "点完成 · 长按编辑"
                      : "点一下表示已做"}
                  </Text>
                </View>
              </GlassCard>
            </Pressable>
          )}

          {/* Quick log — tap a chip to tell Aurora you just did this */}
          <View style={styles.quickLogRow}>
            {([
              { key: "eat" as const, label: "刚吃过", emoji: "🍱", ts: lifeStates.lastMealAt },
              { key: "shower" as const, label: "刚洗过澡", emoji: "🚿", ts: lifeStates.lastShowerAt },
              { key: "sleep" as const, label: "刚睡醒", emoji: "🌙", ts: lifeStates.lastSleepAt },
            ]).map((it) => {
              const since = it.ts ? Date.now() - it.ts : null;
              const sinceLabel = (() => {
                if (since === null) return null;
                const h = Math.floor(since / 3_600_000);
                if (h < 1) return "刚刚";
                if (h < 24) return `${h}h 前`;
                const d = Math.floor(h / 24);
                return `${d}d 前`;
              })();
              return (
                <Pressable
                  key={it.key}
                  onPress={() => {
                    logLifeState(it.key);
                    if (Platform.OS !== "web")
                      Haptics.selectionAsync().catch(() => {});
                  }}
                  style={({ pressed }) => [
                    styles.quickLogChip,
                    pressed && { opacity: 0.7 },
                  ]}
                  hitSlop={4}
                >
                  <Text style={styles.quickLogEmoji}>{it.emoji}</Text>
                  <Text style={styles.quickLogLabel}>{it.label}</Text>
                  {sinceLabel && (
                    <Text style={styles.quickLogSince}>{sinceLabel}</Text>
                  )}
                </Pressable>
              );
            })}
          </View>

          {sleepHint && (
            <GlassCard radius={20} style={styles.sleepCard}>
              <View style={styles.sleepRow}>
                <View style={styles.sleepIcon}>
                  <LinearGradient
                    colors={[theme.lavender, "#7B6BF0"]}
                    style={StyleSheet.absoluteFill}
                  />
                  <Moon size={18} color={theme.bg} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sleepTitle}>该准备休息了</Text>
                  <Text style={styles.sleepSub}>{sleepHint}</Text>
                </View>
              </View>
            </GlassCard>
          )}

          {/* Modules */}
          <SectionHeader
            title="生活模块"
            subtitle={
              modules.length === 0
                ? "和 Aurora 聊聊你的近况，这里会自动出现"
                : "点击查看 · 由对话自动生成"
            }
          />

          {modules.length === 0 ? (
            <EmptyState
              onPress={() => router.push("/")}
              label="去和 Aurora 聊一聊"
            />
          ) : (
            <View style={styles.gridCol}>
              {modules.map((m) => (
                <Pressable
                  key={m.id}
                  onPress={() => setActiveModuleId(m.id)}
                  onLongPress={() => {
                    if (Platform.OS !== "web")
                      Haptics.impactAsync(
                        Haptics.ImpactFeedbackStyle.Medium
                      ).catch(() => {});
                    setEditingModule({
                      id: m.id,
                      title: m.title,
                      summary: m.summary,
                    });
                  }}
                  delayLongPress={280}
                  style={({ pressed }) => [pressed && { opacity: 0.85 }]}
                >
                  <ModuleCard module={m} />
                </Pressable>
              ))}
            </View>
          )}

          {/* Unified email card */}
          <Pressable
            onPress={() => setMailPickerOpen(true)}
            style={({ pressed }) => [pressed && { opacity: 0.85 }]}
          >
            <GlassCard radius={20} style={styles.gmailCard}>
              <View style={styles.gmailRow}>
                <View style={styles.gmailIcon}>
                  <LinearGradient
                    colors={["#5A8DEE", "#7B6BF0"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={StyleSheet.absoluteFill}
                  />
                  <Inbox size={16} color={"#fff"} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.gmailTitle}>
                    {gmail.connected || Object.keys(mailConfigs).length > 0
                      ? "邮箱已接入"
                      : "接入邮箱"}
                  </Text>
                  <Text style={styles.gmailSub}>
                    {gmail.connected
                      ? gmail.lastSyncAt
                        ? `Gmail · 上次同步 ${new Date(gmail.lastSyncAt).toLocaleString()}`
                        : "Gmail 已连接 · 点查看、同步或接入别的邮箱"
                      : Object.keys(mailConfigs).length > 0
                      ? "点查看或继续接入更多邮箱"
                      : "Gmail / iCloud / Outlook / QQ / 163 · 点选择"}
                  </Text>
                  {(Object.keys(mailConfigs).length > 0 || gmail.connected) && (
                    <View style={styles.mailChipsRow}>
                      {gmail.connected && (
                        <View style={styles.mailChip}>
                          <View style={[styles.mailChipDot, { backgroundColor: "#EA4335" }]} />
                          <Text style={styles.mailChipText}>Gmail</Text>
                        </View>
                      )}
                      {MAIL_PROVIDERS.filter((p) => mailConfigs[p.id]).map((p) => (
                        <View key={p.id} style={styles.mailChip}>
                          <View style={[styles.mailChipDot, { backgroundColor: p.color }]} />
                          <Text style={styles.mailChipText}>{p.name.replace(" 邮箱", "")}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                  {gmailToast && (
                    <Text style={styles.gmailToast}>{gmailToast}</Text>
                  )}
                  {gmail.error && (
                    <Text style={styles.gmailError} numberOfLines={2}>
                      {gmail.error}
                    </Text>
                  )}
                </View>
                <View style={styles.gmailGhostBtn}>
                  <Text style={styles.gmailGhostText}>
                    {gmail.connected ? "管理" : "选择"}
                  </Text>
                </View>
              </View>
            </GlassCard>
          </Pressable>

          {/* Schedule */}
          <View style={styles.scheduleHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sectionTitle}>
                {viewMode === "month"
                  ? monthAnchor.toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "long",
                    })
                  : viewMode === "week"
                  ? `${week[0].date.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${week[6].date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
                  : selectedDate === todayISO
                  ? "今日时间线"
                  : new Date(selectedDate).toLocaleDateString(undefined, {
                      month: "long",
                      day: "numeric",
                      weekday: "short",
                    })}
              </Text>
              <Text style={styles.sectionSub}>
                {viewMode === "month"
                  ? "点任意一天查看详情"
                  : viewMode === "week"
                  ? "本周概览 · 点某天跳到该日"
                  : filteredSchedule.length === 0
                  ? "这一天还没有安排 · 点上方日期可切换"
                  : `${filteredSchedule.length} 项 · 左滑删除 · 长按编辑`}
              </Text>
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable
                onPress={() => setAiOpen(true)}
                style={({ pressed }) => [
                  styles.aiPill,
                  pressed && { opacity: 0.7 },
                ]}
                hitSlop={6}
              >
                <Wand2 size={14} color={theme.amber} />
                <Text style={styles.aiPillText}>AI 添加</Text>
              </Pressable>
              <Pressable
                onPress={async () => {
                  if (remindersOn) {
                    await cancelAllReminders();
                    setRemindersOn(false);
                    AsyncStorage.setItem("aurora.reminders.on", "0").catch(() => {});
                    setCalToast("已关闭 Aurora 提醒");
                  } else {
                    const ok = await ensureNotificationPermission();
                    if (!ok) {
                      setCalToast("未获得通知权限");
                      return;
                    }
                    const n = await rescheduleAll(schedule);
                    setRemindersOn(true);
                    AsyncStorage.setItem("aurora.reminders.on", "1").catch(() => {});
                    setCalToast(
                      n > 0
                        ? `已开启提醒 · ${n} 项将在事件前 10 分钟提醒`
                        : "已开启提醒 · 只会对带时间的项生效"
                    );
                  }
                }}
                style={({ pressed }) => [
                  styles.aiPill,
                  remindersOn && { borderColor: theme.amber, backgroundColor: "rgba(244,184,96,0.12)" },
                  pressed && { opacity: 0.7 },
                ]}
                hitSlop={6}
              >
                {remindersOn ? (
                  <Bell size={14} color={theme.amber} />
                ) : (
                  <BellOff size={14} color={theme.textDim} />
                )}
                <Text style={[styles.aiPillText, !remindersOn && { color: theme.textDim }]}>
                  {remindersOn ? "提醒中" : "提醒"}
                </Text>
              </Pressable>
              <Pressable
                onPress={openNew}
                style={({ pressed }) => [
                  styles.addPill,
                  pressed && { opacity: 0.7 },
                ]}
                hitSlop={6}
              >
                <Plus size={14} color={theme.bg} />
                <Text style={styles.addPillText}>手动</Text>
              </Pressable>
            </View>
          </View>

          {/* Calendar sync · 一键双向：先从 iOS 导入新项目，再把本地未同步的推回 iOS */}
          {viewMode === "day" && (
            <View style={styles.calBulkRow}>
              <Pressable
                onPress={async () => {
                  setCalToast(null);
                  setCalBusy(true);
                  setCalImporting(true);
                  try {
                    // 1) Pull from iOS
                    let imported = 0;
                    const addedIds: string[] = [];
                    try {
                      const items = await readFromCalendar();
                      const existingKeys = new Set(
                        schedule.map((s) =>
                          `${s.date ?? todayISO}|${s.title.trim().toLowerCase()}`
                        )
                      );
                      for (const item of items) {
                        const key = `${item.date}|${item.title.trim().toLowerCase()}`;
                        if (existingKeys.has(key)) continue;
                        const newId = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
                        addScheduleItem({
                          id: newId,
                          time: item.time,
                          title: item.title,
                          kind: item.kind,
                          date: item.date,
                          locked: true,
                          source: "ios",
                          iosId: item.iosId,
                          iosType: item.iosType,
                        });
                        existingKeys.add(key);
                        addedIds.push(newId);
                        imported += 1;
                      }
                      if (addedIds.length > 0) setLastImportIds(addedIds);
                    } catch (err) {
                      console.log("[Aurora] import from iOS failed", err);
                    }

                    // 2) Push local (not yet on iOS) to iOS
                    const toPush = filteredSchedule.filter(
                      (s) => s.source !== "ios"
                    );
                    let pushed = 0;
                    let pushSkipped = 0;
                    if (toPush.length > 0) {
                      try {
                        const r = await addManyToCalendar(toPush);
                        pushed = r.added;
                        pushSkipped = r.skipped;
                        if (r.added > 0) setLastSyncIds(r.eventIds);
                      } catch (err) {
                        console.log("[Aurora] push to iOS failed", err);
                      }
                    }

                    const parts: string[] = [];
                    if (imported > 0) parts.push(`导入 ${imported} 项`);
                    if (pushed > 0) parts.push(`同步 ${pushed} 项到 iOS`);
                    if (parts.length === 0) {
                      const skipMsg = pushSkipped > 0 ? `· ${pushSkipped} 项已在日历` : "";
                      setCalToast(`已是最新 ${skipMsg}`.trim());
                    } else {
                      setCalToast(`已同步 · ${parts.join(" · ")}`);
                    }
                    if (Platform.OS !== "web")
                      Haptics.notificationAsync(
                        Haptics.NotificationFeedbackType.Success
                      ).catch(() => {});
                  } catch (err) {
                    setCalToast(err instanceof Error ? err.message : "同步失败");
                  } finally {
                    setCalBusy(false);
                    setCalImporting(false);
                  }
                }}
                disabled={calBusy || calImporting}
                style={({ pressed }) => [
                  styles.calHalfBtn,
                  styles.calHalfSync,
                  { flex: 1 },
                  (pressed || calBusy || calImporting) && { opacity: 0.7 },
                ]}
              >
                {calBusy || calImporting ? (
                  <ActivityIndicator size="small" color={theme.amber} />
                ) : (
                  <>
                    <RefreshCw size={13} color={theme.amber} />
                    <Text style={styles.calBulkText} numberOfLines={1}>
                      与 iOS 日历同步
                    </Text>
                  </>
                )}
              </Pressable>
            </View>
          )}
          {viewMode === "day" && (lastSyncIds.length > 0 || lastImportIds.length > 0) && (
            <View style={styles.calBulkRow}>
              {lastSyncIds.length > 0 && (
                <Pressable
                  onPress={async () => {
                    setCalUndoing(true);
                    try {
                      const n = await removeFromCalendar(lastSyncIds);
                      setLastSyncIds([]);
                      setCalToast(n > 0 ? `已撤销同步 ${n} 项` : "未能撤销");
                      if (Platform.OS !== "web")
                        Haptics.notificationAsync(
                          Haptics.NotificationFeedbackType.Warning
                        ).catch(() => {});
                    } catch (err) {
                      setCalToast(err instanceof Error ? err.message : "撤销失败");
                    } finally {
                      setCalUndoing(false);
                    }
                  }}
                  disabled={calUndoing}
                  style={({ pressed }) => [
                    styles.calUndo,
                    (pressed || calUndoing) && { opacity: 0.6 },
                  ]}
                >
                  {calUndoing ? (
                    <ActivityIndicator size="small" color={theme.textMuted} />
                  ) : (
                    <>
                      <RotateCcw size={12} color={theme.textMuted} />
                      <Text style={styles.calUndoText}>撤销同步 {lastSyncIds.length}</Text>
                    </>
                  )}
                </Pressable>
              )}
              {lastImportIds.length > 0 && (
                <Pressable
                  onPress={() => {
                    removeScheduleItems(lastImportIds);
                    setCalToast(`已撤销导入 ${lastImportIds.length} 项`);
                    setLastImportIds([]);
                    if (Platform.OS !== "web")
                      Haptics.notificationAsync(
                        Haptics.NotificationFeedbackType.Warning
                      ).catch(() => {});
                  }}
                  style={({ pressed }) => [
                    styles.calUndo,
                    pressed && { opacity: 0.6 },
                  ]}
                >
                  <RotateCcw size={12} color={theme.textMuted} />
                  <Text style={styles.calUndoText}>撤销导入 {lastImportIds.length}</Text>
                </Pressable>
              )}
            </View>
          )}

          {calToast && <Text style={styles.gmailToast}>{calToast}</Text>}

          {/* View mode toggle */}
          <View style={styles.viewToggle}>
            {([
              { id: "day", label: "日" },
              { id: "week", label: "周" },
              { id: "month", label: "月" },
            ] as const).map((v) => {
              const active = viewMode === v.id;
              return (
                <Pressable
                  key={v.id}
                  onPress={() => setViewMode(v.id)}
                  style={({ pressed }) => [
                    styles.viewTab,
                    active && styles.viewTabActive,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Text
                    style={[
                      styles.viewTabText,
                      active && styles.viewTabTextActive,
                    ]}
                  >
                    {v.label}
                  </Text>
                </Pressable>
              );
            })}
            <View style={{ flex: 1 }} />
            <Pressable
              onPress={() => {
                const now = new Date();
                setWeekAnchor(now);
                setMonthAnchor(now);
                setSelectedDate(toISODate(now));
              }}
              hitSlop={6}
              style={({ pressed }) => [
                styles.todayChip,
                pressed && { opacity: 0.7 },
              ]}
            >
              <CalendarDays size={12} color={theme.amber} />
              <Text style={styles.todayChipText}>今天</Text>
            </Pressable>
          </View>

          {/* Week strip (day view only) */}
          {viewMode === "day" && (
          <View style={styles.weekStripRow}>
            <Pressable
              onPress={() => {
                const a = new Date(weekAnchor);
                a.setDate(a.getDate() - 7);
                setWeekAnchor(a);
              }}
              hitSlop={8}
              style={styles.weekNav}
            >
              <Text style={styles.weekNavText}>‹</Text>
            </Pressable>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.weekStrip}
            >
              {week.map((d) => {
                const isSel = d.iso === selectedDate;
                const isToday = d.iso === todayISO;
                const count = scheduleCountByDate.get(d.iso) ?? 0;
                const wd = ["日", "一", "二", "三", "四", "五", "六"][d.date.getDay()];
                return (
                  <Pressable
                    key={d.iso}
                    onPress={() => setSelectedDate(d.iso)}
                    style={({ pressed }) => [
                      styles.dayPill,
                      isSel && styles.dayPillActive,
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <Text
                      style={[
                        styles.dayWd,
                        isSel && styles.dayWdActive,
                      ]}
                    >
                      {wd}
                    </Text>
                    <Text
                      style={[
                        styles.dayNum,
                        isSel && styles.dayNumActive,
                        isToday && !isSel && { color: theme.amber },
                      ]}
                    >
                      {d.date.getDate()}
                    </Text>
                    {count > 0 && (
                      <View
                        style={[
                          styles.dayDot,
                          isSel && { backgroundColor: theme.bg },
                        ]}
                      />
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable
              onPress={() => {
                const a = new Date(weekAnchor);
                a.setDate(a.getDate() + 7);
                setWeekAnchor(a);
              }}
              hitSlop={8}
              style={styles.weekNav}
            >
              <Text style={styles.weekNavText}>›</Text>
            </Pressable>
          </View>
          )}

          {viewMode === "month" ? (
            <MonthGrid
              anchor={monthAnchor}
              setAnchor={setMonthAnchor}
              countByDate={scheduleCountByDate}
              todayISO={todayISO}
              selectedDate={selectedDate}
              onPick={(iso) => {
                setSelectedDate(iso);
                setWeekAnchor(new Date(iso));
                setViewMode("day");
              }}
            />
          ) : viewMode === "week" ? (
            <View style={{ gap: 14 }}>
              {week.map((d) => {
                const items = schedule.filter((s) => (s.date ?? todayISO) === d.iso);
                const wd = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d.date.getDay()];
                const isToday = d.iso === todayISO;
                return (
                  <Pressable
                    key={d.iso}
                    onPress={() => {
                      setSelectedDate(d.iso);
                      setViewMode("day");
                    }}
                  >
                    <GlassCard radius={16} style={styles.weekDayCard}>
                      <View style={styles.weekDayHead}>
                        <Text
                          style={[
                            styles.weekDayLabel,
                            isToday && { color: theme.amber },
                          ]}
                        >
                          {d.date.getDate()} · {wd}
                          {isToday ? "  今天" : ""}
                        </Text>
                        <Text style={styles.weekDayCount}>
                          {items.length === 0 ? "空" : `${items.length} 项`}
                        </Text>
                      </View>
                      {items.length > 0 && (
                        <View style={{ gap: 4, marginTop: 6 }}>
                          {items.slice(0, 4).map((s) => (
                            <View key={s.id} style={styles.weekItemRow}>
                              <Text style={styles.weekItemTime}>
                                {s.time || "—"}
                              </Text>
                              <Text
                                style={[
                                  styles.weekItemText,
                                  s.done && styles.scheduleDone,
                                ]}
                                numberOfLines={1}
                              >
                                {s.title}
                              </Text>
                            </View>
                          ))}
                          {items.length > 4 && (
                            <Text style={styles.weekItemMore}>
                              +{items.length - 4} 项
                            </Text>
                          )}
                        </View>
                      )}
                    </GlassCard>
                  </Pressable>
                );
              })}
            </View>
          ) : filteredSchedule.length === 0 ? (
            <GlassCard radius={20} style={styles.placeholder}>
              <Text style={styles.placeholderText}>
                试试说：「明天 10 点我有数学课，下午要交英语作业」
              </Text>
            </GlassCard>
          ) : (
            <>
            <View style={{ gap: 10 }}>
              {filteredSchedule.map((s) => {
                const Icon = kindIcon(s.kind);
                return (
                  <Swipeable
                    key={s.id}
                    overshootRight={false}
                    friction={2}
                    rightThreshold={40}
                    containerStyle={styles.swipeOuter}
                    renderRightActions={(_progress, dragX) => {
                      const trans = dragX.interpolate({
                        inputRange: [-72, 0],
                        outputRange: [0, 72],
                        extrapolate: "clamp",
                      });
                      return (
                        <RNAnimated.View
                          style={{
                            width: 72,
                            transform: [{ translateX: trans }],
                          }}
                        >
                          <Pressable
                            onPress={() => {
                              deleteScheduleItem(s.id);
                              if (Platform.OS !== "web")
                                Haptics.notificationAsync(
                                  Haptics.NotificationFeedbackType.Warning
                                ).catch(() => {});
                            }}
                            style={({ pressed }) => [
                              styles.swipeDeleteIcon,
                              pressed && { opacity: 0.85 },
                            ]}
                          >
                            <Trash2 size={18} color={"#fff"} />
                          </Pressable>
                        </RNAnimated.View>
                      );
                    }}
                  >
                    <Pressable
                      onPress={() => toggleDone(s)}
                      onLongPress={() => {
                        if (Platform.OS !== "web")
                          Haptics.impactAsync(
                            Haptics.ImpactFeedbackStyle.Medium
                          ).catch(() => {});
                        openEdit(s);
                      }}
                      delayLongPress={280}
                      style={({ pressed }) => [pressed && { opacity: 0.85 }]}
                    >
                      <GlassCard radius={18} style={styles.scheduleCard}>
                        <View
                          style={[
                            styles.check,
                            s.done && styles.checkOn,
                          ]}
                        >
                          {s.done && <Check size={12} color={theme.bg} />}
                        </View>
                        <View style={styles.timePill}>
                          <Text style={styles.timeText}>{s.time || "—"}</Text>
                        </View>
                        <View style={styles.scheduleIcon}>
                          <Icon size={16} color={theme.amber} />
                        </View>
                        <Text
                          style={[
                            styles.scheduleTitle,
                            s.done && styles.scheduleDone,
                          ]}
                          numberOfLines={2}
                        >
                          {s.title}
                        </Text>
                        <Pressable
                          onPress={() => {
                            toggleLockScheduleItem(s.id);
                            if (Platform.OS !== "web")
                              Haptics.selectionAsync().catch(() => {});
                          }}
                          hitSlop={8}
                          style={({ pressed }) => [
                            styles.rowAction,
                            pressed && { opacity: 0.5 },
                          ]}
                        >
                          {s.locked ? (
                            <Lock size={14} color={theme.amber} />
                          ) : (
                            <LockOpen size={14} color={theme.textDim} />
                          )}
                        </Pressable>
                        {s.source === "ios" && (
                          <View style={styles.sourceBadge}>
                            <Text style={styles.sourceBadgeText}>iOS</Text>
                          </View>
                        )}
                        {s.source === "plan" && (
                          <View style={[styles.sourceBadge, { borderColor: theme.mint }]}>
                            <Text style={[styles.sourceBadgeText, { color: theme.mint }]}>计划</Text>
                          </View>
                        )}
                      </GlassCard>
                    </Pressable>
                  </Swipeable>
                );
              })}
            </View>
            {completedToday.length > 0 && (
              <Pressable
                onPress={() => setShowCompleted((v) => !v)}
                style={({ pressed }) => [
                  styles.completedToggle,
                  pressed && { opacity: 0.6 },
                ]}
              >
                <Check size={12} color={theme.mint} />
                <Text style={styles.completedToggleText}>
                  {showCompleted
                    ? `收起已完成 ${completedToday.length} 项`
                    : `查看已完成 ${completedToday.length} 项`}
                </Text>
              </Pressable>
            )}
            {showCompleted && completedToday.length > 0 && (
              <View style={{ gap: 8, marginTop: 6 }}>
                {completedToday.map((s) => (
                  <Pressable
                    key={s.id}
                    onPress={() => toggleDone(s)}
                    style={({ pressed }) => [pressed && { opacity: 0.7 }]}
                  >
                    <GlassCard radius={14} style={styles.completedCard}>
                      <View style={[styles.check, styles.checkOn]}>
                        <Check size={12} color={theme.bg} />
                      </View>
                      <Text style={styles.completedTime}>{s.time || "—"}</Text>
                      <Text
                        style={[styles.scheduleTitle, styles.scheduleDone]}
                        numberOfLines={1}
                      >
                        {s.title}
                      </Text>
                    </GlassCard>
                  </Pressable>
                ))}
              </View>
            )}
            </>
          )}

          {/* Reminders without dates — collapsible, lives BELOW the daily schedule */}
          {undatedReminders.length > 0 && (
            <GlassCard radius={18} style={styles.remindersCard}>
              <Pressable
                onPress={() => setRemindersOpen((v) => !v)}
                style={({ pressed }) => [
                  styles.remindersHead,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Inbox size={14} color={theme.lavender} />
                <Text style={styles.remindersTitle}>提醒事项</Text>
                <View style={{ flex: 1 }} />
                <Text style={styles.remindersCount}>
                  {undatedReminders.length}
                </Text>
                {remindersOpen ? (
                  <ChevronUp size={14} color={theme.lavender} />
                ) : (
                  <ChevronDown size={14} color={theme.lavender} />
                )}
              </Pressable>
              {remindersOpen && (
                <View style={{ gap: 6, marginTop: 6 }}>
                  {undatedReminders.map((s) => (
                    <View key={s.id} style={styles.reminderRow}>
                      <Pressable
                        onPress={() => toggleDone(s)}
                        hitSlop={6}
                      >
                        <View style={[styles.check, s.done && styles.checkOn]}>
                          {s.done && <Check size={11} color={theme.bg} />}
                        </View>
                      </Pressable>
                      <Text style={styles.reminderText} numberOfLines={2}>
                        {s.title}
                      </Text>
                      {s.source === "ios" && (
                        <View style={styles.sourceBadge}>
                          <Text style={styles.sourceBadgeText}>iOS</Text>
                        </View>
                      )}
                      <Pressable
                        onPress={() => deleteScheduleItem(s.id)}
                        hitSlop={8}
                        style={({ pressed }) => [
                          styles.rowAction,
                          pressed && { opacity: 0.5 },
                        ]}
                      >
                        <Trash2 size={13} color={theme.textDim} />
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}
            </GlassCard>
          )}

          {/* Facts / What Aurora knows */}
          {facts.length > 0 && (
            <>
              <SectionHeader
                title="Aurora 对你的理解"
                subtitle="长按编辑 · 左滑删除 · Aurora 会从对话中自动修正"
              />
              <View style={{ gap: 8 }}>
                {facts.slice(-8).map((f, i) => {
                  const realIdx = facts.length - Math.min(8, facts.length) + i;
                  return (
                    <Swipeable
                      key={`${realIdx}-${f.slice(0, 10)}`}
                      overshootRight={false}
                      friction={2}
                      rightThreshold={40}
                      containerStyle={styles.swipeOuter}
                      renderRightActions={(_progress, dragX) => {
                        const trans = dragX.interpolate({
                          inputRange: [-72, 0],
                          outputRange: [0, 72],
                          extrapolate: "clamp",
                        });
                        return (
                          <RNAnimated.View
                            style={{
                              width: 72,
                              transform: [{ translateX: trans }],
                            }}
                          >
                            <Pressable
                              onPress={() => {
                                removeFact(realIdx);
                                if (Platform.OS !== "web")
                                  Haptics.notificationAsync(
                                    Haptics.NotificationFeedbackType.Warning
                                  ).catch(() => {});
                              }}
                              style={({ pressed }) => [
                                styles.swipeDeleteIcon,
                                pressed && { opacity: 0.8 },
                              ]}
                            >
                              <Trash2 size={18} color={"#fff"} />
                            </Pressable>
                          </RNAnimated.View>
                        );
                      }}
                    >
                      <Pressable
                        onLongPress={() => {
                          if (Platform.OS !== "web")
                            Haptics.impactAsync(
                              Haptics.ImpactFeedbackStyle.Medium
                            ).catch(() => {});
                          setEditingFact({ index: realIdx, text: f });
                        }}
                        delayLongPress={280}
                        style={({ pressed }) => [
                          styles.factRowSolid,
                          pressed && { opacity: 0.7 },
                        ]}
                      >
                        <View style={styles.factDot} />
                        <Text style={styles.factText}>{f}</Text>
                      </Pressable>
                    </Swipeable>
                  );
                })}
              </View>
            </>
          )}

          <View style={{ height: 80 }} />
        </ScrollView>
      </SafeAreaView>

      {/* Schedule edit modal */}
      <Modal
        visible={composerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setComposerOpen(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setComposerOpen(false)}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            <Pressable>
              <GlassCard radius={26} intensity={50} style={styles.modalCard}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>
                    {schedule.find((s) => s.id === editingItem?.id)
                      ? "编辑安排"
                      : "新增安排"}
                  </Text>
                  <Pressable
                    onPress={() => setComposerOpen(false)}
                    hitSlop={8}
                  >
                    <X size={18} color={theme.textMuted} />
                  </Pressable>
                </View>
                {schedule.find((s) => s.id === editingItem?.id) && (
                  <View style={styles.modeRow}>
                    {(
                      [
                        { id: "ai", label: "AI 编辑" },
                        { id: "manual", label: "手动编辑" },
                      ] as const
                    ).map((m) => {
                      const active = editMode === m.id;
                      return (
                        <Pressable
                          key={m.id}
                          onPress={() => setEditMode(m.id)}
                          style={({ pressed }) => [
                            styles.modeChip,
                            active && styles.modeChipActive,
                            pressed && { opacity: 0.7 },
                          ]}
                        >
                          {m.id === "ai" && (
                            <Wand2
                              size={12}
                              color={active ? theme.amber : theme.textDim}
                            />
                          )}
                          <Text
                            style={[
                              styles.modeText,
                              active && styles.modeTextActive,
                            ]}
                          >
                            {m.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}

                {editMode === "ai" && schedule.find((s) => s.id === editingItem?.id) ? (
                  <>
                    <Text style={styles.aiHint}>
                      用一句话告诉 Aurora 怎么改，例如「挪到明天下午 3 点」「改成在咖啡馆和导师见面」
                    </Text>
                    <TextInput
                      value={aiEditText}
                      onChangeText={setAiEditText}
                      placeholder="说出你的修改…"
                      placeholderTextColor={theme.textDim}
                      style={[
                        styles.modalInput,
                        { minHeight: 80, textAlignVertical: "top" },
                      ]}
                      multiline
                      autoFocus
                    />
                  </>
                ) : (
                <>
                <Text style={styles.fieldLabel}>时间</Text>
                <TextInput
                  value={editingItem?.time ?? ""}
                  onChangeText={(v) =>
                    setEditingItem((p) => (p ? { ...p, time: v } : p))
                  }
                  placeholder="例如 10:30 / 今晚 / 下午"
                  placeholderTextColor={theme.textDim}
                  style={styles.modalInput}
                />
                <Text style={styles.fieldLabel}>内容</Text>
                <TextInput
                  value={editingItem?.title ?? ""}
                  onChangeText={(v) =>
                    setEditingItem((p) => (p ? { ...p, title: v } : p))
                  }
                  placeholder="做什么？"
                  placeholderTextColor={theme.textDim}
                  style={styles.modalInput}
                  multiline
                />
                <Text style={styles.fieldLabel}>类别</Text>
                <View style={styles.kindRow}>
                  {KINDS.map((k) => {
                    const active = editingItem?.kind === k;
                    return (
                      <Pressable
                        key={k}
                        onPress={() =>
                          setEditingItem((p) => (p ? { ...p, kind: k } : p))
                        }
                        style={({ pressed }) => [
                          styles.kindChip,
                          active && styles.kindChipActive,
                          pressed && { opacity: 0.7 },
                        ]}
                      >
                        <Text
                          style={[
                            styles.kindText,
                            active && styles.kindTextActive,
                          ]}
                        >
                          {kindLabel(k)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {editingItem && schedule.find((s) => s.id === editingItem.id) && (
                  <>
                    <Text style={styles.fieldLabel}>状态</Text>
                    <View style={styles.kindRow}>
                      {([
                        { id: false, label: "进行中" },
                        { id: true, label: "已完成" },
                      ] as const).map((s) => {
                        const active = !!editingItem.done === s.id;
                        return (
                          <Pressable
                            key={String(s.id)}
                            onPress={() =>
                              setEditingItem((p) =>
                                p ? { ...p, done: s.id } : p
                              )
                            }
                            style={({ pressed }) => [
                              styles.kindChip,
                              active && styles.kindChipActive,
                              pressed && { opacity: 0.7 },
                            ]}
                          >
                            <Text
                              style={[
                                styles.kindText,
                                active && styles.kindTextActive,
                              ]}
                            >
                              {s.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </>
                )}
                </>
                )}
                <View style={styles.modalActions}>
                  {schedule.find((s) => s.id === editingItem?.id) && (
                    <Pressable
                      onPress={() => {
                        if (editingItem) deleteScheduleItem(editingItem.id);
                        setComposerOpen(false);
                      }}
                      style={({ pressed }) => [
                        styles.deleteBtn,
                        pressed && { opacity: 0.6 },
                      ]}
                    >
                      <Trash2 size={14} color={theme.danger} />
                    </Pressable>
                  )}
                  <Pressable
                    onPress={async () => {
                      if (
                        editMode === "ai" &&
                        editingItem &&
                        schedule.find((s) => s.id === editingItem.id)
                      ) {
                        const t = aiEditText.trim();
                        if (!t) return;
                        try {
                          const ok = await editScheduleFromAI.mutateAsync({
                            id: editingItem.id,
                            instruction: t,
                          });
                          if (ok) {
                            setComposerOpen(false);
                            setAiEditText("");
                            if (Platform.OS !== "web")
                              Haptics.notificationAsync(
                                Haptics.NotificationFeedbackType.Success
                              ).catch(() => {});
                          }
                        } catch (err) {
                          console.warn("[AI edit]", err);
                        }
                      } else {
                        saveItem();
                      }
                    }}
                    disabled={editScheduleFromAI.isPending}
                    style={({ pressed }) => [
                      styles.saveBtn,
                      (pressed || editScheduleFromAI.isPending) && {
                        opacity: 0.7,
                      },
                    ]}
                  >
                    <LinearGradient
                      colors={[theme.amber, theme.peach]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={StyleSheet.absoluteFill}
                    />
                    {editScheduleFromAI.isPending ? (
                      <ActivityIndicator size="small" color={theme.bg} />
                    ) : (
                      <Text style={styles.saveText}>
                        {editMode === "ai" &&
                        schedule.find((s) => s.id === editingItem?.id)
                          ? "让 Aurora 修改"
                          : "保存"}
                      </Text>
                    )}
                  </Pressable>
                </View>
              </GlassCard>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      {/* AI-add modal */}
      <Modal
        visible={aiOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setAiOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setAiOpen(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <Pressable>
              <GlassCard radius={26} intensity={50} style={styles.modalCard}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>用自然语言添加</Text>
                  <Pressable onPress={() => setAiOpen(false)} hitSlop={8}>
                    <X size={18} color={theme.textMuted} />
                  </Pressable>
                </View>
                <Text style={styles.aiHint}>
                  直接用一句话描述，例如「今晚 8 点去高尔夫、明天上午 10 点有数学课」
                </Text>
                <TextInput
                  value={aiText}
                  onChangeText={setAiText}
                  placeholder="输入你的安排…"
                  placeholderTextColor={theme.textDim}
                  style={[styles.modalInput, { minHeight: 90, textAlignVertical: "top" }]}
                  multiline
                  autoFocus
                />
                <View style={styles.modalActions}>
                  <Pressable
                    onPress={async () => {
                      const t = aiText.trim();
                      if (!t) return;
                      try {
                        const count = await addScheduleFromAI.mutateAsync(t);
                        if (count > 0) {
                          setAiText("");
                          setAiOpen(false);
                          if (Platform.OS !== "web")
                            Haptics.notificationAsync(
                              Haptics.NotificationFeedbackType.Success
                            ).catch(() => {});
                        }
                      } catch (err) {
                        console.warn("[AI add]", err);
                      }
                    }}
                    disabled={addScheduleFromAI.isPending}
                    style={({ pressed }) => [
                      styles.saveBtn,
                      (pressed || addScheduleFromAI.isPending) && { opacity: 0.7 },
                    ]}
                  >
                    <LinearGradient
                      colors={[theme.amber, theme.peach]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={StyleSheet.absoluteFill}
                    />
                    {addScheduleFromAI.isPending ? (
                      <ActivityIndicator size="small" color={theme.bg} />
                    ) : (
                      <Text style={styles.saveText}>让 Aurora 添加</Text>
                    )}
                  </Pressable>
                </View>
              </GlassCard>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      {/* Module detail modal */}
      <Modal
        visible={activeModule !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setActiveModuleId(null)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setActiveModuleId(null)}
          />
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            keyboardVerticalOffset={0}
            style={{ width: "100%", maxHeight: "86%" }}
          >
            {activeModule && (
              <GlassCard
                radius={26}
                intensity={50}
                style={[styles.modalCard, { maxHeight: "100%" }]}
              >
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>{activeModule.title}</Text>
                  <Pressable onPress={() => setActiveModuleId(null)} hitSlop={8}>
                    <X size={18} color={theme.textMuted} />
                  </Pressable>
                </View>
                <ScrollView
                  showsVerticalScrollIndicator={true}
                  style={{ flexShrink: 1 }}
                  contentContainerStyle={{ gap: 10, paddingBottom: 8 }}
                  nestedScrollEnabled
                  keyboardShouldPersistTaps="handled"
                >
                <Text style={styles.moduleSummary}>{activeModule.summary}</Text>
                <View style={styles.progressTrack}>
                  <LinearGradient
                    colors={[theme.amber, theme.peach]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={[
                      styles.progressFill,
                      {
                        width: `${Math.round(Math.max(0, Math.min(1, activeModule.progress ?? 0)) * 100)}%`,
                      },
                    ]}
                  />
                </View>
                <Text style={styles.progressNote}>
                  当前进度 {Math.round(Math.max(0, Math.min(1, activeModule.progress ?? 0)) * 100)}%
                </Text>

                <View style={styles.moduleAiRow}>
                  <Pressable
                    onPress={async () => {
                      setExpandErr(null);
                      try {
                        const r = await expandModule.mutateAsync(
                          activeModule.id
                        );
                        if (!r) {
                          setExpandErr(
                            "生成为空·请重试或检查网络"
                          );
                        } else if (Platform.OS !== "web") {
                          Haptics.notificationAsync(
                            Haptics.NotificationFeedbackType.Success
                          ).catch(() => {});
                        }
                      } catch (err) {
                        console.warn("[expand module]", err);
                        setExpandErr(
                          err instanceof Error
                            ? err.message
                            : "生成失败"
                        );
                      }
                    }}
                    disabled={expandModule.isPending}
                    style={({ pressed }) => [
                      styles.expandBtn,
                      (pressed || expandModule.isPending) && { opacity: 0.7 },
                    ]}
                  >
                    {expandModule.isPending ? (
                      <ActivityIndicator size="small" color={theme.amber} />
                    ) : (
                      <>
                        <Sparkles size={14} color={theme.amber} />
                        <Text style={styles.expandBtnText}>
                          {activeModule.detail ? "重新生成" : "AI 深入展开"}
                        </Text>
                      </>
                    )}
                  </Pressable>
                </View>
                {expandErr && (
                  <Text style={styles.gmailError}>{expandErr}</Text>
                )}

                {activeModule.detail && (
                  <>
                    <View style={styles.detailContent}>
                      <Markdown text={activeModule.detail} selectable />
                    </View>
                    <View style={styles.moduleAiRow}>
                      <Pressable
                        onPress={async () => {
                          setModuleToast(null);
                          try {
                            const res =
                              await addModuleDetailToPlan.mutateAsync(
                                activeModule.id
                              );
                            const count = res.count;
                            if (count > 0) {
                              setPlanAddedIds(res.ids);
                              setModuleToast(`已加入 ${count} 项到本周计划`);
                              if (Platform.OS !== "web")
                                Haptics.notificationAsync(
                                  Haptics.NotificationFeedbackType.Success
                                ).catch(() => {});
                            } else {
                              setModuleToast("未能提取出具体可执行项");
                            }
                          } catch (err) {
                            console.warn("[add to plan]", err);
                            setModuleToast("加入失败，稍后再试");
                          }
                        }}
                        disabled={addModuleDetailToPlan.isPending}
                        style={({ pressed }) => [
                          styles.expandBtn,
                          {
                            backgroundColor: "rgba(244,184,96,0.95)",
                            borderColor: theme.amber,
                          },
                          (pressed || addModuleDetailToPlan.isPending) && {
                            opacity: 0.7,
                          },
                        ]}
                      >
                        {addModuleDetailToPlan.isPending ? (
                          <ActivityIndicator size="small" color={theme.bg} />
                        ) : (
                          <>
                            <CalendarPlus size={14} color={theme.bg} />
                            <Text
                              style={[
                                styles.expandBtnText,
                                { color: theme.bg },
                              ]}
                            >
                              加入本周计划
                            </Text>
                          </>
                        )}
                      </Pressable>
                    </View>
                    {moduleToast && (
                      <View style={styles.toastRow}>
                        <Text style={[styles.gmailToast, { flex: 1 }]}>{moduleToast}</Text>
                        {planAddedIds.length > 0 && (
                          <Pressable
                            onPress={() => {
                              removeScheduleItems(planAddedIds);
                              setPlanAddedIds([]);
                              setModuleToast(`已撤销 ${planAddedIds.length} 项`);
                              if (Platform.OS !== "web")
                                Haptics.notificationAsync(
                                  Haptics.NotificationFeedbackType.Warning
                                ).catch(() => {});
                            }}
                            style={({ pressed }) => [
                              styles.calUndo,
                              pressed && { opacity: 0.6 },
                            ]}
                          >
                            <RotateCcw size={12} color={theme.textMuted} />
                            <Text style={styles.calUndoText}>撤销</Text>
                          </Pressable>
                        )}
                      </View>
                    )}
                  </>
                )}

                {(() => {
                  const id = activeModule.id.toLowerCase();
                  const title = activeModule.title;
                  const matchKind = ([
                    "study",
                    "work",
                    "sleep",
                    "health",
                    "break",
                  ] as const).find((k) => id.includes(k));
                  const related = schedule.filter((s) => {
                    if (matchKind && s.kind === matchKind) return true;
                    return s.title.toLowerCase().includes(title.toLowerCase());
                  });
                  const relatedFacts = facts.filter((f) =>
                    f.toLowerCase().includes(title.toLowerCase())
                  );
                  return (
                    <>
                      <Text style={styles.detailHeading}>相关安排</Text>
                      {related.length === 0 ? (
                        <Text style={styles.detailEmpty}>
                          还没有具体安排 · 去和 Aurora 聊聊详情
                        </Text>
                      ) : (
                        <View style={{ gap: 6, marginTop: 2 }}>
                          {related.map((s) => (
                            <View key={s.id} style={styles.detailRow}>
                              <View style={styles.detailDot} />
                              <Text style={styles.detailTime}>
                                {s.time || "—"}
                              </Text>
                              <Text
                                style={[
                                  styles.detailText,
                                  s.done && styles.scheduleDone,
                                ]}
                                numberOfLines={2}
                              >
                                {s.title}
                              </Text>
                            </View>
                          ))}
                        </View>
                      )}
                      {relatedFacts.length > 0 && (
                        <>
                          <Text style={styles.detailHeading}>Aurora 所知</Text>
                          <View style={{ gap: 4 }}>
                            {relatedFacts.map((f, i) => (
                              <Text key={i} style={styles.detailFact}>
                                · {f}
                              </Text>
                            ))}
                          </View>
                        </>
                      )}
                    </>
                  );
                })()}
                {/* Inline module chat */}
                <View style={styles.moduleChatHead}>
                  <MessageCircle size={13} color={theme.amber} />
                  <Text style={styles.moduleChatHeadText}>聊聊这个模块</Text>
                </View>
                {(moduleChats[activeModule.id] ?? []).map((msg) => (
                  <View
                    key={msg.id}
                    style={[
                      styles.chatBubble,
                      msg.role === "user"
                        ? styles.chatBubbleUser
                        : styles.chatBubbleAI,
                    ]}
                  >
                    {msg.role === "assistant" ? (
                      <>
                        <Markdown text={msg.text} color={theme.text} selectable />
                        <View style={styles.chatBubbleActions}>
                          <Pressable
                            onPress={async () => {
                              setModuleChatAddingId(msg.id);
                              setModuleToast(null);
                              try {
                                const r = await addTextToPlan.mutateAsync({
                                  moduleId: activeModule.id,
                                  text: msg.text,
                                });
                                if (r.count > 0) {
                                  setPlanAddedIds(r.ids);
                                  setModuleToast(
                                    `已加入 ${r.count} 项到本周计划`
                                  );
                                  if (Platform.OS !== "web")
                                    Haptics.notificationAsync(
                                      Haptics.NotificationFeedbackType.Success
                                    ).catch(() => {});
                                } else {
                                  setModuleToast("未提取出可执行项");
                                }
                              } catch (err) {
                                setModuleToast(
                                  err instanceof Error
                                    ? err.message
                                    : "加入失败"
                                );
                              } finally {
                                setModuleChatAddingId(null);
                              }
                            }}
                            disabled={moduleChatAddingId === msg.id}
                            style={({ pressed }) => [
                              styles.chatBubbleAddBtn,
                              (pressed || moduleChatAddingId === msg.id) && {
                                opacity: 0.6,
                              },
                            ]}
                          >
                            {moduleChatAddingId === msg.id ? (
                              <ActivityIndicator
                                size="small"
                                color={theme.amber}
                              />
                            ) : (
                              <>
                                <CalendarPlus size={11} color={theme.amber} />
                                <Text style={styles.chatBubbleAddText}>
                                  加入本周计划
                                </Text>
                              </>
                            )}
                          </Pressable>
                        </View>
                      </>
                    ) : (
                      <Text style={styles.chatBubbleUserText}>{msg.text}</Text>
                    )}
                  </View>
                ))}
                {chatAboutModule.isPending && (
                  <View style={[styles.chatBubble, styles.chatBubbleAI]}>
                    <ActivityIndicator size="small" color={theme.amber} />
                  </View>
                )}
                {moduleChatErr && (
                  <Text style={styles.gmailError}>{moduleChatErr}</Text>
                )}
                <View style={styles.chatComposer}>
                  <TextInput
                    value={moduleChatInput}
                    onChangeText={setModuleChatInput}
                    placeholder={`针对「${activeModule.title}」聊一聊…`}
                    placeholderTextColor={theme.textDim}
                    style={styles.chatComposerInput}
                    multiline
                  />
                  <Pressable
                    onPress={async () => {
                      const t = moduleChatInput.trim();
                      if (!t || chatAboutModule.isPending) return;
                      setModuleChatErr(null);
                      const mid = activeModule.id;
                      const prev = moduleChats[mid] ?? [];
                      const userMsg = {
                        role: "user" as const,
                        text: t,
                        id: `mc_${Date.now().toString(36)}_u`,
                      };
                      setModuleChats((p) => ({
                        ...p,
                        [mid]: [...prev, userMsg],
                      }));
                      setModuleChatInput("");
                      try {
                        const history = prev.map((m) => ({
                          role: m.role,
                          content: m.text,
                        }));
                        const reply = await chatAboutModule.mutateAsync({
                          moduleId: mid,
                          history,
                          userText: t,
                        });
                        if (!reply) {
                          setModuleChatErr("回复为空·请重试");
                          return;
                        }
                        setModuleChats((p) => ({
                          ...p,
                          [mid]: [
                            ...(p[mid] ?? [userMsg]),
                            {
                              role: "assistant",
                              text: reply,
                              id: `mc_${Date.now().toString(36)}_a`,
                            },
                          ],
                        }));
                        if (Platform.OS !== "web")
                          Haptics.selectionAsync().catch(() => {});
                      } catch (err) {
                        setModuleChatErr(
                          err instanceof Error ? err.message : "发送失败"
                        );
                      }
                    }}
                    disabled={
                      !moduleChatInput.trim() || chatAboutModule.isPending
                    }
                    style={({ pressed }) => [
                      styles.chatSendBtn,
                      (pressed ||
                        !moduleChatInput.trim() ||
                        chatAboutModule.isPending) && { opacity: 0.5 },
                    ]}
                  >
                    <Send size={14} color={theme.bg} />
                  </Pressable>
                </View>
                </ScrollView>

                <View style={styles.modalActions}>
                  <Pressable
                    onPress={() => {
                      removeModule(activeModule.id);
                      setActiveModuleId(null);
                      setExpandErr(null);
                    }}
                    style={({ pressed }) => [
                      styles.deleteBtn,
                      pressed && { opacity: 0.6 },
                    ]}
                  >
                    <Trash2 size={14} color={theme.danger} />
                    <Text style={styles.deleteText}>移除模块</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setActiveModuleId(null)}
                    style={({ pressed }) => [
                      styles.saveBtn,
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <LinearGradient
                      colors={[theme.amber, theme.peach]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={StyleSheet.absoluteFill}
                    />
                    <Text style={styles.saveText}>完成</Text>
                  </Pressable>
                </View>
              </GlassCard>
            )}
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Email picker modal */}
      <Modal
        visible={mailPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMailPickerOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setMailPickerOpen(false)}
          />
            <GlassCard
              radius={26}
              intensity={50}
              style={[styles.modalCard, { maxHeight: "86%" }]}
            >
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>选择邮箱</Text>
                <Pressable
                  onPress={() => setMailPickerOpen(false)}
                  hitSlop={8}
                >
                  <X size={18} color={theme.textMuted} />
                </Pressable>
              </View>
              <ScrollView
                showsVerticalScrollIndicator={false}
                style={{ flexShrink: 1 }}
                contentContainerStyle={{ gap: 8, paddingBottom: 4 }}
                nestedScrollEnabled
              >
                <Pressable
                  onPress={() => {
                    setMailPickerOpen(false);
                    if (gmail.connected) return;
                    gmail.connect();
                  }}
                  style={({ pressed }) => [
                    styles.mailOption,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <View style={[styles.mailDot, { backgroundColor: "#EA4335" }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.mailOptName}>Gmail</Text>
                    <Text style={styles.mailOptSub}>
                      {gmail.connected ? "已连接 · 点进入管理" : "完整的 OAuth 授权 · 可用"}
                    </Text>
                  </View>
                  {gmail.connected && (
                    <Check size={14} color={theme.mint} />
                  )}
                </Pressable>
                {gmail.connected && (
                  <View style={styles.mailGmailMgr}>
                    <Pressable
                      onPress={async () => {
                        setGmailToast(null);
                        const r = await gmail.sync();
                        if (r) {
                          setGmailToast(
                            r.added > 0
                              ? `已从 ${r.scanned} 封邮件中提取 ${r.added} 条`
                              : `扫描了 ${r.scanned} 封 · 暂无可执行待办`
                          );
                          setMailPickerOpen(false);
                        }
                      }}
                      disabled={gmail.syncing}
                      style={({ pressed }) => [
                        styles.gmailBtn,
                        { flex: 1 },
                        (pressed || gmail.syncing) && { opacity: 0.6 },
                      ]}
                    >
                      {gmail.syncing ? (
                        <ActivityIndicator size="small" color={theme.bg} />
                      ) : (
                        <>
                          <RefreshCw size={12} color={theme.bg} />
                          <Text style={styles.gmailBtnText}>同步</Text>
                        </>
                      )}
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        gmail.disconnect();
                        setGmailToast(null);
                      }}
                      style={({ pressed }) => [
                        styles.gmailGhostBtn,
                        pressed && { opacity: 0.6 },
                      ]}
                    >
                      <Text style={styles.gmailGhostText}>断开</Text>
                    </Pressable>
                  </View>
                )}
                {!gmail.connected && (
                  <View style={styles.mailGmailMgr}>
                    <Pressable
                      onPress={() => {
                        gmail.disconnect();
                        setGmailToast("已重置连接状态");
                      }}
                      hitSlop={6}
                      style={({ pressed }) => [
                        styles.gmailGhostBtn,
                        { flexDirection: "row", alignItems: "center", gap: 6 },
                        pressed && { opacity: 0.6 },
                      ]}
                    >
                      <RotateCcw size={12} color={theme.textMuted} />
                      <Text style={styles.gmailGhostText}>重置连接状态</Text>
                    </Pressable>
                  </View>
                )}

                {MAIL_PROVIDERS.map((p) => {
                  const cfg = mailConfigs[p.id];
                  return (
                    <Pressable
                      key={p.id}
                      onPress={() => {
                        setMailPickerOpen(false);
                        setProviderSheet(p.id);
                      }}
                      style={({ pressed }) => [
                        styles.mailOption,
                        pressed && { opacity: 0.6 },
                      ]}
                    >
                      <View style={[styles.mailDot, { backgroundColor: p.color }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.mailOptName}>{p.name}</Text>
                        <Text style={styles.mailOptSub}>
                          {cfg ? `已保存 ${cfg.email}` : p.note}
                        </Text>
                      </View>
                      {cfg && <Check size={14} color={theme.mint} />}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </GlassCard>
        </View>
      </Modal>

      {/* Fact edit modal */}
      <Modal
        visible={editingFact !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setEditingFact(null)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setEditingFact(null)}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            <Pressable>
              <GlassCard radius={26} intensity={50} style={styles.modalCard}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>编辑认知</Text>
                  <Pressable onPress={() => setEditingFact(null)} hitSlop={8}>
                    <X size={18} color={theme.textMuted} />
                  </Pressable>
                </View>
                <View style={styles.modeRow}>
                  {(
                    [
                      { id: "ai", label: "AI 编辑" },
                      { id: "manual", label: "手动编辑" },
                    ] as const
                  ).map((m) => {
                    const active = factEditMode === m.id;
                    return (
                      <Pressable
                        key={m.id}
                        onPress={() => {
                          setFactEditMode(m.id);
                          setFactAiErr(null);
                        }}
                        style={({ pressed }) => [
                          styles.modeChip,
                          active && styles.modeChipActive,
                          pressed && { opacity: 0.7 },
                        ]}
                      >
                        {m.id === "ai" && (
                          <Wand2
                            size={12}
                            color={active ? theme.amber : theme.textDim}
                          />
                        )}
                        <Text
                          style={[
                            styles.modeText,
                            active && styles.modeTextActive,
                          ]}
                        >
                          {m.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {factEditMode === "ai" ? (
                  <>
                    <Text style={styles.aiHint}>
                      用一句话告诉 Aurora 怎么改，例如「不是烘焙，是热爱烘焙」「改成在读研究生」。
                    </Text>
                    <View style={styles.factCurrentBox}>
                      <Text style={styles.factCurrentLabel}>当前</Text>
                      <Text style={styles.factCurrentText}>{editingFact?.text}</Text>
                    </View>
                    <TextInput
                      value={factAiText}
                      onChangeText={setFactAiText}
                      placeholder="说出你的修改…"
                      placeholderTextColor={theme.textDim}
                      style={[
                        styles.modalInput,
                        { minHeight: 70, textAlignVertical: "top" },
                      ]}
                      multiline
                      autoFocus
                    />
                    {factAiErr && (
                      <Text style={styles.gmailError}>{factAiErr}</Text>
                    )}
                  </>
                ) : (
                  <>
                    <Text style={styles.aiHint}>手动修改这条认知的表述。</Text>
                    <TextInput
                      value={editingFact?.text ?? ""}
                      onChangeText={(v) =>
                        setEditingFact((p) => (p ? { ...p, text: v } : p))
                      }
                      placeholder="..."
                      placeholderTextColor={theme.textDim}
                      style={[
                        styles.modalInput,
                        { minHeight: 80, textAlignVertical: "top" },
                      ]}
                      multiline
                      autoFocus
                    />
                  </>
                )}
                <View style={styles.modalActions}>
                  <Pressable
                    onPress={() => {
                      if (editingFact) removeFact(editingFact.index);
                      setEditingFact(null);
                      setFactAiText("");
                      setFactAiErr(null);
                    }}
                    style={({ pressed }) => [
                      styles.deleteBtn,
                      pressed && { opacity: 0.6 },
                    ]}
                  >
                    <Trash2 size={14} color={theme.danger} />
                  </Pressable>
                  <Pressable
                    onPress={async () => {
                      if (!editingFact) return;
                      if (factEditMode === "ai") {
                        const t = factAiText.trim();
                        if (!t) return;
                        setFactAiErr(null);
                        try {
                          const ok = await editFactWithAI.mutateAsync({
                            index: editingFact.index,
                            instruction: t,
                          });
                          if (!ok) {
                            setFactAiErr("改写失败·请重试");
                            return;
                          }
                          setEditingFact(null);
                          setFactAiText("");
                          if (Platform.OS !== "web")
                            Haptics.notificationAsync(
                              Haptics.NotificationFeedbackType.Success
                            ).catch(() => {});
                        } catch (err) {
                          setFactAiErr(
                            err instanceof Error ? err.message : "改写失败"
                          );
                        }
                      } else {
                        updateFact(editingFact.index, editingFact.text);
                        setEditingFact(null);
                        if (Platform.OS !== "web")
                          Haptics.notificationAsync(
                            Haptics.NotificationFeedbackType.Success
                          ).catch(() => {});
                      }
                    }}
                    disabled={editFactWithAI.isPending}
                    style={({ pressed }) => [
                      styles.saveBtn,
                      (pressed || editFactWithAI.isPending) && {
                        opacity: 0.7,
                      },
                    ]}
                  >
                    <LinearGradient
                      colors={[theme.amber, theme.peach]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={StyleSheet.absoluteFill}
                    />
                    {editFactWithAI.isPending ? (
                      <ActivityIndicator size="small" color={theme.bg} />
                    ) : (
                      <Text style={styles.saveText}>
                        {factEditMode === "ai" ? "让 Aurora 修改" : "保存"}
                      </Text>
                    )}
                  </Pressable>
                </View>
              </GlassCard>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      {/* Module edit modal (long-press a module to open) */}
      <Modal
        visible={editingModule !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setEditingModule(null)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setEditingModule(null)}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            <Pressable>
              {editingModule && (
                <GlassCard radius={26} intensity={50} style={styles.modalCard}>
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>编辑模块</Text>
                    <Pressable onPress={() => setEditingModule(null)} hitSlop={8}>
                      <X size={18} color={theme.textMuted} />
                    </Pressable>
                  </View>
                  <Text style={styles.fieldLabel}>名称</Text>
                  <TextInput
                    value={editingModule.title}
                    onChangeText={(v) =>
                      setEditingModule((p) => (p ? { ...p, title: v } : p))
                    }
                    placeholder="例如 IMC 学习"
                    placeholderTextColor={theme.textDim}
                    style={styles.modalInput}
                  />
                  <Text style={styles.fieldLabel}>总结</Text>
                  <TextInput
                    value={editingModule.summary}
                    onChangeText={(v) =>
                      setEditingModule((p) => (p ? { ...p, summary: v } : p))
                    }
                    placeholder="一句话说明这个模块是什么"
                    placeholderTextColor={theme.textDim}
                    style={[
                      styles.modalInput,
                      { minHeight: 70, textAlignVertical: "top" },
                    ]}
                    multiline
                  />
                  <View style={styles.modalActions}>
                    <Pressable
                      onPress={() => {
                        if (editingModule) removeModule(editingModule.id);
                        setEditingModule(null);
                      }}
                      style={({ pressed }) => [
                        styles.deleteBtn,
                        pressed && { opacity: 0.6 },
                      ]}
                    >
                      <Trash2 size={14} color={theme.danger} />
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        if (!editingModule) return;
                        const title = editingModule.title.trim();
                        const summary = editingModule.summary.trim();
                        if (!title) return;
                        updateModule(editingModule.id, { title, summary });
                        setEditingModule(null);
                        if (Platform.OS !== "web")
                          Haptics.notificationAsync(
                            Haptics.NotificationFeedbackType.Success
                          ).catch(() => {});
                      }}
                      style={({ pressed }) => [
                        styles.saveBtn,
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <LinearGradient
                        colors={[theme.amber, theme.peach]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={StyleSheet.absoluteFill}
                      />
                      <Text style={styles.saveText}>保存</Text>
                    </Pressable>
                  </View>
                </GlassCard>
              )}
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      {/* Per-provider mail config sheet */}
      <MailProviderSheet
        providerId={providerSheet}
        config={providerSheet ? mailConfigs[providerSheet] : undefined}
        onClose={() => setProviderSheet(null)}
        onSave={(id, cfg) => {
          persistMailConfigs({ ...mailConfigs, [id]: cfg });
          setProviderSheet(null);
          setGmailToast(`已保存 ${cfg.email} · 服务端同步开发中`);
          if (Platform.OS !== "web")
            Haptics.notificationAsync(
              Haptics.NotificationFeedbackType.Success
            ).catch(() => {});
        }}
        onDelete={(id) => {
          const next = { ...mailConfigs };
          delete next[id];
          persistMailConfigs(next);
          setProviderSheet(null);
        }}
      />
    </View>
  );
}

function MailProviderSheet({
  providerId,
  config,
  onClose,
  onSave,
  onDelete,
}: {
  providerId: MailProviderId | null;
  config: MailProviderConfig | undefined;
  onClose: () => void;
  onSave: (id: MailProviderId, cfg: MailProviderConfig) => void;
  onDelete: (id: MailProviderId) => void;
}) {
  const provider = useMemo(
    () => MAIL_PROVIDERS.find((p) => p.id === providerId),
    [providerId]
  );
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  useEffect(() => {
    setEmail(config?.email ?? "");
    setPassword(config?.password ?? "");
  }, [providerId, config]);
  if (!provider) return null;
  return (
    <Modal
      visible={providerId !== null}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalBackdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ width: "100%", alignItems: "center" }}
        >
          <View style={styles.modalContentWrap}>
            <GlassCard
              radius={26}
              intensity={50}
              style={[styles.modalCard, { flexShrink: 1 }]}
            >
              <View style={styles.modalHeader}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={[styles.mailDot, { backgroundColor: provider.color, width: 14, height: 14, borderRadius: 7 }]} />
                  <Text style={styles.modalTitle}>{provider.name}</Text>
                </View>
                <Pressable onPress={onClose} hitSlop={8}>
                  <X size={18} color={theme.textMuted} />
                </Pressable>
              </View>
              <ScrollView
                showsVerticalScrollIndicator={false}
                style={{ maxHeight: 420 }}
                contentContainerStyle={{ gap: 8, paddingBottom: 6 }}
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
              >
                <Pressable
                  onPress={() => Linking.openURL(provider.passwordUrl).catch(() => {})}
                  style={({ pressed }) => [
                    styles.tutorialBtn,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <ExternalLink size={12} color={theme.amber} />
                  <Text style={styles.tutorialText}>{PROVIDER_TUTORIAL_LABEL[provider.id]}</Text>
                </Pressable>

                <View style={styles.tutorialSteps}>
                  {PROVIDER_STEPS[provider.id].map((step, i) => (
                    <View key={i} style={styles.tutorialStepRow}>
                      <View style={styles.tutorialStepNum}>
                        <Text style={styles.tutorialStepNumText}>{i + 1}</Text>
                      </View>
                      <Text style={styles.tutorialStepText}>{step}</Text>
                    </View>
                  ))}
                </View>

                <Text style={styles.aiHint}>{provider.passwordHint}</Text>

                <Text style={styles.fieldLabel}>邮箱地址</Text>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder={
                    provider.id === "qq"
                      ? "yourname@qq.com"
                      : provider.id === "163"
                      ? "yourname@163.com"
                      : provider.id === "icloud"
                      ? "yourname@icloud.com"
                      : "yourname@outlook.com"
                  }
                  placeholderTextColor={theme.textDim}
                  style={styles.modalInput}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoCorrect={false}
                />

                <Text style={styles.fieldLabel}>{provider.passwordLabel}</Text>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="粘贴应用专用密码 / 授权码"
                  placeholderTextColor={theme.textDim}
                  style={styles.modalInput}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                />

                <Text style={styles.fieldLabel}>IMAP 服务器</Text>
                <View style={[styles.modalInput, { paddingVertical: 14 }]}>
                  <Text style={{ color: theme.textMuted, fontSize: 13 }}>
                    {provider.imapHost}:{provider.imapPort} · SSL
                  </Text>
                </View>

                <Text style={styles.helpNote}>
                  注：IMAP 同步需要 Aurora 服务端中转（Expo Go 无法直连 IMAP）。
                  账号信息会本地加密保存，服务端上线后自动启用同步。现阶段可先保存配置。
                </Text>
              </ScrollView>
              <View style={styles.modalActions}>
                {config && (
                  <Pressable
                    onPress={() => onDelete(provider.id)}
                    style={({ pressed }) => [
                      styles.deleteBtn,
                      pressed && { opacity: 0.6 },
                    ]}
                  >
                    <Trash2 size={14} color={theme.danger} />
                  </Pressable>
                )}
                <Pressable
                  onPress={() => {
                    const e = email.trim();
                    const p = password.trim();
                    if (!e || !p) return;
                    onSave(provider.id, {
                      email: e,
                      password: p,
                      savedAt: Date.now(),
                    });
                  }}
                  style={({ pressed }) => [
                    styles.saveBtn,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <LinearGradient
                    colors={[theme.amber, theme.peach]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={StyleSheet.absoluteFill}
                  />
                  <Text style={styles.saveText}>保存配置</Text>
                </Pressable>
              </View>
            </GlassCard>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function SectionHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle && <Text style={styles.sectionSub}>{subtitle}</Text>}
    </View>
  );
}

function MonthGrid({
  anchor,
  setAnchor,
  countByDate,
  todayISO,
  selectedDate,
  onPick,
}: {
  anchor: Date;
  setAnchor: (d: Date) => void;
  countByDate: Map<string, number>;
  todayISO: string;
  selectedDate: string;
  onPick: (iso: string) => void;
}) {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7; // Monday=0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: ({ iso: string; date: Date } | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(year, month, d);
    cells.push({ iso: toISODate(dt), date: dt });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return (
    <View style={styles.monthWrap}>
      <View style={styles.monthNavRow}>
        <Pressable
          onPress={() => setAnchor(new Date(year, month - 1, 1))}
          hitSlop={8}
          style={({ pressed }) => [styles.monthNavBtn, pressed && { opacity: 0.6 }]}
        >
          <ChevronLeft size={18} color={theme.textMuted} />
        </Pressable>
        <Text style={styles.monthLabel}>
          {anchor.toLocaleDateString(undefined, { year: "numeric", month: "long" })}
        </Text>
        <Pressable
          onPress={() => setAnchor(new Date(year, month + 1, 1))}
          hitSlop={8}
          style={({ pressed }) => [styles.monthNavBtn, pressed && { opacity: 0.6 }]}
        >
          <ChevronRight size={18} color={theme.textMuted} />
        </Pressable>
      </View>
      <View style={styles.monthWdRow}>
        {["一", "二", "三", "四", "五", "六", "日"].map((w) => (
          <Text key={w} style={styles.monthWd}>
            {w}
          </Text>
        ))}
      </View>
      <View style={styles.monthGrid}>
        {cells.map((c, i) => {
          if (!c) return <View key={`e${i}`} style={styles.monthCell} />;
          const count = countByDate.get(c.iso) ?? 0;
          const isSel = c.iso === selectedDate;
          const isToday = c.iso === todayISO;
          return (
            <Pressable
              key={c.iso}
              onPress={() => onPick(c.iso)}
              style={({ pressed }) => [
                styles.monthCell,
                pressed && { opacity: 0.6 },
              ]}
            >
              <View
                style={[
                  styles.monthCellInner,
                  isSel && styles.monthCellSel,
                  !isSel && isToday && styles.monthCellToday,
                ]}
              >
                <Text
                  style={[
                    styles.monthCellNum,
                    isSel && { color: theme.bg },
                    !isSel && isToday && { color: theme.amber },
                  ]}
                >
                  {c.date.getDate()}
                </Text>
                {count > 0 && (
                  <View
                    style={[
                      styles.monthDot,
                      isSel && { backgroundColor: theme.bg },
                    ]}
                  />
                )}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function EmptyState({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [pressed && { opacity: 0.7 }]}>
      <GlassCard radius={22} style={styles.empty}>
        <Sparkles size={18} color={theme.amber} />
        <Text style={styles.emptyText}>{label}</Text>
      </GlassCard>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  flex: { flex: 1 },
  scroll: { padding: 20, gap: 20 },
  hero: { marginTop: 12, marginBottom: 4 },
  dateLabel: {
    color: theme.textDim,
    fontSize: 10,
    letterSpacing: 2.2,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  greeting: {
    color: theme.text,
    fontSize: 32,
    fontWeight: "700",
    letterSpacing: -0.8,
    marginTop: 8,
    lineHeight: 38,
  },
  greetingDim: { color: theme.textDim, fontWeight: "500" },
  tone: { color: theme.textMuted, fontSize: 14.5, marginTop: 6, lineHeight: 21, letterSpacing: -0.1 },
  goalsStripWrap: {
    marginHorizontal: -20,
    marginTop: -4,
    marginBottom: -4,
  },
  goalsStrip: {
    paddingHorizontal: 20,
    gap: 10,
    flexDirection: "row",
    alignItems: "center",
  },
  goalChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.035)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    maxWidth: 220,
    minWidth: 160,
  },
  goalChipEmoji: { fontSize: 18 },
  goalChipTitle: {
    color: theme.text,
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: -0.2,
  },
  goalChipBarTrack: {
    marginTop: 5,
    height: 3,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.06)",
    overflow: "hidden",
    width: 110,
  },
  goalChipBarFill: {
    height: "100%",
    borderRadius: 2,
    backgroundColor: theme.amber,
  },
  goalChipPct: {
    color: theme.amber,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.2,
    marginLeft: 2,
  },
  goalChipMore: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: "rgba(244,184,96,0.08)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(244,184,96,0.25)",
  },
  goalChipMoreText: {
    color: theme.amber,
    fontSize: 12,
    fontWeight: "700",
  },
  nudgeCard: {
    padding: 16,
    borderColor: "rgba(244,184,96,0.32)",
    backgroundColor: "rgba(244,184,96,0.06)",
  },
  nudgeHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  nudgeFlag: {
    color: theme.amber,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  nudgeEstWrap: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: "rgba(244,184,96,0.12)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(244,184,96,0.28)",
  },
  nudgeEst: {
    color: theme.amber,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  nudgeTitle: {
    color: theme.text,
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.3,
    lineHeight: 24,
  },
  nudgeFootRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 8,
  },
  nudgeReason: {
    color: theme.textMuted,
    fontSize: 12.5,
    flexShrink: 1,
    letterSpacing: -0.1,
  },
  nudgeHint: {
    color: theme.textDim,
    fontSize: 10.5,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  quickLogRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
    marginBottom: 2,
  },
  quickLogChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.08)",
  },
  quickLogEmoji: { fontSize: 13 },
  quickLogLabel: {
    color: theme.textMuted,
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: -0.1,
  },
  quickLogSince: {
    color: theme.textDim,
    fontSize: 10.5,
    fontWeight: "500",
    marginLeft: 2,
  },
  sleepCard: { padding: 14 },
  sleepRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  sleepIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  sleepTitle: { color: theme.text, fontSize: 15, fontWeight: "700" },
  sleepSub: { color: theme.textMuted, fontSize: 13, marginTop: 2 },
  sectionHeader: { marginTop: 8, marginBottom: 4 },
  scheduleHeader: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 12,
    marginTop: 8,
    marginBottom: 4,
  },
  sectionTitle: {
    color: theme.text,
    fontSize: 18,
    fontWeight: "600",
    letterSpacing: -0.3,
  },
  sectionSub: { color: theme.textDim, fontSize: 11.5, marginTop: 3, letterSpacing: 0.1 },
  addPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: theme.amber,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  addPillText: { color: theme.bg, fontSize: 12, fontWeight: "700" },
  aiPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(244,184,96,0.12)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(244,184,96,0.35)",
  },
  aiPillText: { color: theme.amber, fontSize: 12, fontWeight: "700" },
  aiHint: { color: theme.textMuted, fontSize: 13, lineHeight: 19 },
  gridCol: { gap: 10 },
  placeholder: { padding: 16 },
  placeholderText: { color: theme.textMuted, fontSize: 14, lineHeight: 20 },
  scheduleCard: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 12,
  },
  check: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.4,
    borderColor: theme.textFaint,
    alignItems: "center",
    justifyContent: "center",
  },
  checkOn: { backgroundColor: theme.amber, borderColor: theme.amber },
  timePill: {
    minWidth: 52,
    paddingVertical: 5,
    paddingHorizontal: 6,
    alignItems: "center",
  },
  timeText: {
    color: theme.textMuted,
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.4,
    fontVariant: ["tabular-nums"],
  },
  scheduleIcon: {
    width: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  scheduleTitle: { color: theme.text, fontSize: 14.5, flex: 1, lineHeight: 20, letterSpacing: -0.1 },
  scheduleDone: {
    color: theme.textDim,
    textDecorationLine: "line-through",
  },
  rowAction: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  empty: {
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  emptyText: { color: theme.textMuted, fontSize: 14 },
  factsCard: { padding: 16, gap: 10 },
  factRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  factDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.amber,
    marginTop: 7,
  },
  factText: { color: theme.text, fontSize: 14, flex: 1, lineHeight: 20 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    padding: 16,
  },
  modalCard: { padding: 22, gap: 10 },
  modalContentWrap: { maxHeight: "86%", width: "100%" },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  modalTitle: {
    color: theme.text,
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  fieldLabel: {
    color: theme.textDim,
    fontSize: 11,
    letterSpacing: 1.5,
    fontWeight: "700",
    marginTop: 6,
  },
  modalInput: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 12,
    padding: 12,
    color: theme.text,
    fontSize: 15,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  kindRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 2 },
  kindChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  kindChipActive: {
    backgroundColor: "rgba(244,184,96,0.18)",
    borderColor: theme.amber,
  },
  kindText: { color: theme.textMuted, fontSize: 13, fontWeight: "600" },
  kindTextActive: { color: theme.amber },
  modalActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
    alignItems: "center",
  },
  deleteBtn: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: "rgba(255,107,107,0.1)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,107,107,0.3)",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  deleteText: { color: theme.danger, fontWeight: "600", fontSize: 13 },
  saveBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  saveText: { color: theme.bg, fontWeight: "700", fontSize: 14 },
  moduleSummary: { color: theme.textMuted, fontSize: 14, lineHeight: 20 },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
    marginTop: 12,
  },
  progressFill: { height: "100%", borderRadius: 3 },
  progressNote: { color: theme.textDim, fontSize: 12, fontWeight: "600" },
  swipeDelete: {
    backgroundColor: theme.danger,
    justifyContent: "center",
    alignItems: "center",
    width: 88,
    borderTopRightRadius: 18,
    borderBottomRightRadius: 18,
    flexDirection: "row",
    gap: 6,
  },
  swipeOuter: {
    borderRadius: 18,
    overflow: "hidden",
  },
  swipeDeleteText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  sourceBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.amber,
    marginLeft: 4,
  },
  sourceBadgeText: {
    color: theme.amber,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  swipeDeleteIcon: {
    flex: 1,
    backgroundColor: theme.danger,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    marginLeft: 8,
  },
  factRowSolid: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  chatBubble: {
    padding: 12,
    borderRadius: 14,
    maxWidth: "88%",
  },
  chatBubbleAI: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    marginTop: 6,
  },
  chatBubbleUser: {
    alignSelf: "flex-end",
    backgroundColor: "rgba(244,184,96,0.18)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(244,184,96,0.4)",
    marginTop: 6,
  },
  chatBubbleUserText: { color: theme.text, fontSize: 14, lineHeight: 20 },
  chatBubbleActions: {
    flexDirection: "row",
    marginTop: 8,
    gap: 6,
  },
  chatBubbleAddBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: "rgba(244,184,96,0.14)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(244,184,96,0.4)",
  },
  chatBubbleAddText: { color: theme.amber, fontSize: 11, fontWeight: "700" },
  moduleChatHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 14,
    marginBottom: 2,
  },
  moduleChatHeadText: {
    color: theme.amber,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  chatComposer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    marginTop: 8,
  },
  chatComposerInput: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: theme.text,
    fontSize: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    minHeight: 40,
    maxHeight: 100,
  },
  chatSendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.amber,
    alignItems: "center",
    justifyContent: "center",
  },
  gmailCard: { padding: 14 },
  gmailRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  gmailIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  gmailTitle: { color: theme.text, fontSize: 15, fontWeight: "700" },
  gmailSub: { color: theme.textMuted, fontSize: 12, marginTop: 2, lineHeight: 17 },
  gmailToast: { color: theme.amber, fontSize: 12, marginTop: 4, fontWeight: "600" },
  gmailError: { color: theme.danger, fontSize: 12, marginTop: 4 },
  gmailBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: theme.amber,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  gmailBtnText: { color: theme.bg, fontSize: 12, fontWeight: "700" },
  gmailGhostBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  gmailGhostText: { color: theme.textMuted, fontSize: 12, fontWeight: "600" },
  detailHeading: {
    color: theme.textDim,
    fontSize: 11,
    letterSpacing: 1.5,
    fontWeight: "700",
    marginTop: 14,
  },
  detailEmpty: { color: theme.textMuted, fontSize: 13, marginTop: 4 },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 4,
  },
  detailDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.amber,
  },
  detailTime: {
    color: theme.amber,
    fontSize: 12,
    fontWeight: "700",
    minWidth: 52,
  },
  detailText: { color: theme.text, fontSize: 14, flex: 1 },
  detailFact: { color: theme.textMuted, fontSize: 13, lineHeight: 19 },
  weekStripRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
    marginBottom: 6,
  },
  weekStrip: { gap: 8, paddingHorizontal: 4 },
  weekNav: {
    width: 26,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  weekNavText: { color: theme.textDim, fontSize: 22, fontWeight: "300" },
  dayPill: {
    width: 44,
    paddingVertical: 8,
    borderRadius: 14,
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  dayPillActive: {
    backgroundColor: theme.amber,
    borderColor: theme.amber,
  },
  dayWd: { color: theme.textDim, fontSize: 10, fontWeight: "700", letterSpacing: 1 },
  dayWdActive: { color: theme.bg },
  dayNum: { color: theme.text, fontSize: 16, fontWeight: "700" },
  dayNumActive: { color: theme.bg },
  dayDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.amber,
  },
  modeRow: { flexDirection: "row", gap: 6, marginBottom: 4 },
  modeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  modeChipActive: {
    backgroundColor: "rgba(244,184,96,0.14)",
    borderColor: theme.amber,
  },
  modeText: { color: theme.textDim, fontSize: 12, fontWeight: "600" },
  modeTextActive: { color: theme.amber },
  moduleAiRow: { flexDirection: "row", marginTop: 8 },
  expandBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: "rgba(244,184,96,0.12)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(244,184,96,0.35)",
  },
  expandBtnText: { color: theme.amber, fontSize: 12, fontWeight: "700" },
  viewToggle: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    marginTop: 4,
    marginBottom: 6,
  },
  viewTab: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  viewTabActive: {
    backgroundColor: "rgba(244,184,96,0.16)",
    borderColor: theme.amber,
  },
  viewTabText: { color: theme.textDim, fontSize: 13, fontWeight: "700" },
  viewTabTextActive: { color: theme.amber },
  todayChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: "rgba(244,184,96,0.1)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(244,184,96,0.3)",
  },
  todayChipText: { color: theme.amber, fontSize: 11, fontWeight: "700" },
  weekDayCard: { padding: 14 },
  weekDayHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  weekDayLabel: { color: theme.text, fontSize: 14, fontWeight: "700" },
  weekDayCount: { color: theme.textDim, fontSize: 12, fontWeight: "600" },
  weekItemRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  weekItemTime: {
    color: theme.amber,
    fontSize: 12,
    fontWeight: "700",
    minWidth: 52,
  },
  weekItemText: { color: theme.text, fontSize: 13, flex: 1 },
  weekItemMore: { color: theme.textDim, fontSize: 12, marginTop: 2 },
  monthWrap: { gap: 8 },
  monthNavRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 4,
  },
  monthNavBtn: { padding: 6 },
  monthLabel: { color: theme.text, fontSize: 15, fontWeight: "700" },
  monthWdRow: { flexDirection: "row" },
  monthWd: {
    flex: 1,
    textAlign: "center",
    color: theme.textDim,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
  },
  monthGrid: { flexDirection: "row", flexWrap: "wrap" },
  monthCell: {
    width: "14.2857%",
    aspectRatio: 1,
    padding: 2,
  },
  monthCellInner: {
    flex: 1,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  monthCellSel: { backgroundColor: theme.amber },
  monthCellToday: {
    borderWidth: 1,
    borderColor: theme.amber,
  },
  monthCellNum: { color: theme.text, fontSize: 14, fontWeight: "700" },
  monthDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.amber,
  },
  detailContent: {
    marginTop: 8,
    padding: 14,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  calBulkRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center",
    marginTop: 4,
  },
  calBulk: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 12,
    backgroundColor: "rgba(244,184,96,0.1)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(244,184,96,0.3)",
  },
  calHalfBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  calHalfSync: {
    backgroundColor: "rgba(244,184,96,0.1)",
    borderColor: "rgba(244,184,96,0.3)",
  },
  calHalfImport: {
    backgroundColor: "rgba(123,107,240,0.10)",
    borderColor: "rgba(123,107,240,0.30)",
  },
  calBulkText: { color: theme.amber, fontSize: 12, fontWeight: "700" },
  calImport: {
    backgroundColor: "rgba(123,107,240,0.10)",
    borderColor: "rgba(123,107,240,0.30)",
  },
  calImportText: { color: theme.lavender, fontSize: 12, fontWeight: "700" },
  calUndo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  calUndoText: { color: theme.textMuted, fontSize: 12, fontWeight: "700" },
  mailChipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 6,
  },
  mailChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  mailChipDot: { width: 6, height: 6, borderRadius: 3 },
  mailChipText: {
    color: theme.textMuted,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  remindersCard: {
    padding: 12,
    backgroundColor: "rgba(123,107,240,0.08)",
  },
  remindersHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  remindersTitle: {
    color: theme.lavender,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  remindersCount: {
    color: theme.lavender,
    fontSize: 11,
    fontWeight: "700",
  },
  reminderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  reminderText: {
    flex: 1,
    color: theme.text,
    fontSize: 14,
    lineHeight: 19,
  },
  mailOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  mailDot: { width: 10, height: 10, borderRadius: 5 },
  mailOptName: { color: theme.text, fontSize: 14, fontWeight: "700" },
  mailOptSub: { color: theme.textMuted, fontSize: 12, marginTop: 2 },
  mailGmailMgr: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    marginTop: -2,
    marginBottom: 2,
  },
  helpStep: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    paddingVertical: 6,
  },
  helpStepNum: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: theme.amber,
    color: theme.bg,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 22,
    overflow: "hidden",
  },
  helpStepText: {
    flex: 1,
    color: theme.text,
    fontSize: 13,
    lineHeight: 19,
  },
  helpNote: {
    color: theme.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
  },
  tutorialBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: "rgba(244,184,96,0.12)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(244,184,96,0.35)",
    marginTop: 4,
    marginBottom: 4,
  },
  tutorialText: { color: theme.amber, fontSize: 12, fontWeight: "700" },
  tutorialSteps: { gap: 8, marginTop: 4 },
  tutorialStepRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  tutorialStepNum: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(244,184,96,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  tutorialStepNumText: {
    color: theme.amber,
    fontSize: 11,
    fontWeight: "700",
  },
  factCurrentBox: {
    backgroundColor: "rgba(244,184,96,0.08)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(244,184,96,0.3)",
    borderRadius: 12,
    padding: 10,
    gap: 4,
  },
  factCurrentLabel: {
    color: theme.amber,
    fontSize: 10,
    letterSpacing: 1.5,
    fontWeight: "700",
  },
  factCurrentText: { color: theme.text, fontSize: 13, lineHeight: 19 },
  tutorialStepText: {
    flex: 1,
    color: theme.text,
    fontSize: 13,
    lineHeight: 19,
  },
  completedToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: "rgba(149,213,178,0.1)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(149,213,178,0.3)",
    marginTop: 8,
  },
  completedToggleText: { color: theme.mint, fontSize: 11, fontWeight: "700" },
  completedCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    opacity: 0.7,
  },
  completedTime: {
    color: theme.textDim,
    fontSize: 12,
    fontWeight: "700",
    minWidth: 52,
  },
  toastRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
});
