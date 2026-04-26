import type { DistributionViewModel, InsightViewModel } from "./mappers";
import { CONFIG } from "./config";
import { formatTime } from "./utils";

export const UI_TEXT = {
  app: {
    loadingEyebrow: "初始化中",
    loadingTitle: "正在读取天气与多模型数据",
    loadingDescription: "首次加载会同步小时预报、中文摘要与多模型判断，请稍候。",
    closeRail: "关闭地点侧轨",
  },
  header: {
    productName: "首页决策台",
    synced: "已同步",
    stale: "缓存回退",
    home: "首页决策台",
    analysis: "分析工作区",
    refresh: "刷新",
    refreshIdle: "待命",
    refreshPending: "刷新中",
    refreshSuccess: "已更新",
    refreshError: "刷新失败",
    favorite: "收藏当前地点",
    unfavorite: "取消收藏",
    expandRail: "展开地点侧轨",
    collapseRail: "收起地点侧轨",
  },
  rail: {
    ariaLabel: "地点侧轨",
    title: "地点侧轨",
    description: "默认收起，展开后可切换地点与查看收藏。",
    reserved: "预留位",
    current: "当前地点",
    currentTemperature: "当前温度",
    comingSoon: "即将扩展",
    favorite: "收藏",
    unfavorite: "取消收藏",
  },
  weatherOverview: {
    currentDecision: "当前判断",
    currentMoment: "当前时刻",
    feelsLike: "体感",
    wind: "风",
    currentPrecipitation: "当前降水",
    currentWind: "当前风速",
    sourcePage: "天气原页",
    timelineTitle: "24 小时预测轨道",
    timelineDescription: "轨道展示温度和降水变化，点选小时即可看清当前这一格的细项。",
    now: "现在",
    peak: "峰值",
    peakTemperature: "最高温",
    currentHour: "当前小时",
    range: "区间",
    selectedHour: "选中小时",
    precipitation: "降水",
    precipitationProbability: "降水概率",
    apparentTemperature: "体感温度",
    waitingHourlyData: "等待小时数据",
    summarySyncing: "天气摘要同步中。",
    nowBadge: "现在",
    hiddenAtSource: "该时段未公开",
    topBandTitle: "当前选中时段",
    peakWindow: "峰值时段",
  },
  insight: {
    eyebrow: "多模型快速分析",
    title: "最接近的前 3 个模型",
    description: "按当前参考温度筛选最接近的前 3 个模型，只保留结构化判断。",
    openDetails: "查看详情",
    referenceTemperature: "参考温度",
    calculating: "计算中",
    updated: "已更新",
    idle: "待命",
    manual: "手动输入",
    modelMean: "模型均温",
    currentMoment: "当前时刻",
    resetDefault: "恢复默认",
    temperatureInputPlaceholder: "输入最新温度，例如 21.4",
    currentReference: "当前参考",
    source: "来源",
    modelTimestamp: "模型时刻",
    autoNearest: "自动选择最近时刻",
    candidatePrefix: "候选",
    currentPrediction: "当前预测",
    peakTemperature: "当日最高温",
    peakWindow: "峰值时段",
    waitingResult: "正在等待多模型快速分析结果。",
    footer: "首页只展示前 3 个模型，完整排序、分布与资料说明请进入分析工作区。",
    enterAnalysis: "进入分析",
  },
  analysis: {
    eyebrow: "分析工作区",
    title: "模型详情与官方原图",
    description: "这里集中查看完整模型排序、三类分布、模型资料说明与官方原图。",
    modelsTab: "模型详情",
    imageTab: "官方原图",
    referenceTemperature: "参考温度",
    modelCount: "模型总数",
    temperatureSpread: "温度跨度",
    temperatureSpreadCaption: "当前时刻的离散范围",
    catalogCoverage: "资料覆盖",
    fullRanking: "完整模型排序",
    rankingLoading: "完整模型排序后台更新中...",
    waitingModelData: "等待模型数据",
    clearLock: "清除锁定",
    hasCatalog: "有资料",
    currentPrediction: "当前预测",
    deviation: "偏差",
    dayPeakTemperature: "当日最高温",
    noPeakMoment: "暂无峰值时刻",
    peakDistribution: "峰值时段分布",
    temperatureDistribution: "当前温区分布",
    highestPeakDistribution: "最高温分布",
    distributionLoading: "分布数据后台更新中...",
    clear: "清除",
    clearAll: "清除筛选",
    modelUnit: "个模型",
    average: "平均",
    range: "范围",
    sourceProof: "源证明",
    chartSource: "图表来源",
    timestampSource: "时间来源",
    sampleCount: "样本",
    extendedMetrics: "扩展指标",
    maxTemperature: "最高气温",
    weatherReport: "天气报告",
    fromWeatherReport: "来自天气报告",
    uvIndex: "紫外线",
    predictabilityPrefix: "可信度",
    modelProfile: "模型资料",
    modelProfileHint: "悬停或点击模型，可联动查看机构背景、能力边界、优势局限与运行信息。",
    profileCoverage: "资料命中",
    dynamicJoinCaption: "动态模型集合会与静态资料表自动 join",
    interactionState: "联动状态",
    interactionRisk: "检测到数据风险",
    interactionClickHint: "点击后可保持锁定",
    staticProfileMissing: "这个模型暂时没有整理好的静态资料，但仍会保留当前动态表现和分布位置。",
    profileOrganization: "机构",
    profileType: "类型",
    profileCoverageLabel: "覆盖",
    profileResolution: "分辨率",
    profileUpdate: "更新",
    profileHorizon: "时效",
    profileStrengths: "更适合看",
    profileLimits: "需要谨慎",
    profileDistributionTemp: "分布温度",
    profileBucket: "当前温区",
    profilePeakHit: "峰值命中",
    profileNotes: "说明",
    profileRuntime: "运行与更新",
    profilePageUpdate: "页面 Last update",
    profileOfficialCadence: "官方运行节奏",
    profileFetchedAt: "本次抓取",
    profileVerifiedAt: "核验日期",
    profileCurrentRunUnavailable: "当前页面未公开该模型本次运行时间。",
    hit: "命中",
    miss: "未命中",
    profileDisclaimer: "模型资料描述的是模型特性和边界，不等于当前时刻的自动准确率评分。",
    openOfficialSource: "打开官方资料",
    officialImage: "官方原图",
    officialImageViewer: "官方原图查看器",
    officialImageDescription: "优先显示最近一次成功缓存的版本，同时在后台刷新。",
    openInNewTab: "新标签打开",
    currentStatus: "当前状态",
    displayVersion: "显示版本",
    latestImage: "最新图",
    cachedImage: "缓存图",
    backgroundRefreshFailed: "后台刷新曾失败",
    backgroundRefreshReady: "后台可继续刷新",
    cachedVersionCaption: "当前优先显示缓存版本",
    latestVersionCaption: "当前显示最新缓存",
    readTime: "读取时间",
    prewarmHint: "进入页面时会提前预热",
    peakSummary: "峰值摘要",
    peakSummaryLoading: "正在读取多模型峰值分布。",
    available: "可用",
    imageUnavailable: "当前无法读取官方原图，请稍后重试。",
    integrityIssue: "检测到模型列表与分布数据不一致，已暂停部分联动高亮。",
    interactionsDisabled: "已暂停部分联动",
    hoverHint: "悬停或点击模型可联动查看",
    lockedPrefix: "已锁定",
    highlightedPrefix: "已高亮",
    peakPrefix: "峰值",
    bucketPrefix: "温区",
    filterState: "当前筛选",
    filterAll: "全部模型",
    filteredModels: "命中模型",
    localFilterOnly: "仅做本地筛选，不会重新请求后端",
    compactDistributionHint: "悬停展开，点击锁定筛选",
    defaultBucketState: "未筛选",
  },
  errors: {
    dashboard: "首页数据读取失败，请稍后重试。",
    insight: "多模型快速分析读取失败。",
    distribution: "模型分布读取失败。",
    favorites: "收藏状态同步失败。",
  },
  responsiveGuard: {
    message: "为了获得完整的桌面终端视图，建议优先在 1440×900 及以上窗口查看。",
  },
} as const;

const MULTIMODEL_STATUS_LABELS = {
  ready: "就绪",
  revalidating: "后台刷新中",
  fallback_error: "缓存回退",
  unavailable: "不可用",
} as const;

const MULTIMODEL_STATUS_CAPTIONS = {
  analysis: {
    ready: "多模型分析数据已就绪。",
    revalidating:
      "正在后台刷新，当前先显示最近一次成功的分析结果。",
    fallback_error:
      "最新分析刷新失败，当前回退到最近一次成功结果。",
    unavailable: "当前地区暂无可用的多模型分析数据。",
  },
  image: {
    ready: "官方原图已就绪。",
    revalidating:
      "正在后台刷新，当前先显示最近一张可用图像。",
    fallback_error:
      "最新原图拉取失败，当前回退到最近一张可用图像。",
    unavailable: "当前地区暂无可用的官方原图。",
  },
} as const;

export const translateStatusLabel = (status: string | null | undefined) => {
  if (!status) {
    return CONFIG.fallback.nullValue;
  }

  const normalized = status.toLowerCase();
  return MULTIMODEL_STATUS_LABELS[normalized as keyof typeof MULTIMODEL_STATUS_LABELS] ?? CONFIG.text.statusMapping[normalized] ?? status;
};

export const describeMultimodelStatus = (
  surface: "analysis" | "image",
  status: string | null | undefined,
) => {
  if (!status) {
    return CONFIG.fallback.nullValue;
  }

  const normalized = status.toLowerCase() as keyof (typeof MULTIMODEL_STATUS_CAPTIONS)["analysis"];
  return MULTIMODEL_STATUS_CAPTIONS[surface][normalized] ?? status;
};

export const translatePredictabilityLabel = (value: string | null | undefined) => {
  if (!value) {
    return CONFIG.fallback.nullValue;
  }

  return CONFIG.text.predictabilityMapping[value] ?? value;
};

export const translateWarningLabel = (warning: string) => CONFIG.text.warningMapping[warning] ?? warning;
export const translateFieldCoverageWarning = (warning: string) => {
  const match = warning.match(/^1h (feelsLikeC|precipitationProbabilityPct|windDirection) missing for (\d+)\/(\d+) hours from source table\.$/);
  if (!match) {
    return null;
  }

  const labelMap = {
    feelsLikeC: "体感温度",
    precipitationProbabilityPct: "降水概率",
    windDirection: "风向",
  } as const;

  return `1 小时源站表中，${labelMap[match[1] as keyof typeof labelMap]}缺失 ${match[2]}/${match[3]} 个时段。`;
};

export const translateWarning = (warning: string) =>
  translateFieldCoverageWarning(warning) ?? CONFIG.text.warningMapping[warning] ?? warning;

const normalizeWarning = (warning: string) => warning.trim().replace(/\s+/g, " ").toLowerCase();

const isInternalModelParseWarning = (warning: string) => {
  const normalized = normalizeWarning(warning);
  const mentionsSelectedModel = normalized.includes("selected model");
  const mentionsMissingSeries =
    normalized.includes("missing in parsed highcharts series") ||
    normalized.includes("missing in pressed highcharts series") ||
    normalized.includes("missing in pressed high chess series");
  const mentionsNoTableRow =
    normalized.includes("no model table row matched") && normalized.includes("selected domain");
  return (mentionsSelectedModel && mentionsMissingSeries) || mentionsNoTableRow;
};

const isFavoritesRouteNoiseWarning = (warning: string) => {
  const normalized = normalizeWarning(warning);
  return normalized.includes("route not found") && normalized.includes("/api/user/favorites");
};

const isRequestedTimestampFallbackWarning = (warning: string) => {
  const normalized = normalizeWarning(warning);
  return normalized.includes("requested timestamp was unavailable") && normalized.includes("nearest available timestamp");
};

const isFieldCoverageWarning = (warning: string) =>
  /^1h (feelslikec|precipitationprobabilitypct|winddirection) missing for \d+\/\d+ hours from source table\.$/i.test(
    warning.trim(),
  );

const isSevereWarning = (warning: string) => {
  const normalized = normalizeWarning(warning);
  if (isFieldCoverageWarning(warning)) {
    return false;
  }
  return (
    normalized.includes("failed") ||
    normalized.includes("error") ||
    normalized.includes("exception") ||
    normalized.includes("unavailable") ||
    normalized.includes("timeout") ||
    normalized.includes("integrity") ||
    normalized.includes("inconsistent")
  );
};

const shouldDisplayWarning = (warning: string) =>
  !isInternalModelParseWarning(warning) && !isFavoritesRouteNoiseWarning(warning);

const collectWarnings = ({
  dashboardWarnings,
  reportWarnings,
  insightWarnings,
  distributionWarnings,
  suppressRequestedTimestampFallback = false,
}: {
  dashboardWarnings?: string[];
  reportWarnings?: string[];
  insightWarnings?: string[];
  distributionWarnings?: string[];
  suppressRequestedTimestampFallback?: boolean;
}) =>
  Array.from(
    new Set(
      [
        ...(dashboardWarnings ?? []),
        ...(reportWarnings ?? []),
        ...(insightWarnings ?? []),
        ...(distributionWarnings ?? []),
      ]
        .filter((warning): warning is string => Boolean(warning) && shouldDisplayWarning(warning))
        .filter((warning) => !(suppressRequestedTimestampFallback && isRequestedTimestampFallbackWarning(warning)))
        .map((warning) => translateWarning(warning)),
    ),
  );

export const collectDisplayWarnings = ({
  dashboardWarnings,
  reportWarnings,
  insightWarnings,
  distributionWarnings,
  suppressRequestedTimestampFallback = false,
}: {
  dashboardWarnings?: string[];
  reportWarnings?: string[];
  insightWarnings?: string[];
  distributionWarnings?: string[];
  suppressRequestedTimestampFallback?: boolean;
}) =>
  collectWarnings({
    dashboardWarnings,
    reportWarnings,
    insightWarnings,
    distributionWarnings,
    suppressRequestedTimestampFallback,
  });

export const collectHomeDisplayWarnings = ({
  dashboardWarnings,
  reportWarnings,
  insightWarnings,
  distributionWarnings,
  suppressRequestedTimestampFallback = false,
}: {
  dashboardWarnings?: string[];
  reportWarnings?: string[];
  insightWarnings?: string[];
  distributionWarnings?: string[];
  suppressRequestedTimestampFallback?: boolean;
}) =>
  Array.from(
    new Set(
      [
        ...(dashboardWarnings ?? []),
        ...(reportWarnings ?? []),
        ...(insightWarnings ?? []),
        ...(distributionWarnings ?? []),
      ]
        .filter((warning): warning is string => Boolean(warning) && shouldDisplayWarning(warning))
        .filter((warning) => !(suppressRequestedTimestampFallback && isRequestedTimestampFallbackWarning(warning)))
        .filter((warning) => isSevereWarning(warning))
        .map((warning) => translateWarning(warning)),
    ),
  );

export const toDecisionSummaryText = (text: string) => {
  const normalized = text.trim();
  if (!normalized) {
    return text;
  }
  if (normalized.startsWith("判断要点：")) {
    return normalized;
  }
  return `判断要点：${normalized}`;
};

export const buildPeakSummary = (distribution: InsightViewModel["peakTimeDistribution"], timeZone?: string) => {
  if (!distribution.length) {
    return "峰值时段分布正在同步。";
  }

  const sorted = [...distribution].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  const topCount = Math.max(...sorted.map((item) => item.modelCount));
  const topItems = sorted.filter((item) => item.modelCount >= Math.max(1, topCount - 1));
  const first = topItems[0] ?? sorted[0];
  const last = topItems[topItems.length - 1] ?? first;

  if (!first) {
    return "峰值时段分布正在同步。";
  }

  if (first.timestamp === last.timestamp) {
    return `主流峰值集中在 ${formatTime(first.timestamp, timeZone)}，完整分布请进入模型详情确认。`;
  }

  return `主流峰值集中在 ${formatTime(first.timestamp, timeZone)} 至 ${formatTime(last.timestamp, timeZone)}，完整分布请进入模型详情查看。`;
};

export const hasAnalysisIntegrityIssue = (
  insight: InsightViewModel | null,
  distribution: DistributionViewModel | null,
) => {
  if (!insight || !distribution) {
    return false;
  }

  const distributionTotal = distribution.distribution.reduce((sum, bucket) => sum + bucket.count, 0);
  const peakTotal = distribution.peakDistribution.reduce((sum, bucket) => sum + bucket.count, 0);
  const rankedNames = new Set(insight.rankedModels.map((model) => model.modelName));
  const inventoryNames = new Set((insight.modelInventory ?? distribution.modelInventory ?? []).map((item) => item.modelName));

  return (
    distribution.modelCount !== distribution.members.length ||
    insight.modelCount !== insight.rankedModels.length ||
    distributionTotal !== distribution.modelCount ||
    peakTotal !== distribution.modelCount ||
    distribution.members.some((member) => !rankedNames.has(member.modelName)) ||
    (inventoryNames.size > 0 &&
      (insight.rankedModels.some((model) => !inventoryNames.has(model.modelName)) ||
        distribution.members.some((member) => !inventoryNames.has(member.modelName))))
  );
};
