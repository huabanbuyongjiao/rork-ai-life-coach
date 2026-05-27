import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import {
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  Lock,
  LockOpen,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Target,
  Trash2,
  Wand2,
  X,
} from "lucide-react-native";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
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
import { theme } from "@/constants/theme";
import { planLongTermGoal } from "@/lib/coach";
import { useAurora } from "@/providers/AuroraProvider";
import type { Goal, Milestone } from "@/types/aurora";

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Compute a sensible ISO date for a milestone task based on the milestone's
 * "when" label and its index within the milestone. Examples of `when`:
 *   "第 1 个月" → spread across the first month from today
 *   "第 2-4 个月" → spread across days 30–120
 *   "第 2 周" → day 7–13
 */
function dateForMilestoneTask(
  when: string,
  taskIndex: number,
  taskCount: number
): string {
  const today = new Date();
  const totalDays = ((): { start: number; end: number } => {
    const w = (when || "").trim();
    const m = w.match(/(\d+)\s*-?\s*(\d+)?\s*(个月|月|周|天|日)/);
    if (m) {
      const a = parseInt(m[1], 10);
      const b = m[2] ? parseInt(m[2], 10) : a;
      const unit = m[3];
      const unitDays =
        unit === "周" ? 7 : unit === "天" || unit === "日" ? 1 : 30;
      return { start: (a - 1) * unitDays, end: b * unitDays - 1 };
    }
    return { start: 0, end: 6 };
  })();
  const span = Math.max(1, totalDays.end - totalDays.start);
  const slot =
    taskCount <= 1
      ? totalDays.start + Math.floor(span / 2)
      : totalDays.start +
        Math.round((taskIndex / Math.max(1, taskCount - 1)) * span);
  const d = new Date(today);
  d.setDate(today.getDate() + Math.max(0, slot));
  return toISODate(d);
}

const HORIZONS = ["3 个月", "6 个月", "1 年", "3 年", "10 年", "一生"];

type EditingMilestone = {
  goalId: string;
  mIdx: number;
  title: string;
  when: string;
};

type EditingGoal = {
  goalId: string;
  title: string;
  horizon: string;
  summary: string;
};

export default function GoalsScreen() {
  const {
    goals,
    facts,
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
    toggleLockGoal,
  } = useAurora();
  const [composerOpen, setComposerOpen] = useState<boolean>(false);
  const [goalText, setGoalText] = useState<string>("");
  const [horizon, setHorizon] = useState<string>("1 年");
  const [planning, setPlanning] = useState<boolean>(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [regenerating, setRegenerating] = useState<Record<string, boolean>>({});
  const [regenGoal, setRegenGoal] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<EditingMilestone | null>(null);
  const [editingGoal, setEditingGoal] = useState<EditingGoal | null>(null);

  const toggleExpanded = useCallback((key: string) => {
    setExpanded((p) => ({ ...p, [key]: !p[key] }));
  }, []);

  const handlePlan = useCallback(async () => {
    const t = goalText.trim();
    if (!t) return;
    setPlanning(true);
    try {
      const res = await planLongTermGoal({ goal: t, horizon, facts });
      const goal: Goal = {
        id: `g_${Date.now().toString(36)}`,
        title: t,
        horizon,
        summary: res.summary,
        milestones: res.milestones.map((m) => ({ ...m, done: false })),
        createdAt: Date.now(),
      };
      addGoal(goal);
      setGoalText("");
      setComposerOpen(false);
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
          () => {}
        );
      }
    } catch (err) {
      console.warn("[plan goal]", err);
      Alert.alert("规划失败", "请稍后再试");
    } finally {
      setPlanning(false);
    }
  }, [goalText, horizon, facts, addGoal]);

  const onDelete = useCallback(
    (id: string) => {
      Alert.alert("删除目标？", "里程碑也会一并删除", [
        { text: "取消", style: "cancel" },
        { text: "删除", style: "destructive", onPress: () => deleteGoal(id) },
      ]);
    },
    [deleteGoal]
  );

  const onRegenGoal = useCallback(
    (id: string) => {
      Alert.alert(
        "根据最新理解重新规划？",
        "Aurora 会结合你的最新情况重新拆解所有里程碑。",
        [
          { text: "取消", style: "cancel" },
          {
            text: "重新规划",
            onPress: async () => {
              setRegenGoal((p) => ({ ...p, [id]: true }));
              try {
                await regenerateGoalPlan(id);
                if (Platform.OS !== "web")
                  Haptics.notificationAsync(
                    Haptics.NotificationFeedbackType.Success
                  ).catch(() => {});
              } catch (err) {
                console.warn(err);
                Alert.alert("失败", "请稍后再试");
              } finally {
                setRegenGoal((p) => ({ ...p, [id]: false }));
              }
            },
          },
        ]
      );
    },
    [regenerateGoalPlan]
  );

  const onDeleteMilestone = useCallback(
    (goalId: string, mIdx: number) => {
      deleteMilestone(goalId, mIdx);
      if (Platform.OS !== "web")
        Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Warning
        ).catch(() => {});
    },
    [deleteMilestone]
  );

  const saveEditing = useCallback(() => {
    if (!editing) return;
    const patch: Partial<Milestone> = {
      title: editing.title.trim() || "新里程碑",
      when: editing.when.trim(),
    };
    updateMilestone(editing.goalId, editing.mIdx, patch);
    setEditing(null);
  }, [editing, updateMilestone]);

  return (
    <View style={styles.root}>
      <AuroraBackground />
      <SafeAreaView style={styles.flex} edges={["top"]}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.kicker}>个人 / 目标</Text>
              <Text style={styles.title}>人生目标</Text>
              <Text style={styles.sub}>
                设定一个北极星 · Aurora 帮你拆解每一步
              </Text>
            </View>
            <Pressable
              onPress={() => setComposerOpen(true)}
              style={({ pressed }) => [
                styles.addBtn,
                pressed && { opacity: 0.7 },
              ]}
            >
              <LinearGradient
                colors={[theme.amber, theme.peach]}
                style={StyleSheet.absoluteFill}
              />
              <Plus size={20} color={theme.bg} />
            </Pressable>
          </View>

          {goals.length === 0 ? (
            <GlassCard radius={22} style={styles.empty}>
              <View style={styles.emptyIcon}>
                <LinearGradient
                  colors={[theme.amber, theme.rose]}
                  style={StyleSheet.absoluteFill}
                />
                <Target size={22} color={theme.bg} />
              </View>
              <Text style={styles.emptyTitle}>从一个清晰的目标开始</Text>
              <Text style={styles.emptyText}>
                例如：在 1 年内通过雅思 7.5、成为前端工程师、读完 24 本书…
              </Text>
              <Pressable
                onPress={() => setComposerOpen(true)}
                style={({ pressed }) => [
                  styles.emptyCta,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Sparkles size={14} color={theme.bg} />
                <Text style={styles.emptyCtaText}>制定目标</Text>
              </Pressable>
            </GlassCard>
          ) : (
            <View style={{ gap: 14 }}>
              {goals.map((g) => {
                const done = g.milestones.filter((m) => m.done).length;
                const total = g.milestones.length;
                const pct = total > 0 ? done / total : 0;
                const isRegenAll = regenGoal[g.id] ?? false;
                return (
                  <GlassCard key={g.id} radius={22} style={styles.goalCard}>
                    <View style={styles.goalHeader}>
                      <Text style={styles.goalHorizon}>{g.horizon}</Text>
                      <Text style={styles.goalTitle}>{g.title}</Text>
                      {g.summary ? (
                        <Text style={styles.goalSummary}>{g.summary}</Text>
                      ) : null}
                      <View style={styles.goalActions}>
                        <Pressable
                          onPress={() => {
                            toggleLockGoal(g.id);
                            if (Platform.OS !== "web")
                              Haptics.selectionAsync().catch(() => {});
                          }}
                          hitSlop={8}
                          style={({ pressed }) => [
                            styles.goalActionChip,
                            g.locked && styles.goalActionChipLocked,
                            pressed && { opacity: 0.5 },
                          ]}
                        >
                          {g.locked ? (
                            <Lock size={12} color={theme.mint} />
                          ) : (
                            <LockOpen size={12} color={theme.amber} />
                          )}
                          <Text
                            style={[
                              styles.goalActionText,
                              g.locked && { color: theme.mint },
                            ]}
                          >
                            {g.locked ? "已锁定" : "锁定"}
                          </Text>
                        </Pressable>
                        <Pressable
                          onPress={() =>
                            setEditingGoal({
                              goalId: g.id,
                              title: g.title,
                              horizon: g.horizon,
                              summary: g.summary,
                            })
                          }
                          hitSlop={8}
                          style={({ pressed }) => [
                            styles.goalActionChip,
                            pressed && { opacity: 0.5 },
                          ]}
                        >
                          <Pencil size={12} color={theme.amber} />
                          <Text style={styles.goalActionText}>编辑</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => onRegenGoal(g.id)}
                          hitSlop={8}
                          disabled={isRegenAll}
                          style={({ pressed }) => [
                            styles.goalActionChip,
                            (pressed || isRegenAll) && { opacity: 0.5 },
                          ]}
                        >
                          {isRegenAll ? (
                            <ActivityIndicator size="small" color={theme.amber} />
                          ) : (
                            <RefreshCw size={12} color={theme.amber} />
                          )}
                          <Text style={styles.goalActionText}>重新生成</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => onDelete(g.id)}
                          hitSlop={8}
                          style={({ pressed }) => [
                            styles.goalActionChip,
                            styles.goalActionChipDanger,
                            pressed && { opacity: 0.5 },
                          ]}
                        >
                          <Trash2 size={12} color={theme.textDim} />
                          <Text
                            style={[styles.goalActionText, { color: theme.textDim }]}
                          >
                            删除
                          </Text>
                        </Pressable>
                      </View>
                    </View>

                    <View style={styles.progressTrack}>
                      <LinearGradient
                        colors={[theme.amber, theme.peach]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={[styles.progressFill, { width: `${pct * 100}%` }]}
                      />
                    </View>
                    <Text style={styles.progressLabel}>
                      {done} / {total} 已完成
                    </Text>

                    <View style={{ gap: 4, marginTop: 6 }}>
                      {g.milestones.map((m, i) => {
                        const key = `${g.id}-${i}`;
                        const isOpen = expanded[key] ?? false;
                        const tasks = m.tasks ?? [];
                        const taskDone = tasks.filter((t) => t.done).length;
                        const isRegen = regenerating[key] ?? false;
                        return (
                          <Swipeable
                            key={i}
                            overshootRight={false}
                            rightThreshold={40}
                            renderRightActions={() => (
                              <View style={styles.swipeActions}>
                                <Pressable
                                  onPress={() =>
                                    setEditing({
                                      goalId: g.id,
                                      mIdx: i,
                                      title: m.title,
                                      when: m.when ?? "",
                                    })
                                  }
                                  style={({ pressed }) => [
                                    styles.swipeEdit,
                                    pressed && { opacity: 0.85 },
                                  ]}
                                >
                                  <Pencil size={16} color={"#fff"} />
                                </Pressable>
                                <Pressable
                                  onPress={() => onDeleteMilestone(g.id, i)}
                                  style={({ pressed }) => [
                                    styles.swipeDelete,
                                    pressed && { opacity: 0.85 },
                                  ]}
                                >
                                  <Trash2 size={16} color={"#fff"} />
                                </Pressable>
                              </View>
                            )}
                          >
                            <View style={styles.milestoneBlock}>
                              <View style={styles.milestoneRow}>
                                <Pressable
                                  onPress={() => {
                                    toggleMilestone(g.id, i);
                                    if (Platform.OS !== "web")
                                      Haptics.selectionAsync().catch(() => {});
                                  }}
                                  hitSlop={6}
                                >
                                  <View
                                    style={[
                                      styles.check,
                                      m.done && styles.checkOn,
                                    ]}
                                  >
                                    {m.done && (
                                      <Check size={12} color={theme.bg} />
                                    )}
                                  </View>
                                </Pressable>
                                <Pressable
                                  onPress={() => toggleExpanded(key)}
                                  style={({ pressed }) => [
                                    styles.milestoneMain,
                                    pressed && { opacity: 0.7 },
                                  ]}
                                >
                                  <View style={{ flex: 1 }}>
                                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                                      <Text
                                        style={[
                                          styles.milestoneTitle,
                                          m.done && styles.milestoneDone,
                                          { flexShrink: 1 },
                                        ]}
                                      >
                                        {m.title}
                                      </Text>
                                      {m.locked && (
                                        <View style={styles.lockedBadge}>
                                          <Lock size={9} color={theme.amber} />
                                          <Text style={styles.lockedBadgeText}>已加入计划</Text>
                                        </View>
                                      )}
                                    </View>
                                    <Text style={styles.milestoneWhen}>
                                      {m.when}
                                      {tasks.length > 0
                                        ? `  ·  ${taskDone}/${tasks.length} 任务`
                                        : "  ·  点击展开 · 左滑编辑"}
                                    </Text>
                                  </View>
                                  {isOpen ? (
                                    <ChevronDown
                                      size={16}
                                      color={theme.textDim}
                                    />
                                  ) : (
                                    <ChevronRight
                                      size={16}
                                      color={theme.textDim}
                                    />
                                  )}
                                </Pressable>
                              </View>
                              {isOpen && (
                                <View style={styles.taskList}>
                                  {tasks.length > 0 ? (
                                    tasks.map((t, ti) => (
                                      <View key={ti} style={styles.taskRow}>
                                        <Pressable
                                          onPress={() => {
                                            toggleMilestoneTask(g.id, i, ti);
                                            if (Platform.OS !== "web")
                                              Haptics.selectionAsync().catch(
                                                () => {}
                                              );
                                          }}
                                          hitSlop={4}
                                        >
                                          <View
                                            style={[
                                              styles.checkSm,
                                              t.done && styles.checkOn,
                                            ]}
                                          >
                                            {t.done && (
                                              <Check
                                                size={9}
                                                color={theme.bg}
                                              />
                                            )}
                                          </View>
                                        </Pressable>
                                        <Text
                                          style={[
                                            styles.taskText,
                                            t.done && styles.milestoneDone,
                                          ]}
                                        >
                                          {t.title}
                                        </Text>
                                        <Pressable
                                          onPress={() => {
                                            const date = dateForMilestoneTask(
                                              m.when ?? "",
                                              ti,
                                              tasks.length
                                            );
                                            addTaskToToday(
                                              t.title,
                                              "other",
                                              "",
                                              date,
                                              g.id,
                                              i
                                            );
                                            if (Platform.OS !== "web")
                                              Haptics.notificationAsync(
                                                Haptics.NotificationFeedbackType
                                                  .Success
                                              ).catch(() => {});
                                          }}
                                          hitSlop={6}
                                          style={({ pressed }) => [
                                            styles.todayBtn,
                                            pressed && { opacity: 0.6 },
                                          ]}
                                        >
                                          <Calendar
                                            size={11}
                                            color={theme.mint}
                                          />
                                          <Text style={styles.todayBtnText}>
                                            加入计划
                                          </Text>
                                        </Pressable>
                                      </View>
                                    ))
                                  ) : (
                                    <Text style={styles.taskEmpty}>
                                      还没有具体任务。让 Aurora 拆解为每天能做的事。
                                    </Text>
                                  )}
                                  <Pressable
                                    disabled={isRegen}
                                    onPress={async () => {
                                      setRegenerating((p) => ({
                                        ...p,
                                        [key]: true,
                                      }));
                                      try {
                                        await regenerateMilestoneTasks(g.id, i);
                                        if (Platform.OS !== "web")
                                          Haptics.notificationAsync(
                                            Haptics.NotificationFeedbackType
                                              .Success
                                          ).catch(() => {});
                                      } catch (err) {
                                        console.warn(err);
                                      } finally {
                                        setRegenerating((p) => ({
                                          ...p,
                                          [key]: false,
                                        }));
                                      }
                                    }}
                                    style={({ pressed }) => [
                                      styles.regenBtn,
                                      (pressed || isRegen) && { opacity: 0.6 },
                                    ]}
                                  >
                                    {isRegen ? (
                                      <ActivityIndicator
                                        size="small"
                                        color={theme.amber}
                                      />
                                    ) : (
                                      <Wand2 size={12} color={theme.amber} />
                                    )}
                                    <Text style={styles.regenText}>
                                      {tasks.length > 0
                                        ? "重新生成任务"
                                        : "生成具体任务"}
                                    </Text>
                                  </Pressable>
                                </View>
                              )}
                            </View>
                          </Swipeable>
                        );
                      })}
                    </View>
                  </GlassCard>
                );
              })}
            </View>
          )}

          <View style={{ height: 100 }} />
        </ScrollView>
      </SafeAreaView>

      {/* New goal modal */}
      <Modal
        visible={composerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setComposerOpen(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => !planning && setComposerOpen(false)}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={styles.modalWrap}
          >
            <Pressable>
              <GlassCard radius={28} intensity={50} style={styles.modalCard}>
                <Text style={styles.modalTitle}>新的人生目标</Text>
                <Text style={styles.modalSub}>
                  写下一个目标，Aurora 会结合对你的理解规划里程碑。
                </Text>
                <TextInput
                  value={goalText}
                  onChangeText={setGoalText}
                  placeholder="例如：在 1 年内成为独立开发者"
                  placeholderTextColor={theme.textDim}
                  style={styles.modalInput}
                  multiline
                  maxLength={200}
                  editable={!planning}
                />

                <Text style={styles.modalLabel}>时间跨度</Text>
                <View style={styles.horizonRow}>
                  {HORIZONS.map((h) => {
                    const active = horizon === h;
                    return (
                      <Pressable
                        key={h}
                        onPress={() => setHorizon(h)}
                        disabled={planning}
                        style={({ pressed }) => [
                          styles.horizonChip,
                          active && styles.horizonChipActive,
                          pressed && { opacity: 0.7 },
                        ]}
                      >
                        <Text
                          style={[
                            styles.horizonText,
                            active && styles.horizonTextActive,
                          ]}
                        >
                          {h}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <View style={styles.modalActions}>
                  <Pressable
                    onPress={() => setComposerOpen(false)}
                    disabled={planning}
                    style={({ pressed }) => [
                      styles.cancelBtn,
                      pressed && { opacity: 0.6 },
                    ]}
                  >
                    <Text style={styles.cancelText}>取消</Text>
                  </Pressable>
                  <Pressable
                    onPress={handlePlan}
                    disabled={planning || !goalText.trim()}
                    style={({ pressed }) => [
                      styles.confirmBtn,
                      (pressed || planning || !goalText.trim()) && {
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
                    {planning ? (
                      <ActivityIndicator color={theme.bg} size="small" />
                    ) : (
                      <>
                        <Sparkles size={14} color={theme.bg} />
                        <Text style={styles.confirmText}>生成规划</Text>
                      </>
                    )}
                  </Pressable>
                </View>
              </GlassCard>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      {/* Edit goal modal */}
      <Modal
        visible={editingGoal !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setEditingGoal(null)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setEditingGoal(null)}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={styles.modalWrap}
          >
            <Pressable>
              {editingGoal && (
                <GlassCard radius={26} intensity={50} style={styles.modalCard}>
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>编辑人生目标</Text>
                    <Pressable onPress={() => setEditingGoal(null)} hitSlop={8}>
                      <X size={18} color={theme.textMuted} />
                    </Pressable>
                  </View>
                  <Text style={styles.modalLabel}>目标</Text>
                  <TextInput
                    value={editingGoal.title}
                    onChangeText={(v) =>
                      setEditingGoal((p) => (p ? { ...p, title: v } : p))
                    }
                    style={styles.modalInput}
                    placeholderTextColor={theme.textDim}
                    multiline
                    maxLength={200}
                  />
                  <Text style={styles.modalLabel}>时间跨度</Text>
                  <View style={styles.horizonRow}>
                    {HORIZONS.map((h) => {
                      const active = editingGoal.horizon === h;
                      return (
                        <Pressable
                          key={h}
                          onPress={() =>
                            setEditingGoal((p) => (p ? { ...p, horizon: h } : p))
                          }
                          style={({ pressed }) => [
                            styles.horizonChip,
                            active && styles.horizonChipActive,
                            pressed && { opacity: 0.7 },
                          ]}
                        >
                          <Text
                            style={[
                              styles.horizonText,
                              active && styles.horizonTextActive,
                            ]}
                          >
                            {h}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Text style={styles.modalLabel}>描述（可选）</Text>
                  <TextInput
                    value={editingGoal.summary}
                    onChangeText={(v) =>
                      setEditingGoal((p) => (p ? { ...p, summary: v } : p))
                    }
                    placeholder="一句话说明这个目标是什么"
                    placeholderTextColor={theme.textDim}
                    style={styles.modalInput}
                    multiline
                  />
                  <View style={styles.modalActions}>
                    <Pressable
                      onPress={() => setEditingGoal(null)}
                      style={({ pressed }) => [
                        styles.cancelBtn,
                        pressed && { opacity: 0.6 },
                      ]}
                    >
                      <Text style={styles.cancelText}>取消</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        if (!editingGoal) return;
                        updateGoal(editingGoal.goalId, {
                          title: editingGoal.title.trim() || "未命名目标",
                          horizon: editingGoal.horizon,
                          summary: editingGoal.summary.trim(),
                        });
                        setEditingGoal(null);
                        if (Platform.OS !== "web")
                          Haptics.notificationAsync(
                            Haptics.NotificationFeedbackType.Success
                          ).catch(() => {});
                      }}
                      style={({ pressed }) => [
                        styles.confirmBtn,
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <LinearGradient
                        colors={[theme.amber, theme.peach]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={StyleSheet.absoluteFill}
                      />
                      <Text style={styles.confirmText}>保存</Text>
                    </Pressable>
                  </View>
                </GlassCard>
              )}
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      {/* Edit milestone modal */}
      <Modal
        visible={editing !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setEditing(null)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setEditing(null)}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={styles.modalWrap}
          >
            <Pressable>
              {editing && (
                <GlassCard radius={26} intensity={50} style={styles.modalCard}>
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>编辑里程碑</Text>
                    <Pressable onPress={() => setEditing(null)} hitSlop={8}>
                      <X size={18} color={theme.textMuted} />
                    </Pressable>
                  </View>
                  <Text style={styles.modalLabel}>标题</Text>
                  <TextInput
                    value={editing.title}
                    onChangeText={(v) =>
                      setEditing((p) => (p ? { ...p, title: v } : p))
                    }
                    style={styles.modalInput}
                    placeholderTextColor={theme.textDim}
                  />
                  <Text style={styles.modalLabel}>时间</Text>
                  <TextInput
                    value={editing.when}
                    onChangeText={(v) =>
                      setEditing((p) => (p ? { ...p, when: v } : p))
                    }
                    placeholder="例如 第 1 个月"
                    placeholderTextColor={theme.textDim}
                    style={styles.modalInput}
                  />
                  <View style={styles.modalActions}>
                    <Pressable
                      onPress={() => {
                        if (editing) onDeleteMilestone(editing.goalId, editing.mIdx);
                        setEditing(null);
                      }}
                      style={({ pressed }) => [
                        styles.deleteBtn,
                        pressed && { opacity: 0.6 },
                      ]}
                    >
                      <Trash2 size={14} color={theme.danger} />
                    </Pressable>
                    <Pressable
                      onPress={saveEditing}
                      style={({ pressed }) => [
                        styles.confirmBtn,
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <LinearGradient
                        colors={[theme.amber, theme.peach]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={StyleSheet.absoluteFill}
                      />
                      <Text style={styles.confirmText}>保存</Text>
                    </Pressable>
                  </View>
                </GlassCard>
              )}
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  flex: { flex: 1 },
  scroll: { padding: 20, gap: 18 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 6,
  },
  kicker: {
    color: theme.textFaint,
    fontSize: 11,
    letterSpacing: 2.4,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  title: {
    color: theme.text,
    fontSize: 34,
    fontWeight: "700",
    letterSpacing: -0.8,
    marginTop: 6,
    lineHeight: 40,
  },
  sub: { color: theme.textMuted, fontSize: 14, marginTop: 4 },
  addBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  empty: { padding: 22, gap: 12, alignItems: "flex-start" },
  emptyIcon: {
    width: 44,
    height: 44,
    borderRadius: 16,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: { color: theme.text, fontSize: 18, fontWeight: "700" },
  emptyText: { color: theme.textMuted, fontSize: 14, lineHeight: 20 },
  emptyCta: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: theme.amber,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
  },
  emptyCtaText: { color: theme.bg, fontWeight: "700", fontSize: 14 },
  goalCard: { padding: 18, gap: 10 },
  goalHeader: { gap: 4 },
  goalActions: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    marginTop: 10,
    flexWrap: "wrap",
  },
  goalActionChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: "rgba(244,184,96,0.10)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(244,184,96,0.25)",
  },
  goalActionChipDanger: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: theme.border,
  },
  goalActionChipLocked: {
    backgroundColor: "rgba(123,211,183,0.12)",
    borderColor: "rgba(123,211,183,0.35)",
  },
  goalActionText: {
    color: theme.amber,
    fontSize: 11,
    fontWeight: "700",
  },
  goalHorizon: {
    color: theme.amber,
    fontSize: 11,
    letterSpacing: 1.5,
    fontWeight: "700",
  },
  goalTitle: {
    color: theme.text,
    fontSize: 20,
    fontWeight: "700",
    marginTop: 2,
    letterSpacing: -0.2,
  },
  goalSummary: {
    color: theme.textMuted,
    fontSize: 13,
    marginTop: 6,
    lineHeight: 19,
  },
  progressTrack: {
    height: 5,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
    marginTop: 6,
  },
  progressFill: { height: "100%", borderRadius: 3 },
  progressLabel: { color: theme.textDim, fontSize: 11, fontWeight: "600" },
  milestoneBlock: { gap: 4, paddingVertical: 2, backgroundColor: "transparent" },
  milestoneRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 6,
  },
  milestoneMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  lockedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.amber,
    backgroundColor: "rgba(244,184,96,0.08)",
  },
  lockedBadgeText: {
    color: theme.amber,
    fontSize: 9,
    fontWeight: "700",
  },
  taskList: {
    marginLeft: 34,
    paddingLeft: 10,
    borderLeftWidth: 1,
    borderLeftColor: "rgba(244,184,96,0.25)",
    gap: 8,
    paddingVertical: 4,
  },
  taskRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  taskText: { color: theme.textMuted, fontSize: 13, flex: 1, lineHeight: 18 },
  taskEmpty: {
    color: theme.textDim,
    fontSize: 12,
    lineHeight: 17,
    fontStyle: "italic",
  },
  todayBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 9,
    backgroundColor: "rgba(123,211,183,0.12)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(123,211,183,0.3)",
  },
  todayBtnText: { color: theme.mint, fontSize: 10, fontWeight: "700" },
  regenBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: "rgba(244,184,96,0.12)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(244,184,96,0.3)",
    marginTop: 4,
  },
  regenText: { color: theme.amber, fontSize: 11, fontWeight: "700" },
  checkSm: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: theme.textDim,
    alignItems: "center",
    justifyContent: "center",
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: theme.textDim,
    alignItems: "center",
    justifyContent: "center",
  },
  checkOn: {
    backgroundColor: theme.amber,
    borderColor: theme.amber,
  },
  milestoneTitle: { color: theme.text, fontSize: 14, fontWeight: "500" },
  milestoneDone: {
    color: theme.textDim,
    textDecorationLine: "line-through",
  },
  milestoneWhen: { color: theme.textDim, fontSize: 12, marginTop: 1 },
  swipeActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginLeft: 6,
  },
  swipeEdit: {
    width: 56,
    height: "85%",
    borderRadius: 14,
    backgroundColor: theme.lavender,
    alignItems: "center",
    justifyContent: "center",
  },
  swipeDelete: {
    width: 56,
    height: "85%",
    borderRadius: 14,
    backgroundColor: theme.danger,
    alignItems: "center",
    justifyContent: "center",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    padding: 16,
  },
  modalWrap: { justifyContent: "center" },
  modalCard: { padding: 22, gap: 12 },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  modalTitle: {
    color: theme.text,
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  modalSub: { color: theme.textMuted, fontSize: 13, lineHeight: 18 },
  modalInput: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 14,
    padding: 14,
    color: theme.text,
    fontSize: 15,
    minHeight: 48,
    marginTop: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  modalLabel: {
    color: theme.textDim,
    fontSize: 11,
    letterSpacing: 1.5,
    fontWeight: "700",
    marginTop: 4,
  },
  horizonRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  horizonChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    backgroundColor: theme.surface,
  },
  horizonChipActive: {
    backgroundColor: "rgba(244,184,96,0.18)",
    borderColor: theme.amber,
  },
  horizonText: { color: theme.textMuted, fontSize: 13, fontWeight: "600" },
  horizonTextActive: { color: theme.amber },
  modalActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 8,
    alignItems: "center",
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  cancelText: { color: theme.textMuted, fontWeight: "600", fontSize: 14 },
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
  confirmBtn: {
    flex: 1.6,
    paddingVertical: 14,
    borderRadius: 14,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  confirmText: { color: theme.bg, fontWeight: "700", fontSize: 14 },
});
