import type { EmbedParams, LlmCallParams, LlmProvider } from "./types";

const TOOLKIT_URL = process.env.EXPO_PUBLIC_TOOLKIT_URL;
const SECRET_KEY = process.env.EXPO_PUBLIC_RORK_TOOLKIT_SECRET_KEY;

const CHAT_URL = `${TOOLKIT_URL}/v2/vercel/v1/chat/completions`;
const EMBED_URL = `${TOOLKIT_URL}/v2/vercel/v1/embeddings`;

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
          Authorization: `Bearer ${SECRET_KEY}`,
        },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
      clearTimeout(tm);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        if (res.status === 429 || res.status >= 500) {
          lastErr = new Error(`Rork ${res.status}: ${text.slice(0, 160)}`);
          await sleep(600 * Math.pow(2, attempt));
          continue;
        }
        throw new Error(`Rork ${res.status}: ${text.slice(0, 200)}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      clearTimeout(tm);
      lastErr = err;
      if (attempt === 2) break;
      await sleep(600 * Math.pow(2, attempt));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Rork request failed");
}

export const rorkProvider: LlmProvider = {
  name: "rork",
  defaultModel: "anthropic/claude-haiku-4.5",
  defaultEmbedModel: "openai/text-embedding-3-small",

  async chat(params: LlmCallParams): Promise<string> {
    const body = {
      model: params.model ?? this.defaultModel,
      messages: params.messages,
      temperature: params.temperature ?? 0.7,
      max_tokens: params.maxTokens ?? 1200,
      ...(params.json ? { response_format: { type: "json_object" } } : {}),
    };
    const json = await request<{
      choices?: { message?: { content?: string } }[];
    }>(CHAT_URL, body);
    return json.choices?.[0]?.message?.content ?? "";
  },

  async embed(params: EmbedParams): Promise<number[][]> {
    const body = {
      model: params.model ?? this.defaultEmbedModel,
      input: params.input,
    };
    const json = await request<{ data?: { embedding: number[] }[] }>(
      EMBED_URL,
      body
    );
    return (json.data ?? []).map((d) => d.embedding);
  },
};
