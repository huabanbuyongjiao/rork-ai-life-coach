import AsyncStorage from "@react-native-async-storage/async-storage";
import createContextHook from "@nkzw/create-context-hook";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  analyzeConversation,
  coachReply,
  dedupeAgents,
  stripReplyTag,
  editFactAI,
  editScheduleItemAI,
  expandModuleDetail,
  matchAgentsForScheduleItem,
  parseScheduleFromText,
  planFromModuleDetail,
  planLongTermGoal,
  planMilestoneTasks,
  reconcileWithContext,
  runAgentTask,
} from "@/lib/coach";
import type { ChatMessage } from "@/lib/ai";
import type { LifeStates, NowNeedKey } from "@/lib/nowEngine";
import type {
  AgentTask,
  ChatFileAttachment,
  ChatMessageRecord,
  ChatSession,
  Goal,
  LifeModule,
  Milestone,
  ScheduleItem,
  UserContext,
} from "@/types/aurora";

const STORAGE_KEY = "aurora.state.v1";

type ArchivedAgent = { scheduleId: string; agent: AgentTask };

type PersistedState = {
  messages: ChatMessageRecord[];
  modules: LifeModule[];
  facts: string[];
  schedule: ScheduleItem[];
  agents: AgentTask[];
  goals: Goal[];
  sessions: ChatSession[];
  /** Agents that were auto-archived when their matching schedule item was
   * marked done. They are restored if the user un-checks the schedule item. */
  archivedAgents: ArchivedAgent[];
  /** Filler-stripped "topics" that the user has marked done in the timeline.
   * Newly-suggested agents whose title/desc overlaps these topics are dropped. */
  blockedAgentTopics: string[];
  /** Per-agent follow-up chat messages (user iterates on the result). */
  agentChats: Record<string, ChatMessageRecord[]>;
  /** Self-reported physical states for the Now Engine. */
  lifeStates: LifeStates;
};

const INITIAL_STATE: PersistedState = {
  messages: [],
  modules: [],
  facts: [],
  schedule: [],
  agents: [],
  goals: [],
  sessions: [],
  archivedAgents: [],
  blockedAgentTopics: [],
  agentChats: {},
  lifeStates: {},
};

const WELCOME: ChatMessageRecord = {
  id: "welcome",
  role: "assistant",
  text:
    "你好，我是 Aurora — 你的 AI 生活教练。\n\n告诉我你最近在忙什么、想达成什么目标，或者你现在的感受。我会一边聊天一边为你建立专属的生活模块，并在合适的时候提醒你休息、睡觉，或者直接帮你完成一些事情。",
  createdAt: Date.now(),
};

function uid(prefix: string = "m"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export const [AuroraProvider, useAurora] = createContextHook(() => {
  const queryClient = useQueryClient();
  const [hydrated, setHydrated] = useState<boolean>(false);
  const [state, setState] = useState<PersistedState>({
    ...INITIAL_STATE,
    messages: [WELCOME],
  });

  // Hydrate from storage
  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!mounted) return;
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as PersistedState;
            // Migrate old modules whose progress was stored as 0–100 instead of 0–1.
            const fixedModules = (parsed.modules ?? []).map((m) => {
              const n = typeof m.progress === "number" && isFinite(m.progress) ? m.progress : 0;
              const v = n > 1 ? n / 100 : n;
              return { ...m, progress: Math.max(0, Math.min(1, v)) };
            });
            setState({
              ...INITIAL_STATE,
              ...parsed,
              modules: fixedModules,
              messages:
                parsed.messages && parsed.messages.length > 0
                  ? parsed.messages
                  : [WELCOME],
            });
          } catch (err) {
            console.warn("[Aurora] hydration parse error", err);
          }
        }
      })
      .finally(() => {
        if (mounted) setHydrated(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  // Persist on change (after hydration)
  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch((err) => {
      console.warn("[Aurora] persist error", err);
    });
  }, [state, hydrated]);

  const userContext: UserContext = useMemo(
    () => ({ facts: state.facts, modules: state.modules }),
    [state.facts, state.modules]
  );

  const sendMessage = useMutation({
    mutationFn: async (input: {
      text: string;
      images?: string[];
      files?: ChatFileAttachment[];
    }) => {
      const userMsg: ChatMessageRecord = {
        id: uid("u"),
        role: "user",
        text: input.text,
        images: input.images,
        files: input.files,
        createdAt: Date.now(),
      };

      setState((prev) => ({ ...prev, messages: [...prev.messages, userMsg] }));

      const buildHistory = (records: ChatMessageRecord[]): ChatMessage[] =>
        records.map((m) => {
          const fileNote =
            m.files && m.files.length > 0
              ? "\n\n[\u9644\u4ef6]\n" +
                m.files
                  .map((f) => {
                    const head = `- ${f.name} (${f.mimeType}, ${Math.round(
                      f.size / 1024
                    )} KB)`;
                    return f.textPreview
                      ? `${head}\n\u5185\u5bb9\u8282\u9009:\n${f.textPreview}`
                      : head;
                  })
                  .join("\n\n")
              : "";
          const combinedText = (m.text || "") + fileNote;
          if (m.images && m.images.length > 0) {
            return {
              role: m.role,
              content: [
                { type: "text", text: combinedText || "(image)" },
                ...m.images.map((url) => ({
                  type: "image_url" as const,
                  image_url: { url },
                })),
              ],
            };
          }
          return { role: m.role, content: combinedText };
        });

      const historyForReply = buildHistory([
        ...state.messages.filter((m) => m.id !== "welcome"),
        userMsg,
      ]);

      const replyText = await coachReply({
        ctx: userContext,
        history: historyForReply,
      });

      const assistantMsg: ChatMessageRecord = {
        id: uid("a"),
        role: "assistant",
        text: stripReplyTag(replyText),
        createdAt: Date.now(),
      };

      setState((prev) => ({
        ...prev,
        messages: [...prev.messages, assistantMsg],
      }));

      const historyForAnalysis = buildHistory([
        ...state.messages.filter((m) => m.id !== "welcome"),
        userMsg,
        assistantMsg,
      ]);

      analyzeConversation(historyForAnalysis, state.facts)
        .then(async (analysis) => {
          let snapshot: PersistedState | null = null;
          setState((prev) => {
            const newFacts =
              analysis.facts && analysis.facts.length > 0
                ? analysis.facts.slice(0, 12)
                : prev.facts;
            // Normalize progress: LLM sometimes returns 0-100 instead of 0-1.
            // Any value > 1 is treated as a percent and divided by 100, then clamped.
            const normalizeProgress = (p: unknown): number => {
              const n = typeof p === "number" && isFinite(p) ? p : 0;
              const v = n > 1 ? n / 100 : n;
              return Math.max(0, Math.min(1, v));
            };
            const modules =
              analysis.modules && analysis.modules.length > 0
                ? analysis.modules.map((m) => ({
                    ...m,
                    progress: normalizeProgress(m.progress),
                  }))
                : prev.modules;
            const schedule =
              analysis.schedule && analysis.schedule.length > 0
                ? analysis.schedule
                : prev.schedule;
            const incomingAgents = analysis.agentSuggestions ?? [];
            const existingIds = new Set(prev.agents.map((a) => a.id));
            const blocked = prev.blockedAgentTopics;
            const isBlocked = (a: AgentTask): boolean => {
              if (blocked.length === 0) return false;
              const FILLER_B = [
                "协助", "帮我", "帮你", "帮忙", "请你", "帮", "起草", "填写", "完成", "准备", "今天", "明天", "后天", "今晚", "明晚", "上午", "下午", "晚上", "任务", "计划", "检查", "的", "去", "做",
              ];
              const stripB = (s: string): string => {
                let out = s.toLowerCase().replace(/[\s·・｜\.,!！，。:：、（）()\[\]【】「」『』"'“”‘’\-_]/g, "");
                for (const w of FILLER_B) out = out.split(w).join("");
                return out;
              };
              const text = stripB(`${a.title} ${a.description ?? ""}`);
              if (text.length < 2) return false;
              return blocked.some((topic) => {
                const t = stripB(topic);
                if (!t || t.length < 2) return false;
                // Fuzzy overlap: find longest common substring of len>=needed.
                const shorter = t.length <= text.length ? t : text;
                const longer = t.length <= text.length ? text : t;
                const needed = 2;
                for (let i = 0; i + needed <= shorter.length; i++) {
                  if (longer.includes(shorter.slice(i, i + needed))) return true;
                }
                return false;
              });
            };
            // Fuzzy dedup: drop incoming agents whose stripped title/desc
            // significantly overlaps an existing (non-done) agent. This catches
            // "制定本周训练计划" vs "制定两周训练计划" or
            // "实习工资对标 1200-2000 马币" vs "实习工资对标研究".
            const FILLER_D = [
              "协助", "帮我", "帮你", "帮忙", "请你", "帮", "起草", "填写", "完成", "准备", "今天", "明天", "后天", "今晚", "明晚", "上午", "下午", "晚上", "任务", "计划", "检查", "的", "去", "做", "本周", "两周", "一周", "下周", "本月", "今天的",
            ];
            const stripD = (s: string): string => {
              let out = s.toLowerCase().replace(/[\s·・｜\.,!！，。:：、（）()\[\]【】「」『』"'“”‘’\-_0-9]/g, "");
              for (const w of FILLER_D) out = out.split(w).join("");
              return out;
            };
            const isDup = (incoming: AgentTask): boolean => {
              const t = stripD(`${incoming.title} ${incoming.description ?? ""}`);
              if (t.length < 3) return false;
              for (const ex of prev.agents) {
                if (ex.status === "done") continue;
                const e = stripD(`${ex.title} ${ex.description ?? ""}`);
                if (e.length < 3) continue;
                const [shorter, longer] = t.length <= e.length ? [t, e] : [e, t];
                // require >=4 contiguous overlap OR >=60% of shorter inside longer
                const needed = Math.min(4, shorter.length);
                let hits = 0;
                for (let i = 0; i + needed <= shorter.length; i++) {
                  if (longer.includes(shorter.slice(i, i + needed))) hits++;
                }
                const ratio = hits / Math.max(1, shorter.length - needed + 1);
                if (ratio >= 0.6) return true;
              }
              return false;
            };
            const mergedAgents = [
              ...prev.agents,
              ...incomingAgents
                .filter((a) => !existingIds.has(a.id))
                .filter((a) => !isBlocked(a))
                .filter((a) => !isDup(a))
                .map((a) => ({ ...a, status: "suggested" as const })),
            ].slice(-12);
            // Schedule an AI-based semantic dedupe pass (catches duplicates
            // the local stripper misses, e.g. "实习工资行情" vs
            // "实习工资对标研究"). Don't await — lazily fire it and remove later.
            const pendingForDedup = mergedAgents
              .filter((a) => a.status !== "done")
              .map((a) => ({
                id: a.id,
                title: a.title,
                description: a.description || "",
              }));
            if (pendingForDedup.length >= 2) {
              dedupeAgents(pendingForDedup)
                .then((idsToRemove) => {
                  if (idsToRemove.length === 0) return;
                  console.log("[Aurora] AI-dedupe agents", idsToRemove);
                  setState((p) => ({
                    ...p,
                    agents: p.agents.filter(
                      (a) => !idsToRemove.includes(a.id) || a.status === "done"
                    ),
                  }));
                })
                .catch((err) => console.warn("[Aurora] dedupe failed", err));
            }
            const next: PersistedState = {
              ...prev,
              facts: newFacts,
              modules,
              schedule,
              agents: mergedAgents,
            };
            snapshot = next;
            return next;
          });

          if (!snapshot) return;
          const snap = snapshot as PersistedState;
          if (
            snap.goals.length === 0 &&
            snap.agents.length === 0 &&
            snap.schedule.length === 0
          ) {
            return;
          }
          try {
            const recon = await reconcileWithContext({
              facts: snap.facts,
              goals: snap.goals.map((g) => ({
                id: g.id,
                title: g.title,
                horizon: g.horizon,
                summary: g.summary,
                milestones: g.milestones,
              })),
              agents: snap.agents
                .filter((a) => a.status !== "done")
                .map((a) => ({
                  id: a.id,
                  title: a.title,
                  description: a.description,
                  kind: a.kind,
                })),
              schedule: snap.schedule
                .filter((s) => !s.locked)
                .map((s) => ({
                  id: s.id,
                  time: s.time,
                  title: s.title,
                  kind: s.kind,
                })),
              recentMessages: historyForAnalysis,
            });

            const goalPatches = recon.goalPatches ?? [];
            const agentsToRemove = new Set(recon.agentsToRemove ?? []);
            const scheduleToRemove = new Set(recon.scheduleToRemove ?? []);
            if (
              goalPatches.length === 0 &&
              agentsToRemove.size === 0 &&
              scheduleToRemove.size === 0
            ) {
              return;
            }

            setState((prev) => {
              const goalsAfterDelete = prev.goals.filter(
                (g) =>
                  !goalPatches.find((p) => p.id === g.id && p.deleteGoal)
              );
              const patchedGoals = goalsAfterDelete.map((g) => {
                const patch = goalPatches.find((p) => p.id === g.id);
                if (!patch || patch.deleteGoal) return g;
                // Locked goals are immune to AI auto-reconciliation.
                if (g.locked) return g;
                let newMilestones =
                  patch.newMilestones && patch.newMilestones.length > 0
                    ? patch.newMilestones.map((m) => ({
                        title: m.title,
                        when: m.when,
                        done: false,
                        tasks: (m.tasks ?? []).map((t) => ({
                          title: t.title,
                          done: false,
                        })),
                      }))
                    : g.milestones;
                // Preserve any milestone the user locked (because they added a
                // task from it to the weekly plan). Match by title; if it
                // doesn't appear in the AI's new list, append it back.
                const lockedFromOriginal = g.milestones.filter(
                  (m) => m.locked
                );
                if (lockedFromOriginal.length > 0) {
                  const titles = new Set(
                    newMilestones.map((m) => m.title.trim())
                  );
                  newMilestones = newMilestones.map((m) => {
                    const orig = lockedFromOriginal.find(
                      (o) => o.title.trim() === m.title.trim()
                    );
                    return orig ?? m;
                  });
                  for (const orig of lockedFromOriginal) {
                    if (!titles.has(orig.title.trim())) {
                      newMilestones.push(orig);
                    }
                  }
                }
                return {
                  ...g,
                  summary:
                    patch.newSummary && patch.newSummary.trim().length > 0
                      ? patch.newSummary
                      : g.summary,
                  milestones: newMilestones,
                };
              });
              return {
                ...prev,
                goals: patchedGoals,
                agents: prev.agents.filter((a) => !agentsToRemove.has(a.id)),
                schedule: prev.schedule.filter(
                  (s) => !scheduleToRemove.has(s.id)
                ),
              };
            });
          } catch (err) {
            console.warn("[Aurora] reconcile failed", err);
          }
        })
        .catch((err) => {
          console.warn("[Aurora] analysis failed", err);
        });

      return assistantMsg;
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "AI 请求失败";
      console.warn("[Aurora] sendMessage failed", err);
      const errorMsg: ChatMessageRecord = {
        id: uid("a"),
        role: "assistant",
        text: `⚠️ 没能回复你：${msg}\n\n请检查网络或稍后重试。`,
        createdAt: Date.now(),
      };
      setState((prev) => ({
        ...prev,
        messages: [...prev.messages, errorMsg],
      }));
    },
  });

  const clearChat = useCallback(() => {
    setState((prev) => {
      const real = prev.messages.filter((m) => m.id !== "welcome");
      if (real.length === 0) return { ...prev, messages: [WELCOME] };
      const firstUser = real.find((m) => m.role === "user");
      const titleSrc = (firstUser?.text || real[0]?.text || "对话").trim();
      const title = titleSrc.length > 24 ? titleSrc.slice(0, 24) + "…" : titleSrc || "对话";
      const session: ChatSession = {
        id: uid("sess"),
        title,
        createdAt: real[0]?.createdAt ?? Date.now(),
        endedAt: real[real.length - 1]?.createdAt ?? Date.now(),
        messages: real,
      };
      return { ...prev, sessions: [session, ...prev.sessions].slice(0, 50), messages: [WELCOME] };
    });
  }, []);

  const restoreSession = useCallback((sessionId: string) => {
    setState((prev) => {
      const sess = prev.sessions.find((s) => s.id === sessionId);
      if (!sess) return prev;
      const remaining = prev.sessions.filter((s) => s.id !== sessionId);
      const realCurrent = prev.messages.filter((m) => m.id !== "welcome");
      const archived: ChatSession[] = realCurrent.length
        ? [
            {
              id: uid("sess"),
              title: (realCurrent.find((m) => m.role === "user")?.text || "对话").slice(0, 24),
              createdAt: realCurrent[0].createdAt,
              endedAt: realCurrent[realCurrent.length - 1].createdAt,
              messages: realCurrent,
            },
            ...remaining,
          ]
        : remaining;
      return { ...prev, messages: sess.messages, sessions: archived.slice(0, 50) };
    });
  }, []);

  const deleteSession = useCallback((sessionId: string) => {
    setState((prev) => ({ ...prev, sessions: prev.sessions.filter((s) => s.id !== sessionId) }));
  }, []);

  const runAgent = useMutation({
    mutationFn: async (taskId: string) => {
      const task = state.agents.find((a) => a.id === taskId);
      if (!task) return null;
      setState((prev) => ({
        ...prev,
        agents: prev.agents.map((a) =>
          a.id === taskId ? { ...a, status: "running" } : a
        ),
      }));
      try {
        const result = await runAgentTask(task);
        setState((prev) => ({
          ...prev,
          agents: prev.agents.map((a) =>
            a.id === taskId ? { ...a, status: "done", result } : a
          ),
        }));
        const note: ChatMessageRecord = {
          id: uid("a"),
          role: "assistant",
          text: `✦ 智能体任务完成 · ${task.title}\n\n${result}`,
          createdAt: Date.now(),
        };
        setState((prev) => ({
          ...prev,
          messages: [...prev.messages, note],
        }));
        return result;
      } catch (err) {
        setState((prev) => ({
          ...prev,
          agents: prev.agents.map((a) =>
            a.id === taskId ? { ...a, status: "suggested" } : a
          ),
        }));
        throw err;
      }
    },
  });

  const addGoal = useCallback((goal: Goal) => {
    setState((prev) => ({ ...prev, goals: [goal, ...prev.goals] }));
  }, []);

  const toggleMilestone = useCallback((goalId: string, idx: number) => {
    setState((prev) => ({
      ...prev,
      goals: prev.goals.map((g) =>
        g.id === goalId
          ? {
              ...g,
              milestones: g.milestones.map((m, i) =>
                i === idx ? { ...m, done: !m.done } : m
              ),
            }
          : g
      ),
    }));
  }, []);

  const deleteGoal = useCallback((goalId: string) => {
    setState((prev) => ({
      ...prev,
      goals: prev.goals.filter((g) => g.id !== goalId),
    }));
  }, []);

  const toggleMilestoneTask = useCallback(
    (goalId: string, mIdx: number, tIdx: number) => {
      setState((prev) => ({
        ...prev,
        goals: prev.goals.map((g) =>
          g.id === goalId
            ? {
                ...g,
                milestones: g.milestones.map((m, i) =>
                  i === mIdx
                    ? {
                        ...m,
                        tasks: (m.tasks ?? []).map((t, j) =>
                          j === tIdx ? { ...t, done: !t.done } : t
                        ),
                      }
                    : m
                ),
              }
            : g
        ),
      }));
    },
    []
  );

  const updateMilestone = useCallback(
    (goalId: string, mIdx: number, patch: Partial<Milestone>) => {
      setState((prev) => ({
        ...prev,
        goals: prev.goals.map((g) =>
          g.id === goalId
            ? {
                ...g,
                milestones: g.milestones.map((m, i) =>
                  i === mIdx ? { ...m, ...patch } : m
                ),
              }
            : g
        ),
      }));
    },
    []
  );

  const deleteMilestone = useCallback((goalId: string, mIdx: number) => {
    setState((prev) => ({
      ...prev,
      goals: prev.goals.map((g) =>
        g.id === goalId
          ? { ...g, milestones: g.milestones.filter((_, i) => i !== mIdx) }
          : g
      ),
    }));
  }, []);

  const regenerateGoalPlan = useCallback(
    async (goalId: string) => {
      const goal = state.goals.find((g) => g.id === goalId);
      if (!goal) return;
      const res = await planLongTermGoal({
        goal: goal.title,
        horizon: goal.horizon,
        facts: state.facts,
      });
      setState((prev) => ({
        ...prev,
        goals: prev.goals.map((g) =>
          g.id === goalId
            ? {
                ...g,
                summary: res.summary || g.summary,
                milestones: res.milestones.map((m) => ({
                  title: m.title,
                  when: m.when,
                  done: false,
                  tasks: (m.tasks ?? []).map((t) => ({
                    title: t.title,
                    done: false,
                  })),
                })),
              }
            : g
        ),
      }));
    },
    [state.goals, state.facts]
  );

  const regenerateMilestoneTasks = useCallback(
    async (goalId: string, mIdx: number) => {
      const goal = state.goals.find((g) => g.id === goalId);
      if (!goal) return;
      const m = goal.milestones[mIdx];
      if (!m) return;
      const tasks = await planMilestoneTasks({
        goal: goal.title,
        horizon: goal.horizon ?? "",
        milestoneTitle: m.title,
        milestoneWhen: m.when ?? "",
      });
      setState((prev) => ({
        ...prev,
        goals: prev.goals.map((g) =>
          g.id === goalId
            ? {
                ...g,
                milestones: g.milestones.map((mm, i) =>
                  i === mIdx
                    ? {
                        ...mm,
                        tasks: tasks.map((t) => ({
                          title: t.title,
                          done: false,
                        })),
                      }
                    : mm
                ),
              }
            : g
        ),
      }));
    },
    [state.goals]
  );

  const addScheduleItem = useCallback((item: ScheduleItem) => {
    setState((prev) => ({ ...prev, schedule: [...prev.schedule, item] }));
  }, []);

  const addScheduleFromAI = useMutation({
    mutationFn: async (text: string) => {
      const items = await parseScheduleFromText(text);
      if (items.length === 0) return 0;
      const now = new Date();
      const y = now.getFullYear();
      const mo = String(now.getMonth() + 1).padStart(2, "0");
      const dd = String(now.getDate()).padStart(2, "0");
      const todayISO = `${y}-${mo}-${dd}`;
      const isValidISO = (s: string | undefined): s is string =>
        !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
      setState((prev) => {
        const additions: ScheduleItem[] = items.map((it) => ({
          id: uid("s"),
          time: it.time || "今天",
          title: it.title,
          kind: it.kind || "other",
          date: isValidISO(it.date) ? it.date : todayISO,
        }));
        return { ...prev, schedule: [...prev.schedule, ...additions] };
      });
      return items.length;
    },
  });

  const updateScheduleItem = useCallback(
    (id: string, patch: Partial<ScheduleItem>) => {
      setState((prev) => {
        // Enrich the patch with derived lifecycle fields when `done` flips, so
        // historical tasks keep their completion timestamp on their original
        // calendar date (no auto-carry-forward).
        const enrichedPatch: Partial<ScheduleItem> =
          patch.done === undefined
            ? patch
            : patch.done
            ? {
                ...patch,
                completedAt: patch.completedAt ?? Date.now(),
                status: "done",
              }
            : { ...patch, completedAt: undefined, status: "pending" };
        const nextSchedule = prev.schedule.map((s) =>
          s.id === id ? { ...s, ...enrichedPatch } : s
        );
        const item = nextSchedule.find((s) => s.id === id);
        if (!item || patch.done === undefined) {
          return { ...prev, schedule: nextSchedule };
        }

        const clean = (s: string): string =>
          s
            .toLowerCase()
            .replace(
              /[\s·・｜\.,!！，。:：、（）()\[\]【】「」『』"'“”‘’\-_]/g,
              ""
            );
        // Words that frequently appear on both sides but mean nothing for
        // matching. We strip them BEFORE measuring overlap so e.g.
        // "协助填写神秘访客评分表" reduces to "神秘访客评分表".
        const FILLER = [
          "协助",
          "帮我",
          "帮你",
          "帮忙",
          "请你",
          "帮",
          "起草",
          "填写",
          "完成",
          "准备",
          "今天",
          "明天",
          "后天",
          "今晚",
          "明晚",
          "上午",
          "下午",
          "晚上",
          "任务",
          "计划",
          "检查",
          "的",
          "去",
          "做",
        ];
        const stripFiller = (s: string): string => {
          let out = s;
          for (const w of FILLER) out = out.split(w).join("");
          return out;
        };
        const itemRaw = clean(item.title);
        const itemCore = stripFiller(itemRaw);
        if (itemCore.length < 2) return { ...prev, schedule: nextSchedule };
        const longestCommon = (a: string, b: string, minLen: number): string => {
          if (!a || !b) return "";
          let best = "";
          for (let i = 0; i < a.length; i++) {
            for (let j = i + minLen; j <= a.length; j++) {
              const sub = a.slice(i, j);
              if (sub.length <= best.length) continue;
              if (b.includes(sub)) best = sub;
            }
          }
          return best;
        };
        const overlaps = (text: string): boolean => {
          const tc = stripFiller(clean(text));
          if (tc.length < 2) return false;
          const lcs = longestCommon(itemCore, tc, 2);
          // Aggressive: 2-char overlap is enough for CJK topics like
          // "评分", "访客", "健身". This is the user-side flow so false
          // positives are recoverable (they can un-check to restore).
          return lcs.length >= 2;
        };

        if (patch.done === true) {
          // Archive matched agents so they disappear from the agents list.
          const matched: AgentTask[] = [];
          const remaining = prev.agents.filter((a) => {
            if (a.status === "done") return true;
            const isMatch =
              overlaps(a.title) || overlaps(a.description || "");
            if (isMatch) {
              console.log(
                "[Aurora] archive agent on schedule done (local match)",
                a.title,
                "<==",
                item.title
              );
              matched.push(a);
              return false;
            }
            return true;
          });
          // Also kick off an AI-driven match for anything the local matcher
          // missed (e.g. "协助填写神秘访客评分表" vs "羊不同神秘访客评分").
          const pendingForAI = remaining
            .filter((a) => a.status !== "done")
            .map((a) => ({
              id: a.id,
              title: a.title,
              description: a.description || "",
            }));
          if (pendingForAI.length > 0) {
            matchAgentsForScheduleItem({
              scheduleTitle: item.title,
              agents: pendingForAI,
            })
              .then((idsToArchive) => {
                if (idsToArchive.length === 0) return;
                console.log(
                  "[Aurora] AI archive agents",
                  idsToArchive,
                  "<==",
                  item.title
                );
                setState((p) => {
                  const toArchive = p.agents.filter((a) =>
                    idsToArchive.includes(a.id)
                  );
                  if (toArchive.length === 0) return p;
                  return {
                    ...p,
                    agents: p.agents.filter(
                      (a) => !idsToArchive.includes(a.id)
                    ),
                    archivedAgents: [
                      ...p.archivedAgents,
                      ...toArchive.map((a) => ({
                        scheduleId: id,
                        agent: a,
                      })),
                    ],
                  };
                });
              })
              .catch((err) => {
                console.warn("[Aurora] AI agent match failed", err);
              });
          }
          const archived: ArchivedAgent[] = matched.map((a) => ({
            scheduleId: id,
            agent: a,
          }));
          // Persist the topic so freshly-suggested agents about the same
          // thing (different id) also get filtered out going forward.
          const newBlocked = Array.from(
            new Set([...prev.blockedAgentTopics, itemCore])
          ).slice(-30);
          return {
            ...prev,
            schedule: nextSchedule,
            agents: remaining,
            archivedAgents: [...prev.archivedAgents, ...archived],
            blockedAgentTopics: newBlocked,
          };
        }
        // done === false: restore archived agents for this schedule id and
        // unblock the topic so suggestions can come back.
        const restore = prev.archivedAgents.filter(
          (a) => a.scheduleId === id
        );
        const nextBlocked = prev.blockedAgentTopics.filter(
          (t) => t !== itemCore
        );
        if (restore.length === 0) {
          return {
            ...prev,
            schedule: nextSchedule,
            blockedAgentTopics: nextBlocked,
          };
        }
        const existingIds = new Set(prev.agents.map((a) => a.id));
        const restored = restore
          .map((a) => a.agent)
          .filter((a) => !existingIds.has(a.id));
        return {
          ...prev,
          schedule: nextSchedule,
          agents: [...prev.agents, ...restored],
          archivedAgents: prev.archivedAgents.filter(
            (a) => a.scheduleId !== id
          ),
          blockedAgentTopics: nextBlocked,
        };
      });
    },
    []
  );

  const updateGoal = useCallback(
    (goalId: string, patch: Partial<Pick<Goal, "title" | "horizon" | "summary">>) => {
      setState((prev) => ({
        ...prev,
        goals: prev.goals.map((g) =>
          g.id === goalId ? { ...g, ...patch } : g
        ),
      }));
    },
    []
  );

  const editScheduleFromAI = useMutation({
    mutationFn: async (input: { id: string; instruction: string }) => {
      const item = state.schedule.find((s) => s.id === input.id);
      if (!item) return false;
      if (item.locked) {
        console.log("[Aurora] skip AI edit on locked schedule item", item.id);
        return false;
      }
      const res = await editScheduleItemAI({
        current: {
          time: item.time,
          title: item.title,
          kind: item.kind,
          date: item.date,
        },
        instruction: input.instruction,
      });
      if (!res) return false;
      setState((prev) => ({
        ...prev,
        schedule: prev.schedule.map((s) =>
          s.id === input.id
            ? {
                ...s,
                time: res.time || s.time,
                title: res.title || s.title,
                kind: res.kind || s.kind,
                date: res.date ?? s.date,
              }
            : s
        ),
      }));
      return true;
    },
  });

  const markAgentDone = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      agents: prev.agents.map((a) =>
        a.id === id
          ? {
              ...a,
              status: "done" as const,
              result: a.result || "你在今日时间线中已手动完成。",
            }
          : a
      ),
    }));
  }, []);

  /** Move an active agent into the archive (soft delete — user can restore). */
  const archiveAgent = useCallback((id: string) => {
    setState((prev) => {
      const agent = prev.agents.find((a) => a.id === id);
      if (!agent) return prev;
      return {
        ...prev,
        agents: prev.agents.filter((a) => a.id !== id),
        archivedAgents: [
          ...prev.archivedAgents,
          { scheduleId: "manual", agent },
        ],
      };
    });
  }, []);

  /** Move an archived agent back to the active list. */
  const restoreArchivedAgent = useCallback((agentId: string) => {
    setState((prev) => {
      const entry = prev.archivedAgents.find((a) => a.agent.id === agentId);
      if (!entry) return prev;
      const exists = prev.agents.some((a) => a.id === agentId);
      return {
        ...prev,
        archivedAgents: prev.archivedAgents.filter(
          (a) => a.agent.id !== agentId
        ),
        agents: exists
          ? prev.agents
          : [
              ...prev.agents,
              { ...entry.agent, status: "suggested" as const },
            ],
      };
    });
  }, []);

  /** Permanently remove an agent from the archive (irreversible). */
  const deleteArchivedAgent = useCallback((agentId: string) => {
    setState((prev) => ({
      ...prev,
      archivedAgents: prev.archivedAgents.filter(
        (a) => a.agent.id !== agentId
      ),
    }));
  }, []);

  const deleteAgent = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      agents: prev.agents.filter((a) => a.id !== id),
    }));
  }, []);

  const deleteScheduleItem = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      schedule: prev.schedule.filter((s) => s.id !== id),
    }));
  }, []);

  const addTaskToToday = useCallback(
    (
      title: string,
      kind: ScheduleItem["kind"] = "other",
      time: string = "今天",
      date?: string,
      goalId?: string,
      milestoneIdx?: number
    ) => {
      setState((prev) => {
        const exists = prev.schedule.some(
          (s) =>
            s.title.trim().toLowerCase() === title.trim().toLowerCase() &&
            (s.date ?? "") === (date ?? "")
        );
        const item: ScheduleItem = {
          id: uid("s"),
          time,
          title,
          kind,
          ...(date ? { date } : {}),
          // Items added from a goal/milestone or coach plan are locked so the
          // AI reconcile pass can't silently rewrite them later.
          ...(goalId !== undefined ? { locked: true, source: "plan" as const } : {}),
        };
        // If this came from a goal milestone, lock ONLY that milestone so
        // AI reconcile can no longer overwrite it. Other milestones in the
        // same goal stay editable by Aurora.
        const goals =
          goalId && milestoneIdx !== undefined
            ? prev.goals.map((g) =>
                g.id === goalId
                  ? {
                      ...g,
                      milestones: g.milestones.map((m, i) =>
                        i === milestoneIdx ? { ...m, locked: true } : m
                      ),
                    }
                  : g
              )
            : prev.goals;
        if (exists) return { ...prev, goals };
        return { ...prev, schedule: [...prev.schedule, item], goals };
      });
    },
    []
  );

  const togglePinAgent = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      agents: prev.agents.map((a) =>
        a.id === id ? { ...a, pinned: !a.pinned } : a
      ),
    }));
  }, []);

  const toggleLockScheduleItem = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      schedule: prev.schedule.map((s) =>
        s.id === id ? { ...s, locked: !s.locked } : s
      ),
    }));
  }, []);

  const toggleLockGoal = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      goals: prev.goals.map((g) =>
        g.id === id ? { ...g, locked: !g.locked } : g
      ),
    }));
  }, []);

  const updateModule = useCallback(
    (id: string, patch: Partial<LifeModule>) => {
      setState((prev) => ({
        ...prev,
        modules: prev.modules.map((m) =>
          m.id === id ? { ...m, ...patch } : m
        ),
      }));
    },
    []
  );

  const expandModule = useMutation({
    mutationFn: async (moduleId: string) => {
      const m = state.modules.find((mm) => mm.id === moduleId);
      if (!m) return null;
      const title = m.title.toLowerCase();
      const related = state.schedule
        .filter((s) => s.title.toLowerCase().includes(title))
        .map((s) => ({ time: s.time, title: s.title }));
      const detail = await expandModuleDetail({
        module: { id: m.id, title: m.title, summary: m.summary },
        facts: state.facts,
        relatedSchedule: related,
      });
      setState((prev) => ({
        ...prev,
        modules: prev.modules.map((mm) =>
          mm.id === moduleId
            ? { ...mm, detail, detailUpdatedAt: Date.now() }
            : mm
        ),
      }));
      return detail;
    },
  });

  const _mergePlanItems = useCallback(
    (
      items: { time: string; title: string; kind: ScheduleItem["kind"]; dayOffset: number }[]
    ): { count: number; ids: string[] } => {
      if (items.length === 0) return { count: 0, ids: [] };
      const today = new Date();
      const toISO = (d: Date): string => {
        const y = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        return `${y}-${mm}-${dd}`;
      };
      const additions: ScheduleItem[] = items.map((it) => {
        const d = new Date(today);
        d.setDate(today.getDate() + Math.max(0, Math.min(6, it.dayOffset ?? 0)));
        return {
          id: uid("s"),
          time: it.time || "今天",
          title: it.title,
          kind: it.kind || "other",
          date: toISO(d),
        };
      });
      let addedIds: string[] = [];
      setState((prev) => {
        const key = (s: ScheduleItem) =>
          `${s.date ?? ""}|${s.title.trim().toLowerCase()}`;
        const existing = new Set(prev.schedule.map(key));
        const fresh = additions.filter((a) => !existing.has(key(a)));
        addedIds = fresh.map((f) => f.id);
        return { ...prev, schedule: [...prev.schedule, ...fresh] };
      });
      return { count: addedIds.length, ids: addedIds };
    },
    []
  );

  const addModuleDetailToPlan = useMutation({
    mutationFn: async (moduleId: string): Promise<{ count: number; ids: string[] }> => {
      const m = state.modules.find((mm) => mm.id === moduleId);
      if (!m || !m.detail) return { count: 0, ids: [] };
      const items = await planFromModuleDetail({
        module: { id: m.id, title: m.title },
        detail: m.detail,
      });
      return _mergePlanItems(items);
    },
  });

  const addTextToPlan = useMutation({
    mutationFn: async (input: {
      moduleId: string;
      text: string;
    }): Promise<{ count: number; ids: string[] }> => {
      const m = state.modules.find((mm) => mm.id === input.moduleId);
      if (!m || !input.text.trim()) return { count: 0, ids: [] };
      const items = await planFromModuleDetail({
        module: { id: m.id, title: m.title },
        detail: input.text,
      });
      return _mergePlanItems(items);
    },
  });

  const chatAboutModule = useMutation({
    mutationFn: async (input: {
      moduleId: string;
      history: ChatMessage[];
      userText: string;
    }): Promise<string> => {
      const m = state.modules.find((mm) => mm.id === input.moduleId);
      if (!m) return "";
      const moduleCtx = `你正在针对用户的「${m.title}」这个生活模块进行对话。\n模块总结：${m.summary}\n${
        m.detail ? `当前建议内容：\n${m.detail.slice(0, 1200)}` : ""
      }\n\n回复时仅针对这个模块。保持简洁，不超过 180 字。如果用户提出修改建议或增加计划，按 markdown 输出可执行的 3-6 条包含时间提示的动作项，方便加入本周计划。`;
      const messages: ChatMessage[] = [
        { role: "system", content: moduleCtx },
        ...input.history,
        { role: "user", content: input.userText },
      ];
      const reply = await coachReply({ ctx: userContext, history: messages });
      return reply;
    },
  });

  const chatAboutAgent = useMutation({
    mutationFn: async (input: { agentId: string; userText: string }): Promise<string> => {
      const agent = state.agents.find((a) => a.id === input.agentId);
      if (!agent) return "";
      const userMsg: ChatMessageRecord = {
        id: uid("u"),
        role: "user",
        text: input.userText,
        createdAt: Date.now(),
      };
      setState((prev) => ({
        ...prev,
        agentChats: {
          ...prev.agentChats,
          [input.agentId]: [
            ...(prev.agentChats[input.agentId] ?? []),
            userMsg,
          ],
        },
      }));
      const ctx = `你正在针对一个已完成的 AI 智能体任务与用户跟进。\n任务标题：${agent.title}\n任务说明：${agent.description}\n${
        agent.result ? `交付结果：\n${agent.result.slice(0, 1800)}` : ""
      }\n\n回复规则：\n- 仅针对这个任务与交付结果讨论，不跳题。\n- 用户可能要求你改写、扩充、提问、拆解成可执行步骤、或生成下一版本。\n- 输出紧凑 markdown，不超 200 字。`;
      const history: ChatMessage[] = [
        { role: "system", content: ctx },
        ...((state.agentChats[input.agentId] ?? []).map((m) => ({
          role: m.role,
          content: m.text,
        })) as ChatMessage[]),
        { role: "user", content: input.userText },
      ];
      const reply = await coachReply({ ctx: userContext, history });
      const assistantMsg: ChatMessageRecord = {
        id: uid("a"),
        role: "assistant",
        text: reply,
        createdAt: Date.now(),
      };
      setState((prev) => ({
        ...prev,
        agentChats: {
          ...prev.agentChats,
          [input.agentId]: [
            ...(prev.agentChats[input.agentId] ?? []),
            assistantMsg,
          ],
        },
      }));
      return reply;
    },
  });

  const clearAgentChat = useCallback((agentId: string) => {
    setState((prev) => {
      const next = { ...prev.agentChats };
      delete next[agentId];
      return { ...prev, agentChats: next };
    });
  }, []);

  const removeModule = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      modules: prev.modules.filter((m) => m.id !== id),
    }));
  }, []);

  const removeFact = useCallback((index: number) => {
    setState((prev) => ({
      ...prev,
      facts: prev.facts.filter((_, i) => i !== index),
    }));
  }, []);

  const updateFact = useCallback((index: number, text: string) => {
    const t = text.trim();
    if (!t) return;
    setState((prev) => ({
      ...prev,
      facts: prev.facts.map((f, i) => (i === index ? t : f)),
    }));
  }, []);

  const editFactWithAI = useMutation({
    mutationFn: async (input: { index: number; instruction: string }) => {
      const cur = state.facts[input.index];
      if (!cur) return false;
      const next = await editFactAI({ current: cur, instruction: input.instruction });
      if (!next) return false;
      setState((prev) => ({
        ...prev,
        facts: prev.facts.map((f, i) => (i === input.index ? next : f)),
      }));
      return true;
    },
  });

  const [chatDraft, setChatDraft] = useState<string>("");

  const logLifeState = useCallback((key: NowNeedKey) => {
    setState((prev) => {
      const next: LifeStates = { ...prev.lifeStates };
      const now = Date.now();
      if (key === "eat") next.lastMealAt = now;
      else if (key === "shower") next.lastShowerAt = now;
      else if (key === "sleep") next.lastSleepAt = now;
      // "break" is transient — not persisted.
      return { ...prev, lifeStates: next };
    });
  }, []);

  const removeScheduleItems = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    const set = new Set(ids);
    setState((prev) => ({
      ...prev,
      schedule: prev.schedule.filter((s) => !set.has(s.id)),
    }));
  }, []);

  void queryClient;
  void useQuery;

  return useMemo(
    () => ({
      hydrated,
      messages: state.messages,
      modules: state.modules,
      facts: state.facts,
      schedule: state.schedule,
      agents: state.agents,
      goals: state.goals,
      lifeStates: state.lifeStates,
      logLifeState,
      sendMessage,
      runAgent,
      clearChat,
      addGoal,
      toggleMilestone,
      toggleMilestoneTask,
      regenerateMilestoneTasks,
      updateMilestone,
      deleteMilestone,
      regenerateGoalPlan,
      updateGoal,
      addTaskToToday,
      deleteGoal,
      addScheduleItem,
      addScheduleFromAI,
      updateScheduleItem,
      editScheduleFromAI,
      deleteScheduleItem,
      updateModule,
      expandModule,
      addModuleDetailToPlan,
      addTextToPlan,
      chatAboutModule,
      chatAboutAgent,
      clearAgentChat,
      agentChats: state.agentChats,
      removeModule,
      removeFact,
      updateFact,
      editFactWithAI,
      chatDraft,
      setChatDraft,
      removeScheduleItems,
      markAgentDone,
      deleteAgent,
      archiveAgent,
      restoreArchivedAgent,
      deleteArchivedAgent,
      archivedAgents: state.archivedAgents,
      togglePinAgent,
      toggleLockGoal,
      toggleLockScheduleItem,
      sessions: state.sessions,
      restoreSession,
      deleteSession,
    }),
    [
      hydrated,
      state,
      sendMessage,
      runAgent,
      clearChat,
      addGoal,
      toggleMilestone,
      toggleMilestoneTask,
      regenerateMilestoneTasks,
      updateMilestone,
      deleteMilestone,
      regenerateGoalPlan,
      updateGoal,
      addTaskToToday,
      deleteGoal,
      addScheduleItem,
      addScheduleFromAI,
      updateScheduleItem,
      editScheduleFromAI,
      deleteScheduleItem,
      updateModule,
      expandModule,
      addModuleDetailToPlan,
      addTextToPlan,
      chatAboutModule,
      chatAboutAgent,
      clearAgentChat,
      removeModule,
      removeFact,
      updateFact,
      editFactWithAI,
      chatDraft,
      removeScheduleItems,
      markAgentDone,
      deleteAgent,
      archiveAgent,
      restoreArchivedAgent,
      deleteArchivedAgent,
      togglePinAgent,
      toggleLockGoal,
      toggleLockScheduleItem,
      restoreSession,
      deleteSession,
      logLifeState,
    ]
  );
});
