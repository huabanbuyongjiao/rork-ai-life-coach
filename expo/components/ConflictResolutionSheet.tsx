import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  Clock,
  GitMerge,
  Plus,
  X,
} from "lucide-react-native";
import React, { memo, useCallback, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { theme } from "@/constants/theme";
import type { ConflictLog } from "@/lib/db/types";
import { ConflictResolver } from "@/lib/orchestrator/conflict-resolver";

// ── Props ─────────────────────────────────────────────────────────────────

export type ConflictResolutionSheetProps = {
  /** The conflict to present for resolution. */
  conflict: ConflictLog;
  /** Called after the user resolves or dismisses. */
  onResolved: (message: string) => void;
  /** Called when the sheet is dismissed without resolution. */
  onDismiss: () => void;
};

// ── Human-readable labels ─────────────────────────────────────────────────

const KIND_LABELS: Record<string, string> = {
  task_task: "Similar Task Exists",
  task_event: "Task & Event Conflict",
  goal_goal: "Similar Goal Exists",
  agent_agent: "Similar Agent Exists",
  memory_memory: "Conflicting Memory",
  time_overlap: "Time Overlap",
};

const KIND_ICONS: Record<string, React.ReactNode> = {
  task_task: <AlertTriangle size={18} color={theme.amber} strokeWidth={1.5} />,
  task_event: <Clock size={18} color={theme.amber} strokeWidth={1.5} />,
  goal_goal: <AlertTriangle size={18} color={theme.amber} strokeWidth={1.5} />,
  agent_agent: <AlertTriangle size={18} color={theme.ai} strokeWidth={1.5} />,
  memory_memory: <AlertTriangle size={18} color={theme.rose} strokeWidth={1.5} />,
  time_overlap: <Clock size={18} color={theme.amber} strokeWidth={1.5} />,
};

// ── Severity bar ──────────────────────────────────────────────────────────

function SeverityBar({ severity }: { severity: number }) {
  const pct = Math.round(severity * 100);
  const color =
    severity >= 0.7 ? theme.rose : severity >= 0.4 ? theme.amber : theme.sky;
  return (
    <View style={styles.severityRow}>
      <View style={styles.severityTrack}>
        <View
          style={[
            styles.severityFill,
            { width: `${pct}%` as unknown as number, backgroundColor: color },
          ]}
        />
      </View>
      <Text style={styles.severityLabel}>{pct}%</Text>
    </View>
  );
}

// ── Option button ─────────────────────────────────────────────────────────

const OptionButton = memo(function OptionButton({
  label,
  onPress,
  icon,
  loading,
}: {
  label: string;
  onPress: () => void;
  icon: React.ReactNode;
  loading: boolean;
}) {
  return (
    <TouchableOpacity
      style={styles.optionBtn}
      onPress={onPress}
      disabled={loading}
      activeOpacity={0.6}
    >
      <View style={styles.optionIconSlot}>{icon}</View>
      <Text style={styles.optionLabel}>{label}</Text>
      {loading ? (
        <ActivityIndicator size="small" color={theme.textMuted} />
      ) : (
        <ArrowRight size={16} color={theme.textDim} strokeWidth={1.5} />
      )}
    </TouchableOpacity>
  );
});

// ── Option icon resolver ──────────────────────────────────────────────────

function optionIcon(optionId: string): React.ReactNode {
  if (optionId.startsWith("merge"))
    return <GitMerge size={16} color={theme.ai} strokeWidth={1.5} />;
  if (optionId.includes("create") || optionId.includes("keep_new"))
    return <Plus size={16} color={theme.sky} strokeWidth={1.5} />;
  if (optionId.includes("keep") || optionId.includes("existing"))
    return <Check size={16} color={theme.mint} strokeWidth={1.5} />;
  if (optionId === "cancel")
    return <X size={16} color={theme.textDim} strokeWidth={1.5} />;
  return <ArrowRight size={16} color={theme.textDim} strokeWidth={1.5} />;
}

// ── Component ─────────────────────────────────────────────────────────────

function ConflictResolutionSheetImpl({
  conflict,
  onResolved,
  onDismiss,
}: ConflictResolutionSheetProps) {
  const { height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [resolving, setResolving] = useState<string | null>(null);
  const slideAnim = React.useRef(new Animated.Value(screenHeight)).current;

  React.useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: 0,
      damping: 24,
      stiffness: 200,
      useNativeDriver: true,
    }).start();
  }, [slideAnim]);

  const handleResolve = useCallback(
    async (optionId: string) => {
      setResolving(optionId);
      try {
        if (Platform.OS !== "web") {
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        const outcome = await ConflictResolver.resolve(conflict.id, optionId);
        if (Platform.OS !== "web") {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        onResolved(outcome.message);
      } catch {
        if (Platform.OS !== "web") {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        }
      } finally {
        setResolving(null);
      }
    },
    [conflict.id, onResolved],
  );

  const handleDismiss = useCallback(() => {
    try {
      ConflictResolver.dismiss(conflict.id);
    } catch {
      // best-effort
    }
    onDismiss();
  }, [conflict.id, onDismiss]);

  const kindLabel = KIND_LABELS[conflict.kind] ?? conflict.kind;
  const kindIcon = KIND_ICONS[conflict.kind] ?? null;

  const sheetHeight = Math.min(
    420 + conflict.options.length * 56,
    screenHeight * 0.7,
  );

  return (
    <Modal
      visible
      transparent
      animationType="none"
      onRequestClose={handleDismiss}
      statusBarTranslucent
    >
      {/* Backdrop */}
      <Pressable style={styles.backdrop} onPress={handleDismiss}>
        <View style={StyleSheet.absoluteFill} />
      </Pressable>

      {/* Sheet */}
      <Animated.View
        style={[
          styles.sheet,
          {
            height: sheetHeight,
            paddingBottom: insets.bottom + 16,
            transform: [{ translateY: slideAnim }],
          },
        ]}
      >
        {/* Handle */}
        <View style={styles.handleRow}>
          <View style={styles.handle} />
        </View>

        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerIconRow}>
            {kindIcon}
            <Text style={styles.headerLabel}>{kindLabel}</Text>
          </View>
          <TouchableOpacity
            onPress={handleDismiss}
            hitSlop={12}
            style={styles.dismissBtn}
          >
            <X size={18} color={theme.textMuted} strokeWidth={1.5} />
          </TouchableOpacity>
        </View>

        {/* Severity */}
        <SeverityBar severity={conflict.severity} />

        {/* Subject count badge */}
        <View style={styles.badgeRow}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              {conflict.subject_ids.length} affected{" "}
              {conflict.subject_ids.length === 1 ? "item" : "items"}
            </Text>
          </View>
        </View>

        {/* Divider */}
        <View style={styles.divider} />

        {/* Prompt */}
        <Text style={styles.prompt}>How would you like to resolve this?</Text>

        {/* Options */}
        <View style={styles.optionsList}>
          {conflict.options.map((opt: { id: string; label: string }) => (
            <OptionButton
              key={opt.id}
              label={opt.label}
              icon={optionIcon(opt.id)}
              loading={resolving === opt.id}
              onPress={() => handleResolve(opt.id)}
            />
          ))}
          {/* Dismiss option */}
          <OptionButton
            label="Dismiss"
            icon={<X size={16} color={theme.textDim} strokeWidth={1.5} />}
            loading={resolving === "dismiss"}
            onPress={handleDismiss}
          />
        </View>
      </Animated.View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor:
      Platform.OS === "android" ? "rgba(14,15,19,0.98)" : "transparent",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.borderStrong,
    overflow: "hidden",
    paddingHorizontal: 20,
  },
  handleRow: {
    alignItems: "center",
    paddingVertical: 12,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.textFaint,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  headerIconRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  headerLabel: {
    color: theme.text,
    fontSize: 17,
    fontWeight: "600",
    letterSpacing: -0.2,
  },
  dismissBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.surfaceStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  severityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },
  severityTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.borderFaint,
    overflow: "hidden",
  },
  severityFill: {
    height: "100%",
    borderRadius: 2,
  },
  severityLabel: {
    color: theme.textMuted,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.4,
    minWidth: 32,
    textAlign: "right",
  },
  badgeRow: {
    flexDirection: "row",
    marginBottom: 14,
  },
  badge: {
    backgroundColor: theme.surfaceStrong,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  badgeText: {
    color: theme.textMuted,
    fontSize: 11,
    fontWeight: "500",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.border,
    marginBottom: 14,
  },
  prompt: {
    color: theme.textMuted,
    fontSize: 13,
    fontWeight: "500",
    marginBottom: 12,
  },
  optionsList: {
    gap: 8,
  },
  optionBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: theme.surfaceStrong,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  optionIconSlot: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: theme.surfaceSoft,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  optionLabel: {
    flex: 1,
    color: theme.text,
    fontSize: 14,
    fontWeight: "500",
  },
});

export default React.memo(ConflictResolutionSheetImpl);
