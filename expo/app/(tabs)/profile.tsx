import { LinearGradient } from "expo-linear-gradient";
import {
  AlertTriangle,
  Check,
  CircleDot,
  Database,
  Gauge,
  Cpu,
  RefreshCw,
  ShieldCheck,
} from "lucide-react-native";
import React, { useMemo } from "react";
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import AuroraBackground from "@/components/AuroraBackground";
import GlassCard from "@/components/GlassCard";
import { radius, spacing, theme } from "@/constants/theme";
import { ACTIVE_AI_PROVIDER, COACH_MODEL } from "@/lib/ai";
import { useAurora } from "@/providers/AuroraProvider";

const RULES = ["Today 优先", "一句话 Capture", "一次只推进一件事"];

export default function ProfileScreen() {
  const {
    facts,
    schedule,
    todayFocus,
    resetLocalData,
    externalSyncConfigured,
    externalSyncStatus,
    syncExternalIntakes,
  } = useAurora();

  const todayCount = useMemo(() => {
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
      2,
      "0",
    )}-${String(d.getDate()).padStart(2, "0")}`;
    return schedule.filter((item) => (item.date ?? today) === today && !item.done)
      .length;
  }, [schedule]);

  const status = todayFocus?.status ?? "normal";
  const statusCopy =
    status === "low" ? "低能量" : status === "high" ? "高负载" : "可行动";
  const statusColor =
    status === "low" ? theme.ai : status === "high" ? theme.rose : theme.amber;

  const confirmReset = () => {
    const run = () => {
      void resetLocalData();
    };
    if (Platform.OS === "web") {
      run();
      return;
    }
    Alert.alert("重置本地数据", "清空 Capture、Today、Timeline、偏好和历史记录。API key 不会被删除。", [
      { text: "取消", style: "cancel" },
      { text: "重置", style: "destructive", onPress: run },
    ]);
  };

  return (
    <View style={styles.root}>
      <AuroraBackground intensity={0.72} />
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <Text style={styles.eyebrow}>PROFILE</Text>
            <Text style={styles.title}>Life OS 状态</Text>
          </View>

          <GlassCard radius={26} variant="focus" style={styles.statusCard}>
            <LinearGradient
              colors={[
                "rgba(134,181,226,0.12)",
                "rgba(229,165,96,0.08)",
                "rgba(255,255,255,0.02)",
              ]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.statusTop}>
              <View style={[styles.orb, { backgroundColor: statusColor }]}>
                <CircleDot color={theme.bg} size={24} strokeWidth={2.2} />
              </View>
              <View style={[styles.statusPill, { borderColor: statusColor }]}>
                <View style={[styles.dot, { backgroundColor: statusColor }]} />
                <Text style={[styles.statusPillText, { color: statusColor }]}>
                  {status.toUpperCase()}
                </Text>
              </View>
            </View>
            <Text style={styles.statusLabel}>{statusCopy}</Text>
            <Text style={styles.mainLine} numberOfLines={2}>
              {todayFocus?.task ?? "还没有主线"}
            </Text>
            <Text style={styles.subLine} numberOfLines={2}>
              {todayFocus?.nextAction ?? "去 Capture 说一句现在的状态。"}
            </Text>
          </GlassCard>

          <View style={styles.metrics}>
            <Metric
              icon={<Gauge color={theme.amber} size={18} strokeWidth={1.8} />}
              value={String(todayCount)}
              label="Today 待行动"
            />
            <Metric
              icon={<Database color={theme.ai} size={18} strokeWidth={1.8} />}
              value={String(facts.length)}
              label="可用偏好"
            />
          </View>

          <GlassCard radius={18} style={styles.providerCard}>
            <Cpu color={theme.ai} size={17} strokeWidth={1.8} />
            <View style={{ flex: 1 }}>
              <Text style={styles.providerTitle}>
                AI Provider: {ACTIVE_AI_PROVIDER}
              </Text>
              <Text style={styles.providerText} numberOfLines={1}>
                {COACH_MODEL}
              </Text>
            </View>
          </GlassCard>

          <GlassCard radius={18} style={styles.providerCard}>
            <RefreshCw color={theme.amber} size={17} strokeWidth={1.8} />
            <View style={{ flex: 1 }}>
              <Text style={styles.providerTitle}>
                External Sync: {externalSyncConfigured ? "on" : "off"}
              </Text>
              <Text style={styles.providerText} numberOfLines={1}>
                {externalSyncStatus}
              </Text>
            </View>
            <Pressable
              onPress={() => {
                void syncExternalIntakes();
              }}
              style={({ pressed }) => [
                styles.syncButton,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={styles.syncButtonText}>Sync</Text>
            </Pressable>
          </GlassCard>

          <GlassCard radius={22} style={styles.rulesCard}>
            <View style={styles.rulesHeader}>
              <ShieldCheck color={theme.mint} size={18} strokeWidth={1.8} />
              <Text style={styles.sectionTitle}>系统边界</Text>
            </View>
            {RULES.map((rule) => (
              <View key={rule} style={styles.ruleRow}>
                <Check color={theme.mint} size={16} strokeWidth={2} />
                <Text style={styles.ruleText}>{rule}</Text>
              </View>
            ))}
          </GlassCard>

          <Pressable
            onPress={confirmReset}
            style={({ pressed }) => [
              styles.resetButton,
              pressed && { opacity: 0.72 },
            ]}
          >
            <AlertTriangle color={theme.danger} size={17} strokeWidth={1.8} />
            <View style={{ flex: 1 }}>
              <Text style={styles.resetTitle}>重置本地 AIOS 数据</Text>
              <Text style={styles.resetText}>清空旧状态，不影响 OpenAI / Claude key。</Text>
            </View>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function Metric({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
}) {
  return (
    <View style={styles.metric}>
      <View style={styles.metricIcon}>{icon}</View>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  safe: { flex: 1 },
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: 120,
    gap: spacing.md,
  },
  header: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  eyebrow: {
    color: theme.textDim,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.4,
  },
  title: {
    color: theme.text,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "800",
    marginTop: 6,
  },
  statusCard: {
    minHeight: 282,
    padding: 22,
    justifyContent: "space-between",
    overflow: "hidden",
  },
  statusTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  orb: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.035)",
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  statusLabel: {
    color: theme.textMuted,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  mainLine: {
    color: theme.text,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "800",
  },
  subLine: {
    color: theme.textMuted,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "600",
  },
  metrics: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  metric: {
    flex: 1,
    minHeight: 128,
    borderRadius: radius.lg,
    padding: spacing.lg,
    backgroundColor: "rgba(255,255,255,0.035)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    justifyContent: "space-between",
  },
  metricIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.045)",
  },
  metricValue: {
    color: theme.text,
    fontSize: 28,
    lineHeight: 32,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  metricLabel: {
    color: theme.textMuted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
  },
  rulesCard: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  providerCard: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  providerTitle: {
    color: theme.text,
    fontSize: 13,
    fontWeight: "800",
  },
  providerText: {
    color: theme.textDim,
    fontSize: 12,
    fontWeight: "600",
    marginTop: 3,
  },
  syncButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: "rgba(229,165,96,0.08)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.amberStroke,
  },
  syncButtonText: {
    color: theme.amber,
    fontSize: 11,
    fontWeight: "800",
  },
  rulesHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  sectionTitle: {
    color: theme.text,
    fontSize: 16,
    fontWeight: "800",
  },
  ruleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 42,
    paddingHorizontal: spacing.sm,
  },
  ruleText: {
    color: theme.textMuted,
    fontSize: 14,
    fontWeight: "700",
  },
  resetButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 64,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: "rgba(216,106,106,0.08)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(216,106,106,0.28)",
  },
  resetTitle: {
    color: theme.text,
    fontSize: 14,
    fontWeight: "800",
  },
  resetText: {
    color: theme.textDim,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
    marginTop: 3,
  },
});
