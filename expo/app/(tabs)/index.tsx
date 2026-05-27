import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { Image as ExpoImage } from "expo-image";
import { useRouter } from "expo-router";
import {
  CalendarPlus,
  Check,
  Clock,
  Copy,
  FileText,
  History,
  ImagePlus,
  Paperclip,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
  X,
} from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Keyboard,
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
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Swipeable } from "react-native-gesture-handler";

import AuroraBackground from "@/components/AuroraBackground";
import GlassCard from "@/components/GlassCard";
import Markdown from "@/components/Markdown";
import ThinkingDots from "@/components/ThinkingDots";
import { theme } from "@/constants/theme";
import { parseScheduleFromText } from "@/lib/coach";
import { useAurora } from "@/providers/AuroraProvider";
import type { ChatFileAttachment, ChatMessageRecord, ScheduleItem } from "@/types/aurora";

const TEXT_MIME_PATTERNS = [
  /^text\//,
  /json$/,
  /xml$/,
  /javascript$/,
  /typescript$/,
  /csv$/,
  /markdown$/,
  /yaml$/,
];

function isTextLike(mime: string): boolean {
  return TEXT_MIME_PATTERNS.some((p) => p.test(mime));
}

/**
 * Heuristic: does this assistant reply contain content worth dropping into the
 * schedule? We only show the "加入日程" button when the text reads like a plan,
 * a list of tasks, or scheduling advice — not when it's an emotional reply.
 */
function looksPlannable(text: string): boolean {
  if (!text || text.length < 40) return false;

  // Count bullet / numbered list items — need at least 2 to count as a plan.
  const bulletMatches = text.match(/^\s*[-*•]\s+\S/gm) ?? [];
  const numberedMatches = text.match(/^\s*\d+[\.\u3001．\)]\s*\S/gm) ?? [];
  const listItems = bulletMatches.length + numberedMatches.length;
  if (listItems >= 2) return true;

  // Two or more concrete clock times in the same reply → it's a schedule.
  const clockTimes = text.match(/\b\d{1,2}[:：]\d{2}\b/g) ?? [];
  if (clockTimes.length >= 2) return true;

  // Strong planning verbs (the act of building/committing to a plan).
  const hasStrongPlanVerb =
    /(制定计划|制定一个计划|安排一下|安排如下|每日计划|每周计划|本周计划|训练计划|学习计划|复习计划|行动计划|任务列表|todo\s*list|action\s*items|步骤[一二三四五12345]|第[一二三123]步)/i.test(
      text
    );
  if (hasStrongPlanVerb) return true;

  // A clock time + a planning verb in the same message.
  const hasClock = clockTimes.length >= 1;
  const hasTimeWord =
    /(明天|后天|今晚|明晚|每天|每周|本周|下周|周[一二三四五六日天]|上午\s*\d|下午\s*\d|晚上\s*\d)/.test(
      text
    );
  const hasActionVerb =
    /(安排|完成|训练|复习|预习|预约|实施|执行|提醒|打卡)/.test(text);
  if ((hasClock || hasTimeWord) && hasActionVerb) return true;

  return false;
}

export default function CoachScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { messages, sendMessage, clearChat, sessions, restoreSession, deleteSession, chatDraft, setChatDraft } = useAurora();
  const [historyOpen, setHistoryOpen] = useState<boolean>(false);
  const [text, setText] = useState<string>("");
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [pendingFiles, setPendingFiles] = useState<ChatFileAttachment[]>([]);
  const [keyboardUp, setKeyboardUp] = useState<boolean>(false);
  const listRef = useRef<FlatList<any>>(null);

  const isSending = sendMessage.isPending;

  useEffect(() => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: true });
    });
  }, [messages.length, isSending]);

  // Consume any pending draft (e.g. from a module "chat about this" CTA).
  useEffect(() => {
    if (chatDraft && chatDraft.length > 0) {
      setText((cur) => (cur && cur.length > 0 ? cur : chatDraft));
      setChatDraft("");
    }
  }, [chatDraft, setChatDraft]);

  useEffect(() => {
    const showEvt =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const s = Keyboard.addListener(showEvt, () => setKeyboardUp(true));
    const h = Keyboard.addListener(hideEvt, () => setKeyboardUp(false));
    return () => {
      s.remove();
      h.remove();
    };
  }, []);

  const pickImage = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
        base64: true,
        allowsMultipleSelection: true,
        selectionLimit: 9,
      });
      if (result.canceled) return;
      const uris: string[] = [];
      for (const asset of result.assets) {
        const base64 = asset.base64;
        if (!base64) continue;
        const mime = asset.mimeType ?? "image/jpeg";
        uris.push(`data:${mime};base64,${base64}`);
      }
      if (uris.length === 0) return;
      setPendingImages((prev) => [...prev, ...uris]);
      if (Platform.OS !== "web") {
        Haptics.selectionAsync().catch(() => {});
      }
    } catch (err) {
      console.warn("[pickImage]", err);
    }
  }, []);

  const pickFile = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: true,
        type: "*/*",
      });
      if (result.canceled) return;
      const assets = result.assets ?? [];
      if (assets.length === 0) return;
      const files: ChatFileAttachment[] = [];
      for (const asset of assets) {
        const mime = asset.mimeType ?? "application/octet-stream";
        const size = asset.size ?? 0;
        let textPreview: string | undefined;
        if (isTextLike(mime) && size > 0 && size < 200_000 && Platform.OS !== "web") {
          try {
            const raw = await FileSystem.readAsStringAsync(asset.uri);
            textPreview = raw.slice(0, 8000);
          } catch (err) {
            console.warn("[pickFile] read text", err);
          }
        }
        files.push({
          name: asset.name,
          size,
          mimeType: mime,
          textPreview,
        });
      }
      setPendingFiles((prev) => [...prev, ...files]);
      if (Platform.OS !== "web") Haptics.selectionAsync().catch(() => {});
    } catch (err) {
      console.warn("[pickFile]", err);
    }
  }, []);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed && pendingImages.length === 0 && pendingFiles.length === 0)
      return;
    if (isSending) return;
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    sendMessage.mutate({
      text: trimmed || (pendingImages.length > 0 ? "(image)" : "(file)"),
      images: pendingImages.length > 0 ? pendingImages : undefined,
      files: pendingFiles.length > 0 ? pendingFiles : undefined,
    });
    setText("");
    setPendingImages([]);
    setPendingFiles([]);
  }, [text, pendingImages, pendingFiles, isSending, sendMessage]);

  type Row =
    | { type: "sep"; id: string; label: string }
    | { type: "msg"; id: string; msg: ChatMessageRecord };

  const data = useMemo<Row[]>(() => {
    const rows: Row[] = [];
    let lastDay = "";
    for (const m of messages) {
      const d = new Date(m.createdAt);
      const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (dayKey !== lastDay) {
        lastDay = dayKey;
        rows.push({ type: "sep", id: `sep_${m.id}`, label: formatDayLabel(d) });
      }
      rows.push({ type: "msg", id: m.id, msg: m });
    }
    return rows;
  }, [messages]);

  const renderItem = useCallback(
    ({ item }: { item: Row }) => {
      if (item.type === "sep") return <DaySeparator label={item.label} />;
      return <MessageBubble message={item.msg} />;
    },
    []
  );

  const onClear = useCallback(() => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
    clearChat();
  }, [clearChat]);

  const onOpenGoals = useCallback(() => {
    router.push("/goals");
  }, [router]);

  // When the keyboard is up, KeyboardAvoidingView already lifts the composer.
  // When closed, we need to clear the tab-bar area beneath.
  const composerBottomPad = keyboardUp
    ? 8
    : Math.max(insets.bottom, 12) + 60;

  return (
    <View style={styles.root}>
      <AuroraBackground />
      <SafeAreaView style={styles.flex} edges={["top"]}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.brandOrb}>
              <View style={styles.brandOrbInner} />
            </View>
            <View>
              <Text style={styles.headerTitle}>Aurora</Text>
              <Text style={styles.headerSub}>你的 AI 生活教练</Text>
            </View>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              onPress={onOpenGoals}
              style={({ pressed }) => [
                styles.iconBtn,
                pressed && { opacity: 0.6 },
              ]}
              hitSlop={8}
            >
              <Sparkles size={18} color={theme.textMuted} />
            </Pressable>
            <Pressable
              onPress={() => setHistoryOpen(true)}
              style={({ pressed }) => [
                styles.iconBtn,
                pressed && { opacity: 0.6 },
              ]}
              hitSlop={8}
            >
              <History size={18} color={theme.textMuted} />
            </Pressable>
            <Pressable
              onPress={onClear}
              style={({ pressed }) => [
                styles.iconBtn,
                pressed && { opacity: 0.6 },
              ]}
              hitSlop={8}
            >
              <RotateCcw size={18} color={theme.textMuted} />
            </Pressable>
          </View>
        </View>

        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={0}
        >
          <FlatList
            ref={listRef}
            data={data}
            keyExtractor={(m) => m.id}
            renderItem={renderItem}
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              paddingHorizontal: 16,
              paddingTop: 12,
              paddingBottom: 24,
              gap: 12,
            }}
            ListFooterComponent={isSending ? <TypingBubble /> : null}
            onContentSizeChange={() =>
              listRef.current?.scrollToEnd({ animated: true })
            }
            showsVerticalScrollIndicator={false}
          />

          {/* Composer */}
          <View
            style={[
              styles.composerWrap,
              { paddingBottom: composerBottomPad },
            ]}
          >
            {!isSending && text.trim().length === 0 && (
              <QuickSuggestions
                isNewUser={messages.length <= 1}
                onPick={(t) => setText(t)}
              />
            )}
            {(pendingImages.length > 0 || pendingFiles.length > 0) && (
              <View style={styles.thumbsRow}>
                {pendingImages.map((uri, i) => (
                  <View key={`img-${i}`} style={styles.thumbWrap}>
                    <ExpoImage
                      source={{ uri }}
                      style={styles.thumb}
                      contentFit="cover"
                    />
                    <Pressable
                      onPress={() =>
                        setPendingImages((prev) =>
                          prev.filter((_, idx) => idx !== i)
                        )
                      }
                      style={styles.thumbRemove}
                      hitSlop={6}
                    >
                      <X size={12} color="#fff" />
                    </Pressable>
                  </View>
                ))}
                {pendingFiles.map((f, i) => (
                  <View key={`file-${i}`} style={styles.fileChip}>
                    <FileText size={14} color={theme.amber} />
                    <Text style={styles.fileChipText} numberOfLines={1}>
                      {f.name}
                    </Text>
                    <Pressable
                      onPress={() =>
                        setPendingFiles((prev) =>
                          prev.filter((_, idx) => idx !== i)
                        )
                      }
                      hitSlop={6}
                    >
                      <X size={12} color={theme.textMuted} />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
            <GlassCard radius={26} intensity={40} style={styles.composer}>
              <Pressable
                onPress={pickImage}
                style={({ pressed }) => [
                  styles.attachBtn,
                  pressed && { opacity: 0.5 },
                ]}
                hitSlop={8}
              >
                <ImagePlus size={20} color={theme.textMuted} />
              </Pressable>
              <Pressable
                onPress={pickFile}
                style={({ pressed }) => [
                  styles.attachBtn,
                  pressed && { opacity: 0.5 },
                ]}
                hitSlop={8}
              >
                <Paperclip size={18} color={theme.textMuted} />
              </Pressable>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder="和 Aurora 说点什么…"
                placeholderTextColor={theme.textDim}
                style={styles.input}
                multiline
                maxLength={2000}
              />
              <Pressable
                onPress={handleSend}
                disabled={isSending}
                style={({ pressed }) => [
                  styles.sendBtn,
                  text.trim().length > 0 || pendingImages.length > 0 || pendingFiles.length > 0
                    ? styles.sendBtnActive
                    : styles.sendBtnIdle,
                  (pressed || isSending) && { opacity: 0.7 },
                ]}
              >
                {isSending ? (
                  <ActivityIndicator size="small" color={theme.text} />
                ) : (
                  <Send size={15} color={theme.text} strokeWidth={1.8} />
                )}
              </Pressable>
            </GlassCard>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <Modal
        visible={historyOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setHistoryOpen(false)}
      >
        <Pressable style={styles.historyBackdrop} onPress={() => setHistoryOpen(false)}>
          <Pressable style={{ width: "100%" }}>
            <GlassCard radius={24} intensity={50} style={styles.historyCard}>
              <View style={styles.historyHeader}>
                <Text style={styles.historyTitle}>历史对话</Text>
                <Pressable onPress={() => setHistoryOpen(false)} hitSlop={8}>
                  <X size={18} color={theme.textMuted} />
                </Pressable>
              </View>
              {sessions.length === 0 ? (
                <Text style={styles.historyEmpty}>
                  还没有存档的对话。点右上角的刷新按钮可以把当前对话存起来。
                </Text>
              ) : (
                <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
                  {sessions.map((s) => (
                    <Pressable
                      key={s.id}
                      onPress={() => {
                        restoreSession(s.id);
                        setHistoryOpen(false);
                        if (Platform.OS !== "web")
                          Haptics.selectionAsync().catch(() => {});
                      }}
                      style={({ pressed }) => [
                        styles.historyRow,
                        pressed && { opacity: 0.6 },
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.historyRowTitle} numberOfLines={1}>
                          {s.title}
                        </Text>
                        <Text style={styles.historyRowMeta}>
                          {formatSessionTime(s.endedAt)} · {s.messages.length} 条消息
                        </Text>
                      </View>
                      <Pressable
                        hitSlop={8}
                        onPress={() => {
                          deleteSession(s.id);
                          if (Platform.OS !== "web")
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
                              () => {}
                            );
                        }}
                        style={({ pressed }) => [styles.historyDel, pressed && { opacity: 0.5 }]}
                      >
                        <Trash2 size={14} color={theme.danger} />
                      </Pressable>
                    </Pressable>
                  ))}
                </ScrollView>
              )}
            </GlassCard>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function formatSessionTime(t: number): string {
  const d = new Date(t);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return `今天 ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  }
  const ms = now.getTime() - t;
  if (ms < 7 * 24 * 60 * 60 * 1000) {
    const days = Math.floor(ms / (24 * 60 * 60 * 1000));
    return days === 0 ? "刚刚" : `${days} 天前`;
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatBubbleTime(t: number): string {
  const d = new Date(t);
  const hhmm = `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  return hhmm;
}

function formatDayLabel(d: Date): string {
  const now = new Date();
  const startOf = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return "今天";
  if (diffDays === 1) return "昨天";
  if (diffDays === -1) return "明天";
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const sameYear = d.getFullYear() === now.getFullYear();
  const base = `${d.getMonth() + 1}月${d.getDate()}日 ${weekdays[d.getDay()]}`;
  return sameYear ? base : `${d.getFullYear()}年 ${base}`;
}

const DaySeparator = memo(function DaySeparator({ label }: { label: string }) {
  return (
    <View style={styles.daySepWrap}>
      <View style={styles.daySepLine} />
      <Text style={styles.daySepText}>{label}</Text>
      <View style={styles.daySepLine} />
    </View>
  );
});

function QuickSuggestions({
  isNewUser,
  onPick,
}: {
  isNewUser: boolean;
  onPick: (t: string) => void;
}) {
  const starters = isNewUser
    ? [
        "我是一名大学生",
        "我想减肥",
        "我在准备面试",
        "帮我规划今天",
        "我最近很焦虑",
      ]
    : [
        "今天计划怎么安排？",
        "帮我梳理下思路",
        "我该休息一下了吗？",
        "对我的理解还准吗？",
      ];
  return (
    <View style={styles.suggestRow}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 4, gap: 8 }}
      >
        {starters.map((s) => (
          <Pressable
            key={s}
            onPress={() => {
              onPick(s);
              if (Platform.OS !== "web")
                Haptics.selectionAsync().catch(() => {});
            }}
            style={({ pressed }) => [
              styles.suggestChip,
              pressed && { opacity: 0.6 },
            ]}
          >
            <Text style={styles.suggestText}>{s}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function MessageBubble({ message }: { message: ChatMessageRecord }) {
  const { addScheduleItem } = useAurora();
  const isUser = message.role === "user";
  const [addingToSched, setAddingToSched] = useState<boolean>(false);
  const [schedToast, setSchedToast] = useState<string | null>(null);
  const fade = useRef(new Animated.Value(0)).current;
  const swipeRef = useRef<Swipeable>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  useEffect(() => {
    Animated.timing(fade, {
      toValue: 1,
      duration: 320,
      useNativeDriver: true,
    }).start();
  }, [fade]);

  const onCopy = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(message.text || "");
      setCopied(true);
      if (Platform.OS !== "web")
        Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success
        ).catch(() => {});
      setTimeout(() => setCopied(false), 1400);
    } catch (err) {
      console.warn("[copy]", err);
    }
  }, [message.text]);

  const copyable = !!message.text &&
    message.text !== "(image)" &&
    message.text !== "(file)";

  const renderTimestamp = useCallback(
    (progress: Animated.AnimatedInterpolation<number>) => {
      // Fade and slide the timestamp in lockstep with the bubble's swipe progress.
      // progress goes 0 -> 1 as user pulls, and animates back to 0 on release,
      // so the timestamp disappears smoothly together with the bubble's return.
      const opacity = progress.interpolate({
        inputRange: [0, 0.4, 1],
        outputRange: [0, 0.6, 1],
        extrapolate: "clamp",
      });
      const translateX = progress.interpolate({
        inputRange: [0, 1],
        outputRange: [20, 0],
        extrapolate: "clamp",
      });
      return (
        <Animated.View style={[styles.timeReveal, { opacity, transform: [{ translateX }] }]}>
          <Clock size={11} color={theme.textDim} />
          <Text style={styles.timeRevealText}>{formatBubbleTime(message.createdAt)}</Text>
        </Animated.View>
      );
    },
    [message.createdAt]
  );

  // Snap-back behavior: if the user pulls far enough that Swipeable would
  // "open", immediately close it again — peek-only, like iMessage.
  const handleOpen = useCallback(() => {
    swipeRef.current?.close();
  }, []);

  if (isUser) {
    return (
      <Swipeable
        ref={swipeRef}
        renderRightActions={renderTimestamp}
        overshootRight={false}
        friction={2.4}
        rightThreshold={9999}
        onSwipeableWillOpen={handleOpen}
      >
      <Animated.View
        style={[
          styles.userRow,
          { opacity: fade, transform: [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] },
        ]}
      >
        <View style={styles.userBubble}>
          {message.images && message.images.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.bubbleImagesScroll}
              contentContainerStyle={styles.bubbleImagesRow}
            >
              {message.images.map((uri, i) => (
                <Pressable
                  key={i}
                  onPress={() => setLightbox(uri)}
                  style={({ pressed }) => [pressed && { opacity: 0.85 }]}
                >
                  <ExpoImage
                    source={{ uri }}
                    style={styles.bubbleImage}
                    contentFit="cover"
                  />
                </Pressable>
              ))}
            </ScrollView>
          )}
          {message.files && message.files.length > 0 && (
            <View style={{ gap: 6, marginBottom: 6 }}>
              {message.files.map((f, i) => (
                <View key={i} style={styles.userFileRow}>
                  <FileText size={14} color="#1B1300" />
                  <Text style={styles.userFileText} numberOfLines={1}>
                    {f.name}
                  </Text>
                </View>
              ))}
            </View>
          )}
          {message.text && message.text !== "(image)" && message.text !== "(file)" && (
            message.text.length > 600 ? (
              <ScrollView
                style={{ maxHeight: 280 }}
                showsVerticalScrollIndicator={true}
                nestedScrollEnabled
              >
                <Text style={styles.userText} selectable>
                  {message.text}
                </Text>
              </ScrollView>
            ) : (
              <Text style={styles.userText} selectable>
                {message.text}
              </Text>
            )
          )}
        </View>
        {copyable && (
          <Pressable
            onPress={onCopy}
            onLongPress={onCopy}
            hitSlop={8}
            style={({ pressed }) => [
              styles.copyBtn,
              styles.copyBtnUser,
              pressed && { opacity: 0.5 },
            ]}
          >
            {copied ? (
              <Check size={11} color={theme.amber} />
            ) : (
              <Copy size={11} color={theme.textDim} />
            )}
            <Text style={styles.copyBtnText}>
              {copied ? "已复制" : "复制"}
            </Text>
          </Pressable>
        )}
      </Animated.View>
      <ImageLightbox uri={lightbox} onClose={() => setLightbox(null)} />
      </Swipeable>
    );
  }
  return (
    <Swipeable
      ref={swipeRef}
      renderRightActions={renderTimestamp}
      overshootRight={false}
      friction={2.4}
      rightThreshold={9999}
      onSwipeableWillOpen={handleOpen}
    >
    <Animated.View
      style={[
        styles.assistantRow,
        { opacity: fade, transform: [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] },
      ]}
    >
      <View style={styles.assistantDot} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <GlassCard radius={18} intensity={28} variant="elevated" style={styles.assistantBubble}>
          <Markdown text={message.text} color={theme.text} selectable />
        </GlassCard>
        <View style={styles.assistantActionsRow}>
          {copyable && (
            <Pressable
              onPress={onCopy}
              onLongPress={onCopy}
              hitSlop={8}
              style={({ pressed }) => [
                styles.copyBtn,
                pressed && { opacity: 0.5 },
              ]}
            >
              {copied ? (
                <Check size={11} color={theme.amber} />
              ) : (
                <Copy size={11} color={theme.textDim} />
              )}
              <Text style={styles.copyBtnText}>
                {copied ? "已复制" : "复制"}
              </Text>
            </Pressable>
          )}
          {copyable && looksPlannable(message.text) && (
            <Pressable
              onPress={async () => {
                setAddingToSched(true);
                setSchedToast(null);
                try {
                  const items = await parseScheduleFromText(message.text);
                  if (items.length === 0) {
                    setSchedToast("未提取到可执行项");
                  } else {
                    const today = new Date();
                    const y = today.getFullYear();
                    const mo = String(today.getMonth() + 1).padStart(2, "0");
                    const dd = String(today.getDate()).padStart(2, "0");
                    const todayISO = `${y}-${mo}-${dd}`;
                    const isValidISO = (s: string | undefined): s is string =>
                      !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
                    items.forEach((it) => {
                      const newItem: ScheduleItem = {
                        id: `s_${Date.now().toString(36)}_${Math.random()
                          .toString(36)
                          .slice(2, 8)}`,
                        time: it.time || "今天",
                        title: it.title,
                        kind: it.kind || "other",
                        date: isValidISO(it.date) ? it.date : todayISO,
                      };
                      addScheduleItem(newItem);
                    });
                    setSchedToast(`已加入 ${items.length} 项到日程`);
                    if (Platform.OS !== "web")
                      Haptics.notificationAsync(
                        Haptics.NotificationFeedbackType.Success
                      ).catch(() => {});
                  }
                } catch (err) {
                  setSchedToast(
                    err instanceof Error ? err.message : "加入失败"
                  );
                } finally {
                  setAddingToSched(false);
                  setTimeout(() => setSchedToast(null), 3000);
                }
              }}
              disabled={addingToSched}
              hitSlop={8}
              style={({ pressed }) => [
                styles.copyBtn,
                styles.addPlanBtn,
                (pressed || addingToSched) && { opacity: 0.5 },
              ]}
            >
              {addingToSched ? (
                <ActivityIndicator size="small" color={theme.amber} />
              ) : (
                <CalendarPlus size={11} color={theme.amber} />
              )}
              <Text style={[styles.copyBtnText, { color: theme.amber }]}>
                加入日程
              </Text>
            </Pressable>
          )}
        </View>
        {schedToast && (
          <Text style={styles.schedToastText}>{schedToast}</Text>
        )}
      </View>
    </Animated.View>
    </Swipeable>
  );
}

function ImageLightbox({ uri, onClose }: { uri: string | null; onClose: () => void }) {
  return (
    <Modal
      visible={!!uri}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.lightboxBackdrop} onPress={onClose}>
        {uri && (
          <ExpoImage
            source={{ uri }}
            style={styles.lightboxImage}
            contentFit="contain"
          />
        )}
        <Pressable
          onPress={onClose}
          hitSlop={12}
          style={styles.lightboxClose}
        >
          <X size={20} color="#fff" />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function TypingBubble() {
  return (
    <View style={styles.assistantRow}>
      <View style={styles.assistantDot} />
      <GlassCard radius={18} intensity={28} variant="elevated" style={[styles.assistantBubble, { paddingVertical: 14 }]}>
        <ThinkingDots />
      </GlassCard>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  flex: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  brandOrb: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.surfaceStrong,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.borderStrong,
  },
  brandOrbInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.ai,
  },
  headerTitle: {
    color: theme.text,
    fontSize: 17,
    fontWeight: "600",
    letterSpacing: -0.25,
  },
  headerSub: {
    color: theme.textFaint,
    fontSize: 9.5,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    fontWeight: "600",
    marginTop: 3,
  },
  headerActions: { flexDirection: "row", gap: 6 },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  userRow: { width: "100%", alignItems: "flex-end" },
  userBubble: {
    maxWidth: "80%",
    maxHeight: 360,
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingVertical: 10,
    overflow: "hidden",
    backgroundColor: "rgba(229,165,96,0.11)",
  },
  userText: {
    color: theme.text,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "400",
    letterSpacing: -0.1,
  },
  userFileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.05)",
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 10,
  },
  userFileText: {
    color: theme.text,
    fontSize: 12,
    fontWeight: "500",
    flex: 1,
  },
  assistantRow: {
    width: "100%",
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    paddingVertical: 2,
  },
  assistantDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginTop: 16,
    marginLeft: 4,
    backgroundColor: theme.ai,
    opacity: 0.7,
  },
  assistantBubble: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  bubbleImagesScroll: { marginBottom: 8 },
  bubbleImagesRow: { flexDirection: "row", gap: 6 },
  bubbleImage: {
    width: 140,
    height: 100,
    borderRadius: 12,
    backgroundColor: "rgba(0,0,0,0.15)",
  },
  composerWrap: {
    paddingHorizontal: 12,
    paddingTop: 8,
    backgroundColor: theme.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.borderFaint,
    zIndex: 10,
    ...Platform.select({
      android: { elevation: 8 },
      default: {},
    }),
  },
  suggestRowBg: {
    backgroundColor: theme.bg,
  },
  thumbsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 8,
    marginLeft: 8,
  },
  thumbWrap: { position: "relative" },
  thumb: {
    width: 60,
    height: 60,
    borderRadius: 12,
    backgroundColor: theme.surface,
  },
  thumbRemove: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.7)",
    alignItems: "center",
    justifyContent: "center",
  },
  fileChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    maxWidth: 200,
  },
  fileChipText: {
    color: theme.text,
    fontSize: 12,
    fontWeight: "600",
    flexShrink: 1,
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 8,
    paddingVertical: 7,
    gap: 2,
  },
  attachBtn: {
    width: 36,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    flex: 1,
    color: theme.text,
    fontSize: 15,
    lineHeight: 20,
    paddingHorizontal: 6,
    paddingVertical: 10,
    maxHeight: 120,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnIdle: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  sendBtnActive: {
    backgroundColor: theme.aiSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.aiStroke,
  },
  suggestRow: { marginBottom: 10, marginLeft: -4, backgroundColor: theme.bg },
  suggestChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.035)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  suggestText: { color: theme.textMuted, fontSize: 12, fontWeight: "500", letterSpacing: -0.1 },
  timeReveal: {
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 14,
    gap: 4,
    flexDirection: "row",
  },
  timeRevealText: {
    color: theme.textDim,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.5,
  },
  historyBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    padding: 16,
  },
  historyCard: { padding: 18, gap: 8 },
  historyHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  historyTitle: { color: theme.text, fontSize: 18, fontWeight: "700" },
  historyEmpty: { color: theme.textMuted, fontSize: 13, lineHeight: 19, paddingVertical: 12 },
  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
  },
  historyRowTitle: { color: theme.text, fontSize: 14, fontWeight: "600" },
  historyRowMeta: { color: theme.textDim, fontSize: 11, marginTop: 2 },
  daySepWrap: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginVertical: 6,
    paddingHorizontal: 4,
  },
  daySepLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.border,
    maxWidth: 80,
  },
  daySepText: {
    color: theme.textDim,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 1,
  },
  historyDel: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: "rgba(255,107,107,0.08)",
  },
  copyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginTop: 4,
  },
  copyBtnUser: { alignSelf: "flex-end", marginRight: 4 },
  copyBtnAssistant: { alignSelf: "flex-start", marginLeft: 4 },
  assistantActionsRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: 4,
    marginLeft: 4,
    flexWrap: "wrap",
  },
  addPlanBtn: {
    backgroundColor: "rgba(244,184,96,0.12)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(244,184,96,0.3)",
  },
  schedToastText: {
    color: theme.mint,
    fontSize: 11,
    fontWeight: "600",
    marginTop: 4,
    marginLeft: 4,
  },
  copyBtnText: {
    color: theme.textDim,
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  lightboxBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  lightboxImage: {
    width: "100%",
    height: "100%",
  },
  lightboxClose: {
    position: "absolute",
    top: 56,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
});
