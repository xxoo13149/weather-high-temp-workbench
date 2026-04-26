import fs from "node:fs/promises";

const CONFIG_PATH = new URL("../src/config.ts", import.meta.url);
const BASE_URL = process.env.AUDIT_BASE_URL ?? "https://lukaluka.fun";

const text = await fs.readFile(CONFIG_PATH, "utf8");
const entryPattern =
  /^\s{2}([a-z0-9_]+):\s*\{[\s\S]*?^\s{4}enabled:\s*(true|false),[\s\S]*?^\s{2}\},?$/gm;

const locations = [];
for (const match of text.matchAll(entryPattern)) {
  const id = match[1];
  const block = match[0];
  const enabled = /enabled:\s*true/.test(block);
  if (!enabled) {
    continue;
  }

  const timezone = block.match(/timezone:\s*"([^"]+)"/)?.[1] ?? "UTC";
  const displayUnit = block.match(/fallbackDisplayUnit:\s*"([^"]+)"/)?.[1] ?? "C";
  locations.push({ id, timezone, displayUnit });
}

const resolveDateKeyForTimezone = (timeZone, value = new Date()) => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
};

const REQUEST_TIMEOUT_MS = 15000;
const AUDIT_CONCURRENCY = 4;

const fetchJson = async (url) => {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const textValue = await response.text();
  let json = null;
  try {
    json = JSON.parse(textValue);
  } catch {
    json = null;
  }
  return { status: response.status, json, text: textValue };
};

const mapWithConcurrency = async (items, limit, worker) => {
  const results = new Array(items.length);
  let nextIndex = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(runners);
  return results;
};

const rows = await mapWithConcurrency(locations, AUDIT_CONCURRENCY, async (location) => {
  const expectedToday = resolveDateKeyForTimezone(location.timezone);
  let dashboard;
  let kelly;

  try {
    dashboard = await fetchJson(
      `${BASE_URL}/api/weather/dashboard?locationId=${encodeURIComponent(location.id)}`,
    );
  } catch (error) {
    dashboard = {
      status: "error",
      json: null,
      text: error instanceof Error ? error.message : String(error),
    };
  }

  try {
    kelly = await fetchJson(
      `${BASE_URL}/api/weather/kelly?locationId=${encodeURIComponent(location.id)}`,
    );
  } catch (error) {
    kelly = {
      status: "error",
      json: null,
      text: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    id: location.id,
    timezone: location.timezone,
    unit: location.displayUnit,
    expectedToday,
    dashboardStatus: dashboard.status,
    kellyStatus: kelly.status,
    kellyTargetDate: kelly.json?.targetDate ?? null,
    availableTargetDates: kelly.json?.availableTargetDates ?? [],
    repricedAt: kelly.json?.freshness?.repricedAt ?? null,
    orderbookFetchedAt: kelly.json?.freshness?.orderbookFetchedAt ?? null,
    streamLastRepricedAt: kelly.json?.streamHealth?.lastRepricedAt ?? null,
    streamReason: kelly.json?.streamHealth?.reasonCode ?? null,
    markets: Array.isArray(kelly.json?.markets) ? kelly.json.markets.length : null,
    inactiveMarkets: Array.isArray(kelly.json?.inactiveMarkets) ? kelly.json.inactiveMarkets.length : null,
    warnings: Array.isArray(kelly.json?.warnings) ? kelly.json.warnings.length : null,
    todayMismatch:
      dashboard.status === 200 &&
      kelly.status === 200 &&
      expectedToday !== null &&
      kelly.json?.targetDate !== expectedToday,
    repricedMismatch:
      dashboard.status === 200 &&
      kelly.status === 200 &&
      (kelly.json?.freshness?.repricedAt ?? null) !== (kelly.json?.streamHealth?.lastRepricedAt ?? null),
    dashboardError: typeof dashboard.status === "string" ? dashboard.text : null,
    kellyError: typeof kelly.status === "string" ? kelly.text : null,
  };
});

console.log(JSON.stringify(rows, null, 2));
