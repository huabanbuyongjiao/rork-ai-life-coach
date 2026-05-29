const baseUrl = process.argv[2]?.replace(/\/$/, "");
const token = process.argv[3] ?? process.env.LIFEOS_INTAKE_TOKEN ?? "";

if (!baseUrl) {
  console.error("Usage: node server/smoke-test.mjs https://YOUR_DOMAIN [token]");
  process.exit(1);
}

async function request(path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "x-lifeos-token": token } : {}),
      ...(options.headers ?? {}),
    },
  });
  const text = await res.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {}
  if (!res.ok) {
    throw new Error(`${options.method ?? "GET"} ${path} failed: ${res.status} ${text}`);
  }
  return body;
}

const id = `smoke_${Date.now().toString(36)}`;

console.log("1. health");
console.log(await request("/health", { headers: token ? { "x-lifeos-token": "" } : {} }));

console.log("2. post intake");
console.log(
  await request("/api/lifeos/intake", {
    method: "POST",
    body: JSON.stringify({
      rawInput: "Smoke test: 今晚先验证 AI Life OS intake 部署。",
      source: "webhook",
      externalConversationId: id,
    }),
  }),
);

console.log("3. list intakes");
const list = await request("/api/lifeos/intake");
console.log(list);

const found = Array.isArray(list.intakes)
  ? list.intakes.some((item) => item.id === id)
  : false;

if (!found) {
  throw new Error("Smoke intake was accepted but not found in GET /api/lifeos/intake.");
}

console.log("OK");
