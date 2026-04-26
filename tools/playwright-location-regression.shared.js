import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const configPath = path.join(repoRoot, "src", "config.ts");
const artifactRoot = path.join(repoRoot, "test-results", "playwright-location-regression");
const browserExecutableCandidates = [
  process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);

export const DEFAULT_BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
export const fatalTextPattern = /Request failed with status (500|503)|请求失败|请稍后重试|无法加载/i;

export const ANALYSIS_SWITCH_SEQUENCE = [
  { id: "shanghai_pvg", code: "PVG", displayName: "Shanghai Pudong International Airport", cityName: "Shanghai" },
  { id: "miami_mia", code: "MIA", displayName: "Miami International Airport", cityName: "Miami" },
  { id: "toronto_yyz", code: "YYZ", displayName: "Toronto Pearson International Airport", cityName: "Toronto" },
  { id: "wuhan_wuh", code: "WUH", displayName: "Wuhan Tianhe International Airport", cityName: "Wuhan" },
  { id: "miami_mia", code: "MIA", displayName: "Miami International Airport", cityName: "Miami" },
];

export const KELLY_SWITCH_SEQUENCE = [
  { id: "miami_mia", code: "MIA", displayName: "Miami International Airport", cityName: "Miami" },
  { id: "atlanta_atl", code: "ATL", displayName: "Hartsfield-Jackson Atlanta International Airport", cityName: "Atlanta" },
  { id: "lagos_los", code: "LOS", displayName: "Murtala Muhammed International Airport", cityName: "Lagos" },
  { id: "miami_mia", code: "MIA", displayName: "Miami International Airport", cityName: "Miami" },
];

export const KELLY_PRESSURE_SEQUENCE = [
  { id: "miami_mia", code: "MIA", displayName: "Miami International Airport", cityName: "Miami" },
  { id: "atlanta_atl", code: "ATL", displayName: "Hartsfield-Jackson Atlanta International Airport", cityName: "Atlanta" },
  { id: "toronto_yyz", code: "YYZ", displayName: "Toronto Pearson International Airport", cityName: "Toronto" },
  { id: "miami_mia", code: "MIA", displayName: "Miami International Airport", cityName: "Miami" },
];

export const ONLINE_SMOKE_LOCATIONS = [
  { id: "shanghai_pvg", code: "PVG", displayName: "Shanghai Pudong International Airport", cityName: "Shanghai" },
  { id: "miami_mia", code: "MIA", displayName: "Miami International Airport", cityName: "Miami" },
  { id: "wuhan_wuh", code: "WUH", displayName: "Wuhan Tianhe International Airport", cityName: "Wuhan" },
  { id: "toronto_yyz", code: "YYZ", displayName: "Toronto Pearson International Airport", cityName: "Toronto" },
  { id: "atlanta_atl", code: "ATL", displayName: "Hartsfield-Jackson Atlanta International Airport", cityName: "Atlanta" },
  { id: "amsterdam_ams", code: "AMS", displayName: "Amsterdam Airport Schiphol", cityName: "Amsterdam" },
];

const searchNpxModuleEntries = async (relativePath) => {
  const candidates = [];
  const cacheRoots = [
    process.env.PLAYWRIGHT_NPX_CACHE_DIR,
    path.join(os.homedir(), "AppData", "Local", "npm-cache", "_npx"),
    path.join(os.homedir(), ".npm", "_npx"),
  ].filter(Boolean);

  for (const cacheRoot of cacheRoots) {
    try {
      const dirs = await fs.readdir(cacheRoot, { withFileTypes: true });
      for (const dirent of dirs) {
        if (!dirent.isDirectory()) {
          continue;
        }
        const entryPath = path.join(cacheRoot, dirent.name, "node_modules", ...relativePath.split("/"));
        try {
          const stats = await fs.stat(entryPath);
          if (stats.isFile()) {
            candidates.push({
              entryPath,
              mtimeMs: stats.mtimeMs,
            });
          }
        } catch {
          // Ignore missing cache entries.
        }
      }
    } catch {
      // Ignore missing cache directories.
    }
  }

  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return candidates.map((item) => item.entryPath);
};

const resolveFromRequire = (specifier) => {
  const require = createRequire(import.meta.url);
  try {
    return require.resolve(specifier);
  } catch {
    return null;
  }
};

const resolvePlaywrightEntry = async (kind) => {
  const explicit =
    kind === "playwright"
      ? process.env.PLAYWRIGHT_REQUIRE_PATH
      : process.env.PLAYWRIGHT_TEST_REQUIRE_PATH;
  if (explicit) {
    return explicit;
  }

  const localCandidates =
    kind === "playwright"
      ? [resolveFromRequire("playwright")]
      : [resolveFromRequire("@playwright/test"), resolveFromRequire("playwright/test")];
  for (const candidate of localCandidates) {
    if (candidate) {
      return candidate;
    }
  }

  const cachedCandidates =
    kind === "playwright"
      ? await searchNpxModuleEntries("playwright/index.js")
      : [
          ...(await searchNpxModuleEntries("@playwright/test/index.js")),
          ...(await searchNpxModuleEntries("playwright/test.js")),
        ];
  if (cachedCandidates[0]) {
    return cachedCandidates[0];
  }

  throw new Error(
    kind === "playwright"
      ? "Unable to resolve Playwright runtime. Install 'playwright' or set PLAYWRIGHT_REQUIRE_PATH."
      : "Unable to resolve Playwright Test runtime. Install '@playwright/test' or set PLAYWRIGHT_TEST_REQUIRE_PATH.",
  );
};

export const resolvePlaywrightTestModuleSpecifier = async () =>
  pathToFileURL(await resolvePlaywrightEntry("test")).href;

export const loadChromium = async () => {
  const playwright = await import(pathToFileURL(await resolvePlaywrightEntry("playwright")).href);
  return playwright.chromium ?? playwright.default?.chromium ?? null;
};

export const loadPlaywrightTestApi = async () => {
  const module = await import(await resolvePlaywrightTestModuleSpecifier());
  const api = module.default ?? module;
  return {
    expect: api.expect,
    test: api.test,
  };
};

export const readEnabledLocations = async () => {
  const text = await fs.readFile(configPath, "utf8");
  const entryPattern =
    /^\s{2}([a-z0-9_]+):\s*\{[\s\S]*?^\s{4}code:\s*"([^"]+)",[\s\S]*?^\s{4}displayName:\s*"([^"]+)",[\s\S]*?^\s{4}cityName:\s*"([^"]+)",[\s\S]*?^\s{4}enabled:\s*(true|false),[\s\S]*?^\s{2}\},?$/gm;

  const locations = [];
  for (const match of text.matchAll(entryPattern)) {
    if (match[5] !== "true") {
      continue;
    }

    locations.push({
      id: match[1],
      code: match[2],
      displayName: match[3],
      cityName: match[4],
    });
  }

  return locations;
};

export const sanitizeName = (value) => value.replace(/[^a-z0-9_-]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase();

export const createArtifactDir = async (suiteName, baseUrl = DEFAULT_BASE_URL) => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(artifactRoot, `${timestamp}-${sanitizeName(suiteName)}-${sanitizeName(new URL(baseUrl).hostname)}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
};

const resolveBrowserExecutablePath = async () => {
  for (const candidate of browserExecutableCandidates) {
    try {
      const stats = await fs.stat(candidate);
      if (stats.isFile()) {
        return candidate;
      }
    } catch {
      // Ignore missing browser binaries.
    }
  }

  return null;
};

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const waitFor = async (predicate, timeoutMs, label, intervalMs = 1_000) => {
  const startedAt = Date.now();
  let lastValue = null;
  while (Date.now() - startedAt < timeoutMs) {
    lastValue = await predicate();
    if (lastValue) {
      return lastValue;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}.`);
};

const extractKellyRepriceInfo = (payload) => {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const freshness = payload.freshness && typeof payload.freshness === "object" ? payload.freshness : null;
  const streamHealth = payload.streamHealth && typeof payload.streamHealth === "object" ? payload.streamHealth : null;
  const repricedAt = freshness?.repricedAt ?? null;
  const lastRepricedAt = streamHealth?.lastRepricedAt ?? null;
  const generatedAt = payload.generatedAt ?? null;

  if (!repricedAt && !lastRepricedAt && !generatedAt) {
    return null;
  }

  return {
    repricedAt,
    lastRepricedAt,
    generatedAt,
  };
};

export const createRequestTracker = (page) => {
  const events = [];
  const pushEvent = (event) => {
    events.push({
      ...event,
      recordedAt: new Date().toISOString(),
    });
  };

  const onResponse = async (response) => {
    const url = response.url();
    if (!url.includes("/api/weather/")) {
      return;
    }

    const event = {
      type: "response",
      url,
      method: response.request().method(),
      status: response.status(),
    };

    if (url.includes("/api/weather/kelly")) {
      try {
        const payload = await response.json();
        const repriceInfo = extractKellyRepriceInfo(payload);
        if (repriceInfo) {
          event.kellyReprice = repriceInfo;
        }
      } catch {
        // Ignore JSON parse failures for Kelly responses.
      }
    }

    pushEvent(event);
  };

  const onRequestFailed = (request) => {
    const url = request.url();
    if (!url.includes("/api/weather/")) {
      return;
    }

    pushEvent({
      type: "requestfailed",
      url,
      method: request.method(),
      errorText: request.failure()?.errorText ?? "unknown",
    });
  };

  const onConsole = (message) => {
    if (message.type() !== "error") {
      return;
    }
    pushEvent({
      type: "console-error",
      text: message.text(),
    });
  };

  const onPageError = (error) => {
    pushEvent({
      type: "page-error",
      text: error instanceof Error ? error.message : String(error),
    });
  };

  page.on("response", onResponse);
  page.on("requestfailed", onRequestFailed);
  page.on("console", onConsole);
  page.on("pageerror", onPageError);

  return {
    get events() {
      return [...events];
    },
    clear() {
      events.length = 0;
    },
    stop() {
      page.off("response", onResponse);
      page.off("requestfailed", onRequestFailed);
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
    },
  };
};

const hasEndpointRequest = (events, endpointFragment, locationId) =>
  events.some((event) => {
    if (!("url" in event) || typeof event.url !== "string" || !event.url.includes(endpointFragment)) {
      return false;
    }
    try {
      const url = new URL(event.url);
      return url.searchParams.get("locationId") === locationId;
    } catch {
      return false;
    }
  });

const resolveTrackedLocationId = (events) => {
  for (const event of [...events].reverse()) {
    if (!("url" in event) || typeof event.url !== "string" || !event.url.includes("/api/weather/")) {
      continue;
    }
    try {
      const url = new URL(event.url);
      const locationId = url.searchParams.get("locationId");
      if (locationId) {
        return locationId;
      }
    } catch {
      // Ignore malformed URLs.
    }
  }

  return null;
};

const resolveLatestKellyReprice = (events) => {
  for (const event of [...events].reverse()) {
    if (event.type === "response" && event.kellyReprice) {
      return event.kellyReprice;
    }
  }
  return null;
};

const resolveKellyRepriceTimestamp = (repriceInfo) =>
  repriceInfo?.lastRepricedAt ?? repriceInfo?.repricedAt ?? repriceInfo?.generatedAt ?? null;

const normalizeTitleToken = (value) => value.toLowerCase().replace(/[^a-z0-9\s]+/g, " ").replace(/\s+/g, " ").trim();

const titleMatchesLocation = (title, location) => {
  const normalizedTitle = normalizeTitleToken(title);
  const directTokens = [location.displayName, location.cityName].filter(Boolean).map(normalizeTitleToken);
  if (directTokens.some((token) => token && normalizedTitle.includes(token))) {
    return true;
  }

  const titleTokenSet = new Set(normalizedTitle.split(" ").filter((token) => token.length >= 4));
  const displayTokens = normalizeTitleToken(location.displayName)
    .split(" ")
    .filter((token) => token.length >= 4);
  const matchedCount = displayTokens.filter((token) => titleTokenSet.has(token)).length;
  return matchedCount >= 2;
};

export const collectPageState = async (page, tracker) => {
  const bodyText = await page.locator("body").innerText();
  const events = tracker?.events ?? [];
  const locationId = new URL(page.url()).searchParams.get("locationId") ?? resolveTrackedLocationId(events);
  const latestKellyReprice = resolveLatestKellyReprice(events);
  const lastRepricedAt = resolveKellyRepriceTimestamp(latestKellyReprice);
  const readText = async (selector) =>
    (await page
      .locator(selector)
      .first()
      .textContent({ timeout: 2_000 })
      .catch(() => null))?.trim() ?? "";
  const readCount = async (selector) => await page.locator(selector).count().catch(() => 0);
  const readAttribute = async (selector, name) =>
    (await page.locator(selector).first().getAttribute(name, { timeout: 2_000 }).catch(() => null)) ?? null;
  const responseEvents = events.filter(
    (event) => event.type === "response" && typeof event.status === "number" && typeof event.recordedAt === "string",
  );
  const responseErrors = responseEvents.filter((event) => {
    if (event.status !== 500 && event.status !== 503) {
      return false;
    }

    return !responseEvents.some(
      (nextEvent) =>
        nextEvent.status >= 200 &&
        nextEvent.status < 400 &&
        nextEvent.method === event.method &&
        nextEvent.url === event.url &&
        new Date(nextEvent.recordedAt).getTime() > new Date(event.recordedAt).getTime(),
    );
  });

  return {
    url: page.url(),
    locationId,
    title: await readText(".command-header-title"),
    bodyText,
    hasFatalText: fatalTextPattern.test(bodyText),
    hasAnalysisArticles: (await readCount(".analysis-content article")) > 0,
    hasKellyMarkets: (await readCount(".kelly-market-card")) > 0,
    hasKellyEmptyBlock: (await readCount(".kelly-empty-block, .kelly-empty-panel")) > 0,
    hasKellyShell: (await readCount(".kelly-shell, .kelly-workbench-shell")) > 0,
    hasTransition: (await readCount(".command-header-transition")) > 0,
    refreshState: await readAttribute(".command-header-refresh", "data-refresh-state"),
    kellyReprice: latestKellyReprice,
    lastRepricedAt,
    apiEvents: events,
    responseErrors,
    hasDashboardRequest: locationId ? hasEndpointRequest(events, "/api/weather/dashboard", locationId) : false,
    hasInsightsRequest: locationId ? hasEndpointRequest(events, "/api/weather/multimodel/insights", locationId) : false,
    hasDistributionRequest: locationId ? hasEndpointRequest(events, "/api/weather/multimodel/distribution", locationId) : false,
    hasKellyRequest: locationId ? hasEndpointRequest(events, "/api/weather/kelly", locationId) : false,
    hasKellyForceRefreshRequest: locationId
      ? events.some(
          (event) =>
            event.type === "response" &&
            typeof event.url === "string" &&
            event.url.includes("/api/weather/kelly") &&
            event.url.includes(`locationId=${encodeURIComponent(locationId)}`) &&
            event.url.includes("forceRefresh=true"),
        )
      : false,
  };
};

export const writeScenarioArtifacts = async (page, artifactDir, scenarioName, state, extra = {}) => {
  const safeName = sanitizeName(scenarioName);
  const screenshotPath = path.join(artifactDir, `${safeName}.png`);
  const htmlPath = path.join(artifactDir, `${safeName}.html`);
  const jsonPath = path.join(artifactDir, `${safeName}.json`);

  await fs.mkdir(artifactDir, { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
  await fs.writeFile(htmlPath, await page.content(), "utf8").catch(() => undefined);
  await fs.writeFile(
    jsonPath,
    JSON.stringify(
      {
        state,
        ...extra,
      },
      null,
      2,
    ),
    "utf8",
  );

  return {
    screenshotPath,
    htmlPath,
    jsonPath,
  };
};

export const waitForHeaderTitle = async (page, expected) => {
  await waitFor(async () => {
    const text =
      (await page
        .locator(".command-header-title")
        .first()
        .textContent({ timeout: 2_000 })
        .catch(() => null))?.trim() ?? "";
    return text.includes(expected) ? text : null;
  }, 30_000, `header title ${expected}`, 500);
};

export const waitForLocationTitle = async (page, location) => {
  await waitFor(async () => {
    const text =
      (await page
        .locator(".command-header-title")
        .first()
        .textContent({ timeout: 2_000 })
        .catch(() => null))?.trim() ?? "";
    return titleMatchesLocation(text, location) ? text : null;
  }, 30_000, `header title ${location.id}`, 500);
};

export const waitForAnalysisReady = async (page, tracker, expectedLocationId) => {
  return await waitFor(async () => {
    const state = await collectPageState(page, tracker);
    if (state.hasFatalText || state.responseErrors.length > 0) {
      throw new Error(`Analysis page entered fatal state: ${state.bodyText.slice(0, 500)}`);
    }
    if (expectedLocationId && state.locationId && state.locationId !== expectedLocationId) {
      return null;
    }
    if (state.hasAnalysisArticles && !state.hasTransition) {
      return state;
    }
    return null;
  }, 45_000, "analysis content", 1_000);
};

export const waitForKellyReady = async (page, tracker, expectedLocationId) => {
  return await waitFor(async () => {
    const state = await collectPageState(page, tracker);
    if (state.hasFatalText || state.responseErrors.length > 0) {
      throw new Error(`Kelly page entered fatal state: ${state.bodyText.slice(0, 500)}`);
    }
    const hasVisibleContent = state.hasKellyMarkets || state.hasKellyEmptyBlock || state.hasKellyShell;
    const hasExpectedRequest = expectedLocationId
      ? hasEndpointRequest(state.apiEvents, "/api/weather/kelly", expectedLocationId)
      : state.hasKellyRequest;
    if (hasVisibleContent && !state.hasTransition && hasExpectedRequest) {
      return state;
    }
    return null;
  }, 60_000, "kelly content", 1_000);
};

export const switchLocationBySearch = async (page, location) => {
  await page.locator(".command-header-rail-toggle").click();
  await waitFor(async () => (await page.locator(".location-rail-search input").count()) > 0, 10_000, "rail search", 250);
  const search = page.locator(".location-rail-search input");
  await search.fill(location.code);
  const card = page.locator(`[data-location-card="true"][data-location-id="${location.id}"]`).first();
  await waitFor(async () => (await card.count()) > 0, 15_000, `location card ${location.id}`, 250);
  await card.click();
  await waitForLocationTitle(page, location);
  await waitFor(async () => {
    const current = new URL(page.url()).searchParams.get("locationId");
    return current === null || current === location.id ? current ?? location.id : null;
  }, 20_000, `url location ${location.id}`, 500);
};

export const settleRefreshButton = async (page) => {
  await page.locator(".command-header-refresh").click();
  await waitFor(
    async () => ((await page.locator(".command-header-refresh").getAttribute("data-refresh-state")) === "pending" ? true : null),
    10_000,
    "refresh pending",
    500,
  );
  await waitFor(
    async () => {
      const state = (await page.locator(".command-header-refresh").getAttribute("data-refresh-state")) ?? "";
      return state !== "pending" ? state : null;
    },
    30_000,
    "refresh settle",
    1_000,
  );
};

export const runAnalysisSwitchRegression = async (page, tracker, artifactDir, options = {}) => {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  tracker.clear();

  try {
    await page.goto(`${baseUrl}/analysis?locationId=${ANALYSIS_SWITCH_SEQUENCE[0].id}`, { waitUntil: "domcontentloaded" });
    await waitForLocationTitle(page, ANALYSIS_SWITCH_SEQUENCE[0]);
    await waitForAnalysisReady(page, tracker, ANALYSIS_SWITCH_SEQUENCE[0].id);

    for (const location of ANALYSIS_SWITCH_SEQUENCE.slice(1)) {
      tracker.clear();
      await switchLocationBySearch(page, location);
      await waitForAnalysisReady(page, tracker, location.id);
      await sleep(4_000);
    }

    await sleep(12_000);
    tracker.clear();
    await settleRefreshButton(page);
    const state = await waitForAnalysisReady(page, tracker, ANALYSIS_SWITCH_SEQUENCE.at(-1)?.id);
    return {
      ok: true,
      state,
    };
  } catch (error) {
    const state = await collectPageState(page, tracker);
    const artifacts = await writeScenarioArtifacts(page, artifactDir, "analysis-switch-regression", state, {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      state,
      artifacts,
    };
  }
};

export const runAnalysisAllLocationsSmoke = async (page, tracker, artifactDir, locations, options = {}) => {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const failures = [];

  for (const location of locations) {
    tracker.clear();
    try {
      await page.goto(`${baseUrl}/analysis?locationId=${location.id}`, { waitUntil: "domcontentloaded" });
      await waitForLocationTitle(page, location);
      const state = await waitForAnalysisReady(page, tracker, location.id);
      await sleep(2_000);
      if (!state.hasAnalysisArticles) {
        throw new Error("Analysis articles are not visible.");
      }
    } catch (error) {
      const state = await collectPageState(page, tracker);
      const artifacts = await writeScenarioArtifacts(page, artifactDir, `analysis-${location.id}`, state, {
        location,
        error: error instanceof Error ? error.message : String(error),
      });
      failures.push({
        locationId: location.id,
        error: error instanceof Error ? error.message : String(error),
        state,
        artifacts,
      });
    }
  }

  return {
    ok: failures.length === 0,
    failures,
  };
};

export const runKellySwitchRegression = async (page, tracker, artifactDir, options = {}) => {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  tracker.clear();

  try {
    await page.goto(`${baseUrl}/kelly?locationId=${KELLY_SWITCH_SEQUENCE[0].id}`, { waitUntil: "domcontentloaded" });
    await waitForLocationTitle(page, KELLY_SWITCH_SEQUENCE[0]);
    await waitForKellyReady(page, tracker, KELLY_SWITCH_SEQUENCE[0].id);

    for (const location of KELLY_SWITCH_SEQUENCE.slice(1)) {
      tracker.clear();
      await switchLocationBySearch(page, location);
      await waitForKellyReady(page, tracker, location.id);
      await sleep(5_000);
    }

    await sleep(12_000);
    tracker.clear();
    await settleRefreshButton(page);
    const state = await waitForKellyReady(page, tracker, KELLY_SWITCH_SEQUENCE.at(-1)?.id);
    return {
      ok: true,
      state,
    };
  } catch (error) {
    const state = await collectPageState(page, tracker);
    const artifacts = await writeScenarioArtifacts(page, artifactDir, "kelly-switch-regression", state, {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      state,
      artifacts,
    };
  }
};

export const runKellyAllLocationsSmoke = async (page, tracker, artifactDir, locations, options = {}) => {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const failures = [];

  for (const location of locations) {
    tracker.clear();
    try {
      await page.goto(`${baseUrl}/kelly?locationId=${location.id}`, { waitUntil: "domcontentloaded" });
      await waitForLocationTitle(page, location);
      let state = await waitForKellyReady(page, tracker, location.id);
      if (!(state.hasKellyMarkets || state.hasKellyEmptyBlock || state.hasKellyShell)) {
        throw new Error("Kelly content is not visible.");
      }

      await sleep(2_000);
      tracker.clear();
      await settleRefreshButton(page);
      state = await waitForKellyReady(page, tracker, location.id);
      if (!state.hasKellyForceRefreshRequest) {
        throw new Error("Kelly force refresh request was not observed.");
      }
      if (!(state.hasKellyMarkets || state.hasKellyEmptyBlock || state.hasKellyShell)) {
        throw new Error("Kelly content disappeared after refresh.");
      }
    } catch (error) {
      const state = await collectPageState(page, tracker);
      const artifacts = await writeScenarioArtifacts(page, artifactDir, `kelly-${location.id}`, state, {
        location,
        error: error instanceof Error ? error.message : String(error),
      });
      failures.push({
        locationId: location.id,
        error: error instanceof Error ? error.message : String(error),
        state,
        artifacts,
      });
    }
  }

  return {
    ok: failures.length === 0,
    failures,
  };
};

export const runKellyPressureRegression = async (page, tracker, artifactDir, options = {}) => {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const sequence = options.sequence ?? KELLY_PRESSURE_SEQUENCE;
  const refreshRounds = options.refreshRounds ?? 2;
  const refreshDelayMs = options.refreshDelayMs ?? 750;
  const steps = [];
  const lastRepricedByLocation = new Map();
  let ok = true;

  const recordArtifactsIfNeeded = async (scenarioName, state, meta) => {
    const artifacts = await writeScenarioArtifacts(page, artifactDir, scenarioName, state, meta);
    return artifacts;
  };

  try {
    tracker.clear();
    await page.goto(`${baseUrl}/kelly?locationId=${sequence[0].id}`, { waitUntil: "domcontentloaded" });
    await waitForLocationTitle(page, sequence[0]);
    await waitForKellyReady(page, tracker, sequence[0].id);

    for (let index = 0; index < sequence.length; index += 1) {
      const location = sequence[index];
      const step = {
        index,
        locationId: location.id,
        locationCode: location.code,
        locationName: location.cityName,
        switched: index === 0,
        switchError: null,
        switchArtifacts: null,
        refreshes: [],
      };

      if (index > 0) {
        tracker.clear();
        try {
          await switchLocationBySearch(page, location);
          await waitForKellyReady(page, tracker, location.id);
          step.switched = true;
        } catch (error) {
          ok = false;
          step.switchError = error instanceof Error ? error.message : String(error);
          const state = await collectPageState(page, tracker);
          step.switchArtifacts = await recordArtifactsIfNeeded(
            `kelly-pressure-switch-${location.id}`,
            state,
            { error: step.switchError, location },
          );
          steps.push(step);
          break;
        }
      }

      let lastKnownReprice = lastRepricedByLocation.get(location.id) ?? null;

      for (let round = 1; round <= refreshRounds; round += 1) {
        tracker.clear();
        const beforeState = await collectPageState(page, tracker);
        const beforeReprice = resolveKellyRepriceTimestamp(beforeState.kellyReprice) ?? lastKnownReprice;

        const refreshRecord = {
          round,
          url: beforeState.url,
          urlLocationId: beforeState.locationId,
          urlMatchesExpected: beforeState.locationId === location.id,
          refreshStateBefore: beforeState.refreshState,
          refreshStateAfter: null,
          timedOutWaitingForRefreshSettle: false,
          timedOutWaitingForRefreshPending: false,
          refreshError: null,
          readyError: null,
          hasResponseError: false,
          responseErrors: [],
          lastRepricedAtBefore: beforeReprice,
          lastRepricedAtAfter: null,
          lastRepricedUpdated: null,
          stuckPending: false,
          artifacts: null,
        };

        try {
          await settleRefreshButton(page);
        } catch (error) {
          ok = false;
          const message = error instanceof Error ? error.message : String(error);
          refreshRecord.refreshError = message;
          refreshRecord.timedOutWaitingForRefreshSettle = message.includes("Timed out waiting for refresh settle");
          refreshRecord.timedOutWaitingForRefreshPending = message.includes("Timed out waiting for refresh pending");
        }

        let afterState = null;
        try {
          afterState = await waitForKellyReady(page, tracker, location.id);
        } catch (error) {
          ok = false;
          refreshRecord.readyError = error instanceof Error ? error.message : String(error);
          afterState = await collectPageState(page, tracker);
        }

        refreshRecord.refreshStateAfter = afterState.refreshState;
        refreshRecord.stuckPending = afterState.refreshState === "pending";
        refreshRecord.hasResponseError = afterState.responseErrors.length > 0;
        refreshRecord.responseErrors = afterState.responseErrors.map((entry) => ({
          url: entry.url,
          status: entry.status,
          recordedAt: entry.recordedAt,
        }));

        const afterReprice = resolveKellyRepriceTimestamp(afterState.kellyReprice);
        refreshRecord.lastRepricedAtAfter = afterReprice;
        refreshRecord.lastRepricedUpdated =
          Boolean(afterReprice) && Boolean(beforeReprice) ? afterReprice !== beforeReprice : Boolean(afterReprice && !beforeReprice);

        if (afterReprice) {
          lastKnownReprice = afterReprice;
          lastRepricedByLocation.set(location.id, afterReprice);
        }

        const needsArtifacts =
          refreshRecord.refreshError ||
          refreshRecord.readyError ||
          refreshRecord.hasResponseError ||
          refreshRecord.stuckPending ||
          !refreshRecord.urlMatchesExpected;

        if (needsArtifacts) {
          const state = afterState ?? (await collectPageState(page, tracker));
          refreshRecord.artifacts = await recordArtifactsIfNeeded(
            `kelly-pressure-${location.id}-refresh-${round}`,
            state,
            { location, refreshRecord },
          );
        }

        step.refreshes.push(refreshRecord);

        if (refreshDelayMs > 0) {
          await sleep(refreshDelayMs);
        }
      }

      steps.push(step);
      await sleep(1_000);
    }
  } catch (error) {
    ok = false;
    const state = await collectPageState(page, tracker);
    const artifacts = await recordArtifactsIfNeeded("kelly-pressure-fatal", state, {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ok,
      error: error instanceof Error ? error.message : String(error),
      artifacts,
      steps,
    };
  }

  return {
    ok,
    steps,
  };
};

export const runOnlineSmoke = async (page, tracker, artifactDir, options = {}) => {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const analysisFailures = [];
  const kellyFailures = [];

  for (const location of ONLINE_SMOKE_LOCATIONS) {
    tracker.clear();
    try {
      await page.goto(`${baseUrl}/analysis?locationId=${location.id}`, { waitUntil: "domcontentloaded" });
      await waitForLocationTitle(page, location);
      await waitForAnalysisReady(page, tracker, location.id);
    } catch (error) {
      const state = await collectPageState(page, tracker);
      const artifacts = await writeScenarioArtifacts(page, artifactDir, `online-analysis-${location.id}`, state, {
        location,
        error: error instanceof Error ? error.message : String(error),
      });
      analysisFailures.push({
        locationId: location.id,
        error: error instanceof Error ? error.message : String(error),
        state,
        artifacts,
      });
    }

    tracker.clear();
    try {
      await page.goto(`${baseUrl}/kelly?locationId=${location.id}`, { waitUntil: "domcontentloaded" });
      await waitForLocationTitle(page, location);
      await waitForKellyReady(page, tracker, location.id);
    } catch (error) {
      const state = await collectPageState(page, tracker);
      const artifacts = await writeScenarioArtifacts(page, artifactDir, `online-kelly-${location.id}`, state, {
        location,
        error: error instanceof Error ? error.message : String(error),
      });
      kellyFailures.push({
        locationId: location.id,
        error: error instanceof Error ? error.message : String(error),
        state,
        artifacts,
      });
    }
  }

  return {
    ok: analysisFailures.length === 0 && kellyFailures.length === 0,
    analysisFailures,
    kellyFailures,
  };
};

export const runRegressionSuites = async (options = {}) => {
  const chromium = await loadChromium();
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const suite = options.suite ?? "local-full";
  const headless = options.headless ?? process.env.PLAYWRIGHT_HEADLESS !== "false";
  const locations = options.locations ?? (await readEnabledLocations());
  const artifactDir = options.artifactDir ?? (await createArtifactDir(suite, baseUrl));
  const executablePath = await resolveBrowserExecutablePath();
  const browser = await chromium.launch({
    headless,
    executablePath: executablePath ?? undefined,
  });
  const page = await browser.newPage();
  const tracker = createRequestTracker(page);

  try {
    const result = {
      suite,
      baseUrl,
      artifactDir,
    };

    if (suite === "local-full" || suite === "analysis-switch") {
      result.analysisSwitch = await runAnalysisSwitchRegression(page, tracker, artifactDir, { baseUrl });
    }

    if (suite === "local-full" || suite === "analysis-all") {
      result.analysisAll = await runAnalysisAllLocationsSmoke(page, tracker, artifactDir, locations, { baseUrl });
    }

    if (suite === "local-full" || suite === "kelly-switch") {
      result.kellySwitch = await runKellySwitchRegression(page, tracker, artifactDir, { baseUrl });
    }

    if (suite === "kelly-pressure") {
      result.kellyPressure = await runKellyPressureRegression(page, tracker, artifactDir, { baseUrl });
    }

    if (suite === "local-full" || suite === "kelly-all") {
      result.kellyAll = await runKellyAllLocationsSmoke(page, tracker, artifactDir, locations, { baseUrl });
    }

    if (suite === "online-smoke") {
      result.onlineSmoke = await runOnlineSmoke(page, tracker, artifactDir, { baseUrl });
    }

    await fs.writeFile(path.join(artifactDir, "result.json"), JSON.stringify(result, null, 2), "utf8");
    return result;
  } finally {
    tracker.stop();
    await page.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
};
