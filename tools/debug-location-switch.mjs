import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import process from "node:process";
import WebSocket from "ws";

const chromePath =
  "C:/Users/32360/.cache/puppeteer/chrome/win64-131.0.6778.204/chrome-win64/chrome.exe";
const remotePort =
  Number.parseInt(process.env.DEBUG_REMOTE_PORT ?? "", 10) ||
  (9222 + Math.floor(Math.random() * 2000));
const userDataDir = `C:/Users/32360/AppData/Local/Temp/codex-chrome-${Date.now()}`;
const baseUrl = process.env.DEBUG_BASE_URL ?? "https://lukaluka.fun";
const requestedScenarioNames = new Set(
  process.argv
    .slice(2)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);

const chrome = spawn(
  chromePath,
  [
    `--remote-debugging-port=${remotePort}`,
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${userDataDir}`,
    "about:blank",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);

const chromeLogs = [];
chrome.stdout.on("data", (chunk) => chromeLogs.push(String(chunk)));
chrome.stderr.on("data", (chunk) => chromeLogs.push(String(chunk)));

const cleanup = () => {
  try {
    chrome.kill("SIGKILL");
  } catch {
    // ignore
  }
};

process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(1);
});

const waitForJson = async (path) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${remotePort}${path}`);
      if (response.ok) {
        return await response.json();
      }
    } catch {
      // retry
    }
    await delay(200);
  }
  throw new Error(`Timed out waiting for Chrome DevTools endpoint ${path}`);
};

const targets = await waitForJson("/json/list");
const pageTarget =
  targets.find((target) => target.type === "page" && target.url !== "about:blank") ??
  targets.find((target) => target.type === "page");

if (!pageTarget?.webSocketDebuggerUrl) {
  throw new Error("Could not find a page target for Chrome DevTools");
}

const socket = new WebSocket(pageTarget.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.once("open", resolve);
  socket.once("error", reject);
});

let messageId = 0;
const pending = new Map();
const events = [];
const networkEvents = [];
const trackedWeatherRequests = new Map();

socket.on("message", (raw) => {
  const payload = JSON.parse(String(raw));
  if (typeof payload.id === "number") {
    const entry = pending.get(payload.id);
    if (entry) {
      pending.delete(payload.id);
      if (payload.error) {
        entry.reject(new Error(payload.error.message));
      } else {
        entry.resolve(payload.result);
      }
    }
    return;
  }
  events.push(payload);

  if (payload.method === "Network.requestWillBeSent") {
    const requestId = payload.params?.requestId;
    const url = payload.params?.request?.url;
    if (requestId && typeof url === "string" && url.includes("/api/weather/")) {
      trackedWeatherRequests.set(requestId, url);
      networkEvents.push({
        type: "request",
        requestId,
        url,
        method: payload.params?.request?.method ?? "GET",
      });
    }
    return;
  }

  if (payload.method === "Network.responseReceived") {
    const requestId = payload.params?.requestId;
    const trackedUrl = requestId ? trackedWeatherRequests.get(requestId) : null;
    if (requestId && trackedUrl) {
      networkEvents.push({
        type: "response",
        requestId,
        url: trackedUrl,
        status: payload.params?.response?.status ?? null,
        statusText: payload.params?.response?.statusText ?? null,
      });
    }
    return;
  }

  if (payload.method === "Network.loadingFailed") {
    const requestId = payload.params?.requestId;
    const trackedUrl = requestId ? trackedWeatherRequests.get(requestId) : null;
    if (requestId && trackedUrl) {
      networkEvents.push({
        type: "failed",
        requestId,
        url: trackedUrl,
        errorText: payload.params?.errorText ?? null,
        canceled: Boolean(payload.params?.canceled),
      });
    }
  }
});

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++messageId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });

const waitForEvent = async (method, timeoutMs = 20000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const index = events.findIndex((event) => event.method === method);
    if (index >= 0) {
      return events.splice(index, 1)[0];
    }
    await delay(50);
  }
  throw new Error(`Timed out waiting for event ${method}`);
};

await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");
await send("Log.enable");

const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  return result.result?.value;
};

const summarizeRuntimeIssues = (startIndex) =>
  events
    .slice(startIndex)
    .filter((event) => event.method === "Runtime.exceptionThrown" || event.method === "Log.entryAdded")
    .slice(-20);

const summarizeWeatherRequests = (startIndex) =>
  events
    .slice(startIndex)
    .filter((event) => event.method === "Network.requestWillBeSent")
    .map((event) => event.params?.request?.url)
    .filter((url) => typeof url === "string" && url.includes("/api/weather/"));

const summarizeWeatherTraffic = (startIndex) =>
  networkEvents
    .slice(startIndex)
    .filter((entry) => typeof entry.url === "string" && entry.url.includes("/api/weather/"));

const locationIdByCode = {
  PVG: "shanghai_pvg",
  MIA: "miami_mia",
  YYZ: "toronto_yyz",
  WUH: "wuhan_wuh",
};

const readUrlLocationId = (href) => {
  try {
    return new URL(href).searchParams.get("locationId") ?? "shanghai_pvg";
  } catch {
    return null;
  }
};

const trafficHasRequest = (traffic, endpoint, locationId) =>
  traffic.some((entry) => {
    if (entry.type !== "request" || typeof entry.url !== "string" || !entry.url.includes(endpoint)) {
      return false;
    }
    try {
      return new URL(entry.url).searchParams.get("locationId") === locationId;
    } catch {
      return false;
    }
  });

const summarizeAnalysisTraffic = (traffic, locationId) => ({
  dashboard: trafficHasRequest(traffic, "/api/weather/dashboard", locationId),
  insights: trafficHasRequest(traffic, "/api/weather/multimodel/insights", locationId),
  distribution: trafficHasRequest(traffic, "/api/weather/multimodel/distribution", locationId),
  failed: traffic.filter((entry) => entry.type === "failed"),
  busy: traffic.some((entry) => /MULTIMODEL_LOAD_BUSY|load_busy/i.test(JSON.stringify(entry))),
});

const buildAnalysisFailureReasons = ({ snapshot, expectedTitle, expectedLocationId, trafficSummary }) => {
  const reasons = [];
  if (snapshot.page !== "analysis") {
    reasons.push("not_on_analysis_page");
  }
  if (snapshot.title !== expectedTitle) {
    reasons.push("title_not_committed");
  }
  if (readUrlLocationId(snapshot.href) !== expectedLocationId) {
    reasons.push("url_location_not_committed");
  }
  if (snapshot.transition) {
    reasons.push("location_transition_still_visible");
  }
  if (snapshot.hasTimeout) {
    reasons.push("timeout_visible");
  }
  if (snapshot.hasAnalysisSyncing || snapshot.syncState === "revalidating") {
    reasons.push("stuck_revalidating_after_current_responses");
  }
  if ((snapshot.analysisArticleCount ?? 0) <= 0) {
    reasons.push("analysis_article_missing");
  }
  if (trafficSummary && !trafficSummary.dashboard) {
    reasons.push("dashboard_request_missing");
  }
  if (trafficSummary && !trafficSummary.insights) {
    reasons.push("insights_request_missing");
  }
  if (trafficSummary && !trafficSummary.distribution) {
    reasons.push("distribution_request_missing");
  }
  if (trafficSummary?.busy) {
    reasons.push("multimodel_load_busy_seen");
  }
  return reasons;
};

const buildHomeFailureReasons = ({ snapshot, expectedTitle, expectedLocationId = null }) => {
  const reasons = [];
  if (snapshot.page !== "home") {
    reasons.push("not_on_home_page");
  }
  if (snapshot.title !== expectedTitle) {
    reasons.push("title_not_committed");
  }
  if (expectedLocationId && readUrlLocationId(snapshot.href) !== expectedLocationId) {
    reasons.push("url_location_not_committed");
  }
  if (snapshot.transition) {
    reasons.push("location_transition_still_visible");
  }
  if (snapshot.hasTimeout) {
    reasons.push("timeout_visible");
  }
  if ((snapshot.quickInsightCardCount ?? 0) <= 0) {
    reasons.push("quick_insight_missing");
  }
  if (snapshot.hasQuickInsightWaiting) {
    reasons.push("quick_insight_waiting");
  }
  return reasons;
};

const openUrl = async (url) => {
  await send("Page.navigate", { url });
  await waitForEvent("Page.loadEventFired", 20000);
  await delay(3000);
};

const readSnapshot = async () =>
  await evaluate(`(() => {
    const bodyText = document.body.innerText.slice(0, 2200);
    const analysisText = document.querySelector('.analysis-content')?.innerText?.replace(/\\s+/g, ' ').trim() ?? null;
    const analysisFingerprint = (() => {
      if (!analysisText) {
        return null;
      }
      let hash = 0;
      for (const char of analysisText) {
        hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
      }
      return hash.toString(16);
    })();
    return {
      href: location.href,
      title: document.querySelector('.command-header-title')?.textContent?.trim() ?? null,
      page: document.querySelector('.command-header-shell')?.getAttribute('data-page') ?? null,
      syncState: document.querySelector('.command-header-shell')?.getAttribute('data-sync-state') ?? null,
      transition: document.querySelector('.command-header-transition')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
      refreshState: document.querySelector('.command-header-refresh')?.getAttribute('data-refresh-state') ?? null,
      refreshLabel: document.querySelector('.command-header-refresh')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
      pendingCards: [...document.querySelectorAll('[data-pending="true"]')].map((node) => node.textContent?.replace(/\\s+/g, ' ').trim() ?? ''),
      weatherTimestamp: [...document.querySelectorAll('.analysis-content .metric-tile')].find((node) => node.textContent?.includes('天气时刻'))?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
      modelTimestamp: [...document.querySelectorAll('.analysis-content .metric-tile')].find((node) => node.textContent?.includes('模型时刻'))?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
      analysisText,
      analysisFingerprint,
      bodyText,
      quickInsightCardCount: document.querySelectorAll('.home-quick-insight-column article').length,
      analysisArticleCount: document.querySelectorAll('.analysis-content article').length,
      kellyMarketCardCount: document.querySelectorAll('.kelly-market-card').length,
      hasTimeout: /请求超时|请稍后重试/.test(bodyText),
      hasQuickInsightWaiting: /正在等待多模型快速分析结果|首页决策台加载中/.test(bodyText),
      hasAnalysisLoading: /分析工作区加载中|正在加载|等待模型数据/.test(bodyText),
      hasAnalysisSyncing: /分布数据正在同步|完整模型排序正在同步/.test(bodyText),
      hasKellyLoading: /正在加载 Kelly 分析|Kelly 实验台暂不可用/.test(bodyText),
      hasKellyConnected: /实时流已连接|已连接，最近无新盘口/.test(bodyText),
    };
  })()`);

const expandRail = async () => {
  await evaluate(`(() => {
    document.querySelector('.command-header-rail-toggle')?.click();
    return true;
  })()`);
  await delay(1000);
};

const clickRefresh = async () =>
  await evaluate(`(() => {
    const button = document.querySelector('.command-header-refresh');
    if (!button) {
      return { clicked: false, reason: 'refresh button not found' };
    }
    if (button.hasAttribute('disabled')) {
      return { clicked: false, reason: 'refresh button disabled' };
    }
    button.click();
    return { clicked: true, text: button.textContent?.replace(/\\s+/g, ' ').trim() ?? null };
  })()`);

const compactSnapshot = (snapshot, elapsedMs = null) => ({
  ...(elapsedMs === null ? {} : { elapsedMs }),
  href: snapshot.href,
  title: snapshot.title,
  page: snapshot.page,
  syncState: snapshot.syncState,
  transition: snapshot.transition,
  refreshState: snapshot.refreshState,
  refreshLabel: snapshot.refreshLabel,
  weatherTimestamp: snapshot.weatherTimestamp,
  modelTimestamp: snapshot.modelTimestamp,
  analysisFingerprint: snapshot.analysisFingerprint,
  pendingCards: snapshot.pendingCards,
  quickInsightCardCount: snapshot.quickInsightCardCount,
  analysisArticleCount: snapshot.analysisArticleCount,
  kellyMarketCardCount: snapshot.kellyMarketCardCount,
  hasTimeout: snapshot.hasTimeout,
  hasQuickInsightWaiting: snapshot.hasQuickInsightWaiting,
  hasAnalysisLoading: snapshot.hasAnalysisLoading,
  hasAnalysisSyncing: snapshot.hasAnalysisSyncing,
  hasKellyLoading: snapshot.hasKellyLoading,
  hasKellyConnected: snapshot.hasKellyConnected,
  bodyText: snapshot.bodyText,
  analysisText: snapshot.analysisText,
});

const waitForCondition = async (predicate, timeoutMs = 25000, intervalMs = 1000) => {
  const snapshots = [];
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = await readSnapshot();
    snapshots.push(compactSnapshot(snapshot, Date.now() - startedAt));
    if (predicate(snapshot)) {
      return {
        ok: true,
        snapshot,
        snapshots,
      };
    }
    await delay(intervalMs);
  }
  const snapshot = await readSnapshot();
  snapshots.push(compactSnapshot(snapshot, Date.now() - startedAt));
  return {
    ok: false,
    snapshot,
    snapshots,
  };
};

const waitForRefreshSettlement = async (timeoutMs = 25000, intervalMs = 500) => {
  const snapshots = [];
  const startedAt = Date.now();
  let sawPending = false;

  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = await readSnapshot();
    snapshots.push(compactSnapshot(snapshot, Date.now() - startedAt));
    if (snapshot.refreshState === "pending") {
      sawPending = true;
    }
    if (sawPending && snapshot.refreshState && snapshot.refreshState !== "pending") {
      return {
        ok: true,
        snapshot,
        snapshots,
      };
    }
    await delay(intervalMs);
  }

  const snapshot = await readSnapshot();
  snapshots.push(compactSnapshot(snapshot, Date.now() - startedAt));
  return {
    ok: false,
    snapshot,
    snapshots,
  };
};

const ensureRailExpanded = async () => {
  await evaluate(`(() => {
    const expandedRail = document.querySelector('.location-rail[data-expanded="true"], .location-rail-expanded');
    if (expandedRail) {
      return 'already-expanded';
    }
    document.querySelector('.command-header-rail-toggle')?.click();
    return 'clicked-toggle';
  })()`);
  await delay(1000);
};

const expandedRailSelector = `.location-rail[data-expanded="true"], .location-rail-expanded`;

const railGroupLabels = {
  asia: "亚",
  europe: "欧",
  americas: "美",
};

const switchRailGroup = async (groupKey) =>
  await evaluate(`(() => {
    const rail = document.querySelector(${JSON.stringify(expandedRailSelector)}) ?? document;
    const label = ${JSON.stringify(railGroupLabels)}['${groupKey}'];
    const buttons = [...rail.querySelectorAll('.location-rail-group-button, .location-rail-canvas-nav-button')]
      .map((node) => ({
        node,
        text: node.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
      }))
      .filter((entry) => entry.text);
    const target = buttons.find((entry) => entry.text === label || entry.text.startsWith(label));
    if (!target) {
      return { clicked: false, available: buttons.slice(0, 30).map((entry) => entry.text) };
    }
    target.node.click();
    return { clicked: true, text: target.text };
  })()`);

const clickLocation = async (targetCode) =>
  await evaluate(`(() => {
    const rail = document.querySelector(${JSON.stringify(expandedRailSelector)});
    if (!rail) {
      return { clicked: false, reason: 'expanded rail not found' };
    }

    const candidates = [...rail.querySelectorAll('[data-location-card="true"]')]
      .filter((node) => node.isConnected && node.getClientRects().length > 0)
      .map((node) => ({
        node,
        code: (node.getAttribute('data-location-code') ?? '').toUpperCase(),
        id: node.getAttribute('data-location-id') ?? null,
        text: node.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
      }))
      .filter((entry) => entry.text || entry.code);
    const target = candidates.find((entry) => entry.code === '${"TARGET_CODE"}');
    if (!target) {
      return {
        clicked: false,
        available: candidates.slice(0, 20).map((entry) => ({ code: entry.code, id: entry.id, text: entry.text })),
      };
    }
    target.node.click();
    return { clicked: true, code: target.code, id: target.id, text: target.text };
  })()`.replace("'TARGET_CODE'", JSON.stringify(targetCode.toUpperCase())));

const clickHeaderNav = async (targetPage) =>
  await evaluate(`(() => {
    const labels = {
      home: '首页决策台',
      analysis: '分析工作区',
      kelly: 'Kelly'
    };
    const label = labels['${targetPage}'];
    const buttons = [...document.querySelectorAll('.command-header-nav, button')]
      .map((node) => ({
        node,
        text: node.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
      }))
      .filter((entry) => entry.text);
    const target = buttons.find((entry) => entry.text.includes(label));
    if (!target) {
      return { clicked: false, available: buttons.slice(0, 20).map((entry) => entry.text) };
    }
    target.node.click();
    return { clicked: true, text: target.text };
  })()`);

const waitForPage = async (pageKey, timeoutMs = 25000) =>
  await waitForCondition((snapshot) => {
    if (snapshot.page !== pageKey || snapshot.transition) {
      return false;
    }
    if (pageKey === "analysis") {
      return true;
    }
    if (pageKey === "kelly") {
      return snapshot.kellyMarketCardCount > 0 || snapshot.hasKellyConnected || !snapshot.hasKellyLoading;
    }
    return true;
  }, timeoutMs, 1000);

const buildLocationPredicate = (page, targetName, targetLocationId = null) => {
  if (page === "home") {
    return (snapshot) =>
      snapshot.page === "home" &&
      snapshot.title === targetName &&
      !snapshot.transition &&
      !snapshot.hasTimeout &&
      snapshot.quickInsightCardCount > 0 &&
      !snapshot.hasQuickInsightWaiting;
  }

  if (page === "analysis") {
    return (snapshot) =>
      snapshot.page === "analysis" &&
      snapshot.title === targetName &&
      (!targetLocationId || readUrlLocationId(snapshot.href) === targetLocationId) &&
      !snapshot.transition &&
      !snapshot.hasTimeout &&
      !snapshot.hasAnalysisSyncing &&
      snapshot.syncState !== "revalidating" &&
      snapshot.analysisArticleCount > 0;
  }

  return (snapshot) =>
    snapshot.page === "kelly" &&
    snapshot.title === targetName &&
    !snapshot.transition &&
    !snapshot.hasTimeout &&
    snapshot.kellyMarketCardCount > 0 &&
    snapshot.hasKellyConnected;
};

const runSwitchSequence = async ({ pagePath, pageKey, steps }) => {
  const url = `${baseUrl}${pagePath}`;
  await openUrl(url);
  const initialWaitResult =
    pageKey === "home"
      ? await waitForCondition(
          buildLocationPredicate("home", "Shanghai Pudong International Airport", "shanghai_pvg"),
        )
      : null;
  const initialSnapshot = initialWaitResult?.snapshot ?? (await readSnapshot());
  const scenarioResult = {
    url,
    initialSnapshot: compactSnapshot(initialSnapshot),
    ...(pageKey === "home"
      ? {
          initialOk: Boolean(initialWaitResult?.ok),
          initialFailureReasons: buildHomeFailureReasons({
            snapshot: initialSnapshot,
            expectedTitle: "Shanghai Pudong International Airport",
            expectedLocationId: "shanghai_pvg",
          }),
          initialSnapshots: initialWaitResult?.snapshots?.slice(-8) ?? [],
        }
      : {}),
    steps: [],
  };

  for (const step of steps) {
    await ensureRailExpanded();
    if (step.group) {
      await switchRailGroup(step.group);
      await delay(500);
    }
    const eventStart = events.length;
    const networkStart = networkEvents.length;
    const clickResult = await clickLocation(step.code);
    const waitResult = await waitForCondition(
      buildLocationPredicate(pageKey, step.expectedTitle, locationIdByCode[step.code] ?? null),
    );
    scenarioResult.steps.push({
      targetCode: step.code,
      expectedTitle: step.expectedTitle,
      group: step.group ?? null,
      clickResult,
      ok: waitResult.ok,
      finalSnapshot: compactSnapshot(waitResult.snapshot),
      snapshots: waitResult.snapshots.slice(-8),
      requests: summarizeWeatherRequests(eventStart),
      weatherTraffic: summarizeWeatherTraffic(networkStart),
      runtimeIssues: summarizeRuntimeIssues(eventStart),
    });
    if (!waitResult.ok) {
      break;
    }
  }

  return scenarioResult;
};

const runAnalysisRegressionScenario = async () => {
  const url = `${baseUrl}/analysis`;
  await openUrl(url);

  const locationSteps = [
    {
      code: "PVG",
      expectedTitle: "Shanghai Pudong International Airport",
      group: "asia",
    },
    {
      code: "MIA",
      expectedTitle: "Miami International Airport",
      group: "americas",
    },
    {
      code: "YYZ",
      expectedTitle: "Toronto Pearson International Airport",
      group: "americas",
    },
    {
      code: "MIA",
      expectedTitle: "Miami International Airport",
      group: "americas",
    },
  ];

  const scenarioResult = {
    url,
    initialSnapshot: compactSnapshot(await readSnapshot()),
    locationSteps: [],
    refreshAttempts: [],
    navigation: {},
  };

  for (const step of locationSteps) {
    const beforeSnapshot = await readSnapshot();

    if (beforeSnapshot.title === step.expectedTitle) {
      scenarioResult.locationSteps.push({
        targetCode: step.code,
        expectedTitle: step.expectedTitle,
        group: step.group,
        skipped: true,
        beforeSnapshot: compactSnapshot(beforeSnapshot),
      });
      continue;
    }

    await ensureRailExpanded();
    const groupResult = await switchRailGroup(step.group);
    await delay(600);
    const eventStart = events.length;
    const networkStart = networkEvents.length;
    const clickResult = await clickLocation(step.code);
    const expectedLocationId = locationIdByCode[step.code] ?? null;
    const waitResult = await waitForCondition(buildLocationPredicate("analysis", step.expectedTitle, expectedLocationId));
    await delay(1200);
    const finalSnapshot = await readSnapshot();
    const weatherTraffic = summarizeWeatherTraffic(networkStart);
    const trafficSummary = expectedLocationId ? summarizeAnalysisTraffic(weatherTraffic, expectedLocationId) : null;
    const failureReasons = buildAnalysisFailureReasons({
      snapshot: finalSnapshot,
      expectedTitle: step.expectedTitle,
      expectedLocationId,
      trafficSummary,
    });
    scenarioResult.locationSteps.push({
      targetCode: step.code,
      expectedLocationId,
      expectedTitle: step.expectedTitle,
      group: step.group,
      groupResult,
      clickResult,
      ok: waitResult.ok && failureReasons.length === 0,
      failureReasons,
      beforeSnapshot: compactSnapshot(beforeSnapshot),
      finalSnapshot: compactSnapshot(finalSnapshot),
      contentChanged:
        beforeSnapshot.analysisFingerprint !== finalSnapshot.analysisFingerprint ||
        beforeSnapshot.title !== finalSnapshot.title ||
        beforeSnapshot.href !== finalSnapshot.href,
      snapshots: waitResult.snapshots.slice(-8),
      weatherTraffic,
      trafficSummary,
      runtimeIssues: summarizeRuntimeIssues(eventStart),
    });
  }

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const beforeSnapshot = await readSnapshot();
    const eventStart = events.length;
    const networkStart = networkEvents.length;
    const clickResult = await clickRefresh();
    const waitResult = await waitForRefreshSettlement();
    const afterSnapshot = waitResult.snapshot;
    const weatherTraffic = summarizeWeatherTraffic(networkStart);
    scenarioResult.refreshAttempts.push({
      attempt,
      clickResult,
      ok:
        waitResult.ok &&
        afterSnapshot.refreshState !== "pending" &&
        !afterSnapshot.hasTimeout &&
        !afterSnapshot.hasAnalysisSyncing &&
        (afterSnapshot.analysisArticleCount ?? 0) > 0,
      failureReasons: [
        ...(waitResult.ok ? [] : ["refresh_settlement_timeout"]),
        ...(afterSnapshot.refreshState === "pending" ? ["refresh_still_pending"] : []),
        ...(afterSnapshot.hasTimeout ? ["timeout_visible_after_refresh"] : []),
        ...(afterSnapshot.hasAnalysisSyncing ? ["analysis_syncing_after_refresh"] : []),
        ...((afterSnapshot.analysisArticleCount ?? 0) > 0 ? [] : ["analysis_article_missing_after_refresh"]),
      ],
      beforeSnapshot: compactSnapshot(beforeSnapshot),
      afterSnapshot: compactSnapshot(afterSnapshot),
      refreshStateChanged:
        beforeSnapshot.refreshState !== afterSnapshot.refreshState ||
        beforeSnapshot.refreshLabel !== afterSnapshot.refreshLabel,
      contentChanged:
        beforeSnapshot.analysisFingerprint !== afterSnapshot.analysisFingerprint ||
        beforeSnapshot.title !== afterSnapshot.title ||
        beforeSnapshot.modelTimestamp !== afterSnapshot.modelTimestamp ||
        beforeSnapshot.href !== afterSnapshot.href,
      weatherTraffic,
      runtimeIssues: summarizeRuntimeIssues(eventStart),
      snapshots: waitResult.snapshots.slice(-10),
    });
    await delay(1000);
  }

  const beforeNavigationSnapshot = await readSnapshot();
  const expectedBackTitle = beforeNavigationSnapshot.title;
  const expectedBackLocationId = readUrlLocationId(beforeNavigationSnapshot.href);
  const toKellyNetworkStart = networkEvents.length;
  const toKellyClick = await clickHeaderNav("kelly");
  const toKelly = await waitForPage("kelly");
  const backToAnalysisNetworkStart = networkEvents.length;
  const backToAnalysisClick = await clickHeaderNav("analysis");
  const backToAnalysis = await waitForCondition(
    buildLocationPredicate("analysis", expectedBackTitle, expectedBackLocationId),
    25000,
    1000,
  );

  scenarioResult.navigation = {
    toKellyClick,
    toKelly: {
      ok: toKelly.ok,
      finalSnapshot: compactSnapshot(toKelly.snapshot),
      weatherTraffic: summarizeWeatherTraffic(toKellyNetworkStart),
      snapshots: toKelly.snapshots.slice(-8),
    },
    backToAnalysisClick,
    backToAnalysis: {
      ok:
        backToAnalysis.ok &&
        !backToAnalysis.snapshot.hasTimeout &&
        !backToAnalysis.snapshot.hasAnalysisSyncing &&
        (backToAnalysis.snapshot.analysisArticleCount ?? 0) > 0,
      finalSnapshot: compactSnapshot(backToAnalysis.snapshot),
      weatherTraffic: summarizeWeatherTraffic(backToAnalysisNetworkStart),
      snapshots: backToAnalysis.snapshots.slice(-8),
    },
  };

  return scenarioResult;
};

const scenarioDefinitions = {
  home: async () =>
    await runSwitchSequence({
      pagePath: "/",
      pageKey: "home",
      steps: [{ code: "WUH", expectedTitle: "Wuhan Tianhe International Airport" }],
    }),
  analysis: async () =>
    await runSwitchSequence({
      pagePath: "/analysis",
      pageKey: "analysis",
      steps: [
        { code: "WUH", expectedTitle: "Wuhan Tianhe International Airport" },
        { code: "PVG", expectedTitle: "Shanghai Pudong International Airport" },
        { code: "WUH", expectedTitle: "Wuhan Tianhe International Airport" },
        { code: "PVG", expectedTitle: "Shanghai Pudong International Airport" },
        { code: "WUH", expectedTitle: "Wuhan Tianhe International Airport" },
      ],
    }),
  kelly: async () =>
    await runSwitchSequence({
      pagePath: "/kelly",
      pageKey: "kelly",
      steps: [
        { code: "WUH", expectedTitle: "Wuhan Tianhe International Airport" },
        { code: "PVG", expectedTitle: "Shanghai Pudong International Airport" },
      ],
    }),
  "analysis-regression": async () => await runAnalysisRegressionScenario(),
};

const scenarioNames =
  requestedScenarioNames.size > 0
    ? [...requestedScenarioNames].filter((name) => Object.hasOwn(scenarioDefinitions, name))
    : Object.keys(scenarioDefinitions);

if (scenarioNames.length === 0) {
  throw new Error("No valid scenarios requested. Use one or more of: home, analysis, kelly, analysis-regression.");
}

const scenarios = {};
for (const name of scenarioNames) {
  scenarios[name] = await scenarioDefinitions[name]();
}

console.log(
  JSON.stringify(
    {
      scenarios,
      chromeLogs: chromeLogs.slice(-20),
    },
    null,
    2,
  ),
);

socket.close();
cleanup();
