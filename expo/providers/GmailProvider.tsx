import AsyncStorage from "@react-native-async-storage/async-storage";
import createContextHook from "@nkzw/create-context-hook";
import * as Google from "expo-auth-session/providers/google";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";

import {
  GMAIL_ANDROID_CLIENT_ID,
  GMAIL_IOS_CLIENT_ID,
  GMAIL_SCOPES,
  GMAIL_WEB_CLIENT_ID,
  extractActionsFromEmails,
  fetchRecentMessages,
  type GmailMessageSummary,
} from "@/lib/gmail";
import { useAurora } from "@/providers/AuroraProvider";
import type { ScheduleItem } from "@/types/aurora";

WebBrowser.maybeCompleteAuthSession();

const TOKEN_KEY = "aurora.gmail.token.v1";
const LAST_SYNC_KEY = "aurora.gmail.lastSync.v1";

type StoredToken = {
  accessToken: string;
  expiresAt: number;
  email?: string;
};

export type GmailSyncResult = {
  scanned: number;
  added: number;
  preview: GmailMessageSummary[];
};

export const [GmailProvider, useGmail] = createContextHook(() => {
  const { addTaskToToday } = useAurora();
  const [token, setToken] = useState<StoredToken | null>(null);
  const [hydrated, setHydrated] = useState<boolean>(false);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [lastResult, setLastResult] = useState<GmailSyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [request, response, promptAsync] = Google.useAuthRequest({
    webClientId: GMAIL_WEB_CLIENT_ID,
    iosClientId: GMAIL_IOS_CLIENT_ID,
    androidClientId: GMAIL_ANDROID_CLIENT_ID,
    scopes: GMAIL_SCOPES,
  });

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [t, s] = await Promise.all([
          AsyncStorage.getItem(TOKEN_KEY),
          AsyncStorage.getItem(LAST_SYNC_KEY),
        ]);
        if (!mounted) return;
        if (t) {
          const parsed = JSON.parse(t) as StoredToken;
          if (parsed.expiresAt > Date.now() + 30_000) {
            setToken(parsed);
          } else {
            await AsyncStorage.removeItem(TOKEN_KEY);
          }
        }
        if (s) setLastSyncAt(Number(s));
      } catch (err) {
        console.warn("[Gmail] hydrate error", err);
      } finally {
        if (mounted) setHydrated(true);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (response?.type === "success") {
      const at = response.authentication?.accessToken;
      const expiresIn = response.authentication?.expiresIn ?? 3600;
      if (at) {
        const stored: StoredToken = {
          accessToken: at,
          expiresAt: Date.now() + expiresIn * 1000,
        };
        setToken(stored);
        AsyncStorage.setItem(TOKEN_KEY, JSON.stringify(stored)).catch((e) =>
          console.warn("[Gmail] persist token", e)
        );
        setError(null);
      }
    } else if (response?.type === "error") {
      setError(response.error?.message ?? "授权失败");
    }
  }, [response]);

  const connect = useCallback(async () => {
    try {
      setError(null);
      await promptAsync();
    } catch (err) {
      console.warn("[Gmail] connect error", err);
      setError(err instanceof Error ? err.message : "授权失败");
    }
  }, [promptAsync]);

  const disconnect = useCallback(async () => {
    setToken(null);
    setLastResult(null);
    await AsyncStorage.removeItem(TOKEN_KEY).catch(() => {});
  }, []);

  const sync = useCallback(async (): Promise<GmailSyncResult | null> => {
    if (!token) {
      setError("尚未连接 Gmail");
      return null;
    }
    setSyncing(true);
    setError(null);
    try {
      const messages = await fetchRecentMessages(token.accessToken, 12);
      const actions = await extractActionsFromEmails(messages);
      let added = 0;
      for (const a of actions) {
        const kind: ScheduleItem["kind"] = a.kind ?? "other";
        const title = a.source ? `${a.title} · ${a.source}` : a.title;
        addTaskToToday(title, kind, a.time || "近期");
        added += 1;
      }
      const now = Date.now();
      setLastSyncAt(now);
      await AsyncStorage.setItem(LAST_SYNC_KEY, String(now)).catch(() => {});
      const result: GmailSyncResult = {
        scanned: messages.length,
        added,
        preview: messages.slice(0, 5),
      };
      setLastResult(result);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "同步失败";
      setError(msg);
      // If the token is expired, clear it so the UI prompts re-auth.
      if (msg.includes("401") || msg.toLowerCase().includes("unauthor")) {
        await disconnect();
      }
      return null;
    } finally {
      setSyncing(false);
    }
  }, [token, addTaskToToday, disconnect]);

  return useMemo(
    () => ({
      hydrated,
      connected: token !== null,
      canPrompt: request !== null,
      syncing,
      lastSyncAt,
      lastResult,
      error,
      connect,
      disconnect,
      sync,
      platform: Platform.OS,
    }),
    [
      hydrated,
      token,
      request,
      syncing,
      lastSyncAt,
      lastResult,
      error,
      connect,
      disconnect,
      sync,
    ]
  );
});
