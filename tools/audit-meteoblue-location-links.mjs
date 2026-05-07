#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { LOCATION_DIRECTORY } from "../src/config.ts";
import { extractMultiModelHighchartsUrl, extractMultiModelImageUrl } from "../src/providers/meteoblue/multimodel.ts";

const args = new Map(
  process.argv.slice(2).map((value) => {
    const [key, ...rest] = value.split("=");
    return [key, rest.join("=") || "true"];
  }),
);

const concurrency = Math.max(1, Number.parseInt(args.get("--concurrency") ?? "1", 10));
const maxAttempts = Math.max(1, Number.parseInt(args.get("--max-attempts") ?? "4", 10));
const timeoutMs = Math.max(1000, Number.parseInt(args.get("--timeout-ms") ?? "20000", 10));
const retryDelayMs = Math.max(0, Number.parseInt(args.get("--retry-delay-ms") ?? "2000", 10));
const requestSpacingMs = Math.max(0, Number.parseInt(args.get("--request-spacing-ms") ?? "2000", 10));
const toleranceDegrees = Number.parseFloat(args.get("--tolerance-degrees") ?? "0.2");
const outDir = args.get("--out-dir") ?? "artifacts/audits";
const locationFilter = new Set(
  (args.get("--location") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const skipImageUrl = args.has("--skip-image-url");

const generatedAt = new Date().toISOString();
const stamp = generatedAt.replace(/[:.]/g, "-");

const sleep = async (ms) => {
  if (ms <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const mapWithConcurrency = async (items, limit, worker) => {
  const results = new Array(items.length);
  let nextIndex = 0;
  let lastStartAt = 0;

  const waitForStartSlot = async () => {
    if (requestSpacingMs <= 0) {
      return;
    }

    const now = Date.now();
    const waitMs = Math.max(0, lastStartAt + requestSpacingMs - now);
    lastStartAt = now + waitMs;
    await sleep(waitMs);
  };

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      await waitForStartSlot();
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(runners);
  return results;
};

const classifyRetryableFetchStatus = (status) =>
  status === "error" || status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);

const isChallengePage = (result) =>
  result.status === 403 &&
  /Just a moment|cloudflare|challenge-platform|cf-browser-verification/i.test(result.text);

const fetchTextOnce = async (url) => {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
        "user-agent": "weather-location-audit/1.0",
      },
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      text,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      status: "error",
      statusText: "FETCH_ERROR",
      text: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const fetchTextWithRetry = async (url) => {
  let lastResult = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await fetchTextOnce(url);
    result.attempts = attempt;
    lastResult = result;

    if (result.ok || attempt >= maxAttempts || (!classifyRetryableFetchStatus(result.status) && !isChallengePage(result))) {
      return result;
    }

    await sleep(retryDelayMs * attempt);
  }

  return lastResult;
};

const parseTitle = (html) => {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) {
    return null;
  }

  return match[1]
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
};

const parseUrlLocation = (url) => {
  const parsed = new URL(url);
  const latitude = Number(parsed.searchParams.get("lat"));
  const longitude = Number(parsed.searchParams.get("lon"));
  const timezone = parsed.searchParams.get("tz")?.trim() ?? null;

  return {
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    timezone,
    locationName: parsed.searchParams.get("location_name") ?? null,
    iso2: parsed.searchParams.get("iso2") ?? null,
    temperatureUnit: parsed.searchParams.get("temperature_units") ?? null,
  };
};

const compareLocation = (actual, expected) => {
  const reasons = [];
  if (actual.latitude === null || actual.longitude === null) {
    reasons.push("missing_coordinates");
  } else {
    if (Math.abs(actual.latitude - expected.latitude) > toleranceDegrees) {
      reasons.push("latitude_mismatch");
    }
    if (Math.abs(actual.longitude - expected.longitude) > toleranceDegrees) {
      reasons.push("longitude_mismatch");
    }
  }

  if (!actual.timezone) {
    reasons.push("missing_timezone");
  } else if (actual.timezone !== expected.timezone) {
    reasons.push("timezone_mismatch");
  }

  return reasons;
};

const serializeError = (error) => ({
  name: error instanceof Error ? error.name : null,
  message: error instanceof Error ? error.message : String(error),
  code: typeof error === "object" && error !== null && "code" in error ? error.code : null,
});

const auditLocation = async (location) => {
  const expected = {
    latitude: location.latitude,
    longitude: location.longitude,
    timezone: location.timezone,
  };
  const fetchResult = await fetchTextWithRetry(location.multimodelPageUrl);
  const base = {
    id: location.id,
    code: location.code,
    displayName: location.displayName,
    expected,
    pageUrl: location.multimodelPageUrl,
    weekPageUrl: location.weekPageUrl,
    status: "unknown",
    reasons: [],
    attempts: fetchResult.attempts,
    httpStatus: fetchResult.status,
    httpStatusText: fetchResult.statusText,
    title: parseTitle(fetchResult.text),
    highchartsUrl: null,
    imageUrl: null,
    actual: null,
    parserError: null,
    imageParserError: null,
    htmlIncludesHighcharts: fetchResult.text.includes("format=highcharts"),
    htmlIncludesMultimodel: fetchResult.text.includes("meteogram_multimodel"),
  };

  if (!fetchResult.ok) {
    return {
      ...base,
      status: isChallengePage(fetchResult) ? "challenge_page" : "fetch_error",
      reasons: [`fetch_${fetchResult.status}`],
      fetchError: fetchResult.error,
      responseSample: fetchResult.text.slice(0, 500),
    };
  }

  let highchartsUrl;
  try {
    highchartsUrl = extractMultiModelHighchartsUrl(fetchResult.text);
  } catch (error) {
    return {
      ...base,
      status: "missing_highcharts_link",
      reasons: ["highcharts_url_not_found"],
      parserError: serializeError(error),
      responseSample: fetchResult.text.slice(0, 500),
    };
  }

  let imageUrl = null;
  let imageParserError = null;
  if (!skipImageUrl) {
    try {
      imageUrl = extractMultiModelImageUrl(fetchResult.text);
    } catch (error) {
      imageParserError = serializeError(error);
    }
  }

  const actual = parseUrlLocation(highchartsUrl);
  const reasons = compareLocation(actual, expected);
  const status = reasons.length === 0 ? "ok" : "location_mismatch";

  return {
    ...base,
    status,
    reasons,
    highchartsUrl,
    imageUrl,
    actual,
    imageParserError,
  };
};

const allLocations = LOCATION_DIRECTORY.filter((location) => locationFilter.size === 0 || locationFilter.has(location.id));

if (locationFilter.size > 0 && allLocations.length !== locationFilter.size) {
  const known = new Set(LOCATION_DIRECTORY.map((location) => location.id));
  const missing = [...locationFilter].filter((id) => !known.has(id));
  if (missing.length > 0) {
    console.error(`Unknown location id(s): ${missing.join(", ")}`);
    process.exit(2);
  }
}

const results = await mapWithConcurrency(allLocations, concurrency, auditLocation);
const counts = results.reduce(
  (memo, row) => {
    memo[row.status] = (memo[row.status] ?? 0) + 1;
    return memo;
  },
  {},
);
const failures = results.filter((row) => row.status !== "ok");
const report = {
  generatedAt,
  checkedCount: results.length,
  passCount: results.length - failures.length,
  failureCount: failures.length,
  options: {
    concurrency,
    maxAttempts,
    timeoutMs,
    retryDelayMs,
    requestSpacingMs,
    toleranceDegrees,
    skipImageUrl,
    locationFilter: [...locationFilter],
  },
  counts,
  failures,
  results,
};

await fs.mkdir(outDir, { recursive: true });
const outputPath = path.join(outDir, `meteoblue-location-links-${stamp}.json`);
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(
  `Meteoblue location audit: ${report.passCount}/${report.checkedCount} ok; failures=${report.failureCount}; report=${outputPath}`,
);

for (const failure of failures) {
  console.log(
    [
      `FAIL ${failure.id}`,
      `status=${failure.status}`,
      `reasons=${failure.reasons.join(",")}`,
      `title=${failure.title ?? "n/a"}`,
      `actual=${failure.actual ? `${failure.actual.latitude},${failure.actual.longitude},${failure.actual.timezone}` : "n/a"}`,
      `expected=${failure.expected.latitude},${failure.expected.longitude},${failure.expected.timezone}`,
    ].join(" | "),
  );
}

if (failures.length > 0) {
  process.exitCode = 1;
}
