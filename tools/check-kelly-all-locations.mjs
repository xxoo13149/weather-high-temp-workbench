#!/usr/bin/env node

const args = new Set(process.argv.slice(2));
const baseUrlArg = [...args].find((value) => value.startsWith("--base-url="));
const baseUrl = baseUrlArg ? baseUrlArg.slice("--base-url=".length) : "http://127.0.0.1:3000";
const forceRefresh = args.has("--force-refresh");
const quietOk = args.has("--quiet-ok");
const timeoutArg = [...args].find((value) => value.startsWith("--timeout-ms="));
const timeoutMs = timeoutArg ? Number.parseInt(timeoutArg.slice("--timeout-ms=".length), 10) : 12_000;
const idsArg = [...args].find((value) => value.startsWith("--ids="));
const selectedIds = idsArg
  ? idsArg
      .slice("--ids=".length)
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  : null;

const timedFetch = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const toKellyUrl = (locationId) =>
  `${baseUrl}/api/weather/kelly?locationId=${encodeURIComponent(locationId)}${forceRefresh ? "&forceRefresh=true" : ""}`;

const run = async () => {
  const dashboardResponse = await timedFetch(`${baseUrl}/api/weather/dashboard?locationId=shanghai_pvg`);
  if (!dashboardResponse.ok) {
    throw new Error(`Dashboard bootstrap failed: ${dashboardResponse.status}`);
  }

  const dashboard = await dashboardResponse.json();
  const locationIds = selectedIds ?? dashboard.locationDirectory.map((entry) => entry.id);
  const failures = [];
  let okCount = 0;

  for (const locationId of locationIds) {
    const startedAt = Date.now();
    try {
      const response = await timedFetch(toKellyUrl(locationId));
      const elapsedMs = Date.now() - startedAt;
      if (!response.ok) {
        const body = (await response.text()).slice(0, 240);
        failures.push({
          locationId,
          status: response.status,
          elapsedMs,
          body,
        });
        console.log(`FAIL ${locationId} status=${response.status} ${elapsedMs}ms`);
        continue;
      }

      const payload = await response.json();
      okCount += 1;
      if (!quietOk) {
        console.log(
          `OK ${locationId} ${elapsedMs}ms targetDate=${payload.targetDate} repricedAt=${payload.freshness?.repricedAt ?? "null"} markets=${payload.markets?.length ?? 0}/${payload.inactiveMarkets?.length ?? 0}`,
        );
      }
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      failures.push({
        locationId,
        status: "ERR",
        elapsedMs,
        error: error instanceof Error ? error.message : String(error),
      });
      console.log(`ERR ${locationId} ${elapsedMs}ms ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(
    JSON.stringify(
      {
        total: locationIds.length,
        ok: okCount,
        failed: failures.length,
        forceRefresh,
      },
      null,
      2,
    ),
  );

  if (failures.length > 0) {
    console.log(JSON.stringify({ failures }, null, 2));
    process.exitCode = 1;
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
