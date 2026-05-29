import { LinearGradient } from "expo-linear-gradient";
import { Check, Clock3, Plus, RefreshCw, Sparkles } from "lucide-react-native";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import AuroraBackground from "@/components/AuroraBackground";
import GlassCard from "@/components/GlassCard";
import { theme } from "@/constants/theme";

type Status = "low" | "normal" | "high";

export type TodayHudAction = {
  title: string;
  duration: 25 | 45;
  status: Status;
  nextAction: string;
  avoid: string[];
  tip: string;
};

export type TodayTimelineItem = {
  id: string;
  time: string;
  title: string;
  status: "pending" | "done" | "skipped" | "delayed";
  minimumAction?: string;
};

type Props = {
  dateLabel: string;
  action: TodayHudAction;
  timeline: TodayTimelineItem[];
  onComplete: () => void;
  onPostpone: () => void;
  onReplan: () => void;
  onCapture: () => void;
};

const STATUS_COPY: Record<
  Status,
  { label: string; text: string; hint: string; color: string }
> = {
  low: {
    label: "LOW",
    text: "低能量",
    hint: "降低摩擦，只做最小动作。",
    color: theme.ai,
  },
  normal: {
    label: "NORMAL",
    text: "可行动",
    hint: "不用想太多，直接进入一段时间块。",
    color: theme.amber,
  },
  high: {
    label: "HIGH",
    text: "任务偏多",
    hint: "只保留一个主线，其他先放下。",
    color: theme.rose,
  },
};

export default function TodayHud({
  dateLabel,
  action,
  timeline,
  onComplete,
  onPostpone,
  onReplan,
  onCapture,
}: Props) {
  const status = STATUS_COPY[action.status];
  const avoid =
    action.avoid.length > 0
      ? action.avoid.join(" · ")
      : "开新功能 · 整理复杂列表";

  return (
    <View style={styles.root}>
      <AuroraBackground />
      <SafeAreaView style={styles.flex} edges={["top"]}>
        <ScrollView
          contentContainerStyle={styles.shell}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.topBar}>
            <View>
              <Text style={styles.date}>{dateLabel.toUpperCase()}</Text>
              <Text style={styles.title}>Today</Text>
            </View>
            <View style={[styles.statusPill, { borderColor: status.color }]}>
              <View style={[styles.statusDot, { backgroundColor: status.color }]} />
              <Text style={[styles.statusText, { color: status.color }]}>
                {status.label}
              </Text>
            </View>
          </View>

          <GlassCard radius={28} variant="focus" alive style={styles.focusCard}>
            <LinearGradient
              colors={[
                "rgba(229,165,96,0.20)",
                "rgba(134,181,226,0.06)",
                "rgba(255,255,255,0.02)",
              ]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.stateRow}>
              <Text style={styles.stateLabel}>{status.text}</Text>
              <Text style={styles.duration}>{action.duration} MIN</Text>
            </View>
            <Text style={styles.nowLabel}>NOW CARD</Text>
            <Text style={styles.mainTask} numberOfLines={3}>
              {action.title}
            </Text>
            <View style={styles.divider} />
            <Text style={styles.nextLabel}>下一步</Text>
            <Text style={styles.nextAction} numberOfLines={2}>
              {action.nextAction}
            </Text>
          </GlassCard>

          <View style={styles.timelineSection}>
            <View style={styles.timelineHeader}>
              <Text style={styles.timelineTitle}>Today Timeline</Text>
              <Pressable
                onPress={onReplan}
                style={({ pressed }) => [
                  styles.replanButton,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <RefreshCw size={13} color={theme.amber} strokeWidth={1.9} />
                <Text style={styles.replanText}>Replan</Text>
              </Pressable>
            </View>
            <View style={styles.timelineList}>
              {timeline.length === 0 ? (
                <Text style={styles.timelineEmpty}>
                  Capture 一句话后生成今天剩余时间块。
                </Text>
              ) : (
                timeline.slice(0, 4).map((item) => (
                  <View key={item.id} style={styles.timelineItem}>
                    <View style={styles.timelineTime}>
                      <Clock3 size={13} color={theme.textDim} />
                      <Text style={styles.timelineTimeText}>{item.time || "今天"}</Text>
                    </View>
                    <View style={styles.timelineBody}>
                      <Text
                        style={[
                          styles.timelineItemTitle,
                          item.status === "done" && styles.timelineDone,
                        ]}
                        numberOfLines={1}
                      >
                        {item.title}
                      </Text>
                      <Text style={styles.timelineMinimum} numberOfLines={1}>
                        {item.minimumAction || "最小动作：开始第一步"}
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </View>
          </View>

          <View style={styles.actions}>
            <Pressable
              onPress={onComplete}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && { opacity: 0.78 },
              ]}
            >
              <Check size={18} color={theme.bg} />
              <Text style={styles.primaryButtonText}>完成</Text>
            </Pressable>
            <Pressable
              onPress={onPostpone}
              style={({ pressed }) => [
                styles.secondaryButton,
                pressed && { opacity: 0.72 },
              ]}
            >
              <Text style={styles.secondaryButtonText}>稍后</Text>
            </Pressable>
          </View>

          <View style={styles.avoidCard}>
            <Text style={styles.miniLabel}>先别做</Text>
            <Text style={styles.avoidText}>{avoid}</Text>
          </View>

          <GlassCard radius={20} variant="ai" style={styles.aiCard}>
            <Sparkles size={15} color={theme.ai} />
            <Text style={styles.aiText} numberOfLines={2}>
              {action.tip || status.hint}
            </Text>
          </GlassCard>

          <Pressable
            onPress={onCapture}
            style={({ pressed }) => [
              styles.captureButton,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Plus size={16} color={theme.text} />
            <Text style={styles.captureText}>Capture 一句话</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  flex: { flex: 1 },
  shell: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 112,
    gap: 16,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  date: {
    color: theme.textDim,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.6,
  },
  title: {
    color: theme.text,
    fontSize: 34,
    lineHeight: 40,
    fontWeight: "700",
    marginTop: 4,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.035)",
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  focusCard: {
    minHeight: 286,
    padding: 22,
    justifyContent: "space-between",
  },
  stateRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  stateLabel: {
    color: theme.textMuted,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.4,
  },
  duration: {
    color: theme.amber,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.1,
  },
  nowLabel: {
    color: theme.textDim,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.4,
    marginTop: 24,
  },
  mainTask: {
    color: theme.text,
    fontSize: 34,
    lineHeight: 39,
    fontWeight: "800",
    letterSpacing: 0,
    marginTop: 10,
    marginBottom: 22,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.12)",
    marginBottom: 18,
  },
  nextLabel: {
    color: theme.amber,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.4,
    marginBottom: 8,
  },
  nextAction: {
    color: theme.textMuted,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "600",
  },
  timelineSection: {
    gap: 10,
  },
  timelineHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  timelineTitle: {
    color: theme.text,
    fontSize: 15,
    fontWeight: "800",
  },
  replanButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(229,165,96,0.08)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.amberStroke,
  },
  replanText: {
    color: theme.amber,
    fontSize: 11,
    fontWeight: "800",
  },
  timelineList: {
    borderRadius: 20,
    padding: 12,
    backgroundColor: "rgba(255,255,255,0.035)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    gap: 10,
  },
  timelineEmpty: {
    color: theme.textMuted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    paddingVertical: 4,
  },
  timelineItem: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    minHeight: 44,
  },
  timelineTime: {
    width: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  timelineTimeText: {
    color: theme.textDim,
    fontSize: 11,
    fontWeight: "700",
  },
  timelineBody: {
    flex: 1,
    minWidth: 0,
  },
  timelineItemTitle: {
    color: theme.text,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "800",
  },
  timelineMinimum: {
    color: theme.textDim,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
    marginTop: 2,
  },
  timelineDone: {
    color: theme.textDim,
    textDecorationLine: "line-through",
  },
  actions: {
    flexDirection: "row",
    gap: 12,
  },
  primaryButton: {
    flex: 1.25,
    height: 58,
    borderRadius: 18,
    backgroundColor: theme.amber,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryButtonText: {
    color: theme.bg,
    fontSize: 16,
    fontWeight: "800",
  },
  secondaryButton: {
    flex: 1,
    height: 58,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.borderStrong,
    backgroundColor: "rgba(255,255,255,0.045)",
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    color: theme.text,
    fontSize: 16,
    fontWeight: "700",
  },
  avoidCard: {
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: "rgba(255,255,255,0.035)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  miniLabel: {
    color: theme.textDim,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  avoidText: {
    color: theme.textMuted,
    fontSize: 14,
    fontWeight: "600",
  },
  aiCard: {
    paddingHorizontal: 16,
    paddingVertical: 15,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  aiText: {
    color: theme.textMuted,
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
  },
  captureButton: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  captureText: {
    color: theme.text,
    fontSize: 13,
    fontWeight: "700",
  },
});
