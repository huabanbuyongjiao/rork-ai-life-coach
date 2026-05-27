/**
 * Intent classification. Uses the active LLM provider with a strict JSON
 * response so the Router can dispatch deterministically.
 */
import { chatJson } from "../llm";

export type Intent =
  | "task"
  | "goal"
  | "agent"
  | "memory"
  | "event"
  | "chat";

export type ClassifyResult = {
  intent: Intent;
  confidence: number; // 0..1
  entities: Record<string, string | number | boolean | null>;
  rationale: string;
};

const CLASSIFIER_PROMPT = `You are the Intent Classifier of an AI Life OS.
Given the user's natural-language input, return STRICT JSON only:

{
  "intent": "task" | "goal" | "agent" | "memory" | "event" | "chat",
  "confidence": 0..1,
  "entities": { ... extracted fields ... },
  "rationale": "one short sentence"
}

Rules:
- "task": short executable action (verb + object). e.g. "remind me to call mom".
- "goal": long-term direction. e.g. "I want to reach IELTS 7".
- "agent": persistent monitoring / tracking / multi-step pipeline. e.g. "keep watching for internship openings".
- "memory": stable fact / behavior / relation worth remembering. e.g. "my major is IMC".
- "event": time-bound calendar item. e.g. "meeting Thursday 3pm".
- "chat": everything else (questions, emotional venting, exploration).

NEVER classify a one-off emotional vent as task/memory. Use "chat".
Entities should include any of: title, time, duration, person, deadline, frequency.`;

export async function classify(input: string): Promise<ClassifyResult> {
  const result = await chatJson<ClassifyResult>({
    messages: [
      { role: "system", content: CLASSIFIER_PROMPT },
      { role: "user", content: input },
    ],
    temperature: 0.1,
    maxTokens: 400,
  });
  if (!result || !result.intent) {
    return {
      intent: "chat",
      confidence: 0.3,
      entities: {},
      rationale: "classifier fallback",
    };
  }
  return result;
}
