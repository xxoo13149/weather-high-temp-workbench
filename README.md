# meteoblue Weather Relay

Node.js + TypeScript + Fastify service for four jobs:

- parse hourly forecast data from the meteoblue `week` page
- extract the visible `weather report` text from the `week` page and translate it to Chinese
- relay the official meteoblue `multimodel` image without redrawing it
- derive model-level temperature distribution from the public `format=highcharts` payload exposed by the `multimodel` page
- serve the `zip/` React frontend as the only primary web UI

## Endpoints

- `GET /`
- `GET /api/weather/dashboard?mode=1h|3h&limit=...`
- `GET /api/weather/report`
- `GET /api/weather/hourly?mode=1h|3h&limit=...`
- `GET /api/weather/multimodel/image?allowStale=true|false`
- `GET /api/weather/multimodel/status`
- `GET /api/weather/multimodel/distribution?timestamp=<ISO>&bucketSize=1`
- `GET /healthz`

## Run

```bash
copy .env.example .env
npm install
cd zip && npm install && cd ..
npm run dev
```

For local frontend-only development, run the React app on port `3001` with an `/api` proxy to the backend:

```bash
npm run dev:web
```

To build the backend and the `zip` frontend together:

```bash
npm run build
npm start
```

## What The Dashboard Guarantees

- The large multimodel chart is the official meteoblue image relayed unchanged by the backend.
- The hourly strip is not a screenshot. It is a readable rearrangement of exact values parsed from the meteoblue week page.
- The Chinese weather report is derived from the visible week-page narrative and returned through a dedicated interface.
- Model-level statistics come from the page's public `format=highcharts` payload, not from OCR and not from redrawing the PNG.

## Frontend Structure

- `zip/src/App.tsx`: primary dashboard layout and state wiring
- `zip/src/api.ts`: frontend API client for `/api/weather/*`
- `zip/src/mappers.ts`: response-to-view-model mapping and selection helpers
- `zip/src/config.ts`: API paths, refresh policy, localized copy, fallbacks
- `zip/dist/*`: production build served by Fastify at `/`

## Notes

- `mode=1h` is the default dashboard mode because the homepage is optimized around the full one-hour strip.
- `mode=3h` is still supported by the backend for future UI extensions.
- `allowStale=false` on the image endpoint is fail-closed. If the latest fetch fails, the endpoint returns `503` instead of a substitute image.
- `/api/weather/multimodel/distribution` is intentionally derived from the multimodel page itself. If meteoblue changes that page's internal highcharts link format, the distribution endpoint will fail closed rather than inventing values.
