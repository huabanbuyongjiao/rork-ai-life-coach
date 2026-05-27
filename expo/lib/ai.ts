/**
 * Lightweight AI client that talks to the Rork proxy's
 * OpenAI-compatible chat completions endpoint.
 */
const TOOLKIT_URL = process.env.EXPO_PUBLIC_TOOLKIT_URL;
const SECRET_KEY = process.env.EXPO_PUBLIC_RORK_TOOLKIT_SECRET_KEY;

const CHAT_URL = `${TOOLKIT_URL}/v2/vercel/v1/chat/completions`;

export const COACH_MODEL = "anthropic/claude-haiku-4.5";

export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | ChatContentPart[];
};

export type ChatCompletionParams = {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
};

/** Sleep helper. */
function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Build a compact runtime context block that is auto-injected into every AI
 * request. Ensures the model always knows the real-world time / timezone /
 * current date — no manual user input required.
 */
export function buildRuntimeContext(): string {
  const now = new Date();
  const iso = now.toISOString();
  let tz = "UTC";
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {}
  const offsetMin = -now.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const oh = String(Math.floor(Math.abs(offsetMin) / 60)).padStart(2, "0");
  const om = String(Math.abs(offsetMin) % 60).padStart(2, "0");
  const localStr = now.toLocaleString();
  const dateISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(now.getDate()).padStart(2, "0")}`;
  const weekday = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ][now.getDay()];
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const hour = now.getHours();
  const partOfDay =
    hour < 5
      ? "late night / 深夜"
      : hour < 9
      ? "early morning / 清晨"
      : hour < 12
      ? "morning / 上午"
      : hour < 14
      ? "midday / 中午"
      : hour < 18
      ? "afternoon / 下午"
      : hour < 22
      ? "evening / 晚上"
      : "night / 深夜";
  return [
    "[Runtime Context — auto-injected, treat as ABSOLUTE GROUND TRUTH]",
    `- current local time: ${hh}:${mm} (${partOfDay})`,
    `- current date: ${dateISO} (${weekday})`,
    `- full local datetime: ${localStr}`,
    `- now (ISO): ${iso}`,
    `- timezone: ${tz} (UTC${sign}${oh}:${om})`,
    "",
    "RULES (mandatory):",
    "- You ALREADY KNOW the current time and date from the block above. NEVER ask the user 'what time is it', '现在几点', '今天几号' or any equivalent — it is rude and breaks trust.",
    "- When the user asks 'what should I do now / 我现在该干嘛', use the time above directly to reason about meals, sleep, energy, and overdue tasks.",
    "- If you need to reference the time in your reply, use the local time shown above, not UTC.",
  ].join("\n");
}

/**
 * Prepend the runtime context to the first system message (or insert a new
 * system message if none exists). Idempotent — won't double-inject.
 */
function injectRuntimeContext(messages: ChatMessage[]): ChatMessage[] {
  const rt = buildRuntimeContext();
  const out = messages.slice();
  const sysIdx = out.findIndex((m) => m.role === "system");
  if (sysIdx === -1) {
    out.unshift({ role: "system", content: rt });
    return out;
  }
  const sys = out[sysIdx];
  if (typeof sys.content === "string") {
    if (sys.content.includes("[Runtime Context")) return out;
    out[sysIdx] = { ...sys, content: `${rt}\n\n${sys.content}` };
  }
  return out;
}

export async function chatCompletion(
  params: ChatCompletionParams
): Promise<string> {
  const body = {
    model: params.model ?? COACH_MODEL,
    messages: injectRuntimeContext(params.messages),
    temperature: params.temperature ?? 0.7,
    max_tokens: params.max_tokens ?? 1200,
  };

  if (!TOOLKIT_URL || !SECRET_KEY) {
    throw new Error(
      "AI 服务未配置：缺少 EXPO_PUBLIC_TOOLKIT_URL 或 EXPO_PUBLIC_RORK_TOOLKIT_SECRET_KEY"
    );
  }

  let lastErr: unknown = null;
  // Retry up to 2 times for transient upstream / network failures.
  // Total worst case: 30s + 30s + backoff ≈ 65s before surfacing error.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const ctl = new AbortController();
      const tm = setTimeout(() => ctl.abort(), 30000);
      const res = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SECRET_KEY}`,
        },
        body: JSON.stringify(body),
        signal: ctl.signal,
      }).finally(() => clearTimeout(tm));

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        // Retry on 429 / 5xx; bail immediately on 4xx auth / bad request.
        if (res.status === 429 || res.status >= 500) {
          lastErr = new Error(
            `AI request failed (${res.status}): ${text.slice(0, 160)}`
          );
          await wait(600 * Math.pow(2, attempt));
          continue;
        }
        throw new Error(
          `AI request failed (${res.status}): ${text.slice(0, 200)}`
        );
      }

      const json = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = json.choices?.[0]?.message?.content ?? "";
      if (!content && attempt < 1) {
        lastErr = new Error("AI 返回为空");
        await wait(500 * Math.pow(2, attempt));
        continue;
      }
      return content;
    } catch (err) {
      lastErr = err;
      if (attempt === 1) break;
      // Surface abort/timeout clearly
      if (err instanceof Error && err.name === "AbortError") {
        lastErr = new Error("AI 请求超时（30 秒未响应）");
      }
      await wait(600 * Math.pow(2, attempt));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("AI 请求失败");
}

/**
 * Ask the model for a JSON-only response, parsing safely.
 */
export async function chatJson<T>(
  params: ChatCompletionParams
): Promise<T | null> {
  const raw = await chatCompletion({
    ...params,
    temperature: params.temperature ?? 0.3,
  });
  const cleaned = raw
    .replace(/^```(?:json)?/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  // Try to extract first JSON object
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
