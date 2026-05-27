import { chatJson } from "./ai";
import type { ScheduleItem } from "@/types/aurora";

export const GMAIL_WEB_CLIENT_ID =
  "1084650680509-i3dl47ldlqt2flst4gm7cf02nvdoarfj.apps.googleusercontent.com";

export const GMAIL_IOS_CLIENT_ID =
  "1084650680509-5use8of428ufbjhqjbrhaeeti4jh6ntu.apps.googleusercontent.com";

export const GMAIL_ANDROID_CLIENT_ID =
  "1084650680509-kg1fga4em57raueo8dj5kr843ev8kn81.apps.googleusercontent.com";

export const GMAIL_SCOPES: string[] = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "openid",
  "email",
  "profile",
];

export type GmailMessageSummary = {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  date: number;
};

type GmailListResponse = {
  messages?: { id: string; threadId: string }[];
};

type GmailFullMessage = {
  id: string;
  threadId: string;
  snippet?: string;
  internalDate?: string;
  payload?: {
    headers?: { name: string; value: string }[];
  };
};

async function gmailFetch<T>(path: string, accessToken: string): Promise<T> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Gmail API ${res.status}: ${txt.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

/**
 * Fetch the latest N inbox messages and return summaries (subject + snippet).
 * Uses `format=metadata` to keep payloads small and avoid base64-encoded bodies.
 */
export async function fetchRecentMessages(
  accessToken: string,
  maxResults: number = 10
): Promise<GmailMessageSummary[]> {
  const list = await gmailFetch<GmailListResponse>(
    `users/me/messages?maxResults=${maxResults}&labelIds=INBOX&q=newer_than:7d`,
    accessToken
  );
  const ids = (list.messages ?? []).map((m) => m.id);
  if (ids.length === 0) return [];

  const full = await Promise.all(
    ids.map((id) =>
      gmailFetch<GmailFullMessage>(
        `users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
        accessToken
      ).catch(() => null)
    )
  );

  return full
    .filter((m): m is GmailFullMessage => m !== null)
    .map((m) => {
      const headers = m.payload?.headers ?? [];
      const h = (name: string) =>
        headers.find((hh) => hh.name.toLowerCase() === name.toLowerCase())
          ?.value ?? "";
      return {
        id: m.id,
        threadId: m.threadId,
        from: h("From"),
        subject: h("Subject"),
        snippet: m.snippet ?? "",
        date: m.internalDate ? Number(m.internalDate) : Date.now(),
      };
    });
}

const EMAIL_PARSE_SYSTEM = `You read a batch of the user's recent email summaries (sender + subject + short snippet) and extract any time-sensitive things they need to act on — deadlines, appointments, forms to fill, replies expected, meetings, classes, payments, package deliveries.

Return JSON:
{
  "items": [
    {
      "time": string,    // e.g. "明天 14:00", "5月25日", "今晚", "本周五". If unclear, "近期".
      "title": string,   // short actionable phrase in the user's language (Chinese unless clearly English)
      "kind": "study"|"work"|"sleep"|"health"|"break"|"other",
      "source": string   // short hint about which email it came from, e.g. "来自 Coursera"
    }
  ]
}

Rules:
- ONLY extract things the user actually needs to do or attend. Skip newsletters, promotions, security notifications, social-network notifications.
- If nothing actionable, return { "items": [] }.
- Merge duplicates (multiple reminders for the same event).
- JSON only, no prose, no code fences.`;

export async function extractActionsFromEmails(
  messages: GmailMessageSummary[]
): Promise<{
  time: string;
  title: string;
  kind: ScheduleItem["kind"];
  source: string;
}[]> {
  if (messages.length === 0) return [];
  const block = messages
    .map((m, i) => {
      const d = new Date(m.date).toLocaleString();
      return `[${i + 1}] ${d}\nFrom: ${m.from}\nSubject: ${m.subject}\nSnippet: ${m.snippet}`;
    })
    .join("\n\n");
  const res = await chatJson<{
    items: {
      time: string;
      title: string;
      kind: ScheduleItem["kind"];
      source: string;
    }[];
  }>({
    messages: [
      { role: "system", content: EMAIL_PARSE_SYSTEM },
      { role: "user", content: block },
    ],
    temperature: 0.2,
    max_tokens: 900,
  });
  return res?.items ?? [];
}
