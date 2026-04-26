#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const args = new Map(
  process.argv.slice(2).map((value) => {
    const [key, ...rest] = value.split("=");
    return [key, rest.join("=")];
  }),
);

const baseUrl = (args.get("--base-url") ?? "https://lukaluka.fun").replace(/\/+$/, "");
const timeoutMs = Number.parseInt(args.get("--timeout-ms") ?? "15000", 10);
const concurrency = Math.max(1, Number.parseInt(args.get("--concurrency") ?? "4", 10));
const outDir = args.get("--out-dir") ?? "artifacts/audits";
const forceRefresh = args.has("--force-refresh");
const maxAttempts = Math.max(1, Number.parseInt(args.get("--max-attempts") ?? "2", 10));
const retryDelayMs = Math.max(0, Number.parseInt(args.get("--retry-delay-ms") ?? "400", 10));
const skipLatest = args.has("--skip-latest");

const generatedAt = new Date().toISOString();
const stamp = generatedAt.replace(/[:.]/g, "-");
const configText = await fs.readFile(new URL("../src/config.ts", import.meta.url), "utf8");
const entryPattern =
  /^\s{2}([a-z0-9_]+):\s*\{[\s\S]*?^\s{4}enabled:\s*(true|false),[\s\S]*?^\s{2}\},?$/gm;

const locations = [];
for (const match of configText.matchAll(entryPattern)) {
  const id = match[1];
  const block = match[0];
  if (!/enabled:\s*true/.test(block)) {
    continue;
  }

  locations.push({
    id,
    code: block.match(/code:\s*"([^"]+)"/)?.[1] ?? null,
    displayNameZh: block.match(/displayNameZh:\s*"([^"]+)"/)?.[1] ?? id,
    timezone: block.match(/timezone:\s*"([^"]+)"/)?.[1] ?? "UTC",
    displayUnit: block.match(/fallbackDisplayUnit:\s*"([^"]+)"/)?.[1] ?? "C",
  });
}

const sleep = async (ms) => {
  if (ms <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const writeAtomicTextFile = async (targetPath, contents) => {
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tempPath, contents, "utf8");
  await fs.rename(tempPath, targetPath);
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

const resolveDateKeyForTimezone = (timeZone, value = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);

const fetchJsonOnce = async (url) => {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        accept: "application/json",
      },
    });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      json,
      text,
    };
  } catch (error) {
    return {
      ok: false,
      status: "error",
      statusText: "FETCH_ERROR",
      json: null,
      text: error instanceof Error ? error.message : String(error),
    };
  }
};

const shouldRetryResult = (result) => {
  if (result.ok) {
    return false;
  }

  if (typeof result.status === "number" && [429, 500, 502, 503, 504].includes(result.status)) {
    return true;
  }

  return (
    typeof result.text === "string" &&
    (result.text.includes("Error 1102") ||
      result.text.includes("exceeded resource limits") ||
      result.text.includes("The operation was aborted due to timeout") ||
      result.text.includes("\"retryable\":true"))
  );
};

const fetchJsonWithRetry = async (url) => {
  let lastResult = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await fetchJsonOnce(url);
    result.attempts = attempt;
    lastResult = result;

    if (!shouldRetryResult(result) || attempt >= maxAttempts) {
      return result;
    }

    await sleep(retryDelayMs);
  }

  return lastResult;
};

const STABILITY_ONLY_WARNING_PATTERNS = [
  /最近一次成功缓存/,
  /最近一次成功结果/,
  /沿用上一轮市场结果/,
  /沿用最近一次可用价格/,
  /后台刷新中/,
  /稍后会自动补齐/,
  /刷新较慢/,
];

const USER_IMPACT_WARNING_PATTERNS = [
  /仅展示天气判断/,
  /仅展示天气侧推导结果/,
  /沿用上一轮可用结果/,
  /METAR 实况当前不可用/,
  /auto-fallback/i,
  /targetDate/i,
];

const classifyWarnings = (warnings) => {
  const normalized = Array.isArray(warnings) ? warnings.filter((value) => typeof value === "string" && value.trim()) : [];
  const stabilityOnly = [];
  const userImpact = [];
  const uncategorized = [];

  for (const warning of normalized) {
    if (USER_IMPACT_WARNING_PATTERNS.some((pattern) => pattern.test(warning))) {
      userImpact.push(warning);
      continue;
    }

    if (STABILITY_ONLY_WARNING_PATTERNS.some((pattern) => pattern.test(warning))) {
      stabilityOnly.push(warning);
      continue;
    }

    uncategorized.push(warning);
  }

  return {
    all: normalized,
    stabilityOnly,
    userImpact,
    uncategorized,
  };
};

const classifyRow = ({ location, dashboard, kelly }) => {
  const reasons = [];
  const dashboardJson = dashboard.json ?? null;
  const kellyJson = kelly.json ?? null;
  const contract = dashboardJson?.sourceMetadata?.contract ?? location.sourceMetadata ?? null;
  const primaryObservation = contract?.currentSources?.primaryObservation ?? null;
  const primaryObservationKey = primaryObservation?.key ?? null;
  const usesAirportObservation = primaryObservationKey === "aviationweather-metar";
  const usesPendingOfficialStation = primaryObservationKey === "hko-lau-fau-shan";
  const dashboardMetar = dashboardJson?.metar?.observation ?? null;
  const dashboardTaf = dashboardJson?.taf?.forecast ?? null;
  const kellyMetar = kellyJson?.weatherEvidence?.metarObservation ?? null;
  const kellyTaf = kellyJson?.weatherEvidence?.tafForecast ?? null;
  const warningBuckets = classifyWarnings(kellyJson?.warnings);
  const marketCount =
    (Array.isArray(kellyJson?.markets) ? kellyJson.markets.length : 0) +
    (Array.isArray(kellyJson?.inactiveMarkets) ? kellyJson.inactiveMarkets.length : 0);
  const expectedToday = resolveDateKeyForTimezone(location.timezone);
  const targetDate = kellyJson?.targetDate ?? null;
  const kellyMarketMappingStatus = contract?.kellyMarketMapping?.status ?? null;

  if (!dashboard.ok) {
    reasons.push("dashboard_http_error");
  }
  if (!kelly.ok) {
    reasons.push("kelly_http_error");
  }
  if (dashboard.ok && usesAirportObservation && !dashboardMetar) {
    reasons.push("missing_dashboard_metar");
  }
  if (kelly.ok && usesAirportObservation && !kellyMetar) {
    reasons.push("missing_kelly_metar");
  }
  if (dashboard.ok && usesAirportObservation && !dashboardTaf) {
    reasons.push("missing_dashboard_taf");
  }
  if (kelly.ok && usesAirportObservation && !kellyTaf) {
    reasons.push("missing_kelly_taf");
  }
  if (kelly.ok && kellyMarketMappingStatus === "production" && marketCount === 0) {
    reasons.push("no_markets_suspected_discovery");
  }
  if (kelly.ok && targetDate && expectedToday && targetDate !== expectedToday) {
    reasons.push("target_date_mismatch");
  }
  if (usesPendingOfficialStation) {
    reasons.push("pending_official_station");
  }
  if (warningBuckets.userImpact.length > 0) {
    reasons.push("user_impact_warnings");
  }
  if (warningBuckets.uncategorized.length > 0) {
    reasons.push("uncategorized_warnings");
  } else if (warningBuckets.stabilityOnly.length > 0) {
    reasons.push("stability_only_warnings");
  }

  let status = "healthy";
  if (reasons.some((reason) => reason === "dashboard_http_error" || reason === "kelly_http_error")) {
    status = "failing";
  } else if (reasons.includes("no_markets_suspected_discovery")) {
    status = "no-market-suspected-discovery";
  } else if (
    reasons.some((reason) =>
      [
        "missing_dashboard_metar",
        "missing_kelly_metar",
        "target_date_mismatch",
        "user_impact_warnings",
        "uncategorized_warnings",
      ].includes(reason),
    )
  ) {
    status = "degraded-usable";
  } else if (reasons.includes("pending_official_station")) {
    status = "pending-contract";
  } else if (
    reasons.some((reason) => ["missing_dashboard_taf", "missing_kelly_taf", "stability_only_warnings"].includes(reason))
  ) {
    status = "optional-source-gap";
  }

  return {
    id: location.id,
    code: location.code,
    displayNameZh: location.displayNameZh,
    timezone: location.timezone,
    displayUnit: location.displayUnit,
    expectedToday,
    targetDate,
    status,
    reasons,
    dashboardStatus: dashboard.status,
    kellyStatus: kelly.status,
    marketCount,
    warningCount: warningBuckets.all.length,
    stabilityWarnings: warningBuckets.stabilityOnly,
    userImpactWarnings: warningBuckets.userImpact,
    uncategorizedWarnings: warningBuckets.uncategorized,
    dashboardMetarPresent: Boolean(dashboardMetar),
    dashboardTafPresent: Boolean(dashboardTaf),
    kellyMetarPresent: Boolean(kellyMetar),
    kellyTafPresent: Boolean(kellyTaf),
    observationSourceKey: primaryObservationKey,
    kellyMarketMappingStatus,
  };
};

const rows = await mapWithConcurrency(locations, concurrency, async (location) => {
  const dashboardUrl = `${baseUrl}/api/weather/dashboard?locationId=${encodeURIComponent(location.id)}`;
  const kellyUrl = `${baseUrl}/api/weather/kelly?locationId=${encodeURIComponent(location.id)}${forceRefresh ? "&forceRefresh=true" : ""}`;
  const [dashboard, kelly] = await Promise.all([fetchJsonWithRetry(dashboardUrl), fetchJsonWithRetry(kellyUrl)]);

  return classifyRow({ location, dashboard, kelly });
});

const summary = {
  generatedAt,
  baseUrl,
  total: rows.length,
  statusCounts: rows.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {}),
  reasonCounts: rows.reduce((acc, row) => {
    for (const reason of row.reasons) {
      acc[reason] = (acc[reason] ?? 0) + 1;
    }
    return acc;
  }, {}),
  groupedLocationIds: rows.reduce((acc, row) => {
    const bucket = acc[row.status] ?? [];
    bucket.push(row.id);
    acc[row.status] = bucket;
    return acc;
  }, {}),
};

const report = {
  summary,
  rows,
};

await fs.mkdir(outDir, { recursive: true });
const latestPath = path.join(outDir, "production-city-audit-latest.json");
const stampedPath = path.join(outDir, `production-city-audit-${stamp}.json`);

if (!skipLatest) {
  await writeAtomicTextFile(latestPath, JSON.stringify(report, null, 2));
}
await writeAtomicTextFile(stampedPath, JSON.stringify(report, null, 2));

console.log(
  JSON.stringify(
    {
      ...summary,
      paths: {
        latest: skipLatest ? null : latestPath,
        stamped: stampedPath,
      },
    },
    null,
    2,
  ),
);
