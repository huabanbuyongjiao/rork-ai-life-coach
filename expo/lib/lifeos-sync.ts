import type { LifeOSStoredIntake } from "@/lib/lifeos-api";

const API_BASE_URL = process.env.EXPO_PUBLIC_LIFEOS_API_BASE_URL;
const SYNC_TOKEN = process.env.EXPO_PUBLIC_LIFEOS_SYNC_TOKEN;

export function isLifeOSSyncConfigured(): boolean {
  return !!API_BASE_URL;
}

export async function fetchExternalIntakes(): Promise<LifeOSStoredIntake[]> {
  if (!API_BASE_URL) return [];
  const res = await fetch(`${API_BASE_URL.replace(/\/$/, "")}/api/lifeos/intake`, {
    headers: SYNC_TOKEN ? { "x-lifeos-token": SYNC_TOKEN } : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`LifeOS sync failed (${res.status}): ${text.slice(0, 160)}`);
  }
  const json = (await res.json()) as { intakes?: LifeOSStoredIntake[] };
  return Array.isArray(json.intakes) ? json.intakes : [];
}
