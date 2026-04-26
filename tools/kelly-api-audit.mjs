import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

const base = "http://127.0.0.1:3000/api/weather/kelly";
const timeoutMs = 15_000;

const locations = [
  "shanghai_pvg",
  "wuhan_wuh",
  "istanbul_ist",
  "munich_muc",
  "toronto_yyz",
  "miami_mia",
  "losangeles_lax",
  "amsterdam_ams",
  "ankara_esb",
  "atlanta_atl",
  "austin_aus",
  "beijing_pek",
  "buenosaires_eze",
  "busan_pus",
  "capetown_cpt",
  "chengdu_ctu",
  "chicago_ord",
  "chongqing_ckg",
  "dallas_dal",
  "denver_bfk",
  "helsinki_hel",
  "hongkong_hkg",
  "houston_hou",
  "jakarta_hlp",
  "jeddah_jed",
  "kualalumpur_kul",
  "lagos_los",
  "london_lcy",
  "lucknow_lko",
  "madrid_mad",
  "mexicocity_mex",
  "milan_mxp",
  "moscow_vko",
  "newyork_lga",
  "panamacity_pac",
  "paris_cdg",
  "sanfrancisco_sfo",
  "saopaulo_gru",
  "seattle_sea",
  "seoul_icn",
  "shenzhen_szx",
  "singapore_sin",
  "taipei_tpe",
  "telaviv_tlv",
  "tokyo_hnd",
  "warsaw_waw",
  "wellington_wlg",
];

const tasks = [];
for (const locationId of locations) {
  tasks.push({ locationId, mode: "normal", force: false });
  tasks.push({ locationId, mode: "force", force: true });
}

const classifySide = (text) => {
  const value = String(text ?? "");
  const sides = new Set();
  if (/Polymarket|盘口|市场目录|实时流|orderbook|market/i.test(value)) {
    sides.add("polymarket");
  }
  if (/METAR|weather|小时|模型|multimodel|天气|analysis/i.test(value)) {
    sides.add("weather");
  }
  return [...sides];
};

const requestOne = async ({ locationId, mode, force }) => {
  const query = force ? `locationId=${locationId}&forceRefresh=true` : `locationId=${locationId}`;
  const url = `${base}?${query}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();

  let status = -1;
  let ok = false;
  let errorCode = null;
  let errorMessage = null;
  const warningSides = new Set();
  const sourceSides = new Set();

  try {
    const response = await fetch(url, { signal: controller.signal });
    status = response.status;
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }

    if (response.ok) {
      ok = true;
      if (Array.isArray(body?.warnings)) {
        for (const warning of body.warnings) {
          for (const side of classifySide(warning)) {
            warningSides.add(side);
          }
        }
      }
      if (Array.isArray(body?.sourceStatus)) {
        for (const source of body.sourceStatus) {
          if (String(source?.state ?? "") === "fresh") {
            continue;
          }
          for (const side of classifySide(source?.kind ?? "")) {
            sourceSides.add(side);
          }
        }
      }
    } else {
      errorCode = typeof body?.code === "string" ? body.code : null;
      errorMessage =
        typeof body?.message === "string"
          ? body.message
          : text || `HTTP_${response.status}`;
    }
  } catch (error) {
    status = -1;
    if (error?.name === "AbortError") {
      errorCode = "REQUEST_TIMEOUT";
      errorMessage = `Timed out after ${timeoutMs}ms`;
    } else {
      errorMessage = String(error?.message ?? error);
    }
  } finally {
    clearTimeout(timer);
  }

  return {
    locationId,
    mode,
    status,
    ok,
    elapsedMs: Math.round(performance.now() - started),
    errorCode,
    errorMessage,
    warningSides: [...warningSides].join(","),
    sourceSides: [...sourceSides].join(","),
    sampledAt: new Date().toISOString(),
  };
};

const runPool = async (items, concurrency) => {
  const results = new Array(items.length);
  let cursor = 0;

  const worker = async () => {
    while (true) {
      const current = cursor;
      cursor += 1;
      if (current >= items.length) {
        return;
      }
      results[current] = await requestOne(items[current]);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
};

const summarize = (results, retryResults) => {
  const failed = results.filter((item) => !item.ok);
  const stableFailures = [];

  for (const row of failed) {
    const matched = retryResults.find(
      (retry) => retry.locationId === row.locationId && retry.mode === row.mode,
    );
    if (matched && !matched.ok) {
      stableFailures.push({
        locationId: row.locationId,
        mode: row.mode,
        firstStatus: row.status,
        retryStatus: matched.status,
        firstErrorCode: row.errorCode,
        retryErrorCode: matched.errorCode,
        firstErrorMessage: row.errorMessage,
        retryErrorMessage: matched.errorMessage,
      });
    }
  }

  const statusBreakdown = Object.entries(
    results.reduce((acc, item) => {
      const key = String(item.status);
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
  )
    .map(([status, count]) => ({ status: Number(status), count }))
    .sort((a, b) => a.status - b.status);

  const errorCodeBreakdown = Object.entries(
    failed.reduce((acc, item) => {
      const key = item.errorCode ?? "";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
  )
    .map(([errorCode, count]) => ({ errorCode, count }))
    .sort((a, b) => b.count - a.count);

  const slowestTop10 = [...results]
    .sort((a, b) => b.elapsedMs - a.elapsedMs)
    .slice(0, 10);

  return {
    totalRequests: results.length,
    okCount: results.filter((item) => item.ok).length,
    failedCount: failed.length,
    statusBreakdown,
    errorCodeBreakdown,
    slowestTop10,
    stableFailures,
  };
};

const main = async () => {
  const results = await runPool(tasks, 8);
  const failedTasks = results
    .filter((item) => !item.ok)
    .map((item) => ({
      locationId: item.locationId,
      mode: item.mode,
      force: item.mode === "force",
    }));
  const retryResults = await runPool(failedTasks, 6);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = "D:/weather/test-results/api-audit";
  fs.mkdirSync(outDir, { recursive: true });

  const rawPath = path.join(outDir, `kelly-api-audit-${timestamp}-raw.json`);
  const retryPath = path.join(outDir, `kelly-api-audit-${timestamp}-retry.json`);
  const stablePath = path.join(outDir, `kelly-api-audit-${timestamp}-stable-failures.json`);

  fs.writeFileSync(rawPath, JSON.stringify(results, null, 2));
  fs.writeFileSync(retryPath, JSON.stringify(retryResults, null, 2));

  const summary = summarize(results, retryResults);
  fs.writeFileSync(stablePath, JSON.stringify(summary.stableFailures, null, 2));

  summary.paths = {
    raw: rawPath,
    retry: retryPath,
    stable: stablePath,
  };

  console.log(JSON.stringify(summary, null, 2));
};

await main();
