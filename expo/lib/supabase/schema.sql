-- ============================================================================
-- AI Life OS — Production Postgres Schema (Supabase)
-- ----------------------------------------------------------------------------
-- Run this once in Supabase SQL Editor. Idempotent (uses IF NOT EXISTS).
-- Requires: pgvector, pg_trgm. Both available on Supabase free tier.
-- ============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";
create extension if not exists "vector";

-- ---------- Enums ----------------------------------------------------------
do $$ begin
  create type task_status   as enum ('pending','doing','done','archived');
  create type task_priority as enum ('low','medium','high');
  create type goal_horizon  as enum ('short','medium','long');
  create type agent_type    as enum ('research','execution','monitoring','optimization');
  create type agent_state   as enum ('created','active','running','paused','completed','failed');
  create type agent_cycle   as enum ('real_time','event_triggered','daily','weekly');
  create type memory_type   as enum ('fact','behavior','relation','insight');
  create type event_source  as enum ('user','system','import','ai');
  create type conflict_kind as enum ('task_task','task_event','goal_goal','agent_agent','memory_memory','time_overlap');
  create type conflict_status as enum ('open','resolved','dismissed');
exception when duplicate_object then null; end $$;

-- ---------- Core tables ----------------------------------------------------
create table if not exists tasks (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  title         text not null,
  description   text,
  status        task_status not null default 'pending',
  priority      task_priority not null default 'medium',
  linked_goal_id uuid,
  estimated_minutes int,
  deadline      timestamptz,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists goals (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  title         text not null,
  rationale     text,
  horizon       goal_horizon not null default 'medium',
  progress      real not null default 0 check (progress between 0 and 1),
  parent_goal_id uuid references goals(id) on delete set null,
  locked        boolean not null default false,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table tasks
  add constraint tasks_linked_goal_fk
  foreign key (linked_goal_id) references goals(id) on delete set null
  deferrable initially deferred
  not valid;
alter table tasks validate constraint tasks_linked_goal_fk;

create table if not exists agents (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  objective     text not null,
  type          agent_type not null default 'monitoring',
  state         agent_state not null default 'created',
  priority      task_priority not null default 'medium',
  linked_goal_id uuid references goals(id) on delete set null,
  update_cycle  agent_cycle not null default 'event_triggered',
  confidence    real not null default 0.6 check (confidence between 0 and 1),
  input_stream  jsonb not null default '[]'::jsonb,
  output_stream jsonb not null default '[]'::jsonb,
  memory_links  uuid[] not null default '{}',
  last_update   timestamptz,
  next_update   timestamptz,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists events (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  title         text not null,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  source        event_source not null default 'user',
  external_id   text,
  locked        boolean not null default false,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (ends_at >= starts_at)
);

-- Memory Graph: nodes carry typed payloads + 1536-d embeddings (OpenAI small).
create table if not exists memory_nodes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  type          memory_type not null,
  content       text not null,
  confidence    real not null default 0.5 check (confidence between 0 and 1),
  decay_rate    real not null default 0.02, -- per day
  source        text,
  evidence_count int not null default 1,
  last_seen_at  timestamptz not null default now(),
  embedding     vector(1536),
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Edges form the graph (fact->behavior, behavior->insight, etc.)
create table if not exists memory_edges (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references auth.users(id) on delete cascade,
  from_node uuid not null references memory_nodes(id) on delete cascade,
  to_node   uuid not null references memory_nodes(id) on delete cascade,
  relation  text not null,
  weight    real not null default 0.5,
  created_at timestamptz not null default now(),
  unique (from_node, to_node, relation)
);

create table if not exists conflict_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        conflict_kind not null,
  severity    real not null default 0.5 check (severity between 0 and 1),
  status      conflict_status not null default 'open',
  subject_ids uuid[] not null,
  options     jsonb not null default '[]'::jsonb,
  resolution  jsonb,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);

-- Append-only orchestrator audit trail (for observability & rollback).
create table if not exists orchestrator_log (
  id         bigserial primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  input      text not null,
  intent     text not null,
  confidence real,
  mode       text not null,        -- CHAT | SUGGESTION | SYSTEM_ACTION_REQUEST
  action     jsonb not null default '{}'::jsonb,
  rationale  text,
  created_at timestamptz not null default now()
);

-- ---------- Indexes --------------------------------------------------------
create index if not exists idx_tasks_user_status  on tasks(user_id, status);
create index if not exists idx_tasks_deadline     on tasks(user_id, deadline);
create index if not exists idx_tasks_goal         on tasks(linked_goal_id);
create index if not exists idx_goals_user         on goals(user_id);
create index if not exists idx_agents_user_state  on agents(user_id, state);
create index if not exists idx_agents_next_update on agents(next_update) where state in ('active','running');
create index if not exists idx_events_user_time   on events(user_id, starts_at);
create index if not exists idx_memory_user_type   on memory_nodes(user_id, type);
create index if not exists idx_memory_trgm        on memory_nodes using gin (content gin_trgm_ops);
create index if not exists idx_memory_embedding   on memory_nodes using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index if not exists idx_conflict_open      on conflict_log(user_id, status) where status = 'open';

-- ---------- Updated-at trigger --------------------------------------------
create or replace function touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end $$ language plpgsql;

do $$ declare t text;
begin
  foreach t in array array['tasks','goals','agents','events','memory_nodes'] loop
    execute format(
      'drop trigger if exists trg_touch_%1$s on %1$s;
       create trigger trg_touch_%1$s before update on %1$s
       for each row execute function touch_updated_at();', t);
  end loop;
end $$;

-- ---------- Row Level Security --------------------------------------------
alter table tasks            enable row level security;
alter table goals            enable row level security;
alter table agents           enable row level security;
alter table events           enable row level security;
alter table memory_nodes     enable row level security;
alter table memory_edges     enable row level security;
alter table conflict_log     enable row level security;
alter table orchestrator_log enable row level security;

do $$ declare t text;
begin
  foreach t in array array[
    'tasks','goals','agents','events',
    'memory_nodes','memory_edges','conflict_log','orchestrator_log'
  ] loop
    execute format(
      'drop policy if exists "%1$s_owner_all" on %1$s;
       create policy "%1$s_owner_all" on %1$s
       for all using (user_id = auth.uid()) with check (user_id = auth.uid());', t);
  end loop;
end $$;

-- ---------- Memory similarity search RPC ----------------------------------
create or replace function match_memory(
  query_embedding vector(1536),
  match_threshold real default 0.78,
  match_count     int  default 8
) returns table (
  id uuid, type memory_type, content text,
  confidence real, similarity real
) language sql stable as $
  select m.id, m.type, m.content, m.confidence,
         1 - (m.embedding <=> query_embedding) as similarity
  from memory_nodes m
  where m.user_id = auth.uid()
    and m.embedding is not null
    and 1 - (m.embedding <=> query_embedding) > match_threshold
  order by m.embedding <=> query_embedding
  limit match_count;
$;

-- Typed similarity search: restrict to one node type (fact/behavior/relation/insight)
create or replace function match_memory_typed(
  query_embedding vector(1536),
  node_type       memory_type,
  match_threshold real default 0.78,
  match_count     int  default 8
) returns table (
  id uuid, content text, confidence real, similarity real
) language sql stable as $
  select m.id, m.content, m.confidence,
         1 - (m.embedding <=> query_embedding) as similarity
  from memory_nodes m
  where m.user_id = auth.uid()
    and m.type    = node_type
    and m.embedding is not null
    and 1 - (m.embedding <=> query_embedding) > match_threshold
  order by m.embedding <=> query_embedding
  limit match_count;
$;

-- Graph traversal: 1-hop neighbours of a node, with edge metadata.
create or replace function memory_neighbors(
  root_id uuid,
  max_hops int default 1,
  max_nodes int default 32
) returns table (
  id uuid, type memory_type, content text, confidence real,
  hop int, relation text, weight real
) language sql stable as $
  with recursive walk as (
    select n.id, n.type, n.content, n.confidence,
           0::int as hop, ''::text as relation, 1.0::real as weight
    from memory_nodes n
    where n.id = root_id and n.user_id = auth.uid()
    union all
    select n.id, n.type, n.content, n.confidence,
           walk.hop + 1, e.relation, e.weight
    from walk
    join memory_edges e on e.from_node = walk.id and e.user_id = auth.uid()
    join memory_nodes n on n.id = e.to_node and n.user_id = auth.uid()
    where walk.hop < max_hops
  )
  select * from walk
  order by hop, weight desc
  limit max_nodes;
$;

-- ---------- Memory decay + cleanup -----------------------------------------
-- Apply per-node exponential decay based on time since last_seen_at.
-- Formula:  confidence *= exp(-decay_rate * days_since_seen)
-- decay_rate is a per-day constant stored on the node (default 0.02 ≈ 50% in ~35d).
create or replace function decay_memory() returns int language plpgsql as $
declare touched int;
begin
  with updated as (
    update memory_nodes m
       set confidence = greatest(
             0,
             m.confidence * exp(
               -1 * m.decay_rate *
               extract(epoch from (now() - m.last_seen_at)) / 86400.0
             )
           ),
           updated_at = now()
     where m.last_seen_at < now() - interval '1 day'
     returning 1
  )
  select count(*) into touched from updated;
  return touched;
end;
$;

-- Prune nodes that have decayed below the visibility floor and have no edges.
-- Edges anchor a node into the graph — only orphan low-confidence nodes go.
create or replace function prune_low_confidence(
  floor_confidence real default 0.15
) returns int language plpgsql as $
declare removed int;
begin
  with del as (
    delete from memory_nodes m
     where m.confidence < floor_confidence
       and not exists (
         select 1 from memory_edges e
          where e.from_node = m.id or e.to_node = m.id
       )
     returning 1
  )
  select count(*) into removed from del;
  return removed;
end;
$;

-- Reinforce a node atomically (cheaper than the JS round-trip).
create or replace function reinforce_memory(
  node_id uuid,
  gain real default 0.08
) returns void language sql as $
  update memory_nodes
     set confidence     = least(1, confidence + gain),
         evidence_count = evidence_count + 1,
         last_seen_at   = now()
   where id = node_id and user_id = auth.uid();
$;

-- ---------- Agent lifecycle helpers -----------------------------------------

-- Auto-pause agents that haven't been updated in 7 days (prevents stale agents).
create or replace function pause_stale_agents() returns void language sql as $
  update agents
     set state = 'paused',
         last_update = now(),
         output_stream = output_stream || jsonb_build_array(
           jsonb_build_object('at', now(), 'state', 'paused', 'summary', 'Auto-paused: no activity for 7 days')
         )
   where state in ('active','running')
     and (last_update is null or last_update < now() - interval '7 days');
$;

-- Auto-complete agents whose linked goal reached 100% progress.
create or replace function complete_satisfied_agents() returns void language sql as $
  update agents a
     set state = 'completed',
         confidence = 1,
         last_update = now(),
         output_stream = output_stream || jsonb_build_array(
           jsonb_build_object('at', now(), 'state', 'completed', 'summary', 'Auto-completed: linked goal reached 100%')
         )
   from goals g
  where a.linked_goal_id = g.id
    and a.state in ('active','running')
    and g.progress >= 1.0;
$;

-- Invoke the Agent Runner Edge Function via HTTP.
-- Requires pg_net extension enabled (Supabase Dashboard → Database → Extensions).
create or replace function invoke_agent_runner() returns void language plpgsql as $
declare
  fn_url  text;
  fn_key  text;
begin
  -- Read secrets stored as vault secrets or custom settings.
  -- Replace these with your actual edge function URL and shared secret.
  fn_url := current_setting('app.agent_runner_url', true);
  fn_key := current_setting('app.agent_runner_secret', true);
  if fn_url is null or fn_url = '' then
    raise notice 'agent_runner_url not configured — skipping agent tick';
    return;
  end if;
  -- pg_net.http_post requires the pg_net extension.
  perform net.http_post(
    url := fn_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', coalesce(fn_key, '')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
end;
$;

-- ---------- Scheduled jobs (pg_cron) ----------------------------------------
-- Run once in Supabase SQL Editor AFTER enabling pg_cron and pg_net:
--
-- Memory decay: runs daily at 4am UTC
-- select cron.schedule('decay_memory_daily', '0 4 * * *', $select decay_memory()$);
--
-- Memory prune (orphan low-confidence nodes): runs weekly Sunday 4:15am UTC
-- select cron.schedule('prune_memory_weekly', '15 4 * * 0', $select prune_low_confidence()$);
--
-- Stale agent cleanup: runs daily at 4:30am UTC
-- select cron.schedule('pause_stale_agents_daily', '30 4 * * *', $select pause_stale_agents()$);
--
-- Goal-satisfied agent completion: runs daily at 4:45am UTC
-- select cron.schedule('complete_satisfied_agents_daily', '45 4 * * *', $select complete_satisfied_agents()$);
--
-- Agent tick (invoke edge function): every minute for real-time agents
-- select cron.schedule('agent_tick_minutely', '* * * * *', $select invoke_agent_runner()$);
