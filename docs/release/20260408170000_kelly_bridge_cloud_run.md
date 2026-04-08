# Kelly Bridge Cloud Run Release Notes

## What Changed
- Added a dedicated Node bridge entrypoint for Kelly-only traffic: `src/kelly-bridge.ts`
- Added a dedicated Fastify bridge app with:
  - `GET /healthz`
  - `GET /api/weather/kelly`
  - `WS /api/weather/kelly/stream`
- Added internal bridge authorization via `KELLY_BRIDGE_SHARED_SECRET`
- Kept the frontend on same-origin `/api/weather/*`; Cloudflare Worker now forwards the shared secret when proxying Kelly requests
- Added `Dockerfile.kelly-bridge` for Cloud Run deployment

## Required Environment Variables
### Cloud Run bridge
- `HOST=0.0.0.0`
- `PORT=8080`
- `KELLY_BRIDGE_SHARED_SECRET=<shared-secret>`
- Optional upstream overrides:
  - `POLYMARKET_GAMMA_BASE_URL`
  - `POLYMARKET_CLOB_BASE_URL`
  - `POLYMARKET_CLOB_WS_URL`
  - `HTTP_TIMEOUT_MS`

### Cloudflare Worker
- `KELLY_BRIDGE_BASE_URL=https://<cloud-run-bridge-url>`
- Secret:
  - `KELLY_BRIDGE_SHARED_SECRET=<same-shared-secret>`

## Local Run
```bash
npm run dev:kelly-bridge
```

Bridge health check:
```bash
curl http://127.0.0.1:3000/healthz
```

## Cloud Run Deploy Example
```bash
docker build -f Dockerfile.kelly-bridge -t gcr.io/<gcp-project>/weather-kelly-bridge:latest .
docker push gcr.io/<gcp-project>/weather-kelly-bridge:latest
gcloud run deploy weather-kelly-bridge \
  --image gcr.io/<gcp-project>/weather-kelly-bridge:latest \
  --region <region> \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars HOST=0.0.0.0,PORT=8080 \
  --set-env-vars KELLY_BRIDGE_SHARED_SECRET=<shared-secret>
```

After deployment, set the Worker side:
```bash
wrangler secret put KELLY_BRIDGE_SHARED_SECRET
```

Then configure `KELLY_BRIDGE_BASE_URL` in the Cloudflare environment or dashboard.

## Acceptance Checklist
- `GET /healthz` on the bridge returns JSON with `service=kelly-bridge`
- Worker can reach `/api/weather/kelly` through same-origin `lukaluka.fun`
- Worker-originated requests include `x-kelly-bridge-secret`
- Direct requests to the bridge without the shared secret are rejected
