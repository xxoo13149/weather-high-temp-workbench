import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import process from "node:process";
import WebSocket from "ws";

const chromePath =
  "C:/Users/32360/.cache/puppeteer/chrome/win64-131.0.6778.204/chrome-win64/chrome.exe";
const remotePort = 9600 + Math.floor(Math.random() * 400);
const userDataDir = `C:/Users/32360/AppData/Local/Temp/codex-chrome-${Date.now()}`;
const baseUrl = process.env.DEBUG_BASE_URL ?? "https://lukaluka.fun";
const locationId = process.env.DEBUG_LOCATION_ID ?? "shanghai_pvg";

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
  for (let attempt = 0; attempt < 60; attempt += 1) {
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

  throw new Error(`Timed out waiting for ${path}`);
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
const networkEvents = [];
const trackedWeatherRequests = new Map();

socket.on("message", (raw) => {
  const payload = JSON.parse(String(raw));
  if (payload.method === "Network.requestWillBeSent") {
    const requestId = payload.params?.requestId;
    const url = payload.params?.request?.url;
    if (requestId && typeof url === "string" && url.includes("/api/weather/")) {
      trackedWeatherRequests.set(requestId, url);
      networkEvents.push({
        type: "request",
        requestId,
        url,
      });
    }
    return;
  }

  if (payload.method === "Network.responseReceived") {
    const requestId = payload.params?.requestId;
    const url = requestId ? trackedWeatherRequests.get(requestId) : null;
    if (requestId && url) {
      networkEvents.push({
        type: "response",
        requestId,
        url,
        status: payload.params?.response?.status ?? null,
      });
    }
    return;
  }

  if (payload.method === "Network.loadingFailed") {
    const requestId = payload.params?.requestId;
    const url = requestId ? trackedWeatherRequests.get(requestId) : null;
    if (requestId && url) {
      networkEvents.push({
        type: "failed",
        requestId,
        url,
        errorText: payload.params?.errorText ?? null,
        canceled: Boolean(payload.params?.canceled),
      });
    }
    return;
  }

  if (typeof payload.id !== "number") {
    return;
  }

  const entry = pending.get(payload.id);
  if (!entry) {
    return;
  }

  pending.delete(payload.id);
  if (payload.error) {
    entry.reject(new Error(payload.error.message));
    return;
  }

  entry.resolve(payload.result);
});

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++messageId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });

const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });

  return result.result?.value;
};

const readImageSnapshot = async () =>
  await evaluate(`(() => ({
    href: location.href,
    src: document.querySelector('img.analysis-image')?.getAttribute('src') ?? null,
    naturalWidth: document.querySelector('img.analysis-image')?.naturalWidth ?? 0,
    complete: document.querySelector('img.analysis-image')?.complete ?? false,
    activeTab: document.querySelector('[role="tab"][data-state="active"]')?.textContent?.trim() ?? null,
    tabs: [...document.querySelectorAll('[role="tab"]')].map((node) => ({
      text: node.textContent?.trim() ?? null,
      state: node.getAttribute('data-state'),
    })),
    text: document.querySelector('.analysis-image-layout')?.innerText?.replace(/\\s+/g, ' ').trim().slice(0, 400) ?? null
  }))()`);

const waitForImageReady = async (timeoutMs = 20_000) => {
  const startedAt = Date.now();
  let lastState = await readImageSnapshot();

  while (Date.now() - startedAt < timeoutMs) {
    if (lastState.naturalWidth > 0) {
      return lastState;
    }

    await delay(1_000);
    lastState = await readImageSnapshot();
  }

  return lastState;
};

await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");

const summarizeTraffic = () =>
  networkEvents
    .filter((entry) => typeof entry.url === "string" && entry.url.includes("/api/weather/"))
    .map((entry) => ({
      type: entry.type,
      url: entry.url,
      status: "status" in entry ? entry.status : null,
      errorText: "errorText" in entry ? entry.errorText : null,
      canceled: "canceled" in entry ? entry.canceled : null,
    }));

await send("Page.navigate", {
  url: `${baseUrl}/analysis?locationId=${locationId}&tab=models`,
});
await delay(9_000);

const readModelsSnapshot = async () =>
  await evaluate(`(() => ({
    title: document.querySelector('.command-header-title')?.textContent?.trim() ?? null,
    href: location.href,
    articleCount: document.querySelectorAll('.analysis-content article').length,
    refreshState: document.querySelector('.command-header-refresh')?.getAttribute('data-refresh-state') ?? null,
    body: document.body.innerText.replace(/\\s+/g, ' ').trim().slice(0, 500)
  }))()`);

const first = await readModelsSnapshot();

await evaluate(`(() => {
  document.querySelector('.command-header-refresh')?.click();
  return true;
})()`);
await delay(9_000);

const afterRefresh = await readModelsSnapshot();

const tabClick = await evaluate(`(() => {
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const before = tabs.map((node) => ({
    text: node.textContent?.trim() ?? null,
    state: node.getAttribute('data-state'),
  }));
  const imageTab = tabs.find((node) => /原图|image/i.test(node.textContent ?? ''));
  return {
    before,
    href: location.href,
    clicked: Boolean(imageTab),
    rect: imageTab
      ? (() => {
          const box = imageTab.getBoundingClientRect();
          return {
            x: box.left + box.width / 2,
            y: box.top + box.height / 2,
            width: box.width,
            height: box.height,
          };
        })()
      : null,
  };
})()`);
if (tabClick.rect) {
  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: tabClick.rect.x,
    y: tabClick.rect.y,
    button: "left",
    clickCount: 1,
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: tabClick.rect.x,
    y: tabClick.rect.y,
    button: "left",
    clickCount: 1,
  });
}
await delay(6_000);

const imageState = await readImageSnapshot();

const domClickState = await evaluate(`(() => {
  const imageTab = [...document.querySelectorAll('[role="tab"]')]
    .find((node) => /鍘熷浘|官方原图|image/i.test(node.textContent ?? ''));
  if (!imageTab) {
    return { clicked: false, reason: 'image-tab-not-found' };
  }
  imageTab.click();
  return {
    clicked: true,
    href: location.href,
    activeTab: document.querySelector('[role="tab"][data-state="active"]')?.textContent?.trim() ?? null,
    tabs: [...document.querySelectorAll('[role="tab"]')].map((node) => ({
      text: node.textContent?.trim() ?? null,
      state: node.getAttribute('data-state'),
    })),
  };
})()`);
await delay(6_000);

const domClickImageState = await waitForImageReady();

await send("Page.navigate", {
  url: `${baseUrl}/analysis?locationId=${locationId}&tab=image`,
});
await delay(9_000);

const directImageState = await waitForImageReady();

console.log(
  JSON.stringify(
    {
      locationId,
      first,
      afterRefresh,
      traffic: summarizeTraffic(),
      tabClick,
      imageState,
      domClickState,
      domClickImageState,
      directImageState,
    },
    null,
    2,
  ),
);

cleanup();
