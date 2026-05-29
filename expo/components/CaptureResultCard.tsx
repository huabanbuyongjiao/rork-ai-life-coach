import { Sparkles } from "lucide-react-native";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import GlassCard from "@/components/GlassCard";
import { theme } from "@/constants/theme";

type CaptureCardData = {
  status: string;
  task: string;
  nextAction: string;
  duration: string;
  avoid: string;
  tip: string;
};

export function parseCaptureCard(text: string): CaptureCardData | null {
  const get = (label: string) => {
    const line = text
      .split(/\n+/)
      .find((item) => item.trim().startsWith(`${label}：`));
    return line?.split("：").slice(1).join("：").trim() ?? "";
  };
  const card = {
    status: get("状态"),
    task: get("任务"),
    nextAction: get("下一步"),
    duration: get("时间块"),
    avoid: get("先别做"),
    tip: get("提示"),
  };
  if (!card.status || !card.task || !card.nextAction) return null;
  return card;
}

export default function CaptureResultCard({ text }: { text: string }) {
  const data = parseCaptureCard(text);
  if (!data) return null;
  const normalized = data.status.toLowerCase();
  const statusColor = normalized.includes("low")
    ? theme.ai
    : normalized.includes("high")
      ? theme.rose
      : theme.amber;

  return (
    <GlassCard radius={26} variant="focus" style={styles.card}>
      <View style={styles.top}>
        <View style={[styles.statusBadge, { borderColor: statusColor }]}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.statusText, { color: statusColor }]}>
            {data.status}
          </Text>
        </View>
        <Text style={styles.duration}>{data.duration || "25分钟"}</Text>
      </View>

      <Text style={styles.label}>当前最重要任务</Text>
      <Text style={styles.task} numberOfLines={2}>
        {data.task}
      </Text>

      <View style={styles.divider} />

      <Text style={styles.label}>下一步</Text>
      <Text style={styles.action} numberOfLines={2}>
        {data.nextAction}
      </Text>

      {!!data.avoid && (
        <View style={styles.avoidBox}>
          <Text style={styles.avoidLabel}>先别做</Text>
          <Text style={styles.avoidText} numberOfLines={1}>
            {data.avoid}
          </Text>
        </View>
      )}

      {!!data.tip && (
        <View style={styles.tipRow}>
          <Sparkles size={14} color={theme.ai} />
          <Text style={styles.tipText} numberOfLines={2}>
            {data.tip} · 已同步到 Today
          </Text>
        </View>
      )}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 18,
    gap: 12,
    borderColor: theme.amberStroke,
    backgroundColor: "rgba(229,165,96,0.045)",
  },
  top: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  duration: {
    color: theme.amber,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  label: {
    color: theme.textDim,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.3,
  },
  task: {
    color: theme.text,
    fontSize: 26,
    lineHeight: 31,
    fontWeight: "800",
    letterSpacing: 0,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  action: {
    color: theme.text,
    fontSize: 17,
    lineHeight: 23,
    fontWeight: "700",
  },
  avoidBox: {
    borderRadius: 16,
    paddingHorizontal: 13,
    paddingVertical: 11,
    backgroundColor: "rgba(255,255,255,0.035)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  avoidLabel: {
    color: theme.textDim,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.1,
    marginBottom: 5,
  },
  avoidText: {
    color: theme.textMuted,
    fontSize: 13,
    fontWeight: "600",
  },
  tipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  tipText: {
    color: theme.textMuted,
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
  },
});
