# Deploy Intake Server

This server receives pushes from ChatGPT Actions and Claude MCP, then lets the mobile app pull fresh intakes.

## Render Blueprint

1. Push the repo to GitHub.
2. In Render, create a Blueprint from this repo.
3. Render will read `render.yaml`.
4. Set `LIFEOS_INTAKE_TOKEN` to a private shared secret.
5. Deploy.

After deployment, Render gives a URL like:

```text
https://ai-life-os-intake.onrender.com
```

## Configure the App

Set this in `expo/.env.local`:

```env
EXPO_PUBLIC_LIFEOS_API_BASE_URL=https://YOUR_RENDER_URL
EXPO_PUBLIC_LIFEOS_SYNC_TOKEN=YOUR_SHARED_SECRET
```

Restart Expo after editing `.env.local`.

## Configure ChatGPT

1. Open `expo/integrations/chatgpt-actions/openapi.yaml`.
2. Replace `https://YOUR_DEPLOYED_AIOS_DOMAIN` with the deployed URL.
3. In the Custom GPT editor, add the schema under Actions.
4. Configure API key auth:
   - Header name: `x-lifeos-token`
   - Value: the same `LIFEOS_INTAKE_TOKEN`

## Configure Claude

Use a Claude custom connector / remote MCP server that exposes the `lifeos_intake` tool in:

```text
expo/integrations/claude-mcp/lifeos-tool.json
```

The MCP server should call:

```text
POST https://YOUR_DEPLOYED_AIOS_DOMAIN/api/lifeos/intake
```

with header:

```text
x-lifeos-token: YOUR_SHARED_SECRET
```

## Health Check

The public health endpoint is:

```text
GET /health
```

It does not require `x-lifeos-token`, so deployment platforms can use it safely.

## Local Test

```bash
node server/lifeos-intake-server.mjs
```

Then:

```bash
curl -X POST http://localhost:8787/api/lifeos/intake \
  -H "Content-Type: application/json" \
  -d '{"rawInput":"明天要交报告，今晚先写150字","source":"chatgpt"}'
```

## Deployed Smoke Test

After Render deploys, run:

```bash
node server/smoke-test.mjs https://YOUR_RENDER_URL YOUR_SHARED_SECRET
```

It checks:

1. `GET /health`
2. `POST /api/lifeos/intake`
3. `GET /api/lifeos/intake`
