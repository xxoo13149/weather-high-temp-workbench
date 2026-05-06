import { LOCATION_DIRECTORY, LOCATION_REGISTRY, TIMEZONE_GROUP_ORDER, type LocationId, type TimezoneGroup } from "./config.js";
import type {
  DashboardSourceMetadata,
  HourlyWeatherResponse,
  IntradaySignalsSummary,
  KellyTemperatureUnit,
  KellyPrewarmRuntimeStatus,
  LocationCapabilityStatus,
  LocationContractSource,
  LocationDirectoryEntry,
  LocationRolloutTier,
  LocationSourceContract,
  MarketReferenceSummary,
  MultiModelStatusResponse,
  RuntimeCacheBucketStatus,
  ServiceRuntimeStatus,
  SystemStatusResponse,
  SystemStatusSourceCoverage,
  WeatherReportResponse,
} from "./domain/weather.js";
import { resolveMetarStationId } from "./providers/metar/service.js";

export const SOURCE_CONTRACT_VERSION = "2026-04-22";

const TIER_1_LOCATION_IDS = new Set<LocationId>([
  "shanghai_pvg",
  "beijing_pek",
  "wuhan_wuh",
  "hongkong_hkg",
  "tokyo_hnd",
  "busan_pus",
  "toronto_yyz",
  "miami_mia",
  "losangeles_lax",
  "ankara_esb",
  "amsterdam_ams",
  "london_lcy",
]);

const TIER_2_LOCATION_IDS = new Set<LocationId>([
  "chengdu_ctu",
  "chongqing_ckg",
  "guangzhou_can",
  "shenzhen_szx",
  "laufau_shan_lfs",
  "istanbul_ist",
  "munich_muc",
  "warsaw_waw",
  "madrid_mad",
  "newyork_lga",
  "chicago_ord",
  "atlanta_atl",
  "dallas_dal",
  "austin_aus",
  "houston_hou",
  "helsinki_hel",
  "mexicocity_mex",
  "buenosaires_eze",
  "wellington_wlg",
]);

type SourceScope = "current" | "target";

type SourceCoverageAccumulator = {
  scope: SourceScope;
  key: string;
  label: string;
  counts: Record<LocationCapabilityStatus, number>;
};

const capabilityLabels: Record<LocationCapabilityStatus, string> = {
  production: "生产已接入",
  planned: "已进入计划",
  candidate: "候选待评估",
  unavailable: "当前不可用",
};

const formatConfidenceLabel = (confidence: WeatherReportResponse["metrics"]["confidence"]) => {
  if (confidence === "high") {
    return "高";
  }

  if (confidence === "medium") {
    return "中";
  }

  return "低";
};

const formatPredictabilityLabel = (predictability: WeatherReportResponse["metrics"]["predictability"]) => {
  if (predictability === "very_high") {
    return "很高";
  }

  if (predictability === "high") {
    return "高";
  }

  if (predictability === "medium") {
    return "中";
  }

  if (predictability === "low") {
    return "低";
  }

  return "--";
};

const convertTemperatureFromC = (valueC: number, unit: KellyTemperatureUnit) =>
  unit === "F" ? (valueC * 9) / 5 + 32 : valueC;

const formatRoundedNumber = (value: number) => {
  const rounded = Number.parseFloat(value.toFixed(1));
  if (Math.abs(rounded - Math.round(rounded)) < 1e-9) {
    return String(Math.round(rounded));
  }

  return rounded.toFixed(1).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
};

const formatDisplayTemperature = (valueC: number, unit: KellyTemperatureUnit) =>
  `${formatRoundedNumber(convertTemperatureFromC(valueC, unit))}°${unit}`;

const escapeMetricLabel = (value: string) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");

const toPrometheusMetric = (name: string, labels: Record<string, string> | null, value: number | string) => {
  if (!labels || Object.keys(labels).length === 0) {
    return `${name} ${value}`;
  }

  const labelString = Object.entries(labels)
    .map(([key, labelValue]) => `${key}="${escapeMetricLabel(labelValue)}"`)
    .join(",");
  return `${name}{${labelString}} ${value}`;
};

const toUnixTimeSeconds = (value: string | null | undefined) => {
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1_000) : 0;
};

const buildSource = (
  key: string,
  label: string,
  status: LocationCapabilityStatus,
  detail: string,
  stationCode: string | null = null,
): LocationContractSource => ({
  key,
  label,
  status,
  detail,
  stationCode,
});

const resolveRolloutTier = (locationId: LocationId): LocationRolloutTier => {
  if (TIER_1_LOCATION_IDS.has(locationId)) {
    return "tier-1";
  }

  if (TIER_2_LOCATION_IDS.has(locationId)) {
    return "tier-2";
  }

  return "tier-3";
};

const resolveTierDrivenStatus = (locationId: LocationId): Exclude<LocationCapabilityStatus, "unavailable"> =>
  resolveRolloutTier(locationId) === "tier-1" ? "planned" : "candidate";

const resolveKellyMarketMapping = (
  locationId: LocationId,
): {
  status: LocationCapabilityStatus;
  detail: string;
} => {
  switch (locationId) {
    case "laufau_shan_lfs":
      return {
        status: "planned",
        detail: "流浮山的结算站点与市场档位仍在核对中，当前先以天气侧参考为主。",
      };
    case "masroor_opmr":
      return {
        status: "candidate",
        detail: "Masroor 当前已发现候选市场，但温度档位解析还不够稳定，暂不承诺 Kelly 映射。",
      };
    default:
      return {
        status: "production",
        detail: "继续使用当前 Kelly 市场和温度区间映射。",
      };
  }
};

const buildOfficialEnhancements = (locationId: LocationId): LocationContractSource[] => {
  switch (locationId) {
    case "tokyo_hnd":
      return [
        buildSource(
          "jma-amedas",
          "日本气象厅 AMeDAS",
          "planned",
          "计划作为东京机场市场的官方增强观测层，用于补足机场侧近地面温度与观测节奏。",
        ),
      ];
    case "busan_pus":
      return [
        buildSource(
          "kma-station",
          "韩国气象厅站网",
          "planned",
          "计划作为韩国城市的官方增强层，用于补足机场主站之外的官方观测参考。",
        ),
      ];
    case "hongkong_hkg":
    case "laufau_shan_lfs":
      return [
        buildSource(
          "hko",
          "香港天文台",
          "planned",
          "后续优先接入香港天文台官方站点，用来核对本地实况和温度变化。",
        ),
      ];
    case "ankara_esb":
    case "istanbul_ist":
      return [
        buildSource(
          "mgm",
          "土耳其官方气象站网",
          resolveTierDrivenStatus(locationId),
          "计划作为土耳其城市的官方增强层，优先服务高价值交易城市。",
        ),
      ];
    case "shanghai_pvg":
    case "wuhan_wuh":
    case "beijing_pek":
    case "guangzhou_can":
    case "chengdu_ctu":
    case "chongqing_ckg":
    case "shenzhen_szx":
      return [
        buildSource(
          "nmc",
          "中国气象官方站网",
          resolveTierDrivenStatus(locationId),
          "后续作为中国内地城市的官方补充参考，用来核对机场附近与城市站点的变化。",
        ),
      ];
    case "manila_mnl":
      return [
        buildSource(
          "pagasa",
          "菲律宾官方气象站网",
          resolveTierDrivenStatus(locationId),
          "后续作为马尼拉的官方补充参考，用来核对机场实况之外的本地天气变化。",
        ),
      ];
    case "karachi_khi":
    case "masroor_opmr":
      return [
        buildSource(
          "pmd",
          "巴基斯坦官方气象站网",
          resolveTierDrivenStatus(locationId),
          "后续作为卡拉奇的官方补充参考，用来核对机场实况之外的本地天气变化。",
        ),
      ];
    default:
      return [];
  }
};

export const getLocationSourceContract = (locationId: LocationId): LocationSourceContract => {
  const location = LOCATION_REGISTRY[locationId];
  const metarStationCode = resolveMetarStationId(locationId);
  const rolloutTier = resolveRolloutTier(locationId);
  const tafStatus = metarStationCode ? resolveTierDrivenStatus(locationId) : "candidate";
  const officialStationReference =
    locationId === "laufau_shan_lfs"
      ? {
          label: "香港天文台流浮山站",
          kind: "official-station" as const,
          stationCode: "LFS",
          detail: "香港流浮山温度参考优先使用本地官方站点，不混用机场实况。",
        }
      : null;

  return {
    contractVersion: SOURCE_CONTRACT_VERSION,
    rolloutTier,
    settlementReference:
      officialStationReference ??
      (metarStationCode
        ? {
            label: "机场实况站",
            kind: "metar",
            stationCode: metarStationCode,
            detail: "当前用机场实况作为主要参考，适合机场类温度市场。",
          }
        : {
            label: "参考站点待确认",
            kind: "pending-contract",
            stationCode: null,
            detail: "这座城市还需要补齐稳定的实况站点，当前先看小时预报。",
          }),
    currentSources: {
      baselineForecast: buildSource(
        "meteoblue-week-page",
        "小时预报",
        "production",
        "提供首页 24 小时轨道和今日天气摘要。",
      ),
      modelEnvelope: buildSource(
        "meteoblue-multimodel-page",
        "多模型参考",
        "production",
        "帮助查看不同模型对最高温时间和温度区间是否一致。",
      ),
      primaryObservation:
        metarStationCode
          ? buildSource(
              "aviationweather-metar",
              "机场实况",
              "production",
              "用于核对当前实际气温、风雨和机场附近天气变化。",
              metarStationCode,
            )
          : officialStationReference
            ? buildSource(
                "hko-lau-fau-shan",
                "香港天文台流浮山站",
                "planned",
                "后续接入官方实况；当前先展示小时预报和多模型参考。",
                officialStationReference.stationCode,
              )
            : buildSource(
                "airport-observation",
                "机场实况",
                "candidate",
                "这座城市还没有稳定实况映射，当前先看小时预报。",
              ),
    },
    targetUpgrades: {
      openMeteoMultiModel: buildSource(
        "open-meteo-multi-model",
        "公开多模型",
        "planned",
        "后续作为补充参考，帮助交叉查看不同模型的温度判断。",
      ),
      taf: {
        ...buildSource(
          "aviationweather-taf",
          "机场天气提示",
          tafStatus,
          metarStationCode
            ? "后续用于提醒云雨、雷暴、低云和风向变化是否会影响升温。"
            : "待补齐稳定站点后再评估接入，当前不作为主判断。",
          metarStationCode,
        ),
        role: "airport-disruption-confirmation",
      },
      officialEnhancements: buildOfficialEnhancements(locationId),
    },
    peakWindowLocal: {
      startHour: 12,
      endHour: 18,
      rationale: "当前先以本地午后峰值窗口为统一默认值，后续可按城市与市场规则细化。",
    },
    kellyMarketMapping: resolveKellyMarketMapping(locationId),
  };
};

export const buildLocationDirectory = (): LocationDirectoryEntry[] =>
  LOCATION_DIRECTORY.map((location) => ({
    id: location.id,
    code: location.code,
    displayName: location.displayName,
    displayNameZh: location.displayNameZh,
    shortLabel: location.shortLabel,
    cityName: location.cityName,
    countryName: location.countryName,
    timezone: location.timezone,
    timezoneGroup: location.timezoneGroup,
    displayUnit: location.fallbackDisplayUnit,
    enabled: location.enabled,
    sortOrder: location.sortOrder,
    fallbackDisplayUnit: location.fallbackDisplayUnit,
    weekPageUrl: location.weekPageUrl,
    multimodelPageUrl: location.multimodelPageUrl,
    sourceMetadata: getLocationSourceContract(location.id),
  }));

const resolveNextObservationAt = (hourly: HourlyWeatherResponse) => {
  if (!hourly.items.length) {
    return null;
  }

  const currentIndex = hourly.current?.index ?? -1;
  const nextItem = hourly.items[Math.min(hourly.items.length - 1, Math.max(0, currentIndex + 1))];
  return nextItem?.timestamp ?? null;
};

const buildEvidence = (
  contract: LocationSourceContract,
  report: WeatherReportResponse,
  multimodel: MultiModelStatusResponse,
) => {
  const stationLabel = contract.settlementReference.stationCode ?? contract.settlementReference.label;
  const multiModelReferenceReady =
    multimodel.analysisStatus !== "unavailable" ||
    multimodel.imageStatus !== "unavailable";
  const evidence = [
    `${contract.currentSources.baselineForecast.label}用于生成上方 24 小时轨道。`,
  ];

  evidence.push(
    multiModelReferenceReady
      ? multimodel.freshness === "fallback_error"
        ? "多模型参考当前先沿用最近一次可用结果，分析页可继续交叉确认，但先以小时轨道和天气摘要为主。"
        : "多模型参考可以在分析页继续确认升温时间和温度区间是否稳定。"
      : "多模型参考当前可能暂不可用，先看小时轨道和天气摘要。",
  );

  if (report.metrics.predictability) {
    evidence.push(`天气报告给出的把握度为${formatPredictabilityLabel(report.metrics.predictability)}。`);
  }

  evidence.push(`当前参考站点：${stationLabel}。`);

  return evidence;
};

export const buildDashboardEnhancements = ({
  locationId,
  hourly,
  report,
  multimodel,
}: {
  locationId: LocationId;
  hourly: HourlyWeatherResponse;
  report: WeatherReportResponse;
  multimodel: MultiModelStatusResponse;
}): {
  sourceMetadata: DashboardSourceMetadata;
  intradaySignals: IntradaySignalsSummary;
  marketReference: MarketReferenceSummary;
} => {
  const contract = getLocationSourceContract(locationId);
  const displayUnit = LOCATION_REGISTRY[locationId].fallbackDisplayUnit;
  const maxTemperatureC = report.metrics.maxTemperatureC;
  const confidence = report.metrics.confidence ?? "low";
  const baseCase =
    typeof maxTemperatureC === "number"
      ? `目前先按今天最高温约 ${formatDisplayTemperature(maxTemperatureC, displayUnit)} 来看。`
      : "先跟随小时轨道和天气摘要，等待更完整的最高温信息。";
  const upsideCase =
    typeof maxTemperatureC === "number"
      ? `如果接下来几轮刷新继续升温，可以上看 ${formatDisplayTemperature(maxTemperatureC + 1, displayUnit)} 左右。`
      : "如果接下来 1-2 次刷新持续走暖，再把判断调高。";
  const downsideCase =
    typeof maxTemperatureC === "number"
      ? `如果后续观测转弱、云雨提前或风向变化明显，可以下看 ${formatDisplayTemperature(maxTemperatureC - 1, displayUnit)} 左右。`
      : "如果后续观测明显偏弱，就先保守看低一些。";

  return {
    sourceMetadata: {
      contract,
      freshness: {
        hourly: hourly.freshness,
        report: report.freshness,
        multimodel: multimodel.freshness,
      },
    },
    intradaySignals: {
      headline:
        typeof maxTemperatureC === "number"
          ? `目前看今天最高温大约在 ${formatDisplayTemperature(maxTemperatureC, displayUnit)} 附近。`
          : "目前先看今天最高温会落在哪个区间。",
      confidence,
      baseCase,
      upsideCase,
      downsideCase,
      nextObservationAt: resolveNextObservationAt(hourly),
      evidence: buildEvidence(contract, report, multimodel),
      invalidationRules: [
        "如果下一轮刷新和现在差很多，需要重新判断。",
        "如果模型分歧突然变大，需要降低把握度。",
        "如果实况站点和预报方向冲突，先回到实况重新看。",
      ],
      confirmationRules: [
        "如果接下来 1-2 次刷新继续沿当前方向走，可以维持当前判断。",
        "如果多模型参考继续靠拢，把握度可以提高。",
      ],
    },
    marketReference: {
      mode: "qualitative-only",
      summary: "想看交易机会时，先确认今天大概落在哪个温度区间，再去 Kelly 查看对应日期的市场和仓位建议。",
      kellyRoute: "/kelly",
      targetDate: new Intl.DateTimeFormat("en-CA", {
        timeZone: LOCATION_REGISTRY[locationId].timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date()),
      notes: [
        contract.kellyMarketMapping.status === "production"
          ? "这座城市已接入 Kelly 市场映射。"
          : `这座城市的 Kelly 映射仍在完善中：${capabilityLabels[contract.kellyMarketMapping.status]}。`,
        `当前参考站点：${contract.settlementReference.stationCode ?? contract.settlementReference.label}。`,
      ],
    },
  };
};

const createEmptyCounts = (): Record<LocationCapabilityStatus, number> => ({
  production: 0,
  planned: 0,
  candidate: 0,
  unavailable: 0,
});

const summarizeSourceCoverage = (): SystemStatusSourceCoverage[] => {
  const accumulators = new Map<string, SourceCoverageAccumulator>();

  const upsertCoverage = (scope: SourceScope, source: LocationContractSource) => {
    const key = `${scope}:${source.key}`;
    const existing = accumulators.get(key);
    if (existing) {
      existing.counts[source.status] += 1;
      return;
    }

    accumulators.set(key, {
      scope,
      key: source.key,
      label: source.label,
      counts: {
        ...createEmptyCounts(),
        [source.status]: 1,
      },
    });
  };

  for (const location of LOCATION_DIRECTORY) {
    const contract = getLocationSourceContract(location.id);
    upsertCoverage("current", contract.currentSources.baselineForecast);
    upsertCoverage("current", contract.currentSources.modelEnvelope);
    upsertCoverage("current", contract.currentSources.primaryObservation);
    upsertCoverage("target", contract.targetUpgrades.openMeteoMultiModel);
    upsertCoverage("target", contract.targetUpgrades.taf);
    for (const source of contract.targetUpgrades.officialEnhancements) {
      upsertCoverage("target", source);
    }
  }

  return [...accumulators.values()]
    .map((entry) => ({
      scope: entry.scope,
      key: entry.key,
      label: entry.label,
      productionCount: entry.counts.production,
      plannedCount: entry.counts.planned,
      candidateCount: entry.counts.candidate,
      unavailableCount: entry.counts.unavailable,
    }))
    .sort((left, right) => left.scope.localeCompare(right.scope) || left.label.localeCompare(right.label));
};

const summarizeLocationCoverage = () => {
  const byTimezoneGroup = Object.fromEntries(
    TIMEZONE_GROUP_ORDER.map((group) => [group, 0]),
  ) as Record<TimezoneGroup, number>;
  const byRolloutTier: Record<LocationRolloutTier, number> = {
    "tier-1": 0,
    "tier-2": 0,
    "tier-3": 0,
  };

  for (const location of LOCATION_DIRECTORY) {
    byTimezoneGroup[location.timezoneGroup] += 1;
    byRolloutTier[resolveRolloutTier(location.id)] += 1;
  }

  return {
    totalEnabled: LOCATION_DIRECTORY.length,
    byTimezoneGroup,
    byRolloutTier,
  };
};

export const buildSystemStatusResponse = ({
  service,
  buildId,
  startedAt,
  runtime,
  kellyProxy,
  watchdog,
}: {
  service: string;
  buildId: string;
  startedAt: string;
  runtime: ServiceRuntimeStatus | null;
  kellyProxy?: Record<string, unknown>;
  watchdog?: Record<string, unknown> | null;
}): SystemStatusResponse => ({
  ok: true,
  service,
  buildId,
  startedAt,
  generatedAt: new Date().toISOString(),
  roadmap: {
    profile: "polyweather-absorption-v1",
    cleanRoom: true,
    probabilityLayerEnabled: false,
    marketNarrative: "qualitative-only",
  },
  sourceContractsVersion: SOURCE_CONTRACT_VERSION,
  locationCoverage: summarizeLocationCoverage(),
  sourceCoverage: summarizeSourceCoverage(),
  runtime,
  ...(kellyProxy ? { kellyProxy } : {}),
  ...(watchdog !== undefined ? { watchdog } : {}),
});

export const buildMetricsText = (status: SystemStatusResponse) => {
  const lines = [
    "# HELP weather_runtime_info Weather service runtime build marker.",
    "# TYPE weather_runtime_info gauge",
    toPrometheusMetric("weather_runtime_info", { service: status.service, build_id: status.buildId }, 1),
    "# HELP weather_location_total Enabled location contracts.",
    "# TYPE weather_location_total gauge",
    toPrometheusMetric("weather_location_total", null, status.locationCoverage.totalEnabled),
    "# HELP weather_location_timezone_group_total Enabled locations grouped by timezone group.",
    "# TYPE weather_location_timezone_group_total gauge",
    ...Object.entries(status.locationCoverage.byTimezoneGroup).map(([group, count]) =>
      toPrometheusMetric("weather_location_timezone_group_total", { group }, count),
    ),
    "# HELP weather_location_rollout_tier_total Enabled locations grouped by rollout tier.",
    "# TYPE weather_location_rollout_tier_total gauge",
    ...Object.entries(status.locationCoverage.byRolloutTier).map(([tier, count]) =>
      toPrometheusMetric("weather_location_rollout_tier_total", { tier }, count),
    ),
    "# HELP weather_source_contract_total Source contract coverage counts by scope and status.",
    "# TYPE weather_source_contract_total gauge",
    ...status.sourceCoverage.flatMap((entry) => [
      toPrometheusMetric(
        "weather_source_contract_total",
        { scope: entry.scope, source: entry.key, status: "production" },
        entry.productionCount,
      ),
      toPrometheusMetric(
        "weather_source_contract_total",
        { scope: entry.scope, source: entry.key, status: "planned" },
        entry.plannedCount,
      ),
      toPrometheusMetric(
        "weather_source_contract_total",
        { scope: entry.scope, source: entry.key, status: "candidate" },
        entry.candidateCount,
      ),
      toPrometheusMetric(
        "weather_source_contract_total",
        { scope: entry.scope, source: entry.key, status: "unavailable" },
        entry.unavailableCount,
      ),
    ]),
  ];

  if (status.runtime) {
    lines.push(
      "# HELP weather_runtime_cache_entries Cached entries by bucket.",
      "# TYPE weather_runtime_cache_entries gauge",
    );
    for (const [cacheName, bucket] of Object.entries(status.runtime.caches)) {
      const cache = bucket as RuntimeCacheBucketStatus;
      lines.push(toPrometheusMetric("weather_runtime_cache_entries", { cache: cacheName }, cache.entryCount));
      lines.push(toPrometheusMetric("weather_runtime_cache_entries_fresh", { cache: cacheName }, cache.freshCount));
      lines.push(
        toPrometheusMetric("weather_runtime_cache_entries_revalidating", { cache: cacheName }, cache.revalidatingCount),
      );
      lines.push(
        toPrometheusMetric("weather_runtime_cache_entries_fallback_error", { cache: cacheName }, cache.fallbackErrorCount),
      );
      lines.push(toPrometheusMetric("weather_runtime_cache_inflight", { cache: cacheName }, cache.inFlightCount));
    }

    if (status.runtime.kelly) {
      lines.push(
        "# HELP weather_kelly_open_stream_count Kelly realtime open stream count.",
        "# TYPE weather_kelly_open_stream_count gauge",
        toPrometheusMetric("weather_kelly_open_stream_count", null, status.runtime.kelly.openStreamCount),
        "# HELP weather_kelly_active_hub_count Kelly realtime active hub count.",
        "# TYPE weather_kelly_active_hub_count gauge",
        toPrometheusMetric("weather_kelly_active_hub_count", null, status.runtime.kelly.activeHubCount),
        "# HELP weather_kelly_fallback_mode Kelly fallback mode flag.",
        "# TYPE weather_kelly_fallback_mode gauge",
        toPrometheusMetric("weather_kelly_fallback_mode", null, status.runtime.kelly.fallbackMode ? 1 : 0),
      );
    }

    if (status.runtime.prewarm) {
      const prewarm = status.runtime.prewarm as KellyPrewarmRuntimeStatus;
      lines.push(
        "# HELP weather_prewarm_enabled Kelly prewarm loop enabled flag.",
        "# TYPE weather_prewarm_enabled gauge",
        toPrometheusMetric("weather_prewarm_enabled", null, prewarm.enabled ? 1 : 0),
        "# HELP weather_prewarm_inflight Kelly prewarm loop in-flight flag.",
        "# TYPE weather_prewarm_inflight gauge",
        toPrometheusMetric("weather_prewarm_inflight", null, prewarm.inFlight ? 1 : 0),
        "# HELP weather_prewarm_consecutive_failure_passes Consecutive prewarm passes with failures or crashes.",
        "# TYPE weather_prewarm_consecutive_failure_passes gauge",
        toPrometheusMetric("weather_prewarm_consecutive_failure_passes", null, prewarm.consecutiveFailurePasses),
        "# HELP weather_prewarm_heartbeat_unixtime Last prewarm heartbeat timestamp.",
        "# TYPE weather_prewarm_heartbeat_unixtime gauge",
        toPrometheusMetric("weather_prewarm_heartbeat_unixtime", null, toUnixTimeSeconds(prewarm.heartbeatAt)),
        "# HELP weather_prewarm_next_scheduled_unixtime Next scheduled prewarm pass timestamp.",
        "# TYPE weather_prewarm_next_scheduled_unixtime gauge",
        toPrometheusMetric("weather_prewarm_next_scheduled_unixtime", null, toUnixTimeSeconds(prewarm.nextScheduledAt)),
      );

      if (prewarm.lastPass) {
        lines.push(
          "# HELP weather_prewarm_last_pass_total Last prewarm pass city count.",
          "# TYPE weather_prewarm_last_pass_total gauge",
          toPrometheusMetric("weather_prewarm_last_pass_total", null, prewarm.lastPass.total),
          "# HELP weather_prewarm_last_pass_succeeded Last prewarm pass success count.",
          "# TYPE weather_prewarm_last_pass_succeeded gauge",
          toPrometheusMetric("weather_prewarm_last_pass_succeeded", null, prewarm.lastPass.succeeded),
          "# HELP weather_prewarm_last_pass_failed Last prewarm pass failure count.",
          "# TYPE weather_prewarm_last_pass_failed gauge",
          toPrometheusMetric("weather_prewarm_last_pass_failed", null, prewarm.lastPass.failed),
          "# HELP weather_prewarm_last_pass_duration_ms Last prewarm pass duration in milliseconds.",
          "# TYPE weather_prewarm_last_pass_duration_ms gauge",
          toPrometheusMetric("weather_prewarm_last_pass_duration_ms", null, prewarm.lastPass.durationMs),
        );
      }
    }
  }

  return `${lines.join("\n")}\n`;
};
