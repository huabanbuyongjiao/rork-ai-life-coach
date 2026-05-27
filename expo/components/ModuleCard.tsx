import {
  Activity,
  BookOpen,
  Brain,
  Briefcase,
  Coffee,
  Dumbbell,
  Flame,
  Heart,
  Leaf,
  Moon,
  Palette,
  PiggyBank,
  Users,
} from "lucide-react-native";
import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import GlassCard from "@/components/GlassCard";
import { theme } from "@/constants/theme";
import type { LifeModule, ModuleColor } from "@/types/aurora";

const ACCENT: Record<ModuleColor, string> = {
  amber: theme.amber,
  lavender: theme.lavender,
  mint: theme.mint,
  sky: theme.ai,
  rose: theme.rose,
  peach: theme.peach,
};

function iconForModule(id: string): React.ComponentType<{
  size?: number;
  color?: string;
  strokeWidth?: number;
}> {
  const key = id.toLowerCase();
  if (key.includes("study") || key.includes("学习") || key.includes("课"))
    return BookOpen;
  if (key.includes("work") || key.includes("工作")) return Briefcase;
  if (key.includes("sleep") || key.includes("睡")) return Moon;
  if (key.includes("fit") || key.includes("健身") || key.includes("运动"))
    return Dumbbell;
  if (key.includes("health") || key.includes("健康")) return Heart;
  if (key.includes("focus") || key.includes("专注")) return Flame;
  if (key.includes("mind") || key.includes("冥想") || key.includes("正念"))
    return Leaf;
  if (key.includes("social") || key.includes("社交")) return Users;
  if (key.includes("creative") || key.includes("创")) return Palette;
  if (key.includes("finance") || key.includes("财") || key.includes("钱"))
    return PiggyBank;
  if (key.includes("coffee") || key.includes("break")) return Coffee;
  if (key.includes("brain") || key.includes("思考")) return Brain;
  return Activity;
}

type Props = {
  module: LifeModule;
};

function ModuleCardImpl({ module }: Props) {
  const accent = ACCENT[module.color] ?? ACCENT.amber;
  const Icon = useMemo(() => iconForModule(module.id), [module.id]);
  const progressPct = Math.max(0, Math.min(1, module.progress ?? 0));
  const hasProgress = progressPct > 0;

  return (
    <GlassCard radius={16} style={styles.card}>
      <View style={styles.row}>
        <View style={styles.iconWrap}>
          <Icon size={15} color={accent} strokeWidth={1.6} />
        </View>
        <View style={styles.textCol}>
          <Text style={styles.title} numberOfLines={1}>
            {module.title}
          </Text>
          <Text style={styles.summary} numberOfLines={2}>
            {module.summary}
          </Text>
        </View>
        {hasProgress && (
          <Text style={[styles.pct, { color: accent }]}>
            {Math.round(progressPct * 100)}
          </Text>
        )}
      </View>
      {hasProgress && (
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${progressPct * 100}%`, backgroundColor: accent },
            ]}
          />
        </View>
      )}
    </GlassCard>
  );
}

export default React.memo(ModuleCardImpl);

const styles = StyleSheet.create({
  card: { paddingVertical: 14, paddingHorizontal: 16, gap: 12 },
  row: { flexDirection: "row", gap: 12, alignItems: "center" },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.06)",
  },
  textCol: { flex: 1, gap: 3 },
  title: {
    color: theme.text,
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: -0.1,
  },
  summary: {
    color: theme.textMuted,
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: "400",
  },
  pct: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.4,
    fontVariant: ["tabular-nums"],
  },
  progressTrack: {
    height: 1.5,
    borderRadius: 1,
    backgroundColor: "rgba(255,255,255,0.04)",
    overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: 1, opacity: 0.7 },
});
