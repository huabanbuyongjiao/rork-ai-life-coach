import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";

// ── Lazy singleton with safe stub fallback ─────────────────────────────────
// If EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY are missing or blank at runtime,
// we return a stub client that never throws — every query resolves to an
// error result, channel().subscribe() is a no-op. This keeps the app
// render-able even when the backend isn't configured.

let _client: SupabaseClient | null = null;
let _warned = false;

const MISSING_ENV_ERROR = {
  name: "SupabaseNotConfigured",
  message:
    "Supabase 未配置。请在 Rork 项目设置 → Environment Variables 中填入 EXPO_PUBLIC_SUPABASE_URL 和 EXPO_PUBLIC_SUPABASE_ANON_KEY 的实际值，然后重新加载。",
};

export function isSupabaseConfigured(): boolean {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  return !!(url && anon && url.startsWith("http"));
}

function warnOnce(): void {
  if (_warned) return;
  _warned = true;
  console.warn("[supabase]", MISSING_ENV_ERROR.message);
}

/** Builds a chainable stub that mimics PostgrestQueryBuilder. */
function makeQueryStub(): unknown {
  const result = { data: null, error: MISSING_ENV_ERROR };
  const chain: Record<string, unknown> = {
    then: (resolve: (v: typeof result) => unknown) => Promise.resolve(resolve(result)),
    catch: () => Promise.resolve(result),
    finally: (cb: () => void) => {
      cb();
      return Promise.resolve(result);
    },
  };
  // Every Postgrest chain method returns the same stub.
  const passthrough = new Proxy(chain, {
    get(target, prop) {
      if (prop in target) return (target as Record<string | symbol, unknown>)[prop];
      return () => passthrough;
    },
  });
  return passthrough;
}

function makeStubClient(): SupabaseClient {
  warnOnce();
  const channelStub = {
    on: () => channelStub,
    subscribe: () => channelStub,
    unsubscribe: () => Promise.resolve("ok"),
  };
  const stub = {
    from: () => makeQueryStub(),
    rpc: () => makeQueryStub(),
    channel: () => channelStub,
    removeChannel: () => Promise.resolve("ok"),
    auth: {
      getUser: async () => ({ data: { user: null }, error: MISSING_ENV_ERROR }),
      getSession: async () => ({ data: { session: null }, error: MISSING_ENV_ERROR }),
      signOut: async () => ({ error: null }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => {} } },
      }),
    },
    storage: { from: () => makeQueryStub() },
  };
  return stub as unknown as SupabaseClient;
}

function getClient(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon || !url.startsWith("http")) {
    _client = makeStubClient();
    return _client;
  }

  _client = createClient(url, anon, {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
  return _client;
}

/**
 * Singleton Supabase client (lazy init).
 * Falls back to a no-op stub when env vars are missing so the app still renders.
 */
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getClient();
    const value = (client as Record<string | symbol, unknown>)[prop];
    if (typeof value === "function") {
      return (value as Function).bind(client);
    }
    return value;
  },
});

export async function getUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

/** Throws if user is not signed in. Use in DB writes that require user_id. */
export async function requireUserId(): Promise<string> {
  const uid = await getUserId();
  if (!uid) throw new Error("Not authenticated");
  return uid;
}
