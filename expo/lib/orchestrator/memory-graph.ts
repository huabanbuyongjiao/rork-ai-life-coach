/**
 * Memory Graph — the Living Semantic Graph layer.
 *
 *   ingest()    → embed → similarity probe → LLM judge (reinforce | contradict |
 *                 related | new) → write node + edges + (optional) conflict log
 *   neighbors() → 1-hop graph traversal (uses Postgres recursive CTE)
 *   decay()     → server-side exponential decay + orphan prune
 *   derive()    → cluster behaviour nodes into Insight nodes when ≥3 evidence
 *
 * The orchestrator's MemoryEngine.ingest() now delegates here.
 */
import { Memory } from "../db/repo";
import { supabase } from "../supabase/client";
import type { MemoryNode, MemoryType } from "../db/types";
import { chatJson, getLlm } from "../llm";

// ---------- Types ----------------------------------------------------------
export type IngestInput = {
  type: MemoryType;
  content: string;
  source?: string;
  confidence?: number;
};

export type IngestResult =
  | { action: "reinforced"; node: MemoryNode | null; targetId: string }
  | { action: "contradicted"; node: MemoryNode | null; targetId: string }
  | { action: "linked"; node: MemoryNode; edges: number }
  | { action: "created"; node: MemoryNode };

export type SimilarHit = {
  id: string;
  type: MemoryType;
  content: string;
  confidence: number;
  similarity: number;
};

export type NeighborHit = {
  id: string;
  type: MemoryType;
  content: string;
  confidence: number;
  hop: number;
  relation: string;
  weight: number;
};

type LlmJudgement = {
  /** How the new content relates to the candidate. */
  relation: "reinforce" | "contradict" | "elaborate" | "unrelated";
  /** 0..1 — how confident the judge is. */
  confidence: number;
  /** Short rationale, used as the edge label when relation = elaborate. */
  edge_label?: string;
};

// ---------- Thresholds -----------------------------------------------------
const SIM_REINFORCE = 0.92; // identical meaning
const SIM_JUDGE = 0.78; // worth asking the LLM about
const SIM_NEIGHBOR = 0.7; // worth linking as related

const JUDGE_PROMPT = `You compare two short memory snippets about the same user
and decide their relationship. Return STRICT JSON:

{
  "relation": "reinforce" | "contradict" | "elaborate" | "unrelated",
  "confidence": 0.0..1.0,
  "edge_label": "short relation label, lowercase, e.g. 'supports' | 'refines' | 'caused_by'"
}

Rules:
- "reinforce"  = same fact / pattern, possibly different wording
- "contradict" = directly opposing claims about the same subject
- "elaborate"  = related, one extends or specifies the other
- "unrelated"  = same topic words but different subject
Never invent context.`;

async function judge(
  fresh: string,
  candidate: string
): Promise<LlmJudgement | null> {
  return chatJson<LlmJudgement>({
    messages: [
      { role: "system", content: JUDGE_PROMPT },
      {
        role: "user",
        content: `NEW:\n${fresh}\n\nEXISTING:\n${candidate}`,
      },
    ],
    temperature: 0.1,
    maxTokens: 200,
  });
}

// ---------- Public API -----------------------------------------------------
export const MemoryGraph = {
  async ingest(input: IngestInput): Promise<IngestResult> {
    const llm = getLlm();
    const [embedding] = await llm.embed({ input: input.content });

    // 1. Probe semantically-similar existing nodes.
    const hits = await Memory.similar(embedding, 5, SIM_JUDGE);

    // 2. Pure-text identical → fast reinforce path, no LLM call.
    const exact = hits.find((h) => h.similarity >= SIM_REINFORCE);
    if (exact) {
      await reinforceServerSide(exact.id);
      return { action: "reinforced", node: null, targetId: exact.id };
    }

    // 3. Borderline → ask LLM if it's reinforce / contradict / elaborate.
    if (hits.length > 0) {
      const top = hits[0];
      const verdict = await judge(input.content, top.content);
      if (verdict?.relation === "reinforce" && verdict.confidence >= 0.6) {
        await reinforceServerSide(top.id);
        return { action: "reinforced", node: null, targetId: top.id };
      }
      if (verdict?.relation === "contradict" && verdict.confidence >= 0.6) {
        // Soften BOTH sides — system never picks a side on its own.
        await Memory.update(top.id, {
          confidence: Math.max(0, top.confidence * 0.7),
        });
        const node = await Memory.create({
          ...input,
          embedding,
          confidence: Math.min(input.confidence ?? 0.6, 0.5),
        });
        // Conflict log entry so the UI can ask the user to choose.
        await supabase.from("conflict_log").insert({
          user_id: node.user_id,
          kind: "memory_memory",
          severity: 0.6 + verdict.confidence * 0.3,
          subject_ids: [top.id, node.id],
          options: [
            { id: "keep_old", label: `Keep: "${top.content.slice(0, 80)}"`, action: { drop: node.id } },
            { id: "keep_new", label: `Keep: "${node.content.slice(0, 80)}"`, action: { drop: top.id } },
            { id: "keep_both", label: "Keep both (low confidence)", action: {} },
          ],
        });
        return { action: "contradicted", node, targetId: top.id };
      }
    }

    // 4. Not duplicate / not contradiction → create new node.
    const node = await Memory.create({
      ...input,
      embedding,
      confidence: input.confidence ?? 0.6,
    });

    // 5. Link to related neighbours so we never leave orphan nodes.
    const neighbours = hits.filter((h) => h.similarity >= SIM_NEIGHBOR && h.id !== node.id);
    let edges = 0;
    for (const n of neighbours.slice(0, 4)) {
      const rel = pickRelation(input.type, n.type);
      const e = await Memory.addEdge(node.id, n.id, rel, n.similarity);
      if (e) edges += 1;
    }

    if (edges > 0) {
      return { action: "linked", node, edges };
    }
    return { action: "created", node };
  },

  /** 1-hop graph view rooted at a node (uses Postgres recursive CTE). */
  async neighbors(rootId: string, hops = 1, limit = 32): Promise<NeighborHit[]> {
    const { data, error } = await supabase.rpc("memory_neighbors", {
      root_id: rootId,
      max_hops: hops,
      max_nodes: limit,
    });
    if (error) throw error;
    return (data ?? []) as NeighborHit[];
  },

  /** Pull all nodes of a given type, ranked by similarity to a free-text query. */
  async search(
    query: string,
    type?: MemoryType,
    k = 8,
    threshold = SIM_JUDGE
  ): Promise<SimilarHit[]> {
    const llm = getLlm();
    const [embedding] = await llm.embed({ input: query });
    if (type) {
      const { data, error } = await supabase.rpc("match_memory_typed", {
        query_embedding: embedding,
        node_type: type,
        match_threshold: threshold,
        match_count: k,
      });
      if (error) throw error;
      return (data ?? []).map((d: { id: string; content: string; confidence: number; similarity: number }) => ({
        id: d.id,
        type,
        content: d.content,
        confidence: d.confidence,
        similarity: d.similarity,
      }));
    }
    return Memory.similar(embedding, k, threshold) as Promise<SimilarHit[]>;
  },

  /** Run server-side exponential decay. Safe to call client-side; cron does it too. */
  async decay(): Promise<number> {
    const { data, error } = await supabase.rpc("decay_memory");
    if (error) throw error;
    return (data as number | null) ?? 0;
  },

  /** Drop orphan low-confidence nodes (confidence < floor and no edges). */
  async prune(floor = 0.15): Promise<number> {
    const { data, error } = await supabase.rpc("prune_low_confidence", {
      floor_confidence: floor,
    });
    if (error) throw error;
    return (data as number | null) ?? 0;
  },

  /**
   * Derive Insight nodes from clusters of Behavior nodes.
   * Requires ≥3 high-confidence behaviour nodes that the LLM groups into a
   * single pattern. Each new insight is linked back to its evidence edges.
   */
  async deriveInsights(): Promise<MemoryNode[]> {
    const behaviours = (await Memory.list(50)).filter(
      (n) => n.type === "behavior" && n.confidence >= 0.55
    );
    if (behaviours.length < 3) return [];

    const prompt = `You are reviewing behavioural patterns about a single user.
Return STRICT JSON with up to 3 high-level insights, each backed by ≥2 evidence
ids from the input list. Never invent ids. If nothing rises above noise, return
{"insights":[]}.

Schema:
{ "insights": [ { "content": str, "confidence": 0..1, "evidence_ids": [str] } ] }`;

    const result = await chatJson<{
      insights: { content: string; confidence: number; evidence_ids: string[] }[];
    }>({
      messages: [
        { role: "system", content: prompt },
        {
          role: "user",
          content: JSON.stringify(
            behaviours.map((b) => ({ id: b.id, content: b.content, confidence: b.confidence }))
          ),
        },
      ],
      temperature: 0.3,
      maxTokens: 700,
    });

    const insights = result?.insights ?? [];
    const created: MemoryNode[] = [];
    const validIds = new Set(behaviours.map((b) => b.id));

    for (const ins of insights) {
      const evidence = ins.evidence_ids.filter((id) => validIds.has(id));
      if (evidence.length < 2) continue;

      // Skip if an equivalent insight already exists.
      const llm = getLlm();
      const [embedding] = await llm.embed({ input: ins.content });
      const existing = await Memory.similar(embedding, 1, SIM_REINFORCE);
      if (existing.length > 0 && existing[0].similarity >= SIM_REINFORCE) {
        await reinforceServerSide(existing[0].id);
        continue;
      }

      const node = await Memory.create({
        type: "insight",
        content: ins.content,
        confidence: Math.min(0.85, Math.max(0.5, ins.confidence)),
        embedding,
        source: "auto_derived",
      });
      for (const evId of evidence) {
        await Memory.addEdge(node.id, evId, "evidence", 0.8);
      }
      created.push(node);
    }
    return created;
  },
};

// ---------- Helpers --------------------------------------------------------
/** Atomic reinforce via SQL function — single round-trip, no race window. */
async function reinforceServerSide(nodeId: string, gain = 0.08): Promise<void> {
  const { error } = await supabase.rpc("reinforce_memory", {
    node_id: nodeId,
    gain,
  });
  // Fallback to JS path if the SQL fn isn't installed yet.
  if (error) await Memory.reinforce(nodeId, gain);
}

/** Pick a sensible edge label given the two node types. */
function pickRelation(from: MemoryType, to: MemoryType): string {
  if (from === "fact" && to === "behavior") return "supports";
  if (from === "behavior" && to === "insight") return "evidence";
  if (from === "relation" && to === "behavior") return "involves";
  if (from === "insight" && to === "fact") return "explains";
  if (from === to) return "related";
  return "related";
}
