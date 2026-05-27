import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import {
  AlertCircle,
  Brain,
  ChevronDown,
  ChevronRight,
  GitBranch,
  GitFork,
  Hexagon,
  Network,
  Search,
  Sparkles,
  Trash2,
  Users,
  Wand2,
  Zap,
} from "lucide-react-native";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Animated,
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
import { theme, typography } from "@/constants/theme";
import { useLiveMemory } from "@/lib/db/realtime";
import { Memory } from "@/lib/db/repo";
import { MemoryGraph, type NeighborHit } from "@/lib/orchestrator/memory-graph";
import type { MemoryType, MemoryNode } from "@/lib/db/types";

const TYPE_CONFIG: Record<MemoryType, { icon: typeof Brain; label: string; color: string; bgColor: string }> = {
  fact: { icon: Hexagon, label: "事实", color: theme.ai, bgColor: "rgba(134,181,226,0.10)" },
  behavior: { icon: Zap, label: "行为", color: theme.amber, bgColor: "rgba(229,165,96,0.10)" },
  relation: { icon: Users, label: "关系", color: theme.lavender, bgColor: "rgba(159,138,217,0.10)" },
  insight: { icon: Brain, label: "洞察", color: theme.mint, bgColor: "rgba(131,198,168,0.10)" },
};

function formatTimeAgo(iso: string | null): string {
  if (!iso) return "从未";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} 小时前`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} 天前`;
  const months = Math.floor(days / 30);
  return `${months} 个月前`;
}

function confidenceColor(c: number): string {
  if (c >= 0.8) return theme.mint;
  if (c >= 0.5) return theme.amber;
  return theme.textDim;
}

function confidenceLabel(c: number): string {
  if (c >= 0.8) return "可信";
  if (c >= 0.5) return "待验证";
  return "低置信";
}

type FilterType = MemoryType | "all";

export default function MemoryScreen() {
  const { data: nodes, loading, error } = useLiveMemory();
  const [filter, setFilter] = useState<FilterType>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [neighbors, setNeighbors] = useState<NeighborHit[]>([]);
  const [neighborsLoading, setNeighborsLoading] = useState<boolean>(false);
  const [neighborError, setNeighborError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searching, setSearching] = useState<boolean>(false);
  const [searchResults, setSearchResults] = useState<typeof nodes>([]);
  const [showSearch, setShowSearch] = useState<boolean>(false);
  const [deriving, setDeriving] = useState<boolean>(false);
  const [decaying, setDecaying] = useState<boolean>(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const filteredNodes = (searchResults.length > 0 && showSearch ? searchResults : nodes)
    .filter((n) => filter === "all" || n.type === filter)
    .sort((a, b) => b.confidence - a.confidence);

  const onToggleExpand = useCallback(
    async (id: string) => {
      if (expandedId === id) {
        setExpandedId(null);
        setNeighbors([]);
        return;
      }
      setExpandedId(id);
      setNeighborsLoading(true);
      setNeighborError(null);
      try {
        const hits = await MemoryGraph.neighbors(id, 2, 16);
        setNeighbors(hits);
      } catch (e) {
        setNeighborError(e instanceof Error ? e.message : "加载失败");
      } finally {
        setNeighborsLoading(false);
      }
    },
    [expandedId]
  );

  const onSearch = useCallback(async () => {
    const q = searchQuery.trim();
    if (!q) {
      setShowSearch(false);
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const hits = await MemoryGraph.search(q, filter === "all" ? undefined : filter, 12, 0.6);
      const nodeMap = new Map(nodes.map((n) => [n.id, n]));
      const results = hits
        .map((h) => nodeMap.get(h.id))
        .filter((n): n is MemoryNode => !!n);
      setSearchResults(results);
      setShowSearch(true);
      if (Platform.OS !== "web") Haptics.selectionAsync().catch(() => {});
    } catch (e) {
      showToast(e instanceof Error ? e.message : "搜索失败");
    } finally {
      setSearching(false);
    }
  }, [searchQuery, filter, nodes, showToast]);

  const onDerive = useCallback(async () => {
    setDeriving(true);
    try {
      const created = await MemoryGraph.deriveInsights();
      showToast(created.length > 0 ? `生成了 ${created.length} 条新洞察` : "未发现新洞察模式");
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e) {
      showToast(e instanceof Error ? e.message : "洞察生成失败");
    } finally {
      setDeriving(false);
    }
  }, [showToast]);

  const onDecay = useCallback(async () => {
    setDecaying(true);
    try {
      const affected = await MemoryGraph.decay();
      showToast(`衰减了 ${affected} 条记忆`);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    } catch (e) {
      showToast(e instanceof Error ? e.message : "衰减失败");
    } finally {
      setDecaying(false);
    }
  }, [showToast]);

  const onDelete = useCallback(
    async (id: string) => {
      try {
        await Memory.update(id, { confidence: 0 });
        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      } catch (e) {
        showToast(e instanceof Error ? e.message : "删除失败");
      }
    },
    [showToast]
  );

  const typeCounts = {
    all: nodes.length,
    fact: nodes.filter((n) => n.type === "fact").length,
    behavior: nodes.filter((n) => n.type === "behavior").length,
    relation: nodes.filter((n) => n.type === "relation").length,
    insight: nodes.filter((n) => n.type === "insight").length,
  };

  if (loading) {
    return (
      <View style={styles.root}>
        <AuroraBackground />
        <SafeAreaView style={styles.center} edges={["top"]}>
          <ActivityIndicator size="large" color={theme.amber} />
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <AuroraBackground />
      <SafeAreaView style={styles.flex} edges={["top"]}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.kicker}>个人 / 记忆</Text>
            <Text style={styles.title}>记忆图谱</Text>
            <Text style={styles.sub}>
              Aurora 对你的长期理解 · 动态衰减 · 自动推导
            </Text>
          </View>

          {/* Error */}
          {error && (
            <GlassCard radius={16} style={styles.errorCard}>
              <AlertCircle size={16} color={theme.danger} />
              <Text style={styles.errorText}>{error.message}</Text>
            </GlassCard>
          )}

          {/* Search bar */}
          <View style={styles.searchRow}>
            <View style={styles.searchInputWrap}>
              <Search size={14} color={theme.textDim} />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                onSubmitEditing={onSearch}
                placeholder="语义搜索记忆…"
                placeholderTextColor={theme.textDim}
                style={styles.searchInput}
                returnKeyType="search"
              />
              {searchQuery.length > 0 && (
                <Pressable
                  onPress={() => {
                    setSearchQuery("");
                    setShowSearch(false);
                    setSearchResults([]);
                  }}
                  hitSlop={6}
                >
                  <Text style={styles.searchClear}>清除</Text>
                </Pressable>
              )}
            </View>
            <Pressable
              onPress={onSearch}
              disabled={searching}
              style={({ pressed }) => [
                styles.searchBtn,
                (pressed || searching) && { opacity: 0.7 },
              ]}
            >
              {searching ? (
                <ActivityIndicator size="small" color={theme.bg} />
              ) : (
                <Sparkles size={14} color={theme.bg} />
              )}
            </Pressable>
          </View>

          {/* Type counts */}
          <View style={styles.countsRow}>
            {(["all", "fact", "behavior", "relation", "insight"] as const).map((t) => {
              const cfg = t === "all" ? { icon: Network, label: "全部", color: theme.text, bgColor: "rgba(255,255,255,0.05)" } : TYPE_CONFIG[t];
              const active = filter === t;
              const Icon = cfg.icon;
              return (
                <Pressable
                  key={t}
                  onPress={() => {
                    setFilter(t);
                    setShowSearch(false);
                    setSearchResults([]);
                    if (Platform.OS !== "web") Haptics.selectionAsync().catch(() => {});
                  }}
                  style={({ pressed }) => [
                    styles.countChip,
                    active && { backgroundColor: cfg.bgColor, borderColor: cfg.color + "40" },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Icon size={12} color={active ? cfg.color : theme.textDim} />
                  <Text style={[styles.countNum, active && { color: cfg.color }]}>
                    {typeCounts[t]}
                  </Text>
                  <Text style={[styles.countLabel, active && { color: cfg.color }]}>
                    {cfg.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* System actions */}
          <View style={styles.actionsRow}>
            <Pressable
              onPress={onDerive}
              disabled={deriving}
              style={({ pressed }) => [
                styles.actionChip,
                (pressed || deriving) && { opacity: 0.7 },
              ]}
            >
              {deriving ? (
                <ActivityIndicator size="small" color={theme.mint} />
              ) : (
                <Brain size={13} color={theme.mint} />
              )}
              <Text style={styles.actionText}>推导洞察</Text>
            </Pressable>
            <Pressable
              onPress={onDecay}
              disabled={decaying}
              style={({ pressed }) => [
                styles.actionChip,
                (pressed || decaying) && { opacity: 0.7 },
              ]}
            >
              {decaying ? (
                <ActivityIndicator size="small" color={theme.amber} />
              ) : (
                <GitFork size={13} color={theme.amber} />
              )}
              <Text style={styles.actionText}>运行衰减</Text>
            </Pressable>
          </View>

          {toast && <Text style={styles.toast}>{toast}</Text>}

          {/* Empty state */}
          {filteredNodes.length === 0 && (
            <GlassCard radius={22} style={styles.empty}>
              <Network size={24} color={theme.amber} />
              <Text style={styles.emptyTitle}>
                {showSearch ? "未找到匹配记忆" : "还没有记忆节点"}
              </Text>
              <Text style={styles.emptyText}>
                {showSearch
                  ? "换个关键词试试"
                  : "和 Aurora 聊天时，系统会自动提取关于你的长期信息"}
              </Text>
            </GlassCard>
          )}

          {/* Node list */}
          <View style={{ gap: 8 }}>
            {filteredNodes.map((node) => {
              const cfg = TYPE_CONFIG[node.type];
              const Icon = cfg.icon;
              const isExpanded = expandedId === node.id;
              const c = node.confidence;

              return (
                <Pressable
                  key={node.id}
                  onPress={() => onToggleExpand(node.id)}
                  style={({ pressed }) => [pressed && { opacity: 0.95 }]}
                >
                  <GlassCard
                    radius={16}
                    style={[
                      styles.nodeCard,
                      isExpanded && styles.nodeCardExpanded,
                    ]}
                  >
                    {/* Node header */}
                    <View style={styles.nodeHeader}>
                      <View style={[styles.nodeIcon, { backgroundColor: cfg.bgColor }]}>
                        <Icon size={15} color={cfg.color} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <View style={[styles.typeBadge, { backgroundColor: cfg.bgColor, borderColor: cfg.color + "30" }]}>
                            <Text style={[styles.typeBadgeText, { color: cfg.color }]}>
                              {cfg.label}
                            </Text>
                          </View>
                          <Text style={styles.confLabel} numberOfLines={1}>
                            {formatTimeAgo(node.last_seen_at)}
                          </Text>
                        </View>
                        <Text style={styles.nodeContent} numberOfLines={isExpanded ? undefined : 3}>
                          {node.content}
                        </Text>
                      </View>
                      <View style={styles.expandArrow}>
                        {isExpanded ? (
                          <ChevronDown size={16} color={theme.textDim} />
                        ) : (
                          <ChevronRight size={16} color={theme.textDim} />
                        )}
                      </View>
                    </View>

                    {/* Confidence bar */}
                    <View style={styles.confBarRow}>
                      <View style={styles.confBarTrack}>
                        <LinearGradient
                          colors={[cfg.color, cfg.color]}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 0 }}
                          style={[styles.confBarFill, { width: `${c * 100}%`, opacity: c >= 0.5 ? 0.7 : 0.4 }]}
                        />
                      </View>
                      <Text style={[styles.confPct, { color: confidenceColor(c) }]}>
                        {Math.round(c * 100)}%
                      </Text>
                      <Text style={[styles.confStatus, { color: confidenceColor(c) }]}>
                        {confidenceLabel(c)}
                      </Text>
                    </View>

                    {/* Expanded details */}
                    {isExpanded && (
                      <View style={styles.expandedSection}>
                        <View style={styles.detailRow}>
                          <Text style={styles.detailLabel}>衰减率</Text>
                          <Text style={styles.detailValue}>{node.decay_rate.toFixed(3)} / 天</Text>
                        </View>
                        <View style={styles.detailRow}>
                          <Text style={styles.detailLabel}>证据数</Text>
                          <Text style={styles.detailValue}>{node.evidence_count}</Text>
                        </View>
                        {node.source && (
                          <View style={styles.detailRow}>
                            <Text style={styles.detailLabel}>来源</Text>
                            <Text style={styles.detailValue}>{node.source}</Text>
                          </View>
                        )}

                        {/* Neighbors */}
                        <View style={styles.neighborSection}>
                          <View style={styles.neighborHeaderRow}>
                            <GitBranch size={13} color={theme.textDim} />
                            <Text style={styles.neighborTitle}>关联记忆</Text>
                          </View>
                          {neighborsLoading ? (
                            <ActivityIndicator size="small" color={theme.amber} style={{ marginTop: 8 }} />
                          ) : neighborError ? (
                            <Text style={styles.neighborError}>{neighborError}</Text>
                          ) : neighbors.length === 0 ? (
                            <Text style={styles.neighborEmpty}>暂无关联节点</Text>
                          ) : (
                            <View style={{ gap: 4, marginTop: 4 }}>
                              {neighbors.map((n) => {
                                const ncfg = TYPE_CONFIG[n.type] ?? TYPE_CONFIG.fact;
                                const NIcon = ncfg.icon;
                                return (
                                  <View key={n.id} style={styles.neighborRow}>
                                    <NIcon size={11} color={ncfg.color} />
                                    <Text style={styles.neighborContent} numberOfLines={1}>
                                      {n.content}
                                    </Text>
                                    <View style={styles.neighborMeta}>
                                      <Text style={styles.neighborRel}>{n.relation}</Text>
                                      <Text style={styles.neighborHop}>H{n.hop}</Text>
                                    </View>
                                  </View>
                                );
                              })}
                            </View>
                          )}
                        </View>

                        {/* Delete */}
                        <Pressable
                          onPress={() => onDelete(node.id)}
                          hitSlop={8}
                          style={({ pressed }) => [
                            styles.deleteNodeBtn,
                            pressed && { opacity: 0.6 },
                          ]}
                        >
                          <Trash2 size={12} color={theme.danger} />
                          <Text style={styles.deleteNodeText}>移除此记忆</Text>
                        </Pressable>
                      </View>
                    )}
                  </GlassCard>
                </Pressable>
              );
            })}
          </View>

          <View style={{ height: 100 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { padding: 20, gap: 14 },
  header: { marginTop: 6, marginBottom: 2 },
  kicker: {
    color: theme.textFaint,
    fontSize: typography.micro.fontSize,
    letterSpacing: 2.4,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  title: {
    color: theme.text,
    fontSize: typography.display.fontSize,
    fontWeight: "700",
    letterSpacing: -0.8,
    marginTop: 6,
  },
  sub: {
    color: theme.textMuted,
    fontSize: 14,
    marginTop: 4,
    lineHeight: 20,
  },
  errorCard: {
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  errorText: { color: theme.danger, fontSize: 13, flex: 1 },
  searchRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  searchInputWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  searchInput: {
    flex: 1,
    color: theme.text,
    fontSize: 14,
    paddingVertical: 0,
  },
  searchClear: {
    color: theme.textDim,
    fontSize: 12,
    fontWeight: "600",
  },
  searchBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.amber,
  },
  countsRow: {
    flexDirection: "row",
    gap: 6,
    flexWrap: "wrap",
  },
  countChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "transparent",
  },
  countNum: {
    color: theme.textDim,
    fontSize: 12,
    fontWeight: "700",
  },
  countLabel: {
    color: theme.textDim,
    fontSize: 10,
    fontWeight: "600",
  },
  actionsRow: {
    flexDirection: "row",
    gap: 8,
  },
  actionChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  actionText: {
    color: theme.textMuted,
    fontSize: 12,
    fontWeight: "600",
  },
  toast: {
    color: theme.amber,
    fontSize: 11,
    fontWeight: "600",
    textAlign: "center",
  },
  empty: { padding: 22, gap: 10, alignItems: "flex-start" },
  emptyTitle: { color: theme.text, fontSize: 18, fontWeight: "700" },
  emptyText: { color: theme.textMuted, fontSize: 13, lineHeight: 19 },
  nodeCard: { padding: 14, gap: 10 },
  nodeCardExpanded: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.borderStrong,
  },
  nodeHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  nodeIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  typeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  typeBadgeText: {
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  confLabel: {
    color: theme.textDim,
    fontSize: 10,
    fontWeight: "600",
  },
  nodeContent: {
    color: theme.text,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
  },
  expandArrow: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  confBarRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 2,
  },
  confBarTrack: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.06)",
    overflow: "hidden",
  },
  confBarFill: {
    height: "100%",
    borderRadius: 2,
  },
  confPct: {
    fontSize: 11,
    fontWeight: "700",
    width: 32,
  },
  confStatus: {
    fontSize: 10,
    fontWeight: "600",
  },
  expandedSection: {
    gap: 8,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.border,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  detailLabel: {
    color: theme.textDim,
    fontSize: 12,
    fontWeight: "500",
  },
  detailValue: {
    color: theme.textMuted,
    fontSize: 12,
    fontWeight: "600",
  },
  neighborSection: {
    marginTop: 4,
  },
  neighborHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  neighborTitle: {
    color: theme.textDim,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  neighborError: {
    color: theme.danger,
    fontSize: 11,
    marginTop: 4,
  },
  neighborEmpty: {
    color: theme.textDim,
    fontSize: 12,
    fontStyle: "italic",
    marginTop: 4,
  },
  neighborRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.025)",
  },
  neighborContent: {
    color: theme.textMuted,
    fontSize: 12,
    flex: 1,
    lineHeight: 17,
  },
  neighborMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  neighborRel: {
    color: theme.textDim,
    fontSize: 9,
    fontWeight: "600",
  },
  neighborHop: {
    color: theme.textFaint,
    fontSize: 9,
    fontWeight: "700",
  },
  deleteNodeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-end",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: "rgba(216,106,106,0.08)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(216,106,106,0.25)",
  },
  deleteNodeText: {
    color: theme.danger,
    fontSize: 10,
    fontWeight: "700",
  },
});
