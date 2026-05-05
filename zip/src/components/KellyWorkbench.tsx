import { useEffect, useMemo, useState } from "react";
import { Orbit, ShieldCheck } from "lucide-react";

import { KellyWorkbench as KellyWorkbenchShell } from "./kelly";
import type {
  KellyDateChip,
  KellyEvidenceSection,
  KellyFieldErrors,
  KellyMarketStatus,
  KellyOpportunity,
  KellyRiskMode,
  KellySummaryMetric,
  KellySyncMetric,
  KellyWorkbenchData,
} from "@/lib/kelly";
import type {
  DashboardSourceMetadata,
  IntradaySignalsSummary,
  KellyRecommendation,
  KellyWorkbenchResponse,
  LocationDirectoryEntry,
  MarketReferenceSummary,
} from "../types";
import {
  buildMetarDetail,
  buildMetarHeadline,
  buildTafDetail,
  buildTafHeadline,
} from "../lib/aviation-display";
import { formatDateTime, formatShortMonthDay, formatTime } from "../utils";
import type { KellyTemperatureUnit } from "@/types";
import { convertAbsoluteTemperature, convertDeltaTemperature } from "@/components/kelly/temperature";
import { shouldHideKellyFloorMarket } from "../kelly";

type SnapshotMarket = KellyWorkbenchResponse["markets"][number] | KellyWorkbenchResponse["inactiveMarkets"][number];

const OBSERVATION_FLOOR_LABEL = "实况温度已超过该档位";

const SOURCE_LABELS: Partial<Record<KellyWorkbenchResponse["weatherEvidence"]["currentReferenceSource"], string>> = {
  manual: "手动输入",
  metar: "机场实况",
  "hourly-current": "当前实况",
  "hourly-selected": "选中小时",
  "model-mean": "模型均值",
};

const getSourceLabel = (source: KellyWorkbenchResponse["weatherEvidence"]["currentReferenceSource"]) =>
  SOURCE_LABELS[source] ?? "--";

const resolvePrimaryKellyWarning = (warnings: string[]) =>
  warnings.find((warning) => warning.includes("市场") || warning.includes("档位") || warning.includes("盘口")) ??
  warnings[0] ??
  null;

const RISK_MODE_LABELS: Record<KellyRiskMode, string> = {
  conservative: "保守",
  balanced: "均衡",
  aggressive: "进取",
};

const INACTIVE_REASON_LABELS: Partial<Record<NonNullable<SnapshotMarket["inactiveReason"]>, string>> = {
  closed: "该档位已结束",
  accepting_orders_disabled: "当前不再接受下单",
  archived: "该档位已归档",
  expired: "结束时间已过",
  missing_tokens: "缺少完整 token 标识",
  no_orderbook: "当前没有可用 orderbook",
  no_executable_prices: "Yes / No 两侧都没有可执行价格",
  observation_floor: OBSERVATION_FLOOR_LABEL,
};

const CONTRACT_TYPE_LABELS: Record<SnapshotMarket["contractType"], string> = {
  range: "区间",
  atLeast: "至少",
  atMost: "至多",
  exact: "精确",
};

const DATE_RELATIVE_LABELS = ["今天", "明天", "后天"];
const KELLY_LOADING_PHASES = [
  { label: "盘口目录", detail: "识别温度档位与当前可交易状态" },
  { label: "天气参考", detail: "同步实况、小时页与模型时刻" },
  { label: "仓位参数", detail: "按 Kelly 风控口径生成执行建议" },
];

const KELLY_SOURCE_STATUS_LABEL: Record<string, string> = {
  production: "已接入",
  planned: "计划接入",
  candidate: "待确认",
  unavailable: "暂不可用",
};

const describeKellyReferenceStation = (sourceMetadata: DashboardSourceMetadata) =>
  sourceMetadata.contract.settlementReference.stationCode ?? sourceMetadata.contract.settlementReference.label;

const KellySourceContractPanel = ({
  sourceMetadata,
  intradaySignals,
  marketReference,
  timezone,
}: {
  sourceMetadata?: DashboardSourceMetadata | null;
  intradaySignals?: IntradaySignalsSummary | null;
  marketReference?: MarketReferenceSummary | null;
  timezone?: string;
}) => {
  if (!sourceMetadata || !intradaySignals || !marketReference) {
    return null;
  }

  const officialEnhancement = sourceMetadata.contract.targetUpgrades.officialEnhancements[0] ?? null;
  const referenceStation = describeKellyReferenceStation(sourceMetadata);

  return (
    <details className="terminal-panel kelly-source-contract-panel">
      <summary className="panel-section kelly-source-contract-panel__summary">
        <div className="kelly-source-contract-panel__summary-main">
          <div className="eyebrow flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[var(--accent)]" />
            天气依据
          </div>
          <strong>{intradaySignals.headline}</strong>
          <span>{marketReference.summary}</span>
        </div>
        <div className="kelly-source-contract-panel__summary-facts">
          <span>
            <b>站点</b>
            {referenceStation}
          </span>
          <span>
            <b>小时</b>
            {sourceMetadata.contract.currentSources.baselineForecast.label}
          </span>
          <span>
            <b>补充</b>
            {officialEnhancement?.label ?? sourceMetadata.contract.targetUpgrades.taf.label}
          </span>
        </div>
        <span className="kelly-source-contract-panel__summary-toggle" aria-hidden="true" />
      </summary>
      <div className="panel-section kelly-shell__inner kelly-source-contract-panel__details">
        <div className="kelly-shell__header">
          <div className="kelly-shell__hero">
            <div className="eyebrow flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[var(--accent)]" />
              Kelly 参考数据
            </div>
            <h2 className="kelly-shell__title text-[clamp(1.35rem,2vw,1.85rem)]">先确认天气，再看市场</h2>
            <p className="kelly-shell__subtitle">这里展示这次 Kelly 分析使用的天气参考，避免只盯盘口价格。</p>
          </div>

          <div className="kelly-shell__signal">
            <span className="kelly-shell__signal-dot" />
            先看天气
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.7fr)]">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="kelly-sync-card">
              <div className="kelly-sync-card__label">参考站点</div>
              <div className="kelly-sync-card__value">{referenceStation}</div>
              <div className="kelly-sync-card__detail">{sourceMetadata.contract.settlementReference.detail}</div>
            </div>

            <div className="kelly-sync-card">
              <div className="kelly-sync-card__label">小时预报</div>
              <div className="kelly-sync-card__value">
                {sourceMetadata.contract.currentSources.baselineForecast.label}
              </div>
              <div className="kelly-sync-card__detail">
                {KELLY_SOURCE_STATUS_LABEL[sourceMetadata.contract.currentSources.baselineForecast.status] ??
                  sourceMetadata.contract.currentSources.baselineForecast.status}
              </div>
            </div>

            <div className="kelly-sync-card">
              <div className="kelly-sync-card__label">补充参考</div>
              <div className="kelly-sync-card__value">
                {officialEnhancement?.label ?? sourceMetadata.contract.targetUpgrades.taf.label}
              </div>
              <div className="kelly-sync-card__detail">
                {KELLY_SOURCE_STATUS_LABEL[sourceMetadata.contract.targetUpgrades.taf.status] ??
                  sourceMetadata.contract.targetUpgrades.taf.status}
              </div>
            </div>
          </div>

          <div className="rounded-[20px] border border-white/8 bg-black/20 px-4 py-3">
            <div className="eyebrow">今天判断</div>
            <div className="mt-2 text-sm font-medium text-white">{intradaySignals.headline}</div>
            <div className="mt-2 text-xs leading-5 text-white/52">
              下一观察点：
              {intradaySignals.nextObservationAt
                ? formatDateTime(intradaySignals.nextObservationAt, timezone)
                : "等待下一轮小时刷新"}
            </div>
            <div className="mt-3 text-xs leading-5 text-white/52">
              先确认天气判断，再看下方市场表和仓位建议。
            </div>
          </div>
        </div>
      </div>
    </details>
  );
};

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

const resolveInactiveReason = (market: SnapshotMarket) => {
  if (market.observationFloorBlocked) {
    return OBSERVATION_FLOOR_LABEL;
  }

  return market.inactiveReason ? INACTIVE_REASON_LABELS[market.inactiveReason] ?? "当前不可交易" : "当前不可交易";
};

const sortMarkets = (markets: SnapshotMarket[]) =>
  [...markets].sort((left, right) => {
    const leftStart = left.bucketStartC ?? left.bucketEndC ?? Number.POSITIVE_INFINITY;
    const rightStart = right.bucketStartC ?? right.bucketEndC ?? Number.POSITIVE_INFINITY;
    if (leftStart !== rightStart) {
      return leftStart - rightStart;
    }
    return left.title.localeCompare(right.title);
  });

const filterVisibleMarkets = (markets: SnapshotMarket[]) =>
  markets.filter((market) => !shouldHideKellyFloorMarket(market));

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
  `${market.bucketLabel} · ${formatShortMonthDay(targetDate, timeZone)}`;

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
  const effectiveLastRepricedAt = snapshot.streamHealth.lastRepricedAt ?? snapshot.freshness.repricedAt;
  const lastSignal = snapshot.streamHealth.lastSignalAt
    ? `最后流事件 ${formatDateTime(snapshot.streamHealth.lastSignalAt, timeZone)}`
    : "最近还没有流事件";
  const lastRepriced = effectiveLastRepricedAt
    ? `最后重定价 ${formatDateTime(effectiveLastRepricedAt, timeZone)}`
    : "最近还没有实时重定价";
  return `${lastSignal} / ${lastRepriced}`;
};

const resolveReadableStreamLabel = (snapshot: KellyWorkbenchResponse, streamState: string) => {
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
      return (snapshot.streamHealth.lastRepricedAt ?? snapshot.freshness.repricedAt)
        ? "收到信号，本轮未能重定价，沿用上一轮结果"
        : "收到信号，但重定价失败";
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

const buildEvidenceSections = (
  snapshot: KellyWorkbenchResponse,
  selectedMarketId: string | null,
  timeZone: string | undefined,
  displayUnit: KellyTemperatureUnit,
): KellyEvidenceSection[] => {
  const resolvedTimeZone = snapshot.location.timezone ?? timeZone;
  const formatEvidenceTemp = (value: number | null | undefined, digits = 1) =>
    formatTemp(value, displayUnit, digits);
  const formatEvidenceDelta = (value: number | null | undefined, digits = 1, signed = false) =>
    formatDeltaTemp(value, displayUnit, digits, signed);
  const allMarkets = sortMarkets([...snapshot.markets, ...snapshot.inactiveMarkets]);
  const market = allMarkets.find((item) => item.marketId === selectedMarketId) ?? allMarkets[0] ?? null;
  const evidence = snapshot.marketEvidence.find((item) => item.marketId === market?.marketId) ?? null;
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
  const metarObservation = snapshot.weatherEvidence.metarObservation;
  const tafForecast = snapshot.weatherEvidence.tafForecast;

  return [
    {
      id: "decision",
      title: "当前这档为什么值得看",
      description: "先看当前建议、可买价、我们的估值和优势。",
      items: [
        {
          id: "contract",
          label: "当前档位",
          value: market ? buildShortMarketLabel(market, snapshot.targetDate, resolvedTimeZone) : "--",
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
      description: "核对参考温度、天气时刻和抓取时间，确认天气口径没有漂移。",
      items: [
        {
          id: "reference",
          label: "参考温度",
          value: formatEvidenceTemp(snapshot.weatherEvidence.currentReferenceTemperatureC),
          detail: `来源：${getSourceLabel(snapshot.weatherEvidence.currentReferenceSource)}`,
          tone: "accent",
        },
        {
          id: "metar",
          label: "机场实况",
          value: buildMetarHeadline(metarObservation, displayUnit),
          detail: buildMetarDetail(metarObservation, resolvedTimeZone, { includeStationName: true }),
          sourceLabel: metarObservation ? "查看机场实况原文" : undefined,
          sourceUrl: metarObservation?.sourceUrl ?? undefined,
          tone: metarObservation?.stale ? "warning" : "success",
        },
        {
          id: "taf",
          label: "机场预报",
          value: buildTafHeadline(tafForecast, displayUnit),
          detail: buildTafDetail(tafForecast, resolvedTimeZone, displayUnit),
          sourceLabel: tafForecast ? "查看机场预报原文" : undefined,
          sourceUrl: tafForecast?.sourceUrl ?? tafForecast?.officialSourceUrl ?? undefined,
          tone: tafForecast ? (tafForecast.stale ? "warning" : "success") : "neutral",
        },
        {
          id: "timestamps",
          label: "天气 / 模型时刻",
          value: formatTime(snapshot.weatherEvidence.currentWeatherTimestamp, resolvedTimeZone),
          detail: `分析使用模型时刻 ${formatTime(snapshot.weatherEvidence.targetModelTimestamp, resolvedTimeZone)}`,
        },
        {
          id: "summary",
          label: "中文摘要",
          value: snapshot.weatherEvidence.sourceSummaryZh ?? "暂无摘要",
          detail: `天气快照抓取于 ${formatDateTime(snapshot.weatherEvidence.fetchedAt, resolvedTimeZone)}`,
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
  const resolvedTimeZone = snapshot.location.timezone ?? timeZone;
  const formatTempWithUnit = (value: number | null | undefined, digits = 1) =>
    formatTemp(value, displayUnit, digits);
  const formatDeltaWithUnit = (
    value: number | null | undefined,
    digits = 1,
    signed = false,
  ) => formatDeltaTemp(value, displayUnit, digits, signed);

  const visibleMatchedMarkets = filterVisibleMarkets(snapshot.markets);
  const visibleInactiveMarkets = filterVisibleMarkets(snapshot.inactiveMarkets);
  const visibleMarketIds = new Set(
    [...visibleMatchedMarkets, ...visibleInactiveMarkets]
      .map((market) => market.marketId)
      .filter((marketId): marketId is string => Boolean(marketId)),
  );
  const visibleSnapshot: KellyWorkbenchResponse = {
    ...snapshot,
    markets: visibleMatchedMarkets,
    inactiveMarkets: visibleInactiveMarkets,
    recommendations: snapshot.recommendations.filter(
      (recommendation) => !recommendation.marketId || visibleMarketIds.has(recommendation.marketId),
    ),
    bestObservation:
      snapshot.bestObservation && snapshot.bestObservation.marketId && visibleMarketIds.has(snapshot.bestObservation.marketId)
        ? snapshot.bestObservation
        : null,
  };
  const matchedMarkets = sortMarkets(visibleSnapshot.markets);
  const inactiveMarkets = sortMarkets(visibleSnapshot.inactiveMarkets);
  const selectedMarket =
    matchedMarkets.find((item) => item.marketId === selectedMarketId) ??
    inactiveMarkets.find((item) => item.marketId === selectedMarketId) ??
    matchedMarkets[0] ??
    inactiveMarkets[0] ??
    null;
  const bestHighlighted = visibleSnapshot.recommendations[0] ?? visibleSnapshot.bestObservation ?? null;
  const metarObservation = snapshot.weatherEvidence.metarObservation;
  const tafForecast = snapshot.weatherEvidence.tafForecast;
  const targetDateLabel = formatShortMonthDay(visibleSnapshot.targetDate, resolvedTimeZone);

  const rawOpportunities: KellyOpportunity[] = [
    ...(snapshot.recommendations[0] ? [toOpportunity(snapshot, snapshot.recommendations[0], "primary", "主仓建议")] : []),
    ...(snapshot.recommendations[1] ? [toOpportunity(snapshot, snapshot.recommendations[1], "secondary", "副仓建议")] : []),
    ...(snapshot.bestObservation ? [toOpportunity(snapshot, snapshot.bestObservation, "watch", "观察位")] : []),
  ];
  const opportunities = rawOpportunities.filter(
    (opportunity) => !opportunity.marketId || visibleMarketIds.has(opportunity.marketId),
  );

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
      label: buildShortMarketLabel(market, snapshot.targetDate, resolvedTimeZone),
      shortLabel: market.bucketLabel,
      dateLabel: targetDateLabel,
      contractTypeLabel: getContractTypeLabel(market.contractType) ?? undefined,
      rangeLabel: market.bucketLabel,
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
      updatedAtLabel: formatTime(market.updatedAt, resolvedTimeZone),
      note: `Yes ${resolveEntrySourceLabel(market.entrySourceYes)} / No ${resolveEntrySourceLabel(market.entrySourceNo)}`,
    };
  });

  const inactiveRows = inactiveMarkets.map((market) => ({
    id: market.marketId,
    marketId: market.marketId,
    label: buildShortMarketLabel(market, snapshot.targetDate, resolvedTimeZone),
    shortLabel: market.bucketLabel,
    dateLabel: targetDateLabel,
    contractTypeLabel: getContractTypeLabel(market.contractType) ?? undefined,
    rangeLabel: market.bucketLabel,
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
    updatedAtLabel: formatTime(market.updatedAt, resolvedTimeZone),
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
      id: "metar",
      label: "机场实况",
      value: buildMetarHeadline(metarObservation, displayUnit),
      detail: buildMetarDetail(metarObservation, resolvedTimeZone),
      tone: metarObservation ? (metarObservation.stale ? "warning" : "success") : "neutral",
    },
    {
      id: "taf",
      label: "机场预报",
      value: buildTafHeadline(tafForecast, displayUnit),
      detail: buildTafDetail(tafForecast, resolvedTimeZone, displayUnit),
      tone: tafForecast ? (tafForecast.stale ? "warning" : "success") : "neutral",
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
      value: formatDateTime(snapshot.freshness.weatherGeneratedAt, resolvedTimeZone),
      detail: `参考口径：${getSourceLabel(snapshot.weatherEvidence.currentReferenceSource)}`,
      tone: snapshot.weatherEvidence.stale ? "warning" : "success",
    },
    {
      id: "discovery",
      label: "市场目录时间",
      value: formatDateTime(snapshot.freshness.marketDiscoveredAt, resolvedTimeZone),
      detail: "Polymarket 市场发现快照时间",
      tone: snapshot.freshness.marketDiscoveredAt ? "accent" : "warning",
    },
    {
      id: "orderbook",
      label: "盘口快照时间",
      value: formatDateTime(snapshot.freshness.orderbookFetchedAt, resolvedTimeZone),
      detail:
        selectedMarket
          ? `当前选中档位更新时间 ${formatDateTime(selectedMarket.updatedAt, resolvedTimeZone)}`
          : "当前还没有盘口快照。",
      tone: snapshot.freshness.orderbookFetchedAt ? "success" : "warning",
    },
    {
      id: "stream",
      label: "实时状态",
      value: resolveReadableStreamLabel(snapshot, streamState),
      detail: resolveStreamDetail(snapshot, resolvedTimeZone),
      tone: resolveStreamTone(snapshot, streamState),
    },
  ];

  return {
    title: "Kelly 决策台",
    subtitle: "先看日期和仓位建议，再看主表；完整题干放到右侧证据区。",
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
      resolvedTimeZone,
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
    statusNote: draftDirty ? "参数已修改，点击“刷新分析”后应用。" : resolvePrimaryKellyWarning(snapshot.warnings) ?? snapshot.streamHealth.message ?? null,
    fieldErrors,
    marketUrl: selectedMarket?.marketUrl ?? snapshot.sourceLinks.marketUrls[0] ?? snapshot.sourceLinks.polymarketSearchUrl,
    syncMetrics,
    summaryMetrics,
    opportunities,
    opportunityEmptyState: markets.length === 0 ? resolvePrimaryKellyWarning(snapshot.warnings) ?? "当前没有可交易档位。" : "当前没有过线机会，先保留观察位。",
    markets,
    inactiveMarkets: inactiveRows,
    marketEmptyState: resolvePrimaryKellyWarning(snapshot.warnings) ?? "当前没有可展示的温度档位。",
    unresolvedMarkets: [],
    evidenceSections: buildEvidenceSections(visibleSnapshot, selectedMarketId, resolvedTimeZone, displayUnit),
    methodologyNotes: buildMethodologyNotes(visibleSnapshot, displayUnit),
    methodologyModels: visibleSnapshot.methodology.models.map((model) => ({
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
  sourceMetadata,
  intradaySignals,
  marketReference,
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
  sourceMetadata?: DashboardSourceMetadata | null;
  intradaySignals?: IntradaySignalsSummary | null;
  marketReference?: MarketReferenceSummary | null;
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
  const [stableSnapshot, setStableSnapshot] = useState<KellyWorkbenchResponse | null>(snapshot);
  const effectiveSnapshot = snapshot ?? stableSnapshot;
  const resolvedTimeZone = effectiveSnapshot?.location.timezone ?? timezone;
  const hasSuccessfulSnapshot = stableSnapshot !== null;
  const showingFallbackSnapshot = !snapshot && hasSuccessfulSnapshot;

  useEffect(() => {
    if (!snapshot) {
      return;
    }
    setStableSnapshot(snapshot);
  }, [snapshot]);

  useEffect(() => {
    setSelectedMarketId(null);
    setSelectedOpportunityId(null);
  }, [effectiveSnapshot?.location.id, effectiveSnapshot?.targetDate]);

  useEffect(() => {
    if (!effectiveSnapshot) {
      setSelectedMarketId(null);
      return;
    }

    const allMarkets = [...effectiveSnapshot.markets, ...effectiveSnapshot.inactiveMarkets];
    if (selectedMarketId && allMarkets.some((market) => market.marketId === selectedMarketId)) {
      return;
    }

    setSelectedMarketId(
      effectiveSnapshot.recommendations[0]?.marketId ??
        effectiveSnapshot.bestObservation?.marketId ??
        effectiveSnapshot.markets[0]?.marketId ??
        effectiveSnapshot.inactiveMarkets[0]?.marketId ??
        null,
    );
  }, [effectiveSnapshot, selectedMarketId]);

  const data = useMemo(
    () =>
      effectiveSnapshot
        ? buildData({
            snapshot: effectiveSnapshot,
            locations,
            activeLocationId: effectiveSnapshot.location.id,
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
            timeZone: resolvedTimeZone,
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
      effectiveSnapshot,
      resolvedTimeZone,
      streamState,
    ],
  );
  const renderErrorBanner = error
    ? showingFallbackSnapshot
      ? `Kelly 加载失败，当前保留上一份成功快照。${error}`
      : `Kelly 链路异常：${error}`
    : null;
  const renderData = useMemo(() => {
    if (!data) {
      return null;
    }
    if (!renderErrorBanner) {
      return data;
    }
    return {
      ...data,
      statusNote: data.statusNote ? `${renderErrorBanner} | ${data.statusNote}` : renderErrorBanner,
    };
  }, [data, renderErrorBanner]);

  if (!effectiveSnapshot || !renderData) {
    const surfaceTitle = loading ? "正在准备 Kelly 决策台" : "Kelly 决策台暂不可用";
    const surfaceDetail = loading
      ? "同步盘口、天气参考与仓位参数，随后进入温度档位主表。"
      : (error ?? "当前还没有可展示的 Kelly 快照。");

    return (
      <section className="terminal-panel kelly-shell kelly-shell--loading" aria-busy={loading}>
        <div className="panel-section kelly-shell__inner kelly-loading-surface">
          <header className="kelly-shell__header">
            <div className="kelly-shell__hero">
              <div className="eyebrow flex items-center gap-2">
                <Orbit className={`h-4 w-4 kelly-shell__orbit${loading ? " is-loading" : ""}`} />
                Kelly 决策台
              </div>
              <h2 className="kelly-shell__title">{surfaceTitle}</h2>
              <p className="kelly-loading-copy">{surfaceDetail}</p>
            </div>

            <div className={`kelly-shell__signal${loading ? " is-refreshing" : " is-error"}`}>
              <span className="kelly-shell__signal-dot" />
              {loading ? "终端预热中" : "等待链路恢复"}
            </div>
          </header>

          <div className="kelly-loading-steps" role="list" aria-label="Kelly 预热阶段">
            {KELLY_LOADING_PHASES.map((phase) => (
              <div key={phase.label} className="kelly-loading-step" role="listitem">
                <span className="kelly-loading-step__dot" />
                <div className="kelly-loading-step__copy">
                  <strong>{phase.label}</strong>
                  <span>{phase.detail}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="kelly-loading-layout">
            <div className="kelly-loading-column">
              <article className="kelly-loading-panel">
                <div className="kelly-loading-panel__scan" />
                <div className="kelly-loading-chip-row">
                  <span className="kelly-skeleton kelly-loading-chip" />
                  <span className="kelly-skeleton kelly-loading-chip" />
                  <span className="kelly-skeleton kelly-loading-chip" />
                </div>
                <div className="kelly-loading-control-grid">
                  <span className="kelly-skeleton kelly-loading-control" />
                  <span className="kelly-skeleton kelly-loading-control" />
                  <span className="kelly-skeleton kelly-loading-control" />
                  <span className="kelly-skeleton kelly-loading-control is-wide" />
                </div>
              </article>

              <article className="kelly-loading-panel">
                <div className="kelly-loading-panel__eyebrow">温度档位主表</div>
                <div className="kelly-loading-market-list">
                  {Array.from({ length: 2 }).map((_, index) => (
                    <div key={index} className="kelly-loading-market-card">
                      <div className="kelly-loading-market-card__top">
                        <div className="kelly-loading-market-card__hero">
                          <span className="kelly-skeleton kelly-loading-line is-short" />
                          <span className="kelly-skeleton kelly-loading-line is-wide" />
                          <span className="kelly-skeleton kelly-loading-line is-mid" />
                        </div>
                        <div className="kelly-skeleton kelly-loading-market-card__decision" />
                      </div>

                      <div className="kelly-loading-market-card__book">
                        <span className="kelly-skeleton kelly-loading-book" />
                        <span className="kelly-skeleton kelly-loading-book" />
                      </div>

                      <div className="kelly-loading-market-card__meta">
                        <span className="kelly-skeleton kelly-loading-metric" />
                        <span className="kelly-skeleton kelly-loading-metric" />
                        <span className="kelly-skeleton kelly-loading-metric" />
                        <span className="kelly-skeleton kelly-loading-metric" />
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            </div>

            <aside className="kelly-loading-side">
              <article className="kelly-loading-panel">
                <div className="kelly-loading-panel__eyebrow">右侧核对区</div>
                <div className="kelly-loading-side-grid">
                  <span className="kelly-skeleton kelly-loading-side-card" />
                  <span className="kelly-skeleton kelly-loading-side-card" />
                  <span className="kelly-skeleton kelly-loading-side-card" />
                </div>
                <div className="kelly-loading-note-list">
                  <span className="kelly-skeleton kelly-loading-line is-wide" />
                  <span className="kelly-skeleton kelly-loading-line is-mid" />
                  <span className="kelly-skeleton kelly-loading-line is-wide" />
                  <span className="kelly-skeleton kelly-loading-line is-short" />
                </div>
              </article>
            </aside>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="kelly-workbench-shell">
      <KellySourceContractPanel
        sourceMetadata={sourceMetadata}
        intradaySignals={intradaySignals}
        marketReference={marketReference}
        timezone={resolvedTimeZone}
      />
      <KellyWorkbenchShell
        data={renderData}
        disabled={refreshing}
        refreshing={refreshing || (loading && showingFallbackSnapshot)}
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
    </div>
  );
};
