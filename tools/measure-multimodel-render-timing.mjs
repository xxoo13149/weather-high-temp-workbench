#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  createArtifactDir,
  readEnabledLocations,
  sleep,
  switchLocationBySearch,
} from "./playwright-location-regression.shared.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const parseArgs = (argv) => {
  const options = {};
  for (const raw of argv) {
    if (!raw.startsWith("--")) {
      continue;
    }
    const [key, value] = raw.slice(2).split("=", 2);
    options[key] = value ?? "true";
  }
  return options;
};

const resolveFromRequire = (specifier) => {
  const require = createRequire(import.meta.url);
  try {
    return require.resolve(specifier);
  } catch {
    return null;
  }
};

const findNewestNpxPlaywright = async () => {
  const roots = [
    process.env.PLAYWRIGHT_NPX_CACHE_DIR,
    path.join(os.homedir(), "AppData", "Local", "npm-cache", "_npx"),
    path.join(os.homedir(), ".npm", "_npx"),
  ].filter(Boolean);
  const candidates = [];

  for (const root of roots) {
    try {
      const dirs = await fs.readdir(root, { withFileTypes: true });
      for (const dir of dirs) {
        if (!dir.isDirectory()) {
          continue;
        }
        const entry = path.join(root, dir.name, "node_modules", "playwright", "index.js");
        try {
          const stats = await fs.stat(entry);
          candidates.push({ entry, mtimeMs: stats.mtimeMs });
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
  }

  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return candidates[0]?.entry ?? null;
};

const loadChromium = async () => {
  const entry = process.env.PLAYWRIGHT_REQUIRE_PATH ?? resolveFromRequire("playwright") ?? (await findNewestNpxPlaywright());
  if (!entry) {
    throw new Error("Unable to resolve Playwright runtime.");
  }
  const playwright = await import(pathToFileURL(entry).href);
  return playwright.chromium ?? playwright.default?.chromium;
};

const executableCandidates = [
  process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  "C:\\Users\\32360\\.cache\\puppeteer\\chrome\\win64-131.0.6778.204\\chrome-win64\\chrome.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);

const resolveExecutablePath = async () => {
  for (const candidate of executableCandidates) {
    try {
      if ((await fs.stat(candidate)).isFile()) {
        return candidate;
      }
    } catch {
      // ignore
    }
  }
  return null;
};

const now = () => Date.now();

const waitUntil = async (predicate, timeoutMs, intervalMs = 100) => {
  const startedAt = now();
  let last = null;
  while (now() - startedAt <= timeoutMs) {
    try {
      last = await predicate();
      if (last?.ok) {
        return { ...last, elapsedMs: now() - startedAt };
      }
    } catch (error) {
      last = { error: error instanceof Error ? error.message : String(error) };
    }
    await sleep(intervalMs);
  }
  return { ok: false, elapsedMs: now() - startedAt, last };
};

const summarizeEndpoint = (events, fragment) => {
  const matches = events.filter((event) => event.url.includes(fragment));
  return {
    requested: matches.length > 0,
    ok: matches.some((event) => event.status >= 200 && event.status < 300),
    events: matches.map(({ status, elapsedMs, sinceStartMs, body, errorText }) => ({
      status,
      elapsedMs,
      sinceStartMs,
      body,
      errorText,
    })),
  };
};

const summarizeLocationEndpoint = (events, fragment, locationId) =>
  summarizeEndpoint(
    events.filter((event) => {
      try {
        const url = new URL(event.url);
        return url.searchParams.get("locationId") === locationId;
      } catch {
        return event.url.includes(`locationId=${encodeURIComponent(locationId)}`);
      }
    }),
    fragment,
  );

const filterEventsByLocation = (events, locationId) =>
  events.filter((event) => {
    try {
      const url = new URL(event.url);
      return url.searchParams.get("locationId") === locationId;
    } catch {
      return event.url.includes(`locationId=${encodeURIComponent(locationId)}`);
    }
  });

const classify = ({ rowTimeoutMs, finalState, api, failures, rowsReady, locationId }) => {
  const locationApi = filterEventsByLocation(api, locationId);
  const locationFailures = filterEventsByLocation(failures, locationId);
  const insights = summarizeEndpoint(locationApi, "/multimodel/insights");
  const distribution = summarizeEndpoint(locationApi, "/multimodel/distribution");
  const dashboard = summarizeEndpoint(locationApi, "/dashboard");
  const hardApiFailure = [...locationApi, ...locationFailures].some(
    (event) => event.errorText || event.status >= 400 || event.status === "ERR",
  );

  if (rowsReady.ok) {
    return "render_ready";
  }
  if (hardApiFailure) {
    return "hard_api_failure";
  }
  if (!dashboard.requested) {
    return "frontend_no_dashboard_request";
  }
  if (!insights.requested) {
    return "frontend_no_insight_request";
  }
  if (insights.ok && !distribution.requested) {
    return "frontend_no_distribution_request";
  }
  if (finalState.refreshState === "pending" || finalState.pageSkeleton) {
    return "still_loading";
  }
  if (rowTimeoutMs > 0) {
    return "slow_or_empty_after_timeout";
  }
  return "unknown_no_rows";
};

const waitForCurrentModelRender = async ({ readState, api, locationId, rowTimeoutMs }) =>
  await waitUntil(async () => {
    const state = await readState();
    const insights = summarizeLocationEndpoint(api, "/multimodel/insights", locationId);
    const distribution = summarizeLocationEndpoint(api, "/multimodel/distribution", locationId);
    return {
      ok:
        state.locationId === locationId &&
        state.rankingRows > 0 &&
        insights.ok &&
        distribution.ok &&
        !state.transitioning,
      state,
      insights,
      distribution,
    };
  }, rowTimeoutMs, 250);

const summarizeResults = ({ baseUrl, mode, results, readyKey }) => {
  const readyRows = results
    .filter((result) => result.ok && typeof result[readyKey] === "number")
    .map((result) => result[readyKey])
    .sort((left, right) => left - right);
  const pct = (values, percentile) =>
    values.length > 0 ? values[Math.min(values.length - 1, Math.floor(values.length * percentile))] : null;
  return {
    baseUrl,
    mode,
    total: results.length,
    ok: results.filter((result) => result.ok).length,
    missed: results.filter((result) => !result.ok).length,
    p50: pct(readyRows, 0.5),
    p90: pct(readyRows, 0.9),
    p95: pct(readyRows, 0.95),
    max: readyRows.at(-1) ?? null,
    byClassification: Object.fromEntries(
      [...new Set(results.map((result) => result.classification))].map((classification) => [
        classification,
        results.filter((result) => result.classification === classification).length,
      ]),
    ),
    missedIds: results.filter((result) => !result.ok).map((result) => result.id),
  };
};

const run = async () => {
  const options = parseArgs(process.argv.slice(2));
  const baseUrl = options.baseUrl ?? process.env.PLAYWRIGHT_BASE_URL ?? "https://lukaluka.fun";
  const rowTimeoutMs = Number.parseInt(options.rowTimeoutMs ?? "24000", 10);
  const contentTimeoutMs = Number.parseInt(options.contentTimeoutMs ?? "12000", 10);
  const mode = options.mode ?? "direct";
  const ids = options.ids
    ? new Set(options.ids.split(",").map((value) => value.trim()).filter(Boolean))
    : null;
  const allLocations = await readEnabledLocations();
  const locations = ids ? allLocations.filter((location) => ids.has(location.id)) : allLocations;
  const artifactDir = await createArtifactDir(`multimodel-render-timing-${mode}`, baseUrl);

  const chromium = await loadChromium();
  const executablePath = await resolveExecutablePath();
  const browser = await chromium.launch({
    headless: options.headless ? options.headless !== "false" : true,
    executablePath: executablePath ?? undefined,
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  page.setDefaultTimeout(2_500);

  const readState = async () =>
    await page.evaluate(() => {
      const text = document.body.innerText.replace(/\s+/g, " ").trim();
      return {
        href: location.href,
        locationId: new URL(location.href).searchParams.get("locationId"),
        title: document.querySelector(".command-header-title")?.textContent?.trim() ?? null,
        analysisPanel: Boolean(document.querySelector(".analysis-panel")),
        content: Boolean(document.querySelector(".analysis-content")),
        pageSkeleton: !document.querySelector(".analysis-content") && Boolean(document.querySelector(".analysis-panel")),
        transitioning: Boolean(document.querySelector(".command-header-transition")),
        rankingRows: document.querySelectorAll(".analysis-ranking-row").length,
        visibleArticles: document.querySelectorAll(".analysis-content article").length,
        refreshState: document.querySelector(".command-header-refresh")?.getAttribute("data-refresh-state") ?? null,
        text: text.slice(0, 900),
      };
    });

  const results = [];

  const measureLocation = async (location, navigate) => {
    const startedAt = now();
    const requestStarts = new Map();
    const api = [];
    const failures = [];

    const onRequest = (request) => {
      const url = request.url();
      if (url.includes("/api/weather/")) {
        requestStarts.set(request, now());
      }
    };
    const onResponse = async (response) => {
      const request = response.request();
      const url = response.url();
      if (!url.includes("/api/weather/")) {
        return;
      }
      const elapsedMs = now() - (requestStarts.get(request) ?? startedAt);
      let body = null;
      if (!response.ok()) {
        body = await response.text().catch(() => null);
      }
      api.push({
        url,
        status: response.status(),
        elapsedMs,
        sinceStartMs: now() - startedAt,
        body: body?.slice(0, 240) ?? null,
      });
    };
    const onFailed = (request) => {
      const url = request.url();
      if (url.includes("/api/weather/")) {
        failures.push({
          url,
          status: "ERR",
          errorText: request.failure()?.errorText ?? "unknown",
          elapsedMs: now() - (requestStarts.get(request) ?? startedAt),
          sinceStartMs: now() - startedAt,
        });
      }
    };

    page.on("request", onRequest);
    page.on("response", onResponse);
    page.on("requestfailed", onFailed);

    let gotoError = null;
    try {
      await navigate();
    } catch (error) {
      gotoError = error instanceof Error ? error.message : String(error);
    }

    const panelReady = await waitUntil(async () => {
      const state = await readState();
      return { ok: state.analysisPanel, state };
    }, 6_000);
    const contentReady = await waitUntil(async () => {
      const state = await readState();
      return { ok: state.content, state };
    }, contentTimeoutMs);
    const rowsReady = await waitUntil(async () => {
      const state = await readState();
      return { ok: state.rankingRows > 0, state };
    }, rowTimeoutMs, 250);
    const currentRowsReady = await waitForCurrentModelRender({
      readState,
      api,
      locationId: location.id,
      rowTimeoutMs,
    });
    const currentRowsTotalMs = currentRowsReady.ok ? now() - startedAt : null;

    await sleep(500);
    const finalState = await readState();
    page.off("request", onRequest);
    page.off("response", onResponse);
    page.off("requestfailed", onFailed);

    const dashboard = summarizeLocationEndpoint(api, "/dashboard", location.id);
    const insights = summarizeLocationEndpoint(api, "/multimodel/insights", location.id);
    const distribution = summarizeLocationEndpoint(api, "/multimodel/distribution", location.id);
    const classification = classify({
      rowTimeoutMs,
      finalState,
      api,
      failures,
      rowsReady: currentRowsReady,
      locationId: location.id,
    });
    const result = {
      id: location.id,
      code: location.code,
      cityName: location.cityName,
      ok: currentRowsReady.ok,
      classification,
      gotoError,
      panelMs: panelReady.ok ? panelReady.elapsedMs : null,
      contentMs: contentReady.ok ? contentReady.elapsedMs : null,
      rowsMs: rowsReady.ok ? rowsReady.elapsedMs : null,
      currentRowsMs: currentRowsTotalMs,
      rankingRows: finalState.rankingRows,
      refreshState: finalState.refreshState,
      dashboard,
      insights,
      distribution,
      failures,
      text: finalState.text,
    };
    results.push(result);
    console.log(
      `${result.ok ? "OK" : "MISS"} ${result.id} class=${classification} content=${result.contentMs ?? "-"}ms currentRows=${
        result.currentRowsMs ?? "-"
      }ms insight=${insights.events.map((event) => `${event.status}/${event.elapsedMs}`).join(",") || "-"} dist=${
        distribution.events.map((event) => `${event.status}/${event.elapsedMs}`).join(",") || "-"
      }`,
    );
  };

  if (mode === "burst") {
    const burstSize = Number.parseInt(options.burstSize ?? "8", 10);
    const intervalMs = Number.parseInt(options.intervalMs ?? "150", 10);
    await page.goto(`${baseUrl}/analysis?locationId=${encodeURIComponent(locations[0].id)}&tab=models`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });
    await waitUntil(async () => {
      const state = await readState();
      return { ok: state.locationId === locations[0].id && state.rankingRows > 0, state };
    }, 30_000, 250);

    for (let index = 1; index < locations.length; index += burstSize) {
      const burst = locations.slice(index, index + burstSize);
      const finalLocation = burst.at(-1);
      if (!finalLocation) {
        continue;
      }

      const startedAt = now();
      const requestStarts = new Map();
      const api = [];
      const failures = [];
      const onRequest = (request) => {
        const url = request.url();
        if (url.includes("/api/weather/")) {
          requestStarts.set(request, now());
        }
      };
      const onResponse = async (response) => {
        const request = response.request();
        const url = response.url();
        if (!url.includes("/api/weather/")) {
          return;
        }
        let body = null;
        if (!response.ok()) {
          body = await response.text().catch(() => null);
        }
        api.push({
          url,
          status: response.status(),
          elapsedMs: now() - (requestStarts.get(request) ?? startedAt),
          sinceStartMs: now() - startedAt,
          body: body?.slice(0, 240) ?? null,
        });
      };
      const onFailed = (request) => {
        const url = request.url();
        if (url.includes("/api/weather/")) {
          failures.push({
            url,
            status: "ERR",
            errorText: request.failure()?.errorText ?? "unknown",
            elapsedMs: now() - (requestStarts.get(request) ?? startedAt),
            sinceStartMs: now() - startedAt,
          });
        }
      };
      page.on("request", onRequest);
      page.on("response", onResponse);
      page.on("requestfailed", onFailed);

      for (const location of burst) {
        await page.evaluate((locationId) => {
          const url = new URL(window.location.href);
          url.pathname = "/analysis";
          url.searchParams.set("locationId", locationId);
          url.searchParams.set("tab", "models");
          window.history.pushState(null, "", url.toString());
          window.dispatchEvent(new PopStateEvent("popstate"));
        }, location.id);
        await sleep(intervalMs);
      }

      const currentRowsReady = await waitForCurrentModelRender({
        readState,
        api,
        locationId: finalLocation.id,
        rowTimeoutMs,
      });
      const finalState = await readState();
      page.off("request", onRequest);
      page.off("response", onResponse);
      page.off("requestfailed", onFailed);

      const dashboard = summarizeLocationEndpoint(api, "/dashboard", finalLocation.id);
      const insights = summarizeLocationEndpoint(api, "/multimodel/insights", finalLocation.id);
      const distribution = summarizeLocationEndpoint(api, "/multimodel/distribution", finalLocation.id);
      const classification = classify({
        rowTimeoutMs,
        finalState,
        api,
        failures,
        rowsReady: currentRowsReady,
        locationId: finalLocation.id,
      });
      const result = {
        id: finalLocation.id,
        code: finalLocation.code,
        cityName: finalLocation.cityName,
        burstIds: burst.map((location) => location.id),
        ok: currentRowsReady.ok,
        classification,
        currentRowsMs: currentRowsReady.ok ? now() - startedAt : null,
        rankingRows: finalState.rankingRows,
        refreshState: finalState.refreshState,
        dashboard,
        insights,
        distribution,
        failures,
        allApiEvents: api.map(({ url, status, sinceStartMs, elapsedMs, body }) => ({
          path: new URL(url).pathname,
          locationId: new URL(url).searchParams.get("locationId"),
          status,
          sinceStartMs,
          elapsedMs,
          body,
        })),
        text: finalState.text,
      };
      results.push(result);
      console.log(
        `${result.ok ? "OK" : "MISS"} burst final=${result.id} class=${classification} currentRows=${
          result.currentRowsMs ?? "-"
        }ms insight=${insights.events.map((event) => `${event.status}/${event.sinceStartMs}`).join(",") || "-"} dist=${
          distribution.events.map((event) => `${event.status}/${event.sinceStartMs}`).join(",") || "-"
        }`,
      );
    }
  } else if (mode === "click-burst") {
    const burstSize = Number.parseInt(options.burstSize ?? "6", 10);
    const intervalMs = Number.parseInt(options.intervalMs ?? "120", 10);
    const firstLocation = locations[0];
    await page.goto(`${baseUrl}/analysis?locationId=${encodeURIComponent(firstLocation.id)}&tab=models`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });
    await waitUntil(async () => {
      const state = await readState();
      return { ok: state.locationId === firstLocation.id && state.rankingRows > 0, state };
    }, 30_000, 250);

    for (let index = 1; index < locations.length; index += burstSize) {
      const burst = locations.slice(index, index + burstSize);
      const finalLocation = burst.at(-1);
      if (!finalLocation) {
        continue;
      }

      const startedAt = now();
      const requestStarts = new Map();
      const api = [];
      const failures = [];
      const clickErrors = [];
      const onRequest = (request) => {
        const url = request.url();
        if (url.includes("/api/weather/")) {
          requestStarts.set(request, now());
        }
      };
      const onResponse = async (response) => {
        const request = response.request();
        const url = response.url();
        if (!url.includes("/api/weather/")) {
          return;
        }
        let body = null;
        if (!response.ok()) {
          body = await response.text().catch(() => null);
        }
        api.push({
          url,
          status: response.status(),
          elapsedMs: now() - (requestStarts.get(request) ?? startedAt),
          sinceStartMs: now() - startedAt,
          body: body?.slice(0, 240) ?? null,
        });
      };
      const onFailed = (request) => {
        const url = request.url();
        if (url.includes("/api/weather/")) {
          failures.push({
            url,
            status: "ERR",
            errorText: request.failure()?.errorText ?? "unknown",
            elapsedMs: now() - (requestStarts.get(request) ?? startedAt),
            sinceStartMs: now() - startedAt,
          });
        }
      };
      page.on("request", onRequest);
      page.on("response", onResponse);
      page.on("requestfailed", onFailed);

      for (const location of burst) {
        try {
          await page
            .getByRole("button", { name: `${location.code} ${location.displayName}` })
            .first()
            .click({ timeout: 2_500 });
        } catch (error) {
          clickErrors.push({
            locationId: location.id,
            error: error instanceof Error ? error.message : String(error),
          });
          break;
        }
        await sleep(intervalMs);
      }

      const currentRowsReady = await waitForCurrentModelRender({
        readState,
        api,
        locationId: finalLocation.id,
        rowTimeoutMs,
      });
      const finalState = await readState();
      page.off("request", onRequest);
      page.off("response", onResponse);
      page.off("requestfailed", onFailed);

      const dashboard = summarizeLocationEndpoint(api, "/dashboard", finalLocation.id);
      const insights = summarizeLocationEndpoint(api, "/multimodel/insights", finalLocation.id);
      const distribution = summarizeLocationEndpoint(api, "/multimodel/distribution", finalLocation.id);
      const classification =
        clickErrors.length > 0
          ? "frontend_click_target_missing"
          : classify({
              rowTimeoutMs,
              finalState,
              api,
              failures,
              rowsReady: currentRowsReady,
              locationId: finalLocation.id,
            });
      const result = {
        id: finalLocation.id,
        code: finalLocation.code,
        cityName: finalLocation.cityName,
        burstIds: burst.map((location) => location.id),
        ok: clickErrors.length === 0 && currentRowsReady.ok,
        classification,
        clickErrors,
        currentRowsMs: currentRowsReady.ok ? now() - startedAt : null,
        rankingRows: finalState.rankingRows,
        refreshState: finalState.refreshState,
        dashboard,
        insights,
        distribution,
        failures,
        allApiEvents: api.map(({ url, status, sinceStartMs, elapsedMs, body }) => ({
          path: new URL(url).pathname,
          locationId: new URL(url).searchParams.get("locationId"),
          status,
          sinceStartMs,
          elapsedMs,
          body,
        })),
        text: finalState.text,
      };
      results.push(result);
      console.log(
        `${result.ok ? "OK" : "MISS"} click-burst final=${result.id} class=${classification} currentRows=${
          result.currentRowsMs ?? "-"
        }ms insight=${insights.events.map((event) => `${event.status}/${event.sinceStartMs}`).join(",") || "-"} dist=${
          distribution.events.map((event) => `${event.status}/${event.sinceStartMs}`).join(",") || "-"
        } clickErrors=${clickErrors.length}`,
      );
    }
  } else if (mode === "switch") {
    const firstLocation = locations[0];
    await page.goto(`${baseUrl}/analysis?locationId=${encodeURIComponent(firstLocation.id)}&tab=models`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });
    await waitUntil(async () => {
      const state = await readState();
      return { ok: state.locationId === firstLocation.id && state.rankingRows > 0, state };
    }, 30_000, 250);

    for (const location of locations.slice(1)) {
      await measureLocation(location, async () => {
        await switchLocationBySearch(page, location);
      });
    }
  } else {
    for (const location of locations) {
      await measureLocation(location, async () => {
        await page.goto(`${baseUrl}/analysis?locationId=${encodeURIComponent(location.id)}&tab=models`, {
          waitUntil: "domcontentloaded",
          timeout: 20_000,
        });
      });
    }
  }

  await browser.close();

  const summary = summarizeResults({ baseUrl, mode, results, readyKey: "currentRowsMs" });
  await fs.writeFile(path.join(artifactDir, "multimodel-render-timing.json"), JSON.stringify({ summary, results }, null, 2), "utf8");
  console.log(JSON.stringify({ artifactDir: path.relative(repoRoot, artifactDir), summary }, null, 2));

  if (summary.missed > 0) {
    process.exitCode = 1;
  }
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
