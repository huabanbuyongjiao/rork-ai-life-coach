import type { EmbedParams, LlmCallParams, LlmProvider } from "./types";

/**
 * Direct OpenAI provider. Requires EXPO_PUBLIC_OPENAI_API_KEY.
 * NOTE: shipping an API key to the client is only OK for prototyping —
 * in production proxy through a server function.
 */
const KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY ?? "";
const BASE = "https://api.openai.com/v1";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function request<T>(url: string, body: unknown): Promise<T> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), 45000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${KEY}`,
        },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
      clearTimeout(tm);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        if (res.status === 429 || res.status >= 500) {
          lastErr = new Error(`OpenAI ${res.status}: ${text.slice(0, 160)}`);
          await sleep(600 * Math.pow(2, attempt));
          continue;
        }
        throw new Error(`OpenAI ${res.status}: ${text.slice(0, 200)}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      clearTimeout(tm);
      lastErr = err;
      if (attempt === 2) break;
      await sleep(600 * Math.pow(2, attempt));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("OpenAI request failed");
}

export const openaiProvider: LlmProvider = {
  name: "openai",
  defaultModel: "gpt-4o-mini",
  defaultEmbedModel: "text-embedding-3-small",

  async chat(params: LlmCallParams): Promise<string> {
    if (!KEY) throw new Error("EXPO_PUBLIC_OPENAI_API_KEY not configured");
    const body = {
      model: params.model ?? this.defaultModel,
      messages: params.messages,
      temperature: params.temperature ?? 0.7,
      max_tokens: params.maxTokens ?? 1200,
      ...(params.json ? { response_format: { type: "json_object" } } : {}),
    };
    const json = await request<{
      choices?: { message?: { content?: string } }[];
    }>(`${BASE}/chat/completions`, body);
    return json.choices?.[0]?.message?.content ?? "";
  },

  async embed(params: EmbedParams): Promise<number[][]> {
    if (!KEY) throw new Error("EXPO_PUBLIC_OPENAI_API_KEY not configured");
    const body = {
      model: params.model ?? this.defaultEmbedModel,
      input: params.input,
    };
    const json = await request<{ data?: { embedding: number[] }[] }>(
      `${BASE}/embeddings`,
      body
    );
    return (json.data ?? []).map((d) => d.embedding);
  },
};
