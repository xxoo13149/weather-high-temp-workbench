# v0.1.1-multimodel-switch-stability

Date: 2026-05-07

## Goal

Make rapid city switching on the multimodel analysis page feel continuous and prevent blank, stuck, or stale intermediate states after 7-8 quick switches.

## Changes

- Backend multimodel cold refresh no longer fails foreground distribution/insight requests with refresh-in-progress errors.
- Backend multimodel cache-load concurrency increased from 4 to 8 and covered by a regression test that keeps 7 background city loads blocked while the 8th foreground insight still resolves.
- Cloudflare dashboard edge caching now requires fresh `sync`, `hourly`, `report`, and ready/fresh `multimodel` state, so revalidating intermediate dashboard payloads are returned as `no-store`.
- Frontend location transitions now commit as soon as the dashboard is available; analysis, image, home, and Kelly surfaces hydrate after the route switch instead of blocking it.
- Frontend analysis state keeps current-location stable snapshots during refresh, rejects cross-city snapshot fallback, and rechecks epoch/route/timestamp/temperature after secondary distribution alignment to prevent late writes.
- Frontend multimodel insight/distribution loads retry retryable warmup/busy responses with abort-aware backoff.

## Validation

- `npm test -- tests\meteoblue-service.test.ts tests\cloudflare-worker.test.ts tests\cache.test.ts tests\app.test.ts`
- `npm run check`
- `npm --prefix zip run build`

All validation passed. Vite still reports the existing large chunk warning.

## Review Notes

- Pre-release review found no P0 issues.
- P1 findings fixed in this version: old city analysis snapshot mixing into new city, secondary distribution late-write risk, dashboard cache of hourly/report revalidating states, and 7-city background load pressure on foreground multimodel requests.
