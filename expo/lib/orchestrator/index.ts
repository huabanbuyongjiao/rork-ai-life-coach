/**
 * Orchestrator — the top-level kernel.
 *
 *   User input ──► classify ──► route ──► engine.execute ──► conflict check
 *                                                           │
 *                                                           ▼
 *                                                  Suggestion | Write | Chat
 *
 * Every call writes one row to `orchestrator_log` for full auditability.
 */
import { AuditLog } from "../db/repo";
import { chatJson, getLlm } from "../llm";
import { classify, type ClassifyResult, type Intent } from "./classifier";
import {
  AgentEngine,
  EventEngine,
  GoalEngine,
  MemoryEngine,
  TaskEngine,
} from "./engines";
import { AgentRuntime } from "./agent-runtime";
import { MemoryGraph } from "./memory-graph";
import { ConflictResolver } from "./conflict-resolver";

export {
  AgentRuntime,
  AgentEngine,
  ConflictResolver,
  EventEngine,
  GoalEngine,
  MemoryEngine,
  MemoryGraph,
  TaskEngine,
};
export type { ResolutionOutcome } from "./conflict-resolver";
export type {
  IngestResult,
  NeighborHit,
  SimilarHit,
} from "./memory-graph";

export type Mode = "CHAT" | "SUGGESTION" | "SYSTEM_ACTION_REQUEST";

export type OrchestratorResult = {
  mode: Mode;
  intent: Intent;
  confidence: number;
  /** Human-facing message for the chat UI. */
  message: string;
  /** Suggested action(s) the UI should surface for user confirmation. */
  proposal?: {
    kind: "task" | "goal" | "agent" | "event" | "memory";
    payload: Record<string, unknown>;
  };
  /** When mode === SYSTEM_ACTION_REQUEST, the entity id that was written. */
  writtenId?: string;
  rationale: string;
};

export type RunOptions = {
  /**
   * When true, the orchestrator will write SUGGESTIONs straight to the DB
   * (auto-confirm mode). When false (default) it stops at the SUGGESTION
   * stage and returns a proposal for the UI to confirm.
   */
  autoConfirm?: boolean;
};

const SHAPE_PROMPT = `You convert the user input into a STRICT JSON payload for
the AI Life OS engine. Output ONLY JSON. Schema depends on the given intent.

intent=task:    { "title": str, "description"?: str, "priority"?: "low"|"medium"|"high", "estimated_minutes"?: int, "deadline"?: ISO8601 }
intent=goal:    { "title": str, "rationale"?: str, "horizon"?: "short"|"medium"|"long" }
intent=agent:   { "objective": str, "type"?: "research"|"execution"|"monitoring"|"optimization", "update_cycle"?: "real_time"|"event_triggered"|"daily"|"weekly" }
intent=event:   { "title": str, "starts_at": ISO8601, "ends_at": ISO8601 }
intent=memory:  { "type": "fact"|"behavior"|"relation"|"insight", "content": str, "confidence"?: 0..1 }
intent=chat:    { "reply": str }

Be concise. Never invent dates the user didn't give — leave the field out.`;

async function shape<T>(intent: Intent, input: string): Promise<T | null> {
  return chatJson<T>({
    messages: [
      { role: "system", content: SHAPE_PROMPT },
      { role: "user", content: `intent=${intent}\n\n${input}` },
    ],
    temperature: 0.2,
    maxTokens: 600,
  });
}

export const Orchestrator = {
  async run(
    userInput: string,
    options: RunOptions = {}
  ): Promise<OrchestratorResult> {
    const intentRes: ClassifyResult = await classify(userInput);
    const { intent, confidence, rationale } = intentRes;

    // ---- chat: just return a conversational reply --------------------------
    if (intent === "chat") {
      const llm = getLlm();
      const reply = await llm.chat({
        messages: [
          {
            role: "system",
            content:
              "You are a calm AI life OS assistant. Respond briefly. Do not propose system writes unless the user asks.",
          },
          { role: "user", content: userInput },
        ],
        temperature: 0.6,
        maxTokens: 600,
      });
      const out: OrchestratorResult = {
        mode: "CHAT",
        intent,
        confidence,
        message: reply,
        rationale,
      };
      await AuditLog.write({
        input: userInput,
        intent,
        confidence,
        mode: out.mode,
        action: {},
        rationale,
      }).catch(() => undefined);
      return out;
    }

    // ---- shape payload -----------------------------------------------------
    const payload = await shape<Record<string, unknown>>(intent, userInput);
    if (!payload) {
      return {
        mode: "CHAT",
        intent: "chat",
        confidence: 0.4,
        message: "I couldn't structure that — could you rephrase?",
        rationale: "shape() returned null",
      };
    }

    // ---- low confidence → always propose, never auto-write -----------------
    const shouldAutoWrite =
      options.autoConfirm === true && confidence >= 0.75;

    if (!shouldAutoWrite) {
      const out: OrchestratorResult = {
        mode: "SUGGESTION",
        intent,
        confidence,
        message: buildSuggestionMessage(intent, payload),
        proposal: { kind: intent, payload },
        rationale,
      };
      await AuditLog.write({
        input: userInput,
        intent,
        confidence,
        mode: out.mode,
        action: payload,
        rationale,
      }).catch(() => undefined);
      return out;
    }

    // ---- execute write -----------------------------------------------------
    const result = await Orchestrator.commit({ kind: intent, payload });
    await AuditLog.write({
      input: userInput,
      intent,
      confidence,
      mode: "SYSTEM_ACTION_REQUEST",
      action: { payload, result },
      rationale,
    }).catch(() => undefined);
    return {
      mode: "SYSTEM_ACTION_REQUEST",
      intent,
      confidence,
      message: result.message,
      writtenId: result.writtenId,
      rationale,
    };
  },

  /** Apply a previously-suggested proposal (user confirmed in the UI). */
  async commit(proposal: {
    kind: Intent;
    payload: Record<string, unknown>;
  }): Promise<{ message: string; writtenId?: string }> {
    switch (proposal.kind) {
      case "task": {
        const { task, conflict } = await TaskEngine.create(
          proposal.payload as Parameters<typeof TaskEngine.create>[0]
        );
        if (!task) {
          return {
            message: `Found a similar open task "${conflict?.title}". Logged a conflict for review.`,
          };
        }
        return { message: `Task added: ${task.title}`, writtenId: task.id };
      }
      case "goal": {
        const goal = await GoalEngine.create(
          proposal.payload as Parameters<typeof GoalEngine.create>[0]
        );
        return { message: `Goal added: ${goal.title}`, writtenId: goal.id };
      }
      case "agent": {
        const { agent, merged_into } = await AgentEngine.spawn(
          proposal.payload as Parameters<typeof AgentEngine.spawn>[0]
        );
        if (!agent && merged_into) {
          return {
            message: `Merged into existing agent "${merged_into.objective}".`,
            writtenId: merged_into.id,
          };
        }
        return {
          message: `Agent spawned: ${agent?.objective ?? ""}`,
          writtenId: agent?.id,
        };
      }
      case "event": {
        const { event, overlaps } = await EventEngine.create(
          proposal.payload as Parameters<typeof EventEngine.create>[0]
        );
        if (!event) {
          return {
            message: `Time overlaps with ${overlaps.length} existing event(s). Logged a conflict.`,
          };
        }
        return { message: `Event added: ${event.title}`, writtenId: event.id };
      }
      case "memory": {
        const { node, reinforced } = await MemoryEngine.ingest(
          proposal.payload as Parameters<typeof MemoryEngine.ingest>[0]
        );
        if (reinforced) {
          return { message: "Reinforced an existing memory.", writtenId: reinforced };
        }
        return {
          message: `Stored memory: ${(proposal.payload as { content?: string }).content?.slice(0, 60) ?? ""}`,
          writtenId: node?.id,
        };
      }
      default:
        return { message: "Nothing to commit." };
    }
  },
};

function buildSuggestionMessage(
  intent: Intent,
  payload: Record<string, unknown>
): string {
  const p = payload as Record<string, string | undefined>;
  switch (intent) {
    case "task":
      return `Add task "${p.title ?? ""}"?`;
    case "goal":
      return `Track goal "${p.title ?? ""}"?`;
    case "agent":
      return `Spawn agent: ${p.objective ?? ""}?`;
    case "event":
      return `Schedule "${p.title ?? ""}" from ${p.starts_at ?? "?"} to ${p.ends_at ?? "?"}?`;
    case "memory":
      return `Remember: ${p.content ?? ""}?`;
    default:
      return "Proposal";
  }
}
