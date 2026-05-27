import { openaiProvider } from "./openai";
import { rorkProvider } from "./rork";
import type { LlmCallParams, LlmProvider } from "./types";

export type { LlmMessage, LlmCallParams, LlmProvider } from "./types";

type ProviderName = "rork" | "openai";

const providers: Record<ProviderName, LlmProvider> = {
  rork: rorkProvider,
  openai: openaiProvider,
};

const DEFAULT: ProviderName =
  (process.env.EXPO_PUBLIC_LLM_PROVIDER as ProviderName) || "rork";

let active: LlmProvider = providers[DEFAULT] ?? rorkProvider;

export function getLlm(): LlmProvider {
  return active;
}

export function setLlm(name: ProviderName): void {
  active = providers[name];
}

/** Convenience: ask the active provider for a strict JSON object. */
export async function chatJson<T>(params: LlmCallParams): Promise<T | null> {
  const raw = await active.chat({
    ...params,
    temperature: params.temperature ?? 0.2,
    json: true,
  });
  const cleaned = raw
    .replace(/^```(?:json)?/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
