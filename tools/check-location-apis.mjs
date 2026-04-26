#!/usr/bin/env node
import process from "node:process";

const baseUrl = process.env.DEBUG_BASE_URL ?? "https://lukaluka.fun";
const locationId = process.argv[2] ?? process.env.DEBUG_LOCATION_ID ?? "wuhan_wuh";

const buildUrl = (path) => new URL(path, baseUrl).toString();

const fetchJson = async (path) => {
  const response = await fetch(buildUrl(path));
  if (!response.ok) {
    throw new Error(`Failed to fetch ${path}: ${response.status} ${response.statusText}`);
  }
  return response.json();
};

const dashboard = await fetchJson(`/api/weather/dashboard?mode=1h&limit=24&locationId=${locationId}`);
const directory = dashboard.locationDirectory ?? [];
const locationInfo = directory.find((entry) => entry.id === locationId) ?? null;

const hourlyItems = dashboard.hourly?.items ?? [];
const selectedItem = hourlyItems.find((item) => item.temperatureC !== null) ?? hourlyItems[0];
if (!selectedItem) {
  throw new Error(`Could not find any hourly data for ${locationId}`);
}

const timestamp = selectedItem.timestamp;
const actualTemperatureC = selectedItem.temperatureC ?? dashboard.hourly?.current?.temperatureC ?? 0;
const encodedTimestamp = encodeURIComponent(timestamp);

const insights = await fetchJson(
  `/api/weather/multimodel/insights?locationId=${locationId}&timestamp=${encodedTimestamp}&actualTemperatureC=${actualTemperatureC}`,
);
const distribution = await fetchJson(
  `/api/weather/multimodel/distribution?locationId=${locationId}&timestamp=${encodedTimestamp}&bucketSize=1`,
);

const imagePath = `/api/weather/multimodel/image?locationId=${locationId}&allowStale=true`;
let imageResponse = await fetch(buildUrl(imagePath), { method: "HEAD" });
let imageCheckMethod = "HEAD";
if (!imageResponse.ok) {
  imageResponse = await fetch(buildUrl(imagePath), { method: "GET" });
  imageCheckMethod = "GET";
}

const summary = {
  locationId,
  locationName: locationInfo?.displayName ?? locationInfo?.shortLabel ?? "(unknown)",
  generatedAt: dashboard.generatedAt,
  dashboardMultimodel: dashboard.multimodel ?? null,
  selection: {
    insightsSelectedTimestamp: insights.selectedTimestamp,
    insightsReason: insights.selectedTimestampReason,
    insightsResolvedReason: insights.resolvedTimestampReason,
    insightsModelCount: insights.modelCount,
    distributionSelectedTimestamp: distribution.selectedTimestamp,
    distributionReason: distribution.selectedTimestampReason,
    distributionResolvedReason: distribution.resolvedTimestampReason,
    distributionModelCount: distribution.modelCount,
    availableTimestamps: distribution.availableTimestamps?.slice(0, 5) ?? [],
  },
  imageCheck: {
    method: imageCheckMethod,
    path: imagePath,
    status: imageResponse.status,
    contentType: imageResponse.headers.get("content-type"),
    cacheControl: imageResponse.headers.get("cache-control"),
    available: imageResponse.ok,
  },
};

console.log(JSON.stringify(summary, null, 2));
