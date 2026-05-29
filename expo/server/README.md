# AI Life OS Intake Server

Tiny no-dependency server for local testing and simple deployment.

Run locally:

```bash
node server/lifeos-intake-server.mjs
```

Endpoints:

- `GET /health`
- `POST /api/lifeos/intake`
- `GET /api/lifeos/intake`

Optional env:

- `PORT=8787`
- `LIFEOS_INTAKE_TOKEN=shared-secret`
- `LIFEOS_INTAKES_FILE=/path/to/intakes.json`

For phone Expo Go sync on the same Wi-Fi, set:

```env
EXPO_PUBLIC_LIFEOS_API_BASE_URL=http://YOUR_MAC_LAN_IP:8787
EXPO_PUBLIC_LIFEOS_SYNC_TOKEN=shared-secret
```

For public deployment, see `server/DEPLOY.md`.
