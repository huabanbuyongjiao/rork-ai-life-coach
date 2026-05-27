# AI Life OS — Production Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Expo Client (React Native)                    │
│  ┌────────────┐  ┌──────────────┐  ┌─────────────────────────────┐  │
│  │  UI Layer  │──│  Orchestrator│──│  Realtime hooks (db/realtime)│  │
│  └────────────┘  └──────┬───────┘  └────────────┬────────────────┘  │
│                         │                       │                   │
│                  ┌──────▼──────┐         ┌──────▼──────┐            │
│                  │  llm/*      │         │  db/repo    │            │
│                  │ rork|openai │         │  (typed)    │            │
│                  └──────┬──────┘         └──────┬──────┘            │
└─────────────────────────┼────────────────────────┼──────────────────┘
                          │                        │
                  ┌───────▼────────┐       ┌───────▼────────────┐
                  │ Rork / OpenAI  │       │   Supabase         │
                  │   API          │       │  Postgres+pgvector │
                  └────────────────┘       │  Realtime (CDC)    │
                                           │  RLS auth.uid()    │
                                           └────────────────────┘
```

## One-time setup

1. **Supabase project** — already wired via `EXPO_PUBLIC_SUPABASE_URL` /
   `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
2. **Run schema** — open Supabase → SQL Editor → paste
   `lib/supabase/schema.sql` → Run. Idempotent; safe to re-run.
3. **Enable Realtime** — Dashboard → Database → Replication → enable for
   `tasks`, `goals`, `agents`, `events`, `memory_nodes`, `conflict_log`.
4. **Optional cron** — Dashboard → Database → Cron:
   ```sql
   select cron.schedule('decay_memory_daily', '0 4 * * *',
     $$select decay_memory()$$);
   ```
5. **LLM provider** — defaults to Rork toolkit. To use OpenAI directly set
   `EXPO_PUBLIC_LLM_PROVIDER=openai` + `EXPO_PUBLIC_OPENAI_API_KEY`. The
   provider can also be swapped at runtime via `setLlm("openai")`.

## How to use from a screen

```ts
import { Orchestrator } from "@/lib/orchestrator";
import { useLiveTasks } from "@/lib/db/realtime";

function HomeScreen() {
  const { data: tasks } = useLiveTasks();          // realtime
  async function onSend(text: string) {
    const r = await Orchestrator.run(text);        // classify→route→engine
    if (r.mode === "SUGGESTION" && r.proposal) {
      // show confirm UI, then:
      await Orchestrator.commit(r.proposal);
    }
  }
}
```

## Data flow (single user input)

```
text ──► classify()        # JSON: { intent, confidence, entities }
     ──► shape()           # JSON: typed payload for that intent
     ──► ConflictEngine.*  # dup / overlap / contradiction checks
     ──► <Engine>.create   # Tasks / Goals / Agents / Events / Memory
     ──► Realtime CDC      # all subscribed clients update instantly
     ──► AuditLog.write    # orchestrator_log row for observability
```

## Conflict policy

The orchestrator NEVER auto-overwrites. On conflict it writes a row to
`conflict_log` with `options[]` and returns a `SUGGESTION` so the UI can
ask the user which `options[i].id` to commit.

## Agent Runtime (NEW)

`AgentRuntime` is the LLM-powered execution loop that makes Agents actually
*run* — not just tick timestamps. Each tick loads the agent's full context
(linked memory, goals, tasks), calls the LLM to decide next actions, and
applies outputs (new tasks, memory updates, insights, state changes).

### Client-side manual trigger

```ts
import { AgentRuntime } from "@/lib/orchestrator";

// Tick one agent
const result = await AgentRuntime.execute(agentId);
// result: { agentId, newState, summary, createdTaskIds, updatedMemoryIds, insight, nextUpdate }

// Tick all due agents
const results = await AgentRuntime.tickAll();
```

### Server-side autonomous ticks

The Agent Runner Edge Function (`lib/supabase/agent-edge-function.ts`)
processes ALL due agents across ALL users via Supabase's service_role key.

**Deployment steps:**

1. **Deploy the edge function:**
   ```bash
   supabase functions deploy agent-runner
   ```
   Copy `lib/supabase/agent-edge-function.ts` → `supabase/functions/agent-runner/index.ts`
   before deploying (the Rork project structure differs from Supabase CLI structure).

2. **Set edge function secrets** (Supabase Dashboard → Edge Functions → agent-runner):
   - `LLM_CHAT_URL` — OpenAI-compatible endpoint (e.g. Rork toolkit)
   - `LLM_API_KEY` — API key for the LLM endpoint
   - `LLM_MODEL` — model name (default: `gpt-4o-mini`)
   - `AGENT_RUNNER_SECRET` — shared secret for HTTP auth

3. **Enable pg_net extension** (Dashboard → Database → Extensions → pg_net).
   This allows `pg_cron` jobs to make HTTP requests to the edge function.

4. **Configure app settings** (SQL Editor):
   ```sql
   -- Replace with your actual edge function URL (from Supabase Dashboard)
   alter database postgres set app.agent_runner_url = 'https://<project>.functions.supabase.co/agent-runner';
   alter database postgres set app.agent_runner_secret = '<your AGENT_RUNNER_SECRET>';
   ```

5. **Schedule the tick job** (SQL Editor):
   ```sql
   -- Every minute for real-time agents; change cron to '*/5 * * * *' for less frequent
   select cron.schedule('agent_tick_minutely', '* * * * *', $select invoke_agent_runner()$);

   -- Auto-pause stale agents daily
   select cron.schedule('pause_stale_agents_daily', '30 4 * * *', $select pause_stale_agents()$);

   -- Auto-complete agents whose goal reached 100%
   select cron.schedule('complete_satisfied_agents_daily', '45 4 * * *', $select complete_satisfied_agents()$);
   ```

### Agent lifecycle enforcement

Three scheduled DB functions keep the agent system healthy:

| Function | Trigger | What it does |
|---|---|---|
| `pause_stale_agents()` | Daily 4:30am | Pauses agents with no activity for 7 days |
| `complete_satisfied_agents()` | Daily 4:45am | Completes agents whose linked goal hit 100% |
| `decay_memory()` | Daily 4:00am | Decays confidence of untouched memories |

These prevent the "zombie agent" problem — agents that stay `active` forever
but never produce value.
