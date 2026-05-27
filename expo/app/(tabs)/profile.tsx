import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import {
  Archive,
  Brain,
  ChevronRight,
  Sparkles,
  Target,
} from "lucide-react-native";
import React, { useMemo } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import AuroraBackground from "@/components/AuroraBackground";
import { radius, spacing, theme, typography } from "@/constants/theme";
import { useAurora } from "@/providers/AuroraProvider";

type Row = {
  key: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  count?: number;
  onPress: () => void;
};

export default function ProfileScreen() {
  const router = useRouter();
  const { goals, agents, archivedAgents } = useAurora();

  const activeGoals = useMemo(
    () => goals.filter((g) => g.status !== "completed").length,
    [goals],
  );
  const activeAgents = useMemo(
    () => agents.filter((a) => a.status !== "done").length,
    [agents],
  );

  const rows: Row[] = useMemo(
    () => [
      {
        key: "goals",
        icon: <Target color={theme.amber} size={18} strokeWidth={1.6} />,
        title: "目标",
        subtitle: "你正在追求的长期方向",
        count: activeGoals,
        onPress: () => router.push("/goals"),
      },
      {
        key: "agents",
        icon: <Sparkles color={theme.ai} size={18} strokeWidth={1.6} />,
        title: "智能体",
        subtitle: "在后台默默替你跑的小助手",
        count: activeAgents,
        onPress: () => router.push("/agents"),
      },
      {
        key: "archive",
        icon: <Archive color={theme.textMuted} size={18} strokeWidth={1.6} />,
        title: "归档",
        subtitle: "恢复或永久删除过去的智能体",
        count: archivedAgents.length,
        onPress: () => router.push("/agents?filter=archived"),
      },
      {
        key: "memory",
        icon: <Brain color={theme.lavender} size={18} strokeWidth={1.6} />,
        title: "记忆",
        subtitle: "系统对你的记忆",
        onPress: () => router.push("/memory"),
      },
    ],
    [activeGoals, activeAgents, archivedAgents.length, router],
  );

  return (
    <View style={styles.root}>
      <AuroraBackground />
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <Text style={styles.eyebrow}>个人</Text>
            <Text style={styles.title}>你</Text>
            <Text style={styles.subtitle}>
              目标、归档，以及 Aurora 对你的理解都在这里。
            </Text>
          </View>

          <View style={styles.list}>
            {rows.map((row) => (
              <Pressable
                key={row.key}
                onPress={row.onPress}
                style={({ pressed }) => [
                  styles.row,
                  pressed && styles.rowPressed,
                ]}
              >
                <LinearGradient
                  colors={["rgba(255,255,255,0.04)", "rgba(255,255,255,0.012)"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFill}
                />
                <View style={styles.iconWrap}>{row.icon}</View>
                <View style={styles.rowBody}>
                  <View style={styles.rowTitleLine}>
                    <Text style={styles.rowTitle}>{row.title}</Text>
                    {typeof row.count === "number" && row.count > 0 ? (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{row.count}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.rowSubtitle} numberOfLines={2}>
                    {row.subtitle}
                  </Text>
                </View>
                <ChevronRight
                  color={theme.textFaint}
                  size={18}
                  strokeWidth={1.6}
                />
              </Pressable>
            ))}
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Aurora · 你的私人 OS</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  safe: { flex: 1 },
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: 120,
  },
  header: {
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
  },
  eyebrow: {
    ...typography.caption,
    color: theme.textDim,
    marginBottom: spacing.xs,
  },
  title: {
    ...typography.display,
    color: theme.text,
  },
  subtitle: {
    ...typography.body,
    color: theme.textMuted,
    marginTop: spacing.sm,
    maxWidth: 320,
  },
  list: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    overflow: "hidden",
  },
  rowPressed: { opacity: 0.7 },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.borderFaint,
  },
  rowBody: { flex: 1 },
  rowTitleLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  rowTitle: {
    ...typography.headline,
    color: theme.text,
  },
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    minWidth: 20,
    alignItems: "center",
    borderRadius: radius.pill,
    backgroundColor: theme.surfaceStrong,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.borderFaint,
  },
  badgeText: {
    ...typography.caption,
    color: theme.textMuted,
  },
  rowSubtitle: {
    ...typography.footnote,
    color: theme.textDim,
    marginTop: 2,
  },
  footer: {
    marginTop: spacing.xxxl,
    alignItems: "center",
  },
  footerText: {
    ...typography.caption,
    color: theme.textFaint,
  },
});
