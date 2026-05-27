/**
 * LLM provider abstraction — same shape as OpenAI chat completions so
 * Orchestrator code never cares which backend is wired up.
 */
export type LlmRole = "system" | "user" | "assistant";

export type LlmMessage = {
  role: LlmRole;
  content: string;
};

export type LlmCallParams = {
  messages: LlmMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Force JSON-only output when supported. */
  json?: boolean;
};

export type EmbedParams = {
  input: string | string[];
  model?: string;
};

export interface LlmProvider {
  readonly name: string;
  /** Default chat model identifier. */
  readonly defaultModel: string;
  /** Default embedding model identifier (1536-d to match schema). */
  readonly defaultEmbedModel: string;
  chat(params: LlmCallParams): Promise<string>;
  embed(params: EmbedParams): Promise<number[][]>;
}
