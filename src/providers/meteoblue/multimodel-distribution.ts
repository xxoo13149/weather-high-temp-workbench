import { AppError } from "../../domain/errors.js";
import type {
  LocationInfo,
  MultiModelDistributionBucket,
  MultiModelDistributionMember,
  MultiModelDistributionResponse,
  MultiModelInsightPeakModel,
  MultiModelInsightPeakTimeDistribution,
  MultiModelInsightRankedModel,
  MultiModelInsightResponse,
  MultiModelInventoryItem,
} from "../../domain/weather.js";
import { fetchText } from "../../lib/http.js";
import { parseLocalDateTimeInTimeZone, toIsoInTimeZone } from "../../lib/time.js";
import {
  extractMultiModelHighchartsUrl,
  extractMultiModelPageInventory,
  MULTIMODEL_HIGHCHARTS_VERSION,
} from "./multimodel.js";

interface HighchartsPoint {
  x?: number;
  y?: number | null;
  name?: string;
}

interface HighchartsSeries {
  name?: string;
  type?: string;
  xAxis?: number;
  yAxis?: number;
  lineWidth?: number;
  data?: HighchartsPoint[];
}

interface HighchartsConfig {
  title?: {
    text?: string;
  };
  series?: HighchartsSeries[];
}

interface ParsedHighchartsTimestamp {
  iso: string;
  sortMs: number;
  source: "point-name-local" | "x-timezone-converted";
}

export interface MultiModelTemperatureDataset {
  timestamps: string[];
  models: Array<{
    modelName: string;
    displayName: string;
    values: Array<number | null>;
  }>;
  timestampSource: "point-name-local" | "x-timezone-converted";
  detectedXOffsetMinutes: number | null;
}

export interface MultiModelDistributionCacheValue {
  fetchedAt: string;
  pageFetchedAt: string;
  highchartsUrl: string;
  dataset: MultiModelTemperatureDataset;
  modelInventory: MultiModelInventoryItem[];
  warnings: string[];
}

const TEMPERATURE_AXIS_INDEX = 0;
const modelDisplayNameMap: Record<string, string> = {
  AIFS025: "AIFS 0.25°",
  GEM15: "GEM 15 km",
  GFS05: "GFS 0.5°",
  ICON: "ICON",
  IFS025: "IFS 0.25°",
  IFSHRES: "IFS HRES",
  MFGLOBAL: "MeteoFrance Global",
  MSM: "MSM",
  NEMSAS02: "NEMS Asia 0.2°",
  NEMSGLOBAL: "NEMS Global",
  NEMSGLOBAL_E: "NEMS Global E",
  UMGLOBAL10: "UM Global 10 km",
};

const normalizedModelDisplayNameMap: Record<string, string> = {
  AIFS025: "AIFS 0.25°",
  GEM15: "GEM 15 km",
  GFS05: "GFS 0.5°",
  ICON: "ICON",
  IFS025: "IFS 0.25°",
  IFSHRES: "IFS HRES",
  MFGLOBAL: "MeteoFrance Global",
  MSM: "MSM",
  NEMSAS02: "NEMS Asia 0.2°",
  NEMSGLOBAL: "NEMS Global",
  NEMSGLOBAL_E: "NEMS Global E",
  UMGLOBAL10: "UM Global 10 km",
};

const formatBucketLabel = (bucketStartC: number, bucketEndC: number): string =>
  `${bucketStartC.toFixed(1)} - ${bucketEndC.toFixed(1)} °C`;

const parseHighchartsJson = (raw: string): HighchartsConfig => {
  try {
    return JSON.parse(raw.replace(/^\uFEFF/, "")) as HighchartsConfig;
  } catch (error) {
    throw new AppError(
      503,
      "MULTIMODEL_HIGHCHARTS_PARSE_FAILED",
      `Could not parse meteoblue multimodel highcharts payload: ${String(error)}`,
      {
        retryable: true,
      },
    );
  }
};

const normalizeModelName = (value: string | undefined): string => (value ?? "").trim().toUpperCase();

const isTemperatureModelSeries = (series: HighchartsSeries): boolean => {
  const name = normalizeModelName(series.name);
  if (!name || name === "ENSEMBLE") {
    return false;
  }

  return series.xAxis === TEMPERATURE_AXIS_INDEX && series.yAxis === TEMPERATURE_AXIS_INDEX && series.type === "scatter";
};

const normalizePointName = (value: string): string => {
  const trimmed = value.trim().replace(/\//g, "-");
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(trimmed)) {
    return `${trimmed}:00`;
  }

  return trimmed;
};

const parsePointNameDate = (value: string, timeZone: string): Date | null =>
  parseLocalDateTimeInTimeZone(normalizePointName(value), timeZone);

const resolvePointTimestamp = (
  point: HighchartsPoint,
  timeZone: string,
): ParsedHighchartsTimestamp | null => {
  if (typeof point.name === "string") {
    const parsedNameDate = parsePointNameDate(point.name, timeZone);
    if (parsedNameDate) {
      return {
        iso: toIsoInTimeZone(parsedNameDate, timeZone),
        sortMs: parsedNameDate.getTime(),
        source: "point-name-local",
      };
    }
  }

  if (typeof point.x === "number") {
    const parsedXDate = new Date(point.x);
    if (!Number.isNaN(parsedXDate.getTime())) {
      return {
        iso: toIsoInTimeZone(parsedXDate, timeZone),
        sortMs: parsedXDate.getTime(),
        source: "x-timezone-converted",
      };
    }
  }

  return null;
};

const detectXLabelOffsetMinutes = (seriesList: HighchartsSeries[], timeZone: string): number | null => {
  const counts = new Map<number, number>();
  let total = 0;

  for (const series of seriesList) {
    for (const point of series.data ?? []) {
      if (typeof point.name !== "string" || typeof point.x !== "number") {
        continue;
      }

      const parsedNameDate = parsePointNameDate(point.name, timeZone);
      if (!parsedNameDate) {
        continue;
      }

      const diffMinutes = Math.round((point.x - parsedNameDate.getTime()) / 60_000);
      counts.set(diffMinutes, (counts.get(diffMinutes) ?? 0) + 1);
      total += 1;

      if (total >= 128) {
        break;
      }
    }

    if (total >= 128) {
      break;
    }
  }

  if (total === 0) {
    return null;
  }

  const dominant = [...counts.entries()].sort((left, right) => right[1] - left[1])[0];
  if (!dominant) {
    return null;
  }

  const [offsetMinutes, count] = dominant;
  return count >= Math.max(3, Math.ceil(total * 0.8)) ? offsetMinutes : null;
};

const collectOrderedTimestamps = (
  seriesList: HighchartsSeries[],
  timeZone: string,
): {
  timestamps: string[];
  timestampSource: "point-name-local" | "x-timezone-converted";
} => {
  const timestampEntries = new Map<number, string>();
  let usedPointName = false;

  for (const series of seriesList) {
    for (const point of series.data ?? []) {
      const resolved = resolvePointTimestamp(point, timeZone);
      if (!resolved) {
        continue;
      }

      if (resolved.source === "point-name-local") {
        usedPointName = true;
      }

      timestampEntries.set(resolved.sortMs, resolved.iso);
    }
  }

  return {
    timestamps: Array.from(timestampEntries.entries())
      .sort((left, right) => left[0] - right[0])
      .map((entry) => entry[1]),
    timestampSource: usedPointName ? "point-name-local" : "x-timezone-converted",
  };
};

const buildChartEndpointPreview = (highchartsUrl: string): string => {
  const url = new URL(highchartsUrl);
  const format = url.searchParams.get("format");
  return format ? `${url.origin}${url.pathname}?format=${format}` : `${url.origin}${url.pathname}`;
};

const toLocalDateKey = (isoTimestamp: string): string => isoTimestamp.slice(0, 10);

const round2 = (value: number): number => Number.parseFloat(value.toFixed(2));

const buildStats = (values: number[]): {
  minTemperatureC: number;
  maxTemperatureC: number;
  meanTemperatureC: number;
} => {
  const minTemperatureC = Math.min(...values);
  const maxTemperatureC = Math.max(...values);
  const meanTemperatureC = values.reduce((sum, value) => sum + value, 0) / values.length;

  return {
    minTemperatureC: round2(minTemperatureC),
    maxTemperatureC: round2(maxTemperatureC),
    meanTemperatureC: round2(meanTemperatureC),
  };
};

const assertDatasetInvariant = (condition: boolean, code: string, message: string): void => {
  if (!condition) {
    throw new AppError(503, code, message, {
      retryable: true,
    });
  }
};

const validateDatasetOrThrow = (dataset: MultiModelTemperatureDataset): void => {
  assertDatasetInvariant(
    dataset.timestamps.length > 0,
    "MULTIMODEL_TEMPERATURE_TIMESTAMPS_EMPTY",
    "The multimodel chart payload did not contain any hourly timestamps.",
  );

  const seen = new Set<string>();
  let previousMs = Number.NEGATIVE_INFINITY;

  for (const timestamp of dataset.timestamps) {
    const currentMs = Date.parse(timestamp);
    assertDatasetInvariant(
      !Number.isNaN(currentMs),
      "MULTIMODEL_TEMPERATURE_TIMESTAMP_INVALID",
      `Encountered an invalid multimodel timestamp: ${timestamp}`,
    );
    assertDatasetInvariant(
      !seen.has(timestamp),
      "MULTIMODEL_TEMPERATURE_TIMESTAMPS_DUPLICATED",
      "The multimodel chart payload contained duplicated hourly timestamps.",
    );
    assertDatasetInvariant(
      currentMs > previousMs,
      "MULTIMODEL_TEMPERATURE_TIMESTAMPS_NOT_ASCENDING",
      "The multimodel chart payload did not contain strictly ascending hourly timestamps.",
    );

    seen.add(timestamp);
    previousMs = currentMs;
  }

  for (const model of dataset.models) {
    assertDatasetInvariant(
      model.values.length === dataset.timestamps.length,
      "MULTIMODEL_TEMPERATURE_SERIES_LENGTH_MISMATCH",
      `Model ${model.displayName} did not provide the same number of values as the timestamp axis.`,
    );
  }
};

const collectDistributionWarnings = (summary: {
  members: MultiModelDistributionMember[];
  distribution: MultiModelDistributionBucket[];
  peakDistribution: MultiModelDistributionBucket[];
}): string[] => {
  const warnings: string[] = [];
  const distributionTotal = summary.distribution.reduce((sum, bucket) => sum + bucket.count, 0);
  const peakTotal = summary.peakDistribution.reduce((sum, bucket) => sum + bucket.count, 0);

  if (distributionTotal !== summary.members.length) {
    warnings.push("distribution bucket totals did not match modelCount.");
  }

  if (peakTotal !== summary.members.length) {
    warnings.push("peakDistribution bucket totals did not match modelCount.");
  }

  return warnings;
};

const isRankedModelsSorted = (models: MultiModelInsightRankedModel[]): boolean => {
  for (let index = 1; index < models.length; index += 1) {
    const left = models[index - 1];
    const right = models[index];
    if (!left || !right) {
      continue;
    }

    const deltaDiff = Math.abs(left.deltaToActualTemperatureC) - Math.abs(right.deltaToActualTemperatureC);
    if (deltaDiff > 1e-9) {
      return false;
    }
    if (Math.abs(deltaDiff) <= 1e-9) {
      const peakDiff = right.dayPeakTemperatureC - left.dayPeakTemperatureC;
      if (peakDiff > 1e-9) {
        return false;
      }
      if (Math.abs(peakDiff) <= 1e-9 && left.modelName.localeCompare(right.modelName) > 0) {
        return false;
      }
    }
  }

  return true;
};

const collectInsightWarnings = (
  rankedModels: MultiModelInsightRankedModel[],
  selectedTimestamp: string,
): string[] => {
  const warnings: string[] = [];
  const selectedDay = toLocalDateKey(selectedTimestamp);

  if (!isRankedModelsSorted(rankedModels)) {
    warnings.push("rankedModels ordering drifted from the homepage sorting rule.");
  }

  if (rankedModels.some((model) => model.dayPeakTimestamp && toLocalDateKey(model.dayPeakTimestamp) !== selectedDay)) {
    warnings.push("dayPeakTimestamp extended outside the selected local day window.");
  }

  return warnings;
};

const buildModelInventory = (
  dataset: MultiModelTemperatureDataset,
  inventorySource: ReturnType<typeof extractMultiModelPageInventory>,
): {
  dataset: MultiModelTemperatureDataset;
  modelInventory: MultiModelInventoryItem[];
  warnings: string[];
} => {
  const warnings = [...inventorySource.warnings];
  const byCode = new Map(dataset.models.map((model) => [normalizeModelName(model.modelName), model]));
  const usedCodes = new Set<string>();
  const alignedModels: MultiModelTemperatureDataset["models"] = [];
  const inventory: MultiModelInventoryItem[] = [];

  const selected = [...inventorySource.models].sort((left, right) => left.pageOrder - right.pageOrder);
  for (const item of selected) {
    const code = normalizeModelName(item.modelCode);
    const model = byCode.get(code);
    if (!model) {
      warnings.push(`Selected model ${code} is missing in parsed highcharts series.`);
      continue;
    }

    const displayName = item.sourceDisplayName?.trim() || model.displayName;
    alignedModels.push({
      modelName: code,
      displayName,
      values: model.values,
    });

    inventory.push({
      modelName: displayName,
      displayName,
      pageOrder: item.pageOrder,
      pageLastUpdatedAt: item.pageLastUpdatedAt,
      pageLastUpdatedLabel: item.pageLastUpdatedLabel,
      sourceDisplayName: item.sourceDisplayName,
      modelCode: code,
      sourceProvider: item.sourceProvider,
      coverage: item.coverage,
      resolution: item.resolution,
      forecastHorizon: item.forecastHorizon,
    });

    usedCodes.add(code);
  }

  for (const model of dataset.models) {
    const code = normalizeModelName(model.modelName);
    if (usedCodes.has(code)) {
      continue;
    }

    alignedModels.push(model);
    inventory.push({
      modelName: model.displayName,
      displayName: model.displayName,
      pageOrder: inventory.length,
      pageLastUpdatedAt: null,
      pageLastUpdatedLabel: null,
      sourceDisplayName: model.displayName,
      modelCode: code,
    });

    if (selected.length > 0) {
      warnings.push(`Model ${code} exists in highcharts but is absent from selected page inventory.`);
    }
  }

  if (alignedModels.length === 0) {
    return {
      dataset,
      modelInventory: dataset.models.map((model, index) => ({
        modelName: model.displayName,
        displayName: model.displayName,
        pageOrder: index,
        pageLastUpdatedAt: null,
        pageLastUpdatedLabel: null,
        sourceDisplayName: model.displayName,
        modelCode: normalizeModelName(model.modelName),
      })),
      warnings: [...warnings, "Page inventory parsing returned no usable selected models; fell back to chart series order."],
    };
  }

  return {
    dataset: {
      ...dataset,
      models: alignedModels,
    },
    modelInventory: inventory,
    warnings,
  };
};

const collectInventoryWarnings = (
  modelInventory: MultiModelInventoryItem[],
  modelNames: string[],
): string[] => {
  const warnings: string[] = [];
  const inventoryNames = new Set(modelInventory.map((item) => item.modelName));
  const responseNames = new Set(modelNames);

  if (inventoryNames.size !== responseNames.size) {
    warnings.push("modelInventory and derived model set size mismatch.");
  }

  for (const name of inventoryNames) {
    if (!responseNames.has(name)) {
      warnings.push("modelInventory includes entries not present in derived model set.");
      break;
    }
  }

  for (const name of responseNames) {
    if (!inventoryNames.has(name)) {
      warnings.push("derived model set contains entries missing from modelInventory.");
      break;
    }
  }

  return warnings;
};

const isInternalInventoryAlignmentWarning = (warning: string): boolean =>
  /^Selected model [A-Z0-9_]+ is missing in parsed highcharts series\.$/.test(warning) ||
  /^Model [A-Z0-9_]+ exists in highcharts but is absent from selected page inventory\.$/.test(warning) ||
  /^No model table row matched selected domain [A-Z0-9_]+\.$/.test(warning);

export const parseMultiModelHighcharts = (raw: string, timeZone: string): MultiModelTemperatureDataset => {
  const config = parseHighchartsJson(raw);
  const seriesList = (config.series ?? []).filter(isTemperatureModelSeries);

  if (seriesList.length === 0) {
    throw new AppError(
      503,
      "MULTIMODEL_TEMPERATURE_SERIES_NOT_FOUND",
      "Could not find any hourly temperature model curves in the multimodel chart payload.",
      {
        retryable: true,
      },
    );
  }

  const { timestamps, timestampSource } = collectOrderedTimestamps(seriesList, timeZone);
  if (timestamps.length === 0) {
    throw new AppError(
      503,
      "MULTIMODEL_TEMPERATURE_TIMESTAMPS_EMPTY",
      "The multimodel chart payload did not contain any hourly timestamps.",
      {
        retryable: true,
      },
    );
  }

  const models = seriesList.map((series) => {
    const modelName = normalizeModelName(series.name);
    const valuesByTimestamp = new Map<string, number | null>();

    for (const point of series.data ?? []) {
      const resolved = resolvePointTimestamp(point, timeZone);
      if (!resolved) {
        continue;
      }

      valuesByTimestamp.set(resolved.iso, typeof point.y === "number" ? point.y : null);
    }

    return {
      modelName,
      displayName: normalizedModelDisplayNameMap[modelName] ?? modelName,
      values: timestamps.map((timestamp) => valuesByTimestamp.get(timestamp) ?? null),
    };
  });

  const dataset = {
    timestamps,
    models,
    timestampSource,
    detectedXOffsetMinutes: detectXLabelOffsetMinutes(seriesList, timeZone),
  };

  validateDatasetOrThrow(dataset);
  return dataset;
};

const buildBuckets = (
  members: MultiModelDistributionMember[],
  bucketSizeC: number,
  getTemperature: (member: MultiModelDistributionMember) => number,
): MultiModelDistributionBucket[] => {
  const groups = new Map<number, MultiModelDistributionBucket>();

  for (const member of members) {
    const value = getTemperature(member);
    const bucketStartC = Math.floor(value / bucketSizeC) * bucketSizeC;
    const existing = groups.get(bucketStartC);
    if (existing) {
      existing.count += 1;
      existing.models.push(member.modelName);
      continue;
    }

    const bucketEndC = Number.parseFloat((bucketStartC + bucketSizeC).toFixed(2));
    groups.set(bucketStartC, {
      bucketStartC,
      bucketEndC,
      label: `${bucketStartC.toFixed(1)} - ${bucketEndC.toFixed(1)} °C`,
      count: 1,
      models: [member.modelName],
    });
  }

  return Array.from(groups.values())
    .map((bucket) => ({
      ...bucket,
      label: formatBucketLabel(bucket.bucketStartC, bucket.bucketEndC),
    }))
    .sort((left, right) => left.bucketStartC - right.bucketStartC);
};

export const summarizeMultiModelTemperatureDataset = (
  dataset: MultiModelTemperatureDataset,
  selectedTimestamp?: string,
  bucketSizeC = 1,
): {
  selectedTimestamp: string;
  availableTimestamps: string[];
  members: MultiModelDistributionMember[];
  distribution: MultiModelDistributionBucket[];
  peakDistribution: MultiModelDistributionBucket[];
  stats: {
    minTemperatureC: number;
    maxTemperatureC: number;
    meanTemperatureC: number;
  };
} => {
  validateDatasetOrThrow(dataset);

  const selectedIndex = selectedTimestamp ? dataset.timestamps.indexOf(selectedTimestamp) : 0;
  if (selectedTimestamp && selectedIndex < 0) {
    throw new AppError(400, "BAD_REQUEST", "Query parameter 'timestamp' must match one of the available hourly timestamps.");
  }

  const index = selectedIndex >= 0 ? selectedIndex : 0;
  const selectedDayTimestamp = dataset.timestamps[index] ?? dataset.timestamps[0];
  const sameDayIndices = selectedDayTimestamp
    ? collectLocalDayIndices(dataset.timestamps, selectedDayTimestamp)
    : [];
  const peakIndices = sameDayIndices.length > 0 ? sameDayIndices : [index];
  const members: MultiModelDistributionMember[] = [];

  for (const model of dataset.models) {
    const temperatureC = model.values[index];
    if (temperatureC === null) {
      continue;
    }

    let peakTemperatureC = temperatureC;
    let peakTimestamp: string | null = dataset.timestamps[index] ?? null;

    for (const valueIndex of peakIndices) {
      const value = model.values[valueIndex];
      if (value !== null && value > peakTemperatureC) {
        peakTemperatureC = value;
        peakTimestamp = dataset.timestamps[valueIndex] ?? null;
      }
    }

    members.push({
      modelName: model.displayName,
      temperatureC: round2(temperatureC),
      peakTemperatureC: round2(peakTemperatureC),
      peakTimestamp,
    });
  }

  members.sort((left, right) => left.temperatureC - right.temperatureC || left.modelName.localeCompare(right.modelName));

  if (members.length === 0) {
    throw new AppError(
      503,
      "MULTIMODEL_DISTRIBUTION_EMPTY",
      "The multimodel chart payload did not expose any model values for the selected timestamp.",
      {
        retryable: true,
      },
    );
  }

  const stats = buildStats(members.map((member) => member.temperatureC));

  return {
    selectedTimestamp: dataset.timestamps[index] ?? dataset.timestamps[0],
    availableTimestamps: [...dataset.timestamps],
    members,
    distribution: buildBuckets(members, bucketSizeC, (member) => member.temperatureC),
    peakDistribution: buildBuckets(members, bucketSizeC, (member) => member.peakTemperatureC),
    stats,
  };
};

const resolveInsightSelection = (
  dataset: MultiModelTemperatureDataset,
  requestedTimestamp: string | undefined,
  nowIso: string | undefined,
): {
  index: number;
  selectedTimestamp: string;
  reason: "requested" | "nearest-now" | "first-available";
} => {
  if (dataset.timestamps.length === 0) {
    throw new AppError(
      503,
      "MULTIMODEL_TEMPERATURE_TIMESTAMPS_EMPTY",
      "The multimodel chart payload did not contain any hourly timestamps.",
      {
        retryable: true,
      },
    );
  }

  if (requestedTimestamp) {
    const index = dataset.timestamps.indexOf(requestedTimestamp);
    if (index < 0) {
      throw new AppError(
        400,
        "BAD_REQUEST",
        "Query parameter 'timestamp' must match one of the available hourly timestamps.",
      );
    }

    return {
      index,
      selectedTimestamp: dataset.timestamps[index] ?? dataset.timestamps[0],
      reason: "requested",
    };
  }

  const nowMs = Date.parse(nowIso ?? new Date().toISOString());
  if (!Number.isNaN(nowMs)) {
    let nearestIndex = -1;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (let index = 0; index < dataset.timestamps.length; index += 1) {
      const timestamp = dataset.timestamps[index];
      if (!timestamp) {
        continue;
      }

      const timestampMs = Date.parse(timestamp);
      if (Number.isNaN(timestampMs)) {
        continue;
      }

      const distance = Math.abs(timestampMs - nowMs);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    }

    if (nearestIndex >= 0) {
      return {
        index: nearestIndex,
        selectedTimestamp: dataset.timestamps[nearestIndex] ?? dataset.timestamps[0],
        reason: "nearest-now",
      };
    }
  }

  return {
    index: 0,
    selectedTimestamp: dataset.timestamps[0],
    reason: "first-available",
  };
};

const collectLocalDayIndices = (timestamps: string[], selectedTimestamp: string): number[] => {
  const selectedDay = toLocalDateKey(selectedTimestamp);
  const indices: number[] = [];

  for (let index = 0; index < timestamps.length; index += 1) {
    const timestamp = timestamps[index];
    if (timestamp && toLocalDateKey(timestamp) === selectedDay) {
      indices.push(index);
    }
  }

  return indices;
};

const pickModelPeakInRange = (
  model: MultiModelTemperatureDataset["models"][number],
  timestamps: string[],
  rangeIndices: number[],
): {
  dayPeakTemperatureC: number;
  dayPeakTimestamp: string | null;
} | null => {
  let peakTemperature: number | null = null;
  let peakTimestamp: string | null = null;

  for (const index of rangeIndices) {
    const value = model.values[index];
    if (typeof value !== "number") {
      continue;
    }

    if (peakTemperature === null || value > peakTemperature) {
      peakTemperature = value;
      peakTimestamp = timestamps[index] ?? null;
    }
  }

  if (peakTemperature === null) {
    return null;
  }

  return {
    dayPeakTemperatureC: round2(peakTemperature),
    dayPeakTimestamp: peakTimestamp,
  };
};

const buildPeakTimeDistribution = (
  rankedModels: MultiModelInsightRankedModel[],
): MultiModelInsightPeakTimeDistribution[] => {
  const groups = new Map<string, MultiModelInsightPeakModel[]>();

  for (const model of rankedModels) {
    if (!model.dayPeakTimestamp) {
      continue;
    }

    const peakModels = groups.get(model.dayPeakTimestamp) ?? [];
    peakModels.push({
      modelName: model.modelName,
      dayPeakTemperatureC: model.dayPeakTemperatureC,
    });
    groups.set(model.dayPeakTimestamp, peakModels);
  }

  const distribution: MultiModelInsightPeakTimeDistribution[] = [];
  for (const [timestamp, peakModels] of groups.entries()) {
    const temperatures = peakModels.map((model) => model.dayPeakTemperatureC);
    const stats = buildStats(temperatures);
    const sortedPeakModels = [...peakModels].sort(
      (left, right) =>
        right.dayPeakTemperatureC - left.dayPeakTemperatureC ||
        left.modelName.localeCompare(right.modelName),
    );

    distribution.push({
      timestamp,
      modelCount: sortedPeakModels.length,
      avgPeakTemperatureC: stats.meanTemperatureC,
      minPeakTemperatureC: stats.minTemperatureC,
      maxPeakTemperatureC: stats.maxTemperatureC,
      modelNames: sortedPeakModels.map((model) => model.modelName),
      peakModels: sortedPeakModels,
    });
  }

  return distribution.sort(
    (left, right) =>
      right.modelCount - left.modelCount ||
      right.avgPeakTemperatureC - left.avgPeakTemperatureC ||
      left.timestamp.localeCompare(right.timestamp),
  );
};

export const buildMultiModelInsightResponse = (
  cacheValue: MultiModelDistributionCacheValue,
  location: LocationInfo,
  pageUrl: string,
  options: {
    requestedTimestamp?: string;
    actualTemperatureC?: number;
    nowIso?: string;
  },
  freshness: {
    stale: boolean;
    cacheHit: boolean;
  },
): MultiModelInsightResponse => {
  const cacheWarnings = cacheValue.warnings.filter((warning) => !isInternalInventoryAlignmentWarning(warning));
  const selection = resolveInsightSelection(cacheValue.dataset, options.requestedTimestamp, options.nowIso);
  const currentSummary = summarizeMultiModelTemperatureDataset(cacheValue.dataset, selection.selectedTimestamp, 1);
  const referenceTemperatureC =
    typeof options.actualTemperatureC === "number" && Number.isFinite(options.actualTemperatureC)
      ? round2(options.actualTemperatureC)
      : currentSummary.stats.meanTemperatureC;
  const sameDayIndices = collectLocalDayIndices(cacheValue.dataset.timestamps, selection.selectedTimestamp);

  const rankedModels: MultiModelInsightRankedModel[] = cacheValue.dataset.models
    .map((model) => {
      const currentTemperatureC = model.values[selection.index];
      if (typeof currentTemperatureC !== "number") {
        return null;
      }

      const dayPeak = pickModelPeakInRange(model, cacheValue.dataset.timestamps, sameDayIndices);
      if (!dayPeak) {
        return null;
      }

      return {
        modelName: model.displayName,
        currentTemperatureC: round2(currentTemperatureC),
        deltaToActualTemperatureC: round2(currentTemperatureC - referenceTemperatureC),
        dayPeakTemperatureC: dayPeak.dayPeakTemperatureC,
        dayPeakTimestamp: dayPeak.dayPeakTimestamp,
      };
    })
    .filter((model): model is MultiModelInsightRankedModel => model !== null)
    .sort(
      (left, right) =>
        Math.abs(left.deltaToActualTemperatureC) - Math.abs(right.deltaToActualTemperatureC) ||
        right.dayPeakTemperatureC - left.dayPeakTemperatureC ||
        left.modelName.localeCompare(right.modelName),
    );

  if (rankedModels.length === 0) {
    throw new AppError(
      503,
      "MULTIMODEL_INSIGHT_EMPTY",
      "The multimodel chart payload did not expose any model values for the selected timestamp.",
      {
        retryable: true,
      },
    );
  }

  const warnings = [
    ...cacheWarnings,
    ...collectDistributionWarnings(currentSummary),
    ...collectInsightWarnings(rankedModels, selection.selectedTimestamp),
    ...collectInventoryWarnings(
      cacheValue.modelInventory,
      rankedModels.map((model) => model.modelName),
    ),
  ];
  if (selection.reason === "nearest-now") {
    warnings.push("No timestamp query was provided; selected the nearest timestamp to the current server time.");
  } else if (selection.reason === "first-available") {
    warnings.push("Could not resolve nearest-now timestamp; selected the first available timestamp from the chart.");
  }
  if (typeof options.actualTemperatureC !== "number") {
    warnings.push("actualTemperatureC was not provided; using selected timestamp model mean as realtime assumption.");
  }

  return {
    location,
    fetchedAt: cacheValue.fetchedAt,
    stale: freshness.stale,
    cacheHit: freshness.cacheHit,
    pageUrl,
    sourceType: "meteoblue-page-highcharts",
    selectedTimestamp: selection.selectedTimestamp,
    selectedTimestampReason: selection.reason,
    availableTimestamps: [...cacheValue.dataset.timestamps],
    modelCount: rankedModels.length,
    modelInventory: cacheValue.modelInventory,
    referenceTemperature: {
      temperatureC: referenceTemperatureC,
      source:
        typeof options.actualTemperatureC === "number"
          ? "assumed-client-value"
          : "selected-model-mean",
    },
    closestModel: rankedModels[0] ?? null,
    rankedModels,
    peakTimeDistribution: buildPeakTimeDistribution(rankedModels),
    sourceProof: {
      dataFromPage: true,
      usesOfficialApi: false,
      chartFormat: "highcharts",
      pageFetchedAt: cacheValue.pageFetchedAt,
      chartEndpoint: buildChartEndpointPreview(cacheValue.highchartsUrl),
      parserVersion: MULTIMODEL_HIGHCHARTS_VERSION,
      modelNames: cacheValue.dataset.models.map((model) => model.displayName),
      timestampCount: cacheValue.dataset.timestamps.length,
      timestampSource: cacheValue.dataset.timestampSource,
      xLabelOffsetMinutes: cacheValue.dataset.detectedXOffsetMinutes,
    },
    warnings: Array.from(new Set(warnings)),
  };
};

export const loadMultiModelDistribution = async (
  pageUrl: string,
  timeZone: string,
): Promise<MultiModelDistributionCacheValue> => {
  const pageHtml = await fetchText(pageUrl);
  const pageFetchedAt = new Date().toISOString();
  const highchartsUrl = extractMultiModelHighchartsUrl(pageHtml);
  const highchartsText = await fetchText(highchartsUrl);

  const parsedDataset = parseMultiModelHighcharts(highchartsText, timeZone);
  const inventorySource = extractMultiModelPageInventory(pageHtml);
  const inventoryBuilt = buildModelInventory(parsedDataset, inventorySource);

  return {
    fetchedAt: new Date().toISOString(),
    pageFetchedAt,
    highchartsUrl,
    dataset: inventoryBuilt.dataset,
    modelInventory: inventoryBuilt.modelInventory,
    warnings: inventoryBuilt.warnings,
  };
};

export const buildMultiModelDistributionResponse = (
  cacheValue: MultiModelDistributionCacheValue,
  location: LocationInfo,
  pageUrl: string,
  requestedTimestamp: string | undefined,
  nowIso: string | undefined,
  bucketSizeC: number,
  freshness: {
    stale: boolean;
    cacheHit: boolean;
  },
): MultiModelDistributionResponse => {
  const cacheWarnings = cacheValue.warnings.filter((warning) => !isInternalInventoryAlignmentWarning(warning));
  const effectiveTimestamp =
    requestedTimestamp ?? resolveInsightSelection(cacheValue.dataset, undefined, nowIso).selectedTimestamp;
  const summary = summarizeMultiModelTemperatureDataset(cacheValue.dataset, effectiveTimestamp, bucketSizeC);
  const dominantBucket = [...summary.distribution].sort(
    (left, right) => right.count - left.count || left.bucketStartC - right.bucketStartC,
  )[0] ?? summary.distribution[0];
  const dominantPeakBucket = [...summary.peakDistribution].sort(
    (left, right) => right.count - left.count || left.bucketStartC - right.bucketStartC,
  )[0] ?? summary.peakDistribution[0];
  const coolestMember = [...summary.members].sort(
    (left, right) => left.temperatureC - right.temperatureC || left.modelName.localeCompare(right.modelName),
  )[0] ?? summary.members[0];
  const warmestMember = [...summary.members].sort(
    (left, right) => right.temperatureC - left.temperatureC || left.modelName.localeCompare(right.modelName),
  )[0] ?? summary.members[summary.members.length - 1];
  const highestPeakMember = [...summary.members].sort(
    (left, right) =>
      right.peakTemperatureC - left.peakTemperatureC ||
      right.temperatureC - left.temperatureC ||
      left.modelName.localeCompare(right.modelName),
  )[0] ?? summary.members[summary.members.length - 1];

  return {
    location,
    fetchedAt: cacheValue.fetchedAt,
    stale: freshness.stale,
    cacheHit: freshness.cacheHit,
    pageUrl,
    sourceType: "meteoblue-page-highcharts",
    requestedTimestamp: requestedTimestamp ?? null,
    selectedTimestamp: summary.selectedTimestamp,
    availableTimestamps: summary.availableTimestamps,
    bucketSizeC,
    modelCount: summary.members.length,
    modelInventory: cacheValue.modelInventory,
    members: summary.members,
    distribution: summary.distribution,
    peakDistribution: summary.peakDistribution,
    sourceProof: {
      dataFromPage: true,
      usesOfficialApi: false,
      chartFormat: "highcharts",
      pageFetchedAt: cacheValue.pageFetchedAt,
      chartEndpoint: buildChartEndpointPreview(cacheValue.highchartsUrl),
      parserVersion: MULTIMODEL_HIGHCHARTS_VERSION,
      modelNames: cacheValue.dataset.models.map((model) => model.displayName),
      timestampCount: cacheValue.dataset.timestamps.length,
      timestampSource: cacheValue.dataset.timestampSource,
      xLabelOffsetMinutes: cacheValue.dataset.detectedXOffsetMinutes,
    },
    highlights: {
      spreadTemperatureC: Number.parseFloat((summary.stats.maxTemperatureC - summary.stats.minTemperatureC).toFixed(2)),
      dominantBucket,
      dominantPeakBucket,
      coolestMember,
      warmestMember,
      highestPeakMember,
    },
    stats: summary.stats,
    warnings: Array.from(
      new Set([
        ...cacheWarnings,
        ...collectDistributionWarnings(summary),
        ...collectInventoryWarnings(
          cacheValue.modelInventory,
          summary.members.map((member) => member.modelName),
        ),
      ]),
    ),
  };
};
















