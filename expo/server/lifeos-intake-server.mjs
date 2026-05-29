import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = process.env.LIFEOS_INTAKES_FILE ?? join(__dirname, "data", "intakes.json");
const PORT = Number(process.env.PORT ?? 8787);
const TOKEN = process.env.LIFEOS_INTAKE_TOKEN ?? "";

async function readStore() {
  try {
    const raw = await readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeStore(items) {
  await mkdir(dirname(DATA_FILE), { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(items.slice(-500), null, 2));
}

function send(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, x-lifeos-token",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  res.end(JSON.stringify(payload));
}

function authorized(req) {
  if (!TOKEN) return true;
  return req.headers["x-lifeos-token"] === TOKEN;
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      send(res, 204, {});
      return;
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname === "/health") {
      send(res, 200, { ok: true, service: "ai-life-os-intake" });
      return;
    }

    if (url.pathname !== "/api/lifeos/intake") {
      send(res, 404, { ok: false, message: "Not found." });
      return;
    }

    if (!authorized(req)) {
      send(res, 401, { ok: false, message: "Unauthorized." });
      return;
    }

    if (req.method === "GET") {
      const items = await readStore();
      send(res, 200, { ok: true, intakes: items.slice(-100).reverse() });
      return;
    }

    if (req.method === "POST") {
      const body = await readJson(req);
      if (!body.rawInput || typeof body.rawInput !== "string") {
        send(res, 400, { ok: false, accepted: false, message: "Missing rawInput." });
        return;
      }
      const receivedAt = new Date().toISOString();
      const id =
        body.externalConversationId ??
        `intake_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const item = {
        id,
        receivedAt,
        request: {
          rawInput: body.rawInput,
          source: body.source ?? "webhook",
          timestamp: body.timestamp ?? receivedAt,
          conversationSummary: body.conversationSummary,
          externalConversationId: body.externalConversationId,
        },
      };
      const existing = await readStore();
      await writeStore([...existing.filter((entry) => entry.id !== id), item]);
      send(res, 200, { ok: true, accepted: true, id, message: "Intake accepted." });
      return;
    }

    send(res, 405, { ok: false, message: "Method not allowed." });
  } catch (err) {
    send(res, 500, {
      ok: false,
      message: err instanceof Error ? err.message : "Internal server error.",
    });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`AI Life OS intake server listening on http://0.0.0.0:${PORT}`);
});
