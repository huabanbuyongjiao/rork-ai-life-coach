import type { LifeOSIntakeRequest, LifeOSStoredIntake } from "@/lib/lifeos-api";

type IntakeResponse = {
  ok: boolean;
  accepted: boolean;
  message: string;
  id?: string;
};

type IntakeListResponse = {
  ok: boolean;
  intakes: LifeOSStoredIntake[];
};

const globalStore = globalThis as typeof globalThis & {
  __lifeOSIntakes?: LifeOSStoredIntake[];
};

function store(): LifeOSStoredIntake[] {
  globalStore.__lifeOSIntakes ??= [];
  return globalStore.__lifeOSIntakes;
}

function isAuthorized(request: Request): boolean {
  const expected = process.env.LIFEOS_INTAKE_TOKEN;
  if (!expected) return true;
  return request.headers.get("x-lifeos-token") === expected;
}

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return Response.json({ ok: false, intakes: [] } satisfies IntakeListResponse, {
      status: 401,
    });
  }
  return Response.json({
    ok: true,
    intakes: store().slice(-100).reverse(),
  } satisfies IntakeListResponse);
}

export async function POST(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return json(
      {
        ok: false,
        accepted: false,
        message: "Unauthorized.",
      },
      401,
    );
  }

  let body: LifeOSIntakeRequest | null = null;
  try {
    body = (await request.json()) as LifeOSIntakeRequest;
  } catch {
    return json(
      {
        ok: false,
        accepted: false,
        message: "Invalid JSON body.",
      },
      400,
    );
  }

  if (!body?.rawInput || typeof body.rawInput !== "string") {
    return json(
      {
        ok: false,
        accepted: false,
        message: "Missing required field: rawInput.",
      },
      400,
    );
  }

  const receivedAt = new Date().toISOString();
  const id =
    body.externalConversationId ??
    `intake_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const item: LifeOSStoredIntake = {
    id,
    receivedAt,
    request: {
      ...body,
      source: body.source ?? "webhook",
      timestamp: body.timestamp ?? receivedAt,
    },
  };
  const next = store().filter((existing) => existing.id !== id);
  next.push(item);
  globalStore.__lifeOSIntakes = next.slice(-200);

  return json({
    ok: true,
    accepted: true,
    id,
    message: "Intake accepted.",
  });
}

function json(payload: IntakeResponse, status = 200): Response {
  return Response.json(payload, { status });
}
