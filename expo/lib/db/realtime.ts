/**
 * Realtime subscription hooks. Each hook returns a live snapshot of one table
 * for the signed-in user, kept in sync via Supabase Postgres CDC.
 *
 * Wire these in providers / screens; they replace the in-memory state in
 * AuroraProvider for whichever entity you migrate first.
 */
import { useEffect, useState } from "react";
import { supabase } from "../supabase/client";
import { Agents, Conflicts, Events, Goals, Memory, Tasks } from "./repo";
import type {
  Agent,
  ConflictLog,
  EventRecord,
  Goal,
  MemoryNode,
  Task,
} from "./types";

type AnyRow = { id: string };

function applyChange<T extends AnyRow>(
  rows: T[],
  evt: "INSERT" | "UPDATE" | "DELETE",
  newRow: T | null,
  oldRow: T | null
): T[] {
  if (evt === "INSERT" && newRow) return [newRow, ...rows.filter((r) => r.id !== newRow.id)];
  if (evt === "UPDATE" && newRow)
    return rows.map((r) => (r.id === newRow.id ? newRow : r));
  if (evt === "DELETE" && oldRow) return rows.filter((r) => r.id !== oldRow.id);
  return rows;
}

function useLiveTable<T extends AnyRow>(
  table: string,
  initialFetch: () => Promise<T[]>
): { data: T[]; loading: boolean; error: Error | null } {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    initialFetch()
      .then((rows) => {
        if (!cancelled) {
          setData(rows);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e : new Error(String(e)));
          setLoading(false);
        }
      });

    const channel = supabase
      .channel(`rt_${table}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        (payload) => {
          setData((prev) =>
            applyChange(
              prev,
              payload.eventType as "INSERT" | "UPDATE" | "DELETE",
              (payload.new as T) ?? null,
              (payload.old as T) ?? null
            )
          );
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [table, initialFetch]);

  return { data, loading, error };
}

export function useLiveTasks() {
  return useLiveTable<Task>("tasks", Tasks.list);
}
export function useLiveGoals() {
  return useLiveTable<Goal>("goals", Goals.list);
}
export function useLiveAgents() {
  return useLiveTable<Agent>("agents", Agents.list);
}
export function useLiveMemory() {
  return useLiveTable<MemoryNode>("memory_nodes", () => Memory.list(200));
}
export function useLiveConflicts() {
  return useLiveTable<ConflictLog>("conflict_log", Conflicts.open);
}
export function useLiveEventsToday(): {
  data: EventRecord[];
  loading: boolean;
  error: Error | null;
} {
  const fetcher = async (): Promise<EventRecord[]> => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return Events.listInRange(start.toISOString(), end.toISOString());
  };
  return useLiveTable<EventRecord>("events", fetcher);
}
