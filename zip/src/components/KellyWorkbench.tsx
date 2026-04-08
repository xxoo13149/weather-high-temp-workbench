import { useEffect, useMemo, useState } from "react";

import { KellyWorkbench as KellyWorkbenchShell } from "./kelly";
import type {
  KellyDateChip,
  KellyEvidenceSection,
  KellyFieldErrors,
  KellyMarketStatus,
  KellyOpportunity,
  KellyProbabilityPanelData,
  KellyRiskMode,
  KellySummaryMetric,
  KellySyncMetric,
  KellyWorkbenchData,
} from "@/lib/kelly";
import type { KellyRecommendation, KellyWorkbenchResponse, LocationDirectoryEntry } from "../types";
import { formatDateTime, formatTime } from "../utils";
import type { KellyTemperatureUnit } from "@/types";
import { convertAbsoluteTemperature, convertDeltaTemperature } from "@/components/kelly/temperature";

type SnapshotMarket = KellyWorkbenchResponse["markets"][number] | KellyWorkbenchResponse["inactiveMarkets"][number];

const SOURCE_LABELS: Partial<Record<KellyWorkbenchResponse["weatherEvidence"]["currentReferenceSource"], string>> = {
  manual: "手动输入",
  "hourly-current": "当前实况",
  "hourly-selected": "选中小时",
  "model-mean": "模型均值",
};

const getSourceLabel = (source: KellyWorkbenchResponse["weatherEvidence"]["currentReferenceSource"]) =>
  source === "metar" ? "METAR 瀹炲喌" : (SOURCE_LABELS[source] ?? "--");

const RISK_MODE_LABELS: Record<KellyRiskMode, string> = {
  conservative: "保守",
  balanced: "均衡",
  aggressive: "进取",
};

const INACTIVE_REASON_LABELS: Record<NonNullable<SnapshotMarket["inactiveReason"]>, string> = {
  closed: "该档位已结束",
  accepting_orders_disabled: "当前不再接受下单",
  archived: "该档位已归档",
  expired: "结束时间已过",
  missing_tokens: "缺少完整 token 标识",
  no_orderbook: "当前没有可用 orderbook",
  no_executable_prices: "Yes / No 两侧都没有可执行价格",
};

const CONTRACT_TYPE_LABELS: Record<SnapshotMarket["contractType"], string> = {
  range: "区间",
  atLeast: "至少",
  atMost: "至多",
  exact: "精确",
};

const DATE_RELATIVE_LABELS = ["今天", "明天", "后天"];

const toPercentValue = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? value * 100 : null;

const formatTemp = (
  value: number | null | undefined,
  unit: KellyTemperatureUnit,
  digits = 1,
) =>
  typeof value === "number" && Number.isFinite(value)
    ? `${convertAbsoluteTemperature(value, unit).toFixed(digits)}°${unit}`
    : "--";

const formatDeltaTemp = (
  value: number | null | undefined,
  unit: KellyTemperatureUnit,
  digits = 1,
  signed = false,
) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "--";
  }

  const converted = convertDeltaTemperature(value, unit);
  const sign = signed ? (converted >= 0 ? "+" : "") : "";
  return `${sign}${converted.toFixed(digits)}°${unit}`;
};

const formatRangeTemp = (
  startC: number | null | undefined,
  endC: number | null | undefined,
  unit: KellyTemperatureUnit,
  digits = 1,
) => {
  if (typeof startC === "number" && typeof endC === "number") {
    return `${formatTemp(startC, unit, digits)} ~ ${formatTemp(endC, unit, digits)}`;
  }

  if (typeof startC === "number") {
    return `>= ${formatTemp(startC, unit, digits)}`;
  }

  if (typeof endC === "number") {
    return `<= ${formatTemp(endC, unit, digits)}`;
  }

  return "--";
};

const formatPercent = (value: number | null | undefined, digits = 1) =>
  typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(digits)}%` : "--";

const formatSignedPercent = (value: number | null | undefined, digits = 1) =>
  typeof value === "number" && Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%` : "--";

const formatUsd = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value)
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(value)
    : "--";

const formatShortMonthDay = (value: string, timeZone?: string) => {
  const iso = value.includes("T") ? value : `${value}T00:00:00Z`;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    timeZone: timeZone ?? "UTC",
  }).format(parsed);
};

const convertInlineTemperatureLabel = (label: string, unit: KellyTemperatureUnit): string =>
  label.replace(/(-?\d+(?:\.\d+)?)\s*°?\s*([CF])?/gi, (_match, rawValue, rawUnit) => {
    const parsed = Number.parseFloat(rawValue);
    if (!Number.isFinite(parsed)) {
      return rawValue;
    }

    const sourceUnit = (rawUnit?.toUpperCase() as KellyTemperatureUnit | undefined) ?? "C";
    const celsiusValue = sourceUnit === "F" ? ((parsed - 32) * 5) / 9 : parsed;
    return `${convertAbsoluteTemperature(celsiusValue, unit).toFixed(1)}°${unit}`;
  });

const resolveActionLabel = (side: KellyRecommendation["side"] | SnapshotMarket["recommendedSide"] | "watch") => {
  if (side === "yes") {
    return "买 Yes";
  }
  if (side === "no") {
    return "买 No";
  }
  return "观察";
};

const resolveEntrySourceLabel = (source: SnapshotMarket["entrySourceYes"]) => {
  if (source === "best-ask") {
    return "best ask";
  }
  if (source === "midpoint") {
    return "midpoint";
  }
  return "不可执行";
};

const resolveInactiveReason = (market: SnapshotMarket) =>
  market.inactiveReason ? INACTIVE_REASON_LABELS[market.inactiveReason] : "当前不可交易";

const sortMarkets = (markets: SnapshotMarket[]) =>
  [...markets].sort((left, right) => {
    const leftStart = left.bucketStartC ?? left.bucketEndC ?? Number.POSITIVE_INFINITY;
    const rightStart = right.bucketStartC ?? right.bucketEndC ?? Number.POSITIVE_INFINITY;
    if (leftStart !== rightStart) {
      return leftStart - rightStart;
    }
    return left.title.localeCompare(right.title);
  });

const buildDateChips = (dates: string[], selectedDate: string, timeZone?: string): KellyDateChip[] =>
  dates.slice(0, 3).map((date, index) => {
    const shortLabel = formatShortMonthDay(date, timeZone);
    const relativeLabel = DATE_RELATIVE_LABELS[index];
    return {
      value: date,
      shortLabel,
      label: relativeLabel ? `${relativeLabel} · ${shortLabel}` : shortLabel,
      selected: date === selectedDate,
    };
  });

const buildShortMarketLabel = (market: SnapshotMarket, targetDate: string, timeZone?: string) =>
  `${market.bucketLabel} ${formatShortMonthDay(targetDate, timeZone)}`;

const getContractTypeLabel = (contractType: SnapshotMarket["contractType"] | null | undefined) =>
  contractType ? CONTRACT_TYPE_LABELS[contractType] ?? contractType : null;

const buildOpportunityReasons = (market: SnapshotMarket | null, recommendation: KellyRecommendation, minEdge: number) => {
  if (!market) {
    return ["当前市场快照缺失，先保留观察位。"];
  }

  const entryPricePct = toPercentValue(
    recommendation.side === "yes" ? (market.yesBestAsk ?? market.yesPrice) : (market.noBestAsk ?? market.noPrice),
  );
  const fairPricePct = toPercentValue(recommendation.fairPrice);
  const edgePct = toPercentValue(recommendation.edge);

  return [
    `${resolveActionLabel(recommendation.side)} 可买价 ${formatPercent(entryPricePct)}，我们估值 ${formatPercent(fairPricePct)}。`,
    `当前优势 ${formatSignedPercent(edgePct)}，最小优势阈值 ${formatPercent(minEdge * 100)}。`,
    `建议金额 ${formatUsd(recommendation.suggestedStake)}，Kelly ${formatPercent(toPercentValue(recommendation.kellyFraction))}。`,
  ];
};

const toOpportunity = (
  snapshot: KellyWorkbenchResponse,
  recommendation: KellyRecommendation,
  tier: KellyOpportunity["tier"],
  title: string,
): KellyOpportunity => {
  const market =
    [...snapshot.markets, ...snapshot.inactiveMarkets].find((item) => item.marketId === recommendation.marketId) ?? null;

  return {
    id: `${tier}:${recommendation.marketId}:${recommendation.side}`,
    marketId: recommendation.marketId,
    tier,
    title,
    marketLabel: market ? buildShortMarketLabel(market, snapshot.targetDate, snapshot.location.timezone) : recommendation.title,
    side: recommendation.side,
    thesis:
      tier === "watch"
        ? "这档最接近执行线，先作为观察位保留。"
        : `当前更适合 ${resolveActionLabel(recommendation.side)}，已按 ${RISK_MODE_LABELS[snapshot.riskMode]} 模式给出仓位。`,
    confidenceLabel: tier === "watch" ? "仅观察" : `${RISK_MODE_LABELS[snapshot.riskMode]}模式`,
    edgePct: toPercentValue(recommendation.edge),
    fairPricePct: toPercentValue(recommendation.fairPrice),
    marketPricePct: toPercentValue(recommendation.marketPrice),
    kellyPct: toPercentValue(recommendation.kellyFraction),
    suggestedStakeUsd: recommendation.suggestedStake,
    reasons: buildOpportunityReasons(market, recommendation, snapshot.minEdge),
    tags:
      tier === "watch"
        ? ["仅观察", "建议金额 = 0"]
        : [resolveActionLabel(recommendation.side), `Kelly ${formatPercent(toPercentValue(recommendation.kellyFraction))}`],
  };
};

const resolveSelectedSide = (market: SnapshotMarket | null): KellyRecommendation["side"] | "watch" => {
  if (!market || market.recommendedSide === "none") {
    if (!market) {
      return "watch";
    }
    if (market.edgeYes > market.edgeNo) {
      return "yes";
    }
    if (market.edgeNo > market.edgeYes) {
      return "no";
    }
    return "watch";
  }

  return market.recommendedSide;
};

const resolveStreamTone = (snapshot: KellyWorkbenchResponse, streamState: string): KellySyncMetric["tone"] => {
  if (streamState === "connecting") {
    return "accent";
  }
  if (snapshot.streamHealth.reasonCode === "polling_fallback") {
    return "warning";
  }
  if (snapshot.streamHealth.state === "connected") {
    return snapshot.streamHealth.reasonCode === "no_recent_market_motion" ? "neutral" : "success";
  }
  if (snapshot.streamHealth.state === "degraded") {
    return "warning";
  }
  if (snapshot.streamHealth.state === "disconnected") {
    return "danger";
  }
  return "neutral";
};

const resolveStreamLabel = (snapshot: KellyWorkbenchResponse, streamState: string) => {
  if (streamState === "connecting") {
    return "正在建立订阅";
  }

  switch (snapshot.streamHealth.reasonCode) {
    case "no_recent_market_motion":
      return "已连接，最近无新盘口";
    case "polling_fallback":
      return "已回退到轮询";
    case "no_matched_markets":
      return "当前没有可订阅市场";
    case "missing_tokens":
      return "缺少可订阅 token";
    case "reprice_failed":
      return "收到信号，但重定价失败";
    case "ws_error":
      return snapshot.streamHealth.state === "disconnected" ? "实时流已断开" : "实时流异常";
    case "upstream_error":
      return "上游实时流异常";
    case "ws_connected":
      return "实时流已连接";
    default:
      return snapshot.streamHealth.message || "实时状态暂不可用";
  }
};

const resolveStreamDetail = (snapshot: KellyWorkbenchResponse, timeZone?: string) => {
  const lastSignal = snapshot.streamHealth.lastSignalAt
    ? `最后流事件 ${formatDateTime(snapshot.streamHealth.lastSignalAt, timeZone)}`
    : "最近还没有流事件";
  const lastRepriced = snapshot.streamHealth.lastRepricedAt
    ? `最后重定价 ${formatDateTime(snapshot.streamHealth.lastRepricedAt, timeZone)}`
    : "最近还没有实时重定价";
  return `${lastSignal} / ${lastRepriced}`;
};

const buildProbability = (
  snapshot: KellyWorkbenchResponse,
  displayUnit: KellyTemperatureUnit,
): KellyProbabilityPanelData => ({
  title: "概率依据（辅助）",
  subtitle: "用来解释温度分布和档位落点，不替代上面的仓位建议与主表。",
  summary: `最可能高温区间 ${convertInlineTemperatureLabel(snapshot.distributionSummary.mostLikelyRangeLabel, displayUnit)}，当前收缩 ${formatPercent(
    snapshot.methodology.shrink * 100,
  )}。`,
  samples: snapshot.probabilityCurve.map((point) => ({
    temperatureC: point.temperatureC,
    probabilityPct: point.density * 100,
  })),
  thresholds: snapshot.bucketProbabilities.slice(0, 8).map((bucket) => ({
    id: bucket.marketId,
    marketId: bucket.marketId,
    label: convertInlineTemperatureLabel(bucket.label, displayUnit),
    temperatureC: bucket.bucketStartC ?? bucket.bucketEndC ?? snapshot.distributionSummary.modeTemperatureC,
    detail: `Yes 公允价 ${formatPercent(bucket.probabilityYes * 100)}`,
    tone: "neutral",
  })),
  notes: [
    "先看仓位建议和主表，再回到这里核对落点。",
    "当前版本的收缩系数是启发式口径，不是假装成历史回测拟合。",
  ],
  displayUnit,
});

const buildEvidenceSections = (
  snapshot: KellyWorkbenchResponse,
  selectedMarketId: string | null,
  timeZone: string | undefined,
  displayUnit: KellyTemperatureUnit,
): KellyEvidenceSection[] => {
  const formatEvidenceTemp = (value: number | null | undefined, digits = 1) =>
    formatTemp(value, displayUnit, digits);
  const formatEvidenceDelta = (value: number | null | undefined, digits = 1, signed = false) =>
    formatDeltaTemp(value, displayUnit, digits, signed);
  const allMarkets = sortMarkets([...snapshot.markets, ...snapshot.inactiveMarkets]);
  const market = allMarkets.find((item) => item.marketId === selectedMarketId) ?? allMarkets[0] ?? null;
  const evidence = snapshot.marketEvidence.find((item) => item.marketId === market?.marketId) ?? null;
  const probabilityStep =
    snapshot.methodology.probabilitySteps.details?.find((item) => item.marketId === market?.marketId) ?? null;
  const selectedSide = resolveSelectedSide(market);
  const entryPrice = toPercentValue(
    selectedSide === "yes"
      ? (market?.yesBestAsk ?? market?.yesPrice)
      : selectedSide === "no"
        ? (market?.noBestAsk ?? market?.noPrice)
        : null,
  );
  const fairPrice = toPercentValue(
    selectedSide === "yes" ? market?.fairYes : selectedSide === "no" ? market?.fairNo : null,
  );
  const edge = toPercentValue(selectedSide === "yes" ? market?.edgeYes : selectedSide === "no" ? market?.edgeNo : null);
  const kelly = toPercentValue(
    selectedSide === "yes" ? market?.kellyYes : selectedSide === "no" ? market?.kellyNo : null,
  );

  return [
    {
      id: "decision",
      title: "当前这档为什么值得看",
      description: "先看当前建议、可买价、我们的估值和优势。",
      items: [
        {
          id: "contract",
          label: "当前档位",
          value: market ? buildShortMarketLabel(market, snapshot.targetDate, timeZone) : "--",
          detail: market?.bucketLabel ?? "当前还没有选中档位。",
          tone: "accent",
        },
        {
          id: "side",
          label: "当前建议",
          value: resolveActionLabel(selectedSide),
          detail: market?.recommendedSide === "none" ? "未过执行阈值，先保留观察。" : "已进入执行路径。",
        },
        {
          id: "pricing",
          label: "可买价 / 我们估值",
          value: `${formatPercent(entryPrice)} / ${formatPercent(fairPrice)}`,
          detail: "默认取 best ask；缺失时该侧视为当前不可执行。",
        },
        {
          id: "edge",
          label: "优势 / Kelly",
          value: `${formatSignedPercent(edge)} / ${formatPercent(kelly)}`,
          detail: `建议金额 ${formatUsd(market?.suggestedStake ?? 0)}`,
        },
      ],
    },
    {
      id: "weather",
      title: "天气证据",
      description: "核对参考温度、天气时刻、模型时刻和抓取时间。",
      items: [
          {
            id: "reference",
            label: "参考温度",
            value: formatEvidenceTemp(snapshot.weatherEvidence.currentReferenceTemperatureC),
            detail: `来源：${getSourceLabel(snapshot.weatherEvidence.currentReferenceSource)}`,
            tone: "accent",
          },
        {
          id: "timestamps",
          label: "天气 / 模型时刻",
          value: formatTime(snapshot.weatherEvidence.currentWeatherTimestamp, timeZone),
          detail: `分析使用模型时刻 ${formatTime(snapshot.weatherEvidence.targetModelTimestamp, timeZone)}`,
        },
        {
          id: "summary",
          label: "中文摘要",
          value: snapshot.weatherEvidence.sourceSummaryZh ?? "暂无摘要",
          detail: `天气快照抓取于 ${formatDateTime(snapshot.weatherEvidence.fetchedAt, timeZone)}`,
          sourceLabel: "回查 meteoblue 小时页",
          sourceUrl: snapshot.weatherEvidence.hourlyPageUrl,
        },
      ],
    },
    {
      id: "market",
      title: "市场证据",
      description: "完整题干、规则摘要和 resolution source 只放在这里回查。",
      items: [
        {
          id: "title",
          label: "完整标题",
          value: evidence?.title ?? market?.title ?? "--",
          detail: evidence?.eventTitle ?? undefined,
          sourceLabel: "打开 Polymarket",
          sourceUrl: evidence?.marketUrl ?? market?.marketUrl ?? undefined,
        },
        {
          id: "rule",
          label: "规则摘要",
          value: evidence?.ruleSummary ?? "暂无规则摘要",
          detail: evidence?.resolutionSource ?? undefined,
        },
        {
          id: "lifecycle",
          label: "交易状态",
          value: market?.lifecycle === "tradable" ? "可交易" : "附录档位",
          detail: market ? resolveInactiveReason(market) : "当前没有选中市场。",
          sourceLabel: evidence?.eventUrl ? "事件页" : undefined,
          sourceUrl: evidence?.eventUrl ?? undefined,
        },
      ],
    },
    {
      id: "formula",
      title: "公式口径",
      description: "这不是官方公式，是我们当前版本的启发式定价口径。",
      items: [
        {
          id: "shrink",
          label: "收缩系数",
          value: formatPercent(snapshot.methodology.shrink * 100),
          detail: `分歧 ${formatEvidenceDelta(snapshot.methodology.shrinkInputs.disagreement, 2)} / 偏差离散 ${formatEvidenceDelta(
            snapshot.methodology.shrinkInputs.biasDispersion,
            2,
          )} / 缺失 ${(snapshot.methodology.shrinkInputs.missingRatio * 100).toFixed(1)}%`,
        },
        {
          id: "probability",
          label: "p_raw → p_final",
          value:
            probabilityStep !== null
              ? `${formatPercent(probabilityStep.pRaw * 100)} → ${formatPercent(probabilityStep.pFinal * 100)}`
              : "--",
          detail: probabilityStep
            ? `边界 ${formatEvidenceTemp(probabilityStep.lowerBoundC, 0)} ~ ${formatEvidenceTemp(
                probabilityStep.upperBoundC,
                0,
              )}`
            : "当前档位没有概率积分明细。",
        },
        {
          id: "pricing",
          label: "fair / edge / Kelly",
          value: `${formatPercent(fairPrice)} / ${formatSignedPercent(edge)} / ${formatPercent(kelly)}`,
          detail: snapshot.methodology.probabilitySteps.kellyRule,
        },
      ],
    },
  ];
};

const buildMethodologyNotes = (snapshot: KellyWorkbenchResponse, displayUnit: KellyTemperatureUnit) => [
  "当前版本的 shrink 为启发式收缩，不是历史回测拟合。",
  `参考温度 ${formatTemp(snapshot.methodology.referenceTemperatureC, displayUnit)}，来源 ${getSourceLabel(
    snapshot.methodology.referenceSource,
  )}`,
  `权重拆解均值：bias ${snapshot.methodology.weightBreakdown.biasWeight.toFixed(2)} / consensus ${snapshot.methodology.weightBreakdown.consensusWeight.toFixed(2)} / rank ${snapshot.methodology.weightBreakdown.rankWeight.toFixed(2)} / normalized ${snapshot.methodology.weightBreakdown.normalizedWeight.toFixed(2)}`,
  snapshot.methodology.probabilitySteps.fairPriceRule,
  snapshot.methodology.probabilitySteps.edgeRule,
  snapshot.methodology.probabilitySteps.kellyRule,
];

const buildData = ({
  snapshot,
  locations,
  activeLocationId,
  draftControls,
  draftDirty,
  fieldErrors,
  refreshDisabled,
  selectedMarketId,
  streamState,
  timeZone,
}: {
  snapshot: KellyWorkbenchResponse;
  locations: LocationDirectoryEntry[];
  activeLocationId: string;
  draftControls: {
    bankrollInput: string;
    minEdgeInput: string;
    riskMode: KellyRiskMode;
    actualTemperatureText: string;
  };
  draftDirty: boolean;
  fieldErrors: KellyFieldErrors;
  refreshDisabled: boolean;
  selectedMarketId: string | null;
  streamState: string;
  timeZone?: string;
}): KellyWorkbenchData => {
  const displayUnit: KellyTemperatureUnit = snapshot.displayUnit ?? "C";
  const formatTempWithUnit = (value: number | null | undefined, digits = 1) =>
    formatTemp(value, displayUnit, digits);
  const formatDeltaWithUnit = (
    value: number | null | undefined,
    digits = 1,
    signed = false,
  ) => formatDeltaTemp(value, displayUnit, digits, signed);

  const matchedMarkets = sortMarkets(snapshot.markets);
  const inactiveMarkets = sortMarkets(snapshot.inactiveMarkets);
  const selectedMarket =
    matchedMarkets.find((item) => item.marketId === selectedMarketId) ??
    inactiveMarkets.find((item) => item.marketId === selectedMarketId) ??
    matchedMarkets[0] ??
    inactiveMarkets[0] ??
    null;
  const bestHighlighted = snapshot.recommendations[0] ?? snapshot.bestObservation ?? null;
  const targetDateLabel = formatShortMonthDay(snapshot.targetDate, timeZone);

  const opportunities: KellyOpportunity[] = [
    ...(snapshot.recommendations[0] ? [toOpportunity(snapshot, snapshot.recommendations[0], "primary", "主仓建议")] : []),
    ...(snapshot.recommendations[1] ? [toOpportunity(snapshot, snapshot.recommendations[1], "secondary", "副仓建议")] : []),
    ...(snapshot.bestObservation ? [toOpportunity(snapshot, snapshot.bestObservation, "watch", "观察位")] : []),
  ];

  const markets = matchedMarkets.map((market) => {
    const dominantSide =
      market.recommendedSide === "yes"
        ? "yes"
        : market.recommendedSide === "no"
          ? "no"
          : market.edgeYes >= market.edgeNo
            ? "yes"
            : "no";
    const status: KellyMarketStatus =
      market.lifecycle === "tradable"
        ? typeof market.spreadPct === "number" && market.spreadPct > 0.08
          ? "thin"
          : "tradable"
        : "locked";

    return {
      id: market.marketId,
      marketId: market.marketId,
      label: buildShortMarketLabel(market, snapshot.targetDate, timeZone),
      rangeLabel: getContractTypeLabel(market.contractType) ?? market.bucketLabel,
      yesPricePct: toPercentValue(market.yesBestAsk ?? market.yesPrice),
      noPricePct: toPercentValue(market.noBestAsk ?? market.noPrice),
      fairYesPct: toPercentValue(market.fairYes),
      fairNoPct: toPercentValue(market.fairNo),
      yesEdgePct: toPercentValue(market.edgeYes),
      noEdgePct: toPercentValue(market.edgeNo),
      yesKellyPct: toPercentValue(market.kellyYes),
      noKellyPct: toPercentValue(market.kellyNo),
      spreadPct: toPercentValue(market.spreadPct),
      suggestedStakeUsd: market.recommendedSide === "none" ? 0 : market.suggestedStake,
      recommendation: market.recommendedSide === "none" ? "观察" : "执行",
      recommendationSide: resolveActionLabel(market.recommendedSide),
      status,
      detail:
        market.recommendedSide === "none"
          ? `当前最佳优势 ${formatSignedPercent(toPercentValue(dominantSide === "yes" ? market.edgeYes : market.edgeNo))}，先保留观察。`
          : `${resolveActionLabel(market.recommendedSide)}，建议金额 ${formatUsd(market.suggestedStake)}。`,
      spreadLabel: formatPercent(toPercentValue(market.spreadPct)),
      updatedAtLabel: formatTime(market.updatedAt, timeZone),
      note: `Yes ${resolveEntrySourceLabel(market.entrySourceYes)} / No ${resolveEntrySourceLabel(market.entrySourceNo)}`,
    };
  });

  const inactiveRows = inactiveMarkets.map((market) => ({
    id: market.marketId,
    marketId: market.marketId,
    label: buildShortMarketLabel(market, snapshot.targetDate, timeZone),
    rangeLabel: getContractTypeLabel(market.contractType) ?? market.bucketLabel,
    yesPricePct: toPercentValue(market.yesBestAsk ?? market.yesPrice),
    noPricePct: toPercentValue(market.noBestAsk ?? market.noPrice),
    fairYesPct: toPercentValue(market.fairYes),
    fairNoPct: toPercentValue(market.fairNo),
    yesEdgePct: toPercentValue(market.edgeYes),
    noEdgePct: toPercentValue(market.edgeNo),
    yesKellyPct: toPercentValue(market.kellyYes),
    noKellyPct: toPercentValue(market.kellyNo),
    spreadPct: toPercentValue(market.spreadPct),
    suggestedStakeUsd: 0,
    recommendation: "附录",
    recommendationSide: "当前不可交易",
    status: "locked" as const,
    detail: resolveInactiveReason(market),
    spreadLabel: formatPercent(toPercentValue(market.spreadPct)),
    updatedAtLabel: formatTime(market.updatedAt, timeZone),
    note: "已移出主表，仅保留回查。",
    isInactive: true,
    inactiveReason: resolveInactiveReason(market),
  }));

const summaryMetrics: KellySummaryMetric[] = [
    {
      id: "reference",
      label: "参考温度",
      value: formatTempWithUnit(snapshot.weatherEvidence.currentReferenceTemperatureC),
      detail: `来源：${getSourceLabel(snapshot.weatherEvidence.currentReferenceSource)}`,
      tone: "accent",
    },
    {
      id: "range",
      label: "最可能高温区间",
      value: convertInlineTemperatureLabel(snapshot.distributionSummary.mostLikelyRangeLabel, displayUnit),
      detail: `模型分歧 ${formatDeltaWithUnit(snapshot.distributionSummary.peakSpreadC, 2)}`,
      tone: "warning",
    },
    {
      id: "best",
      label: "当前最值得看",
      value: bestHighlighted ? `${resolveActionLabel(bestHighlighted.side)} ${formatSignedPercent(toPercentValue(bestHighlighted.edge))}` : "--",
      detail: bestHighlighted?.title ?? "当前还没有可交易档位。",
      tone: bestHighlighted ? "success" : "neutral",
    },
  ];

  const syncMetrics: KellySyncMetric[] = [
    {
      id: "weather",
      label: "天气分析时间",
      value: formatDateTime(snapshot.freshness.weatherGeneratedAt, timeZone),
      detail: `参考口径：${getSourceLabel(snapshot.weatherEvidence.currentReferenceSource)}`,
      tone: snapshot.weatherEvidence.stale ? "warning" : "success",
    },
    {
      id: "discovery",
      label: "市场目录时间",
      value: formatDateTime(snapshot.freshness.marketDiscoveredAt, timeZone),
      detail: "Polymarket 市场发现快照时间",
      tone: snapshot.freshness.marketDiscoveredAt ? "accent" : "warning",
    },
    {
      id: "orderbook",
      label: "盘口快照时间",
      value: formatDateTime(snapshot.freshness.orderbookFetchedAt, timeZone),
      detail: selectedMarket ? `当前选中档位更新时间 ${formatDateTime(selectedMarket.updatedAt, timeZone)}` : "当前还没有盘口快照。",
      tone: snapshot.freshness.orderbookFetchedAt ? "success" : "warning",
    },
    {
      id: "stream",
      label: "实时状态",
      value: resolveStreamLabel(snapshot, streamState),
      detail: resolveStreamDetail(snapshot, timeZone),
      tone: resolveStreamTone(snapshot, streamState),
    },
  ];

  return {
    title: "Kelly 实验台",
    subtitle: "先选日期，再看仓位建议和主表；完整题干退到右侧证据区。",
    displayUnit,
    locationId: activeLocationId,
    locationOptions: locations.map((location) => ({
      id: location.id,
      label: location.displayName,
      labelZh: location.displayNameZh,
      shortLabel: location.shortLabel,
      timezone: location.timezone,
      timezoneGroup: location.timezoneGroup,
      disabled: !location.enabled,
    })),
    targetDate: snapshot.targetDate,
    dateOptions: snapshot.availableTargetDates,
    dateChips: buildDateChips(
      snapshot.availableTargetDates.length ? snapshot.availableTargetDates : [snapshot.targetDate],
      snapshot.targetDate,
      timeZone,
    ),
    bankrollInput: draftControls.bankrollInput,
    minEdgeInput: draftControls.minEdgeInput,
    actualTemperatureInput: draftControls.actualTemperatureText,
    riskMode: draftControls.riskMode,
    riskModeOptions: [
      { value: "conservative", label: "保守", hint: "0.25x Kelly，单市场上限 5%" },
      { value: "balanced", label: "均衡", hint: "0.5x Kelly，单市场上限 10%" },
      { value: "aggressive", label: "进取", hint: "0.75x Kelly，单市场上限 15%" },
    ],
    refreshDisabled,
    draftDirty,
    statusNote: draftDirty ? "参数已修改，点击“刷新分析”后应用。" : snapshot.warnings[0] ?? snapshot.streamHealth.message ?? null,
    fieldErrors,
    marketUrl: selectedMarket?.marketUrl ?? snapshot.sourceLinks.marketUrls[0] ?? snapshot.sourceLinks.polymarketSearchUrl,
    syncMetrics,
    summaryMetrics,
    opportunities,
    opportunityEmptyState: markets.length === 0 ? snapshot.warnings[0] ?? "当前没有可交易档位。" : "当前没有过线机会，先保留观察位。",
    probability: buildProbability(snapshot, displayUnit),
    markets,
    inactiveMarkets: inactiveRows,
    marketEmptyState: snapshot.warnings[0] ?? "当前没有可展示的温度档位。",
    unresolvedMarkets: [],
    evidenceSections: buildEvidenceSections(snapshot, selectedMarketId, timeZone, displayUnit),
    methodologyNotes: buildMethodologyNotes(snapshot, displayUnit),
    methodologyModels: snapshot.methodology.models.map((model) => ({
      id: model.modelCode ?? model.modelName,
      modelLabel: model.modelCode ?? model.modelName,
      currentPredictionLabel: formatTempWithUnit(model.currentPredictionC),
      biasNowLabel:
        typeof model.biasNowC === "number" ? formatDeltaWithUnit(model.biasNowC, 1, true) : "--",
      adjustedPeakLabel: formatTempWithUnit(model.adjustedPeakTemperatureC),
      weightLabel: typeof model.weight === "number" ? `${(model.weight * 100).toFixed(1)}%` : "--",
      statusLabel: model.included ? "已纳入" : "已排除",
      detail:
        model.included && model.weightBreakdown
          ? `bias ${model.weightBreakdown.biasWeight.toFixed(2)} / consensus ${model.weightBreakdown.consensusWeight.toFixed(2)} / rank ${model.weightBreakdown.rankWeight.toFixed(2)}`
          : model.exclusionReason ?? "本轮未纳入计算。",
      included: model.included,
    })),
    frameAnalysisGroups: [],
  };
};

export const KellyWorkbench = ({
  snapshot,
  locations,
  activeLocationId,
  timezone,
  bankrollInput,
  riskMode,
  minEdgeInput,
  actualTemperatureText,
  draftDirty = false,
  fieldErrors = {},
  loading,
  refreshing = false,
  refreshDisabled = false,
  error,
  streamState,
  onLocationChange,
  onTargetDateChange,
  onBankrollChange,
  onRiskModeChange,
  onMinEdgeChange,
  onActualTemperatureChange,
  onRefresh,
}: {
  snapshot: KellyWorkbenchResponse | null;
  locations: LocationDirectoryEntry[];
  activeLocationId: string;
  timezone?: string;
  bankrollInput: string;
  riskMode: KellyRiskMode;
  minEdgeInput: string;
  actualTemperatureText: string;
  draftDirty?: boolean;
  fieldErrors?: KellyFieldErrors;
  loading: boolean;
  refreshing?: boolean;
  refreshDisabled?: boolean;
  error: string | null;
  streamState: string;
  onLocationChange: (locationId: string) => void;
  onTargetDateChange: (targetDate: string) => void;
  onBankrollChange: (value: string) => void;
  onRiskModeChange: (riskMode: KellyRiskMode) => void;
  onMinEdgeChange: (value: string) => void;
  onActualTemperatureChange: (value: string) => void;
  onRefresh: () => void;
}) => {
  const [selectedMarketId, setSelectedMarketId] = useState<string | null>(null);
  const [selectedOpportunityId, setSelectedOpportunityId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedMarketId(null);
    setSelectedOpportunityId(null);
  }, [snapshot?.location.id, snapshot?.targetDate]);

  useEffect(() => {
    if (!snapshot) {
      setSelectedMarketId(null);
      return;
    }

    const allMarkets = [...snapshot.markets, ...snapshot.inactiveMarkets];
    if (selectedMarketId && allMarkets.some((market) => market.marketId === selectedMarketId)) {
      return;
    }

    setSelectedMarketId(
      snapshot.recommendations[0]?.marketId ??
        snapshot.bestObservation?.marketId ??
        snapshot.markets[0]?.marketId ??
        snapshot.inactiveMarkets[0]?.marketId ??
        null,
    );
  }, [selectedMarketId, snapshot]);

  const data = useMemo(
    () =>
      snapshot
        ? buildData({
            snapshot,
            locations,
            activeLocationId,
            draftControls: {
              bankrollInput,
              minEdgeInput,
              riskMode,
              actualTemperatureText,
            },
            draftDirty,
            fieldErrors,
            refreshDisabled,
            selectedMarketId,
            streamState,
            timeZone: timezone,
          })
        : null,
    [
      actualTemperatureText,
      activeLocationId,
      bankrollInput,
      draftDirty,
      fieldErrors,
      locations,
      minEdgeInput,
      refreshDisabled,
      riskMode,
      selectedMarketId,
      snapshot,
      streamState,
      timezone,
    ],
  );

  if (!snapshot || !data) {
    return (
      <section className="terminal-panel">
        <div className="panel-section">
          <div className="eyebrow">Kelly 实验台</div>
          <h2 className="mt-3 text-xl font-semibold text-white">{loading ? "正在加载 Kelly 分析..." : "Kelly 实验台暂不可用"}</h2>
          <p className="mt-3 text-sm text-white/64">{error ?? "当前还没有可展示的 Kelly 快照。"}</p>
        </div>
      </section>
    );
  }

  return (
    <KellyWorkbenchShell
      data={data}
      disabled={loading || refreshing}
      refreshing={refreshing}
      selectedMarketId={selectedMarketId}
      selectedOpportunityId={selectedOpportunityId}
      onLocationChange={onLocationChange}
      onTargetDateChange={onTargetDateChange}
      onBankrollChange={onBankrollChange}
      onMinEdgeChange={onMinEdgeChange}
      onActualTemperatureChange={onActualTemperatureChange}
      onRiskModeChange={onRiskModeChange}
      onRefresh={onRefresh}
      onSelectOpportunity={setSelectedOpportunityId}
      onSelectMarket={setSelectedMarketId}
    />
  );
};
