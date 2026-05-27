import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import {
  Archive,
  ArchiveRestore,
  BookOpenCheck,
  CalendarPlus,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Copy,
  FileSignature,
  Lock,
  MessageCircle,
  PenLine,
  Pin,
  PinOff,
  PlayCircle,
  Search,
  Send,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react-native";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import AuroraBackground from "@/components/AuroraBackground";
import GlassCard from "@/components/GlassCard";
import Markdown from "@/components/Markdown";
import { theme } from "@/constants/theme";
import { parseScheduleFromText } from "@/lib/coach";
import { useAurora } from "@/providers/AuroraProvider";
import type { AgentTask } from "@/types/aurora";

function iconForKind(kind: AgentTask["kind"]) {
  switch (kind) {
    case "homework":
      return BookOpenCheck;
    case "checkin":
      return ClipboardCheck;
    case "research":
      return Search;
    case "draft":
      return PenLine;
    case "plan":
      return FileSignature;
    default:
      return Wand2;
  }
}

export default function AgentsScreen() {
  const {
    agents,
    runAgent,
    markAgentDone,
    deleteAgent,
    archiveAgent,
    archivedAgents,
    restoreArchivedAgent,
    deleteArchivedAgent,
    chatAboutAgent,
    agentChats,
    clearAgentChat,
    addScheduleItem,
    togglePinAgent,
  } = useAurora();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [cardOpen, setCardOpen] = useState<Record<string, boolean>>({});
  const [chatOpen, setChatOpen] = useState<Record<string, boolean>>({});
  const [chatDrafts, setChatDrafts] = useState<Record<string, string>>({});
  const [addingToSched, setAddingToSched] = useState<string | null>(null);
  const [schedToast, setSchedToast] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState<boolean>(false);

  const onRun = useCallback(
    (id: string) => {
      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      }
      runAgent.mutate(id);
    },
    [runAgent]
  );

  const onCopy = useCallback(async (id: string, text: string) => {
    try {
      await Clipboard.setStringAsync(text);
      setCopiedId(id);
      if (Platform.OS !== "web")
        Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success
        ).catch(() => {});
      setTimeout(() => setCopiedId((p) => (p === id ? null : p)), 1400);
    } catch (err) {
      console.warn("[copy]", err);
    }
  }, []);

  const running = runAgent.isPending ? runAgent.variables : null;

  const onSendAgentMsg = useCallback(
    (agentId: string) => {
      const draft = (chatDrafts[agentId] ?? "").trim();
      if (!draft || chatAboutAgent.isPending) return;
      if (Platform.OS !== "web")
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      chatAboutAgent.mutate({ agentId, userText: draft });
      setChatDrafts((prev) => ({ ...prev, [agentId]: "" }));
    },
    [chatDrafts, chatAboutAgent]
  );

  const onAddToSchedule = useCallback(
    async (agentId: string, resultText: string) => {
      setAddingToSched(agentId);
      setSchedToast(null);
      try {
        const items = await parseScheduleFromText(resultText);
        if (items.length === 0) {
          setSchedToast("未能从结果中解析出日程项");
          return;
        }
        const today = new Date();
        const y = today.getFullYear();
        const mo = String(today.getMonth() + 1).padStart(2, "0");
        const dd = String(today.getDate()).padStart(2, "0");
        const todayISO = `${y}-${mo}-${dd}`;
        const isValidISO = (s: string | undefined): s is string =>
          !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
        for (let i = 0; i < items.length; i++) {
          addScheduleItem({
            id: `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
            time: items[i].time || "今天",
            title: items[i].title,
            kind: items[i].kind || "other",
            date: isValidISO(items[i].date) ? items[i].date! : todayISO,
          });
        }
        setSchedToast(`已添加 ${items.length} 项到日程`);
        if (Platform.OS !== "web")
          Haptics.notificationAsync(
            Haptics.NotificationFeedbackType.Success
          ).catch(() => {});
      } catch (err) {
        setSchedToast(
          err instanceof Error ? err.message : "添加失败"
        );
      } finally {
        setAddingToSched(null);
        setTimeout(() => setSchedToast(null), 3000);
      }
    },
    [addScheduleItem]
  );

  return (
    <View style={styles.root}>
      <AuroraBackground />
      <SafeAreaView style={styles.flex} edges={["top"]}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={0}
        >
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <Text style={styles.kicker}>个人 / 智能体</Text>
            <Text style={styles.title}>AI 智能体</Text>
            <Text style={styles.sub}>
              Aurora 在和你的对话中识别可自动完成的任务 · 你点一下，它去做
            </Text>
          </View>

          <GlassCard radius={20} style={styles.hint}>
            <View style={styles.hintIcon}>
              <LinearGradient
                colors={[theme.lavender, theme.rose]}
                style={StyleSheet.absoluteFill}
              />
              <Sparkles size={16} color={theme.bg} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.hintTitle}>智能体能帮你做什么</Text>
              <Text style={styles.hintText}>
                资料整理 · 邮件起草 · 内容总结 · 行程规划 · 数据对比 · 文档梳理… 在 Coach 里聊到具体任务，这里就会出现一个可执行的按钮。
              </Text>
            </View>
          </GlassCard>

          <GlassCard radius={20} style={styles.hint}>
            <View style={[styles.hintIcon, { backgroundColor: "rgba(255,255,255,0.08)" }]}>
              <Lock size={14} color={theme.textMuted} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.hintTitle}>微信 / WhatsApp / Instagram 接入</Text>
              <Text style={styles.hintText}>
                iOS 和 Android 出于隐私原因不允许第三方 App 读取这些聊天记录。你可以随手把截图发给 Aurora，或用“分享到 Aurora”把重要消息发过来——同样能被理解。
              </Text>
            </View>
          </GlassCard>

          {agents.length === 0 ? (
            <GlassCard radius={22} style={styles.empty}>
              <Wand2 size={22} color={theme.amber} />
              <Text style={styles.emptyTitle}>暂无待办</Text>
              <Text style={styles.emptyText}>
                试试和 Aurora 说：「帮我整理这周读的几篇文章重点」或「帮我起草一封请假邮件」
              </Text>
            </GlassCard>
          ) : (
            <View style={{ gap: 12 }}>
              {agents
                .slice()
                .reverse()
                .sort((a, b) => {
                  const ap = a.pinned ? 1 : 0;
                  const bp = b.pinned ? 1 : 0;
                  return bp - ap;
                })
                .map((task) => {
                  const Icon = iconForKind(task.kind);
                  const isRunning =
                    task.status === "running" || running === task.id;
                  const isDone = task.status === "done";
                  const isOpen = cardOpen[task.id] ?? false;
                  const statusLabel = isDone
                    ? "已完成"
                    : isRunning
                    ? "执行中"
                    : "待执行";
                  const statusColor = isDone
                    ? theme.mint
                    : isRunning
                    ? theme.amber
                    : theme.textDim;
                  return (
                    <GlassCard
                      key={task.id}
                      radius={20}
                      style={[
                        styles.task,
                        task.pinned && styles.taskPinned,
                      ]}
                    >
                      {task.pinned && (
                        <View style={styles.pinnedChip}>
                          <Pin size={10} color={theme.amber} />
                          <Text style={styles.pinnedChipText}>置顶</Text>
                        </View>
                      )}
                      <Pressable
                        onPress={() => {
                          setCardOpen((p) => ({ ...p, [task.id]: !isOpen }));
                          if (Platform.OS !== "web")
                            Haptics.selectionAsync().catch(() => {});
                        }}
                        style={({ pressed }) => [
                          styles.taskTop,
                          pressed && { opacity: 0.85 },
                        ]}
                      >
                        <View style={styles.taskIcon}>
                          <LinearGradient
                            colors={
                              isDone
                                ? [theme.mint, "#52BFA6"]
                                : [theme.amber, theme.peach]
                            }
                            style={StyleSheet.absoluteFill}
                          />
                          <Icon size={18} color={theme.bg} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <View style={styles.titleRow}>
                            <Text style={styles.taskTitle} numberOfLines={1}>
                              {task.title}
                            </Text>
                            <View
                              style={[
                                styles.statusChip,
                                { borderColor: statusColor + "55" },
                              ]}
                            >
                              <View
                                style={[
                                  styles.statusDot,
                                  { backgroundColor: statusColor },
                                ]}
                              />
                              <Text
                                style={[styles.statusText, { color: statusColor }]}
                              >
                                {statusLabel}
                              </Text>
                            </View>
                          </View>
                          <Text
                            style={styles.taskDesc}
                            numberOfLines={isOpen ? undefined : 1}
                          >
                            {task.description}
                          </Text>
                        </View>
                        <Pressable
                          onPress={() => {
                            togglePinAgent(task.id);
                            if (Platform.OS !== "web")
                              Haptics.selectionAsync().catch(() => {});
                          }}
                          hitSlop={8}
                          style={({ pressed }) => [
                            styles.pinBtn,
                            pressed && { opacity: 0.5 },
                          ]}
                        >
                          {task.pinned ? (
                            <PinOff size={14} color={theme.amber} />
                          ) : (
                            <Pin size={14} color={theme.textDim} />
                          )}
                        </Pressable>
                        {isOpen ? (
                          <ChevronUp size={14} color={theme.textDim} />
                        ) : (
                          <ChevronDown size={14} color={theme.textDim} />
                        )}
                      </Pressable>

                      {isOpen && isDone && task.result && (() => {
                        const isCollapsed = collapsed[task.id] ?? false;
                        return (
                          <View style={styles.result}>
                            <View style={styles.resultHead}>
                              <Pressable
                                onPress={() =>
                                  setCollapsed((p) => ({
                                    ...p,
                                    [task.id]: !isCollapsed,
                                  }))
                                }
                                hitSlop={6}
                                style={({ pressed }) => [
                                  styles.resultLabelBtn,
                                  pressed && { opacity: 0.6 },
                                ]}
                              >
                                {isCollapsed ? (
                                  <ChevronDown size={11} color={theme.mint} />
                                ) : (
                                  <ChevronUp size={11} color={theme.mint} />
                                )}
                                <Text style={styles.resultLabel}>
                                  {isCollapsed ? "展开" : "已完成 · 点击收起"}
                                </Text>
                              </Pressable>
                              <View style={{ flexDirection: "row", gap: 6 }}>
                                <Pressable
                                  onPress={() => onCopy(task.id, task.result || "")}
                                  hitSlop={6}
                                  style={({ pressed }) => [
                                    styles.copyBtn,
                                    pressed && { opacity: 0.5 },
                                  ]}
                                >
                                  {copiedId === task.id ? (
                                    <Check size={11} color={theme.amber} />
                                  ) : (
                                    <Copy size={11} color={theme.textDim} />
                                  )}
                                  <Text style={styles.copyBtnText}>
                                    {copiedId === task.id ? "已复制" : "复制"}
                                  </Text>
                                </Pressable>
                                <Pressable
                                  onPress={() => {
                                    if (Platform.OS !== "web")
                                      Haptics.impactAsync(
                                        Haptics.ImpactFeedbackStyle.Light
                                      ).catch(() => {});
                                    onAddToSchedule(task.id, task.result || "");
                                  }}
                                  disabled={addingToSched === task.id}
                                  hitSlop={6}
                                  style={({ pressed }) => [
                                    styles.copyBtn,
                                    styles.scheduleBtn,
                                    (pressed || addingToSched === task.id) && { opacity: 0.5 },
                                  ]}
                                >
                                  {addingToSched === task.id ? (
                                    <ActivityIndicator size="small" color={theme.amber} />
                                  ) : (
                                    <CalendarPlus size={11} color={theme.amber} />
                                  )}
                                  <Text style={styles.copyBtnText}>加入日程</Text>
                                </Pressable>
                                <Pressable
                                  onPress={() => {
                                    archiveAgent(task.id);
                                    if (Platform.OS !== "web")
                                      Haptics.impactAsync(
                                        Haptics.ImpactFeedbackStyle.Light
                                      ).catch(() => {});
                                  }}
                                  hitSlop={6}
                                  style={({ pressed }) => [
                                    styles.copyBtn,
                                    pressed && { opacity: 0.5 },
                                  ]}
                                >
                                  <Archive size={11} color={theme.textDim} />
                                  <Text style={styles.copyBtnText}>归档</Text>
                                </Pressable>
                              </View>
                            </View>
                            {schedToast && (
                              <Text style={styles.schedToast}>{schedToast}</Text>
                            )}
                            {!isCollapsed && (
                              <Markdown text={task.result} color={theme.text} selectable />
                            )}
                          </View>
                        );
                      })()}

                      {isOpen && isDone && task.result && (() => {
                        const msgs = agentChats[task.id] ?? [];
                        const open = chatOpen[task.id] ?? false;
                        const sendingThis =
                          chatAboutAgent.isPending &&
                          chatAboutAgent.variables?.agentId === task.id;
                        return (
                          <View style={styles.chatSection}>
                            <Pressable
                              onPress={() =>
                                setChatOpen((p) => ({ ...p, [task.id]: !open }))
                              }
                              hitSlop={6}
                              style={({ pressed }) => [
                                styles.chatToggle,
                                pressed && { opacity: 0.6 },
                              ]}
                            >
                              <MessageCircle size={13} color={theme.amber} />
                              <Text style={styles.chatToggleText}>
                                {open
                                  ? "收起跟进对话"
                                  : msgs.length > 0
                                  ? `继续跟 Aurora 聊（${msgs.length}）`
                                  : "跟 Aurora 继续聊这个任务"}
                              </Text>
                              {msgs.length > 0 && open && (
                                <Pressable
                                  onPress={() => clearAgentChat(task.id)}
                                  hitSlop={6}
                                  style={({ pressed }) => [
                                    styles.chatClear,
                                    pressed && { opacity: 0.5 },
                                  ]}
                                >
                                  <Trash2 size={11} color={theme.textDim} />
                                </Pressable>
                              )}
                            </Pressable>
                            {open && (
                              <View style={styles.chatBox}>
                                {msgs.map((m) => (
                                  <View
                                    key={m.id}
                                    style={[
                                      styles.chatBubble,
                                      m.role === "user"
                                        ? styles.chatBubbleUser
                                        : styles.chatBubbleAI,
                                    ]}
                                  >
                                    <Markdown
                                      text={m.text}
                                      color={
                                        m.role === "user"
                                          ? "#1B1300"
                                          : theme.text
                                      }
                                      selectable
                                    />
                                  </View>
                                ))}
                                {sendingThis && (
                                  <View
                                    style={[styles.chatBubble, styles.chatBubbleAI]}
                                  >
                                    <ActivityIndicator
                                      size="small"
                                      color={theme.amber}
                                    />
                                  </View>
                                )}
                                <View style={styles.chatComposer}>
                                  <TextInput
                                    value={chatDrafts[task.id] ?? ""}
                                    onChangeText={(t) =>
                                      setChatDrafts((p) => ({
                                        ...p,
                                        [task.id]: t,
                                      }))
                                    }
                                    placeholder="例如：重写成更正式的、拆解为步骤、只要重点…"
                                    placeholderTextColor={theme.textDim}
                                    style={styles.chatInput}
                                    multiline
                                    maxLength={500}
                                  />
                                  <Pressable
                                    onPress={() => onSendAgentMsg(task.id)}
                                    disabled={sendingThis}
                                    style={({ pressed }) => [
                                      styles.chatSend,
                                      (pressed || sendingThis) && {
                                        opacity: 0.6,
                                      },
                                    ]}
                                  >
                                    <Send size={14} color={theme.bg} />
                                  </Pressable>
                                </View>
                              </View>
                            )}
                          </View>
                        );
                      })()}

                      {isOpen && !isDone && (
                        <View style={styles.actionRow}>
                          <Pressable
                            onPress={() => onRun(task.id)}
                            disabled={isRunning}
                            style={({ pressed }) => [
                              styles.runBtn,
                              (pressed || isRunning) && { opacity: 0.8 },
                            ]}
                          >
                            <LinearGradient
                              colors={[theme.amber, theme.peach]}
                              start={{ x: 0, y: 0 }}
                              end={{ x: 1, y: 1 }}
                              style={StyleSheet.absoluteFill}
                            />
                            {isRunning ? (
                              <>
                                <ActivityIndicator size="small" color={theme.bg} />
                                <Text style={styles.runText}>执行中…</Text>
                              </>
                            ) : (
                              <>
                                <PlayCircle size={16} color={theme.bg} />
                                <Text style={styles.runText}>让 Aurora 来做</Text>
                              </>
                            )}
                          </Pressable>
                          <Pressable
                            onPress={() => {
                              markAgentDone(task.id);
                              if (Platform.OS !== "web")
                                Haptics.selectionAsync().catch(() => {});
                            }}
                            hitSlop={6}
                            style={({ pressed }) => [
                              styles.ghostBtn,
                              pressed && { opacity: 0.5 },
                            ]}
                          >
                            <CheckCircle2 size={14} color={theme.mint} />
                            <Text style={styles.ghostBtnText}>已完成</Text>
                          </Pressable>
                          <Pressable
                            onPress={() => {
                              archiveAgent(task.id);
                              if (Platform.OS !== "web")
                                Haptics.impactAsync(
                                  Haptics.ImpactFeedbackStyle.Light
                                ).catch(() => {});
                            }}
                            hitSlop={6}
                            style={({ pressed }) => [
                              styles.ghostBtnIcon,
                              pressed && { opacity: 0.5 },
                            ]}
                          >
                            <Archive size={14} color={theme.textDim} />
                          </Pressable>
                        </View>
                      )}
                    </GlassCard>
                  );
                })}
            </View>
          )}

          {archivedAgents.length > 0 && (
            <View style={styles.archiveSection}>
              <Pressable
                onPress={() => setShowArchived((v) => !v)}
                hitSlop={6}
                style={({ pressed }) => [
                  styles.archiveHead,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Archive size={13} color={theme.textMuted} />
                <Text style={styles.archiveHeadText}>
                  已归档 · {archivedAgents.length}
                </Text>
                <View style={{ flex: 1 }} />
                {showArchived ? (
                  <ChevronUp size={14} color={theme.textDim} />
                ) : (
                  <ChevronDown size={14} color={theme.textDim} />
                )}
              </Pressable>
              {showArchived && (
                <View style={{ gap: 10, marginTop: 8 }}>
                  {archivedAgents.map((entry) => {
                    const a = entry.agent;
                    const Icon = iconForKind(a.kind);
                    return (
                      <GlassCard
                        key={a.id}
                        radius={16}
                        style={styles.archiveCard}
                      >
                        <View style={styles.archiveRow}>
                          <View style={styles.archiveIcon}>
                            <Icon size={14} color={theme.textMuted} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text
                              style={styles.archiveTitle}
                              numberOfLines={1}
                            >
                              {a.title}
                            </Text>
                            <Text
                              style={styles.archiveDesc}
                              numberOfLines={2}
                            >
                              {a.description}
                            </Text>
                          </View>
                        </View>
                        <View style={styles.archiveActions}>
                          <Pressable
                            onPress={() => {
                              restoreArchivedAgent(a.id);
                              if (Platform.OS !== "web")
                                Haptics.selectionAsync().catch(() => {});
                            }}
                            hitSlop={6}
                            style={({ pressed }) => [
                              styles.archiveBtn,
                              pressed && { opacity: 0.6 },
                            ]}
                          >
                            <ArchiveRestore
                              size={12}
                              color={theme.amber}
                            />
                            <Text
                              style={[
                                styles.archiveBtnText,
                                { color: theme.amber },
                              ]}
                            >
                              恢复
                            </Text>
                          </Pressable>
                          <Pressable
                            onPress={() => {
                              deleteArchivedAgent(a.id);
                              if (Platform.OS !== "web")
                                Haptics.notificationAsync(
                                  Haptics.NotificationFeedbackType.Warning
                                ).catch(() => {});
                            }}
                            hitSlop={6}
                            style={({ pressed }) => [
                              styles.archiveBtn,
                              pressed && { opacity: 0.6 },
                            ]}
                          >
                            <Trash2 size={12} color={theme.danger} />
                            <Text
                              style={[
                                styles.archiveBtnText,
                                { color: theme.danger },
                              ]}
                            >
                              永久删除
                            </Text>
                          </Pressable>
                        </View>
                      </GlassCard>
                    );
                  })}
                </View>
              )}
            </View>
          )}

          <View style={{ height: 100 }} />
        </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  flex: { flex: 1 },
  scroll: { padding: 20, gap: 16 },
  header: { marginTop: 6, marginBottom: 4 },
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
  sub: {
    color: theme.textMuted,
    fontSize: 14,
    marginTop: 4,
    lineHeight: 20,
  },
  hint: { padding: 14, flexDirection: "row", gap: 12, alignItems: "flex-start" },
  hintIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  hintTitle: { color: theme.text, fontSize: 14, fontWeight: "700" },
  hintText: {
    color: theme.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  empty: { padding: 22, gap: 8, alignItems: "flex-start" },
  emptyTitle: { color: theme.text, fontSize: 18, fontWeight: "700" },
  emptyText: { color: theme.textMuted, fontSize: 13, lineHeight: 19 },
  task: { padding: 16, gap: 12 },
  taskPinned: {
    borderWidth: 1,
    borderColor: "rgba(244,184,96,0.45)",
  },
  pinnedChip: {
    position: "absolute",
    top: 10,
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: "rgba(244,184,96,0.18)",
  },
  pinnedChipText: {
    color: theme.amber,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  pinBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  taskTop: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  taskIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  taskTitle: { color: theme.text, fontSize: 15, fontWeight: "700", flexShrink: 1 },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statusChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  statusDot: {
    width: 5,
    height: 5,
    borderRadius: 999,
  },
  statusText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.4,
  },
  taskDesc: {
    color: theme.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 3,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  runBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 14,
    overflow: "hidden",
  },
  runText: { color: theme.bg, fontWeight: "700", fontSize: 14 },
  ghostBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: "rgba(123,211,183,0.10)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(123,211,183,0.3)",
  },
  ghostBtnText: { color: theme.mint, fontSize: 11, fontWeight: "700" },
  ghostBtnIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  result: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: "rgba(123,211,183,0.08)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(123,211,183,0.25)",
    gap: 6,
  },
  resultHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  resultLabel: {
    color: theme.mint,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.5,
  },
  resultLabelBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 4,
    paddingRight: 8,
  },
  resultText: { color: theme.text, fontSize: 13, lineHeight: 19 },
  copyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  copyBtnText: {
    color: theme.textDim,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  scheduleBtn: {
    backgroundColor: "rgba(244,184,96,0.12)",
  },
  schedToast: {
    color: theme.mint,
    fontSize: 11,
    fontWeight: "600",
    marginTop: 6,
    textAlign: "center",
  },
  chatSection: {
    gap: 8,
    marginTop: 2,
  },
  chatToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: "rgba(244,184,96,0.10)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(244,184,96,0.28)",
    alignSelf: "flex-start",
  },
  chatToggleText: {
    color: theme.amber,
    fontSize: 12,
    fontWeight: "700",
  },
  chatClear: {
    marginLeft: 4,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  chatBox: {
    gap: 8,
    padding: 10,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  chatBubble: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    maxWidth: "92%",
  },
  chatBubbleAI: {
    backgroundColor: "rgba(255,255,255,0.06)",
    alignSelf: "flex-start",
  },
  chatBubbleUser: {
    backgroundColor: "rgba(244,184,96,0.85)",
    alignSelf: "flex-end",
  },
  chatComposer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
    marginTop: 4,
  },
  chatInput: {
    flex: 1,
    color: theme.text,
    fontSize: 14,
    lineHeight: 19,
    paddingHorizontal: 12,
    paddingVertical: 9,
    maxHeight: 100,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  chatSend: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.amber,
  },
  archiveSection: {
    marginTop: 12,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.borderFaint,
  },
  archiveHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 6,
  },
  archiveHeadText: {
    color: theme.textMuted,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  archiveCard: {
    padding: 12,
    gap: 10,
    opacity: 0.85,
  },
  archiveRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
  },
  archiveIcon: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  archiveTitle: {
    color: theme.text,
    fontSize: 13,
    fontWeight: "600",
  },
  archiveDesc: {
    color: theme.textDim,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  archiveActions: {
    flexDirection: "row",
    gap: 8,
    justifyContent: "flex-end",
  },
  archiveBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  archiveBtnText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
});
