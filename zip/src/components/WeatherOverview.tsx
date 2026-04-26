import {
  BadgeCheck,
  Clock3,
  CloudRain,
  Cloudy,
  Droplets,
  ExternalLink,
  Navigation,
  Radar,
  Thermometer,
  Wind,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar, ScrollViewport } from "@/components/ui/scroll-area";
import { translatePredictabilityLabel, UI_TEXT } from "../display-text";
import {
  buildMetarDetail,
  buildMetarHeadline,
  buildTafDetail,
  buildTafHeadline,
} from "../lib/aviation-display";
import type {
  DashboardMetarSnapshot,
  DashboardTafSnapshot,
  HourlyWeatherItem,
  IntradaySignalsSummary,
  KellyTemperatureUnit,
  MarketReferenceSummary,
  MetarRecentReport,
  TafCloudLayerDetail,
  TafForecastOverview,
  TafForecastSegment,
  TafPhenomenon,
} from "../types";
import {
  formatDateTime,
  formatMonthDay,
  formatTemperature,
  formatNumber,
  formatTime,
  getWindDirectionDegrees,
  getWindDirectionLabel,
} from "../utils";
import { PredictabilityDots } from "./PredictabilityDots";

type TimelineLayoutPreset = {
  key: "desktop" | "compact" | "mobile";
  itemWidth: number;
  itemGap: number;
  trackPadding: number;
  bandHeight: number;
  trackMinWidth: number;
  scrimMinHeight: number;
  trackMinHeight: number;
  cardHeight: number;
  cardRadius: number;
  inspectorWidth: number;
  markerTop: number;
  currentLineTop: number;
  bandInset: number;
  precipMaxHeight: number;
  currentValueClassName: string;
  inspectorValueClassName: string;
  cardTemperatureClassName: string;
  cardTimeClassName: string;
};

type HeroPanelKey = "intraday" | "kelly";

const TIMELINE_LAYOUT_PRESETS: Record<TimelineLayoutPreset["key"], TimelineLayoutPreset> = {
  desktop: {
    key: "desktop",
    itemWidth: 88,
    itemGap: 8,
    trackPadding: 16,
    bandHeight: 46,
    trackMinWidth: 500,
    scrimMinHeight: 166,
    trackMinHeight: 154,
    cardHeight: 92,
    cardRadius: 20,
    inspectorWidth: 278,
    markerTop: 0,
    currentLineTop: 8,
    bandInset: 10,
    precipMaxHeight: 14,
    currentValueClassName: "text-[clamp(2.2rem,4vw,3.4rem)]",
    inspectorValueClassName: "text-[1.4rem]",
    cardTemperatureClassName: "text-[1rem]",
    cardTimeClassName: "text-[11px]",
  },
  compact: {
    key: "compact",
    itemWidth: 82,
    itemGap: 7,
    trackPadding: 14,
    bandHeight: 44,
    trackMinWidth: 430,
    scrimMinHeight: 154,
    trackMinHeight: 142,
    cardHeight: 88,
    cardRadius: 18,
    inspectorWidth: 254,
    markerTop: 0,
    currentLineTop: 8,
    bandInset: 9,
    precipMaxHeight: 13,
    currentValueClassName: "text-[clamp(2rem,3.8vw,3rem)]",
    inspectorValueClassName: "text-[1.3rem]",
    cardTemperatureClassName: "text-[0.95rem]",
    cardTimeClassName: "text-[10px]",
  },
  mobile: {
    key: "mobile",
    itemWidth: 76,
    itemGap: 6,
    trackPadding: 12,
    bandHeight: 38,
    trackMinWidth: 340,
    scrimMinHeight: 148,
    trackMinHeight: 138,
    cardHeight: 86,
    cardRadius: 17,
    inspectorWidth: 0,
    markerTop: 0,
    currentLineTop: 7,
    bandInset: 8,
    precipMaxHeight: 11,
    currentValueClassName: "text-[clamp(1.9rem,8vw,2.8rem)]",
    inspectorValueClassName: "text-[1.1rem]",
    cardTemperatureClassName: "text-[0.9rem]",
    cardTimeClassName: "text-[10px]",
  },
};

const detectViewportWidth = () => (typeof window !== "undefined" ? window.innerWidth : 1280);

const resolveTimelineLayoutPreset = (viewportWidth: number): TimelineLayoutPreset => {
  if (viewportWidth <= 900) {
    return TIMELINE_LAYOUT_PRESETS.mobile;
  }

  if (viewportWidth <= 1180) {
    return TIMELINE_LAYOUT_PRESETS.compact;
  }

  return TIMELINE_LAYOUT_PRESETS.desktop;
};

const buildPredictabilitySummaryDetail = (
  predictabilityLabel: string,
  availableTemperatureHours: number,
  totalHours: number,
) => `把握度参考为${predictabilityLabel}，当前温度时序覆盖 ${availableTemperatureHours}/${totalHours} 小时。`;

const formatWindRange = (item: HourlyWeatherItem | null) => {
  if (!item) {
    return "--";
  }

  const min = item.windSpeedKphMin;
  const max = item.windSpeedKphMax;

  if (typeof min === "number" && typeof max === "number") {
    return `${formatNumber(min)}-${formatNumber(max)} km/h`;
  }

  if (typeof min === "number") {
    return `${formatNumber(min)} km/h`;
  }

  return "--";
};

const summarizeHour = (item: HourlyWeatherItem | null) => {
  if (!item?.summaryZh) {
    return UI_TEXT.weatherOverview.waitingHourlyData;
  }

  return item.summaryZh.replace(/\s+/g, " ").trim();
};

type AviationDetailPanelKey = "metar" | "taf";
type AviationImpactTone = "positive" | "negative" | "neutral";

type AviationImpactItem = {
  id: string;
  label: string;
  tone: AviationImpactTone;
  summary: string;
  detail: string;
  raw?: string | null;
  metric?: string | null;
};

type TafChangeHighlight = {
  changeLabel: string;
  timeFrom: string | null;
  timeTo: string | null;
  headlineZh: string;
};

const AVIATION_EFFECT_LABELS: Record<AviationImpactTone, string> = {
  positive: "偏利于升温",
  negative: "偏抑制升温",
  neutral: "影响中性",
};

const AVIATION_EFFECT_STYLES: Record<AviationImpactTone, string> = {
  positive: "border-[rgba(138,240,194,0.28)] bg-[rgba(138,240,194,0.12)] text-[var(--success)]",
  negative: "border-[rgba(255,107,107,0.26)] bg-[rgba(255,107,107,0.1)] text-[var(--danger)]",
  neutral: "border-white/12 bg-white/[0.04] text-white/72",
};

const TAF_CLOUD_LABELS: Record<string, string> = {
  CAVOK: "CAVOK 放晴",
  FEW: "少云",
  SCT: "疏云",
  BKN: "云层偏多",
  OVC: "厚云盖顶",
  VV: "低云压顶",
  SKC: "晴空",
  NSC: "无显著云",
  NCD: "无云",
};

const buildWindDirectionLabelZh = (degrees: number | null | undefined) => {
  if (typeof degrees !== "number" || !Number.isFinite(degrees)) {
    return "变向风";
  }

  const normalized = ((degrees % 360) + 360) % 360;
  const labels = ["北风", "东北风", "东风", "东南风", "南风", "西南风", "西风", "西北风"];
  const index = Math.round(normalized / 45) % labels.length;
  return labels[index] ?? "变向风";
};

const formatWindDirectionLabel = (degrees: number | null | undefined) =>
  typeof degrees === "number" && Number.isFinite(degrees)
    ? `${buildWindDirectionLabelZh(degrees)} ${Math.round(degrees)}°`
    : "变向风";

const formatWindSpeedLabel = (speedKts: number | null | undefined, gustKts?: number | null) => {
  if (typeof speedKts !== "number" || !Number.isFinite(speedKts)) {
    return "--";
  }

  const base = `${formatNumber(speedKts, 0)} kt / ${formatNumber(speedKts * 1.852, 0)} km/h`;
  if (typeof gustKts === "number" && Number.isFinite(gustKts)) {
    return `${base} · 阵风 ${formatNumber(gustKts, 0)} kt`;
  }

  return base;
};

const resolveTafLocalDateKey = (value: string, timeZone?: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(parsed);
};

const formatTafWindow = (timeFrom: string | null | undefined, timeTo: string | null | undefined, timeZone?: string) => {
  if (!timeFrom && !timeTo) {
    return "--";
  }

  if (timeFrom && timeTo) {
    const fromDateKey = resolveTafLocalDateKey(timeFrom, timeZone);
    const toDateKey = resolveTafLocalDateKey(timeTo, timeZone);
    if (fromDateKey && toDateKey && fromDateKey !== toDateKey) {
      return `${formatDateTime(timeFrom, timeZone)} - ${formatDateTime(timeTo, timeZone)}`;
    }

    if (Date.parse(timeFrom) === Date.parse(timeTo)) {
      return `自 ${formatTime(timeFrom, timeZone)} 起`;
    }

    return `${formatTime(timeFrom, timeZone)} - ${formatTime(timeTo, timeZone)}`;
  }

  return formatTime(timeFrom ?? timeTo, timeZone);
};

const buildFlightCategoryLabel = (value: TafForecastSegment["flightCategory"]) => {
  if (!value) {
    return "未给出";
  }

  const labels: Record<NonNullable<TafForecastSegment["flightCategory"]>, string> = {
    VFR: "VFR 适航",
    MVFR: "MVFR 边缘",
    IFR: "IFR 仪表飞行",
    LIFR: "LIFR 低仪表",
  };

  return labels[value];
};

const findSyntheticCavokLayer = (segment: TafForecastSegment | null): TafCloudLayerDetail | null =>
  segment?.clouds?.some((cloud) => cloud.toUpperCase() === "CAVOK")
    ? {
        raw: "CAVOK",
        cover: "CAVOK",
        baseFt: null,
        cloudType: null,
      }
    : null;

const findKeyTafCloudLayer = (segment: TafForecastSegment | null): TafCloudLayerDetail | null => {
  const cloudLayers = segment?.cloudLayers ?? [];
  return (
    cloudLayers.find((layer) => ["BKN", "OVC", "VV"].includes(layer.cover)) ??
    cloudLayers.find((layer) => layer.cover === "CAVOK") ??
    findSyntheticCavokLayer(segment) ??
    cloudLayers[0] ??
    null
  );
};

const findTafExtreme = (forecast: TafForecastOverview | null | undefined, kind: "max" | "min") => {
  const extremes = forecast?.dailySummary?.temperatureExtremes?.filter((item) => item.kind === kind) ?? [];
  if (!extremes.length) {
    return null;
  }

  return extremes.reduce((selected, item) => {
    if (kind === "max") {
      return item.temperatureC > selected.temperatureC ? item : selected;
    }

    return item.temperatureC < selected.temperatureC ? item : selected;
  }, extremes[0]);
};

const formatTafExtremeValue = (
  forecast: TafForecastOverview | null | undefined,
  kind: "max" | "min",
  displayUnit: KellyTemperatureUnit,
) => {
  const value = kind === "max" ? forecast?.dailySummary?.maxTemperatureC : forecast?.dailySummary?.minTemperatureC;
  if (typeof value === "number" && Number.isFinite(value)) {
    return formatTemperature(value, displayUnit);
  }

  return kind === "max" ? "未发布 TX" : "未发布 TN";
};

const buildTafExtremeHint = (
  forecast: TafForecastOverview | null | undefined,
  kind: "max" | "min",
  timeZone: string | undefined,
) => {
  if (!forecast) {
    return "等待机场 TAF 预报。";
  }

  const extreme = findTafExtreme(forecast, kind);
  if (extreme) {
    const timeLabel = extreme.occursAt ? ` / ${formatDateTime(extreme.occursAt, timeZone)}` : "";
    return `${extreme.raw}${timeLabel}`;
  }

  return kind === "max"
    ? "这份原始 TAF 没有 TX 最高温组，先用风、云和天气现象判断升温条件。"
    : "这份原始 TAF 没有 TN 最低温组，先看已发布的有效时段和扰动信号。";
};

const buildTafTemperatureNotice = (forecast: TafForecastOverview | null | undefined) => {
  if (!forecast?.rawTaf) {
    return "当前没有可核对的原始 TAF 报文，先等待下一次机场预报刷新。";
  }

  const hasAnyExtreme = Boolean(forecast.dailySummary?.temperatureExtremes?.length);
  if (hasAnyExtreme) {
    return forecast.dailySummary?.temperatureTrend?.detailZh ?? "TAF 已发布温度极值组，具体 TX/TN 已列在上方。";
  }

  return "这份原始 TAF 没有发布 TX/TN 温度极值组；这里不是解析失败，而是报文只给了风、能见度、云层和天气现象。";
};

const buildCloudImpact = (segment: TafForecastSegment | null): AviationImpactItem => {
  const keyLayer = findKeyTafCloudLayer(segment);

  if (!keyLayer) {
    return {
      id: "cloud",
      label: "云层",
      tone: "neutral",
      summary: "暂未拿到有效云层信息",
      detail: "当前这段 TAF 没有清晰给出云层结构，先继续看后续实况和小时云量刷新。",
    };
  }

  const coverLabel = TAF_CLOUD_LABELS[keyLayer.cover] ?? keyLayer.cover;
  const baseLabel = keyLayer.baseFt ? `${formatNumber(keyLayer.baseFt, 0)} ft` : "云底高度未给出";
  const isLowCloud = typeof keyLayer.baseFt === "number" && keyLayer.baseFt <= 2500;

  if (keyLayer.cover === "CAVOK") {
    return {
      id: "cloud",
      label: "云层",
      tone: "positive",
      summary: "CAVOK：能见度好，没有重要低云",
      detail:
        "CAVOK 在 TAF/METAR 里不是“没给云层”，而是一个综合简码：能见度足够好，没有显著天气，也没有会影响飞行的重要低云、积雨云或浓积云。对日照升温通常偏友好。",
      raw: keyLayer.raw,
      metric: "晴空信号",
    };
  }

  if (["BKN", "OVC", "VV"].includes(keyLayer.cover)) {
    return {
      id: "cloud",
      label: "云层",
      tone: "negative",
      summary: isLowCloud ? "中低云偏多，日照容易被压住" : `${coverLabel}，升温容易被压制`,
      detail: `${keyLayer.raw} 的意思是 ${coverLabel}，云底约 ${baseLabel}。像 BKN/OVC 这类云量偏多的云层，会明显削弱白天日照，通常偏不利于升温。`,
      raw: keyLayer.raw,
      metric: baseLabel,
    };
  }

  if (["FEW", "SKC", "NSC", "NCD"].includes(keyLayer.cover)) {
    return {
      id: "cloud",
      label: "云层",
      tone: "positive",
      summary: "云量不多，白天更容易见到日照",
      detail: `${keyLayer.raw} 表示 ${coverLabel}${keyLayer.baseFt ? `，云底约 ${baseLabel}` : ""}。云层偏少时，对地面白天升温的压制通常较小。`,
      raw: keyLayer.raw,
      metric: baseLabel,
    };
  }

  return {
    id: "cloud",
    label: "云层",
    tone: "neutral",
    summary: "云量中等，压温力度先看后续演变",
    detail: `${keyLayer.raw} 表示 ${coverLabel}${keyLayer.baseFt ? `，云底约 ${baseLabel}` : ""}。这类云量不算很薄，也不算彻底压住日照，先按中性处理。`,
    raw: keyLayer.raw,
    metric: baseLabel,
  };
};

const buildWindImpact = (segment: TafForecastSegment | null): AviationImpactItem => {
  const speedKts = segment?.windSpeedKts ?? null;
  const gustKts = segment?.windGustKts ?? null;
  const directionLabel = formatWindDirectionLabel(segment?.windDirectionDegrees ?? null);
  const speedLabel = formatWindSpeedLabel(speedKts, gustKts);

  if (typeof speedKts !== "number" || !Number.isFinite(speedKts)) {
    return {
      id: "wind",
      label: "风",
      tone: "neutral",
      summary: "风况暂未明确",
      detail: "当前 TAF 没有给出可靠的风速风向，先继续等最新实况确认。",
      metric: "--",
    };
  }

  if (speedKts >= 15 || (typeof gustKts === "number" && gustKts >= 22)) {
    return {
      id: "wind",
      label: "风",
      tone: "negative",
      summary: "风偏大，地面热量更容易被搅散",
      detail: `当前 ${directionLabel}，风速约 ${speedLabel}。风力偏大时，近地层热量更容易被扰动，一般偏不利于白天快速升温。`,
      metric: directionLabel,
    };
  }

  if (speedKts <= 6 && (typeof gustKts !== "number" || gustKts <= 12)) {
    return {
      id: "wind",
      label: "风",
      tone: "positive",
      summary: "风不算大，对积温压制相对有限",
      detail: `当前 ${directionLabel}，风速约 ${speedLabel}。风力偏弱时，白天地面热量更容易累积，通常偏利于升温。`,
      metric: directionLabel,
    };
  }

  return {
    id: "wind",
    label: "风",
    tone: "neutral",
    summary: "风力中等，方向要继续结合实况看",
    detail: `当前 ${directionLabel}，风速约 ${speedLabel}。这类风力对升温有一定扰动，但还谈不上强压制，先按中性处理。`,
    metric: directionLabel,
  };
};

const buildWeatherImpact = (forecast: TafForecastOverview | null): AviationImpactItem => {
  const weather = forecast?.activeForecast?.weather?.length
    ? forecast.activeForecast.weather
    : forecast?.dailySummary?.dominantWeather ?? [];

  if (!weather.length) {
    return {
      id: "weather",
      label: "降水 / 天气现象",
      tone: "positive",
      summary: "未预报显著天气，暂不按降水压温",
      detail: "TAF 不是雨量预报，它用天气现象代码表示雨、雷暴、雾、霾等。如果当前生效段没有这些代码，或由 CAVOK 覆盖，就按“暂无显著天气现象”处理，对升温压制相对小。",
      raw: null,
      metric: "无显著天气",
    };
  }

  const labels = weather.map((item) => item.labelZh).join("、");
  const raw = weather.map((item) => item.raw).join(" / ");
  const hasThunderstorm = weather.some((item) => item.category === "thunderstorm");
  const hasPrecipitation = weather.some((item) => item.category === "precipitation");
  const hasVisibilityRestriction = weather.some((item) => item.category === "visibility");

  if (hasThunderstorm || hasPrecipitation) {
    return {
      id: "weather",
      label: "降水 / 天气现象",
      tone: "negative",
      summary: `${labels}，通常会压温`,
      detail: `TAF 不直接给雨量毫米数，但 ${raw} 这些代码说明当前这段存在 ${labels}。降水、对流和更厚的云层通常会一起出现，偏不利于升温。`,
      raw,
      metric: labels,
    };
  }

  if (hasVisibilityRestriction) {
    return {
      id: "weather",
      label: "降水 / 天气现象",
      tone: "neutral",
      summary: `${labels}，先把能见度和低云一起看`,
      detail: `${raw} 表示 ${labels}。这类现象不一定直接降温，但经常和湿空气、低云或弱降水一起出现，对升温通常偏中性到略偏不利。`,
      raw,
      metric: labels,
    };
  }

  return {
    id: "weather",
    label: "降水 / 天气现象",
    tone: "neutral",
    summary: `${labels}，影响要结合后续实况`,
    detail: `TAF 通过 ${raw} 这类代码提示 ${labels}。它更像“有无天气现象”的信号，不直接等价于雨量，需要继续结合实况验证。`,
    raw,
    metric: labels,
  };
};

const buildTafImpactItems = (forecast: TafForecastOverview | null) => [
  buildWindImpact(forecast?.activeForecast ?? null),
  buildCloudImpact(forecast?.activeForecast ?? null),
  buildWeatherImpact(forecast),
];

const getTafFlightCategoryRank = (value: TafForecastSegment["flightCategory"]) => {
  const ranks: Record<NonNullable<TafForecastSegment["flightCategory"]>, number> = {
    VFR: 0,
    MVFR: 1,
    IFR: 2,
    LIFR: 3,
  };
  return value ? ranks[value] : null;
};

const getTafWeatherTone = (segment: TafForecastSegment | null): AviationImpactTone => {
  const weather = segment?.weather ?? [];
  if (!weather.length) {
    return "positive";
  }

  if (weather.some((item) => item.category === "thunderstorm" || item.category === "precipitation")) {
    return "negative";
  }

  return "neutral";
};

const describeTafSegmentWeather = (segment: TafForecastSegment | null) => {
  const weather = segment?.weather ?? [];
  if (!weather.length) {
    return {
      label: "无显著天气",
      raw: null as string | null,
    };
  }

  return {
    label: weather.map((item) => item.labelZh).join("、"),
    raw: weather.map((item) => item.raw).join(" / "),
  };
};

const findMatchingTafSegment = (
  highlight: TafChangeHighlight,
  segments: TafForecastSegment[],
  overview: TafForecastOverview | null,
) => {
  const candidates = [
    overview?.activeForecast ?? null,
    ...segments,
  ].filter((segment): segment is TafForecastSegment => Boolean(segment));

  return (
    candidates.find(
      (segment) =>
        segment.changeLabel === highlight.changeLabel &&
        segment.timeFrom === highlight.timeFrom &&
        segment.timeTo === highlight.timeTo,
    ) ??
    candidates.find((segment) => segment.timeFrom === highlight.timeFrom && segment.timeTo === highlight.timeTo) ??
    candidates.find((segment) => segment.changeLabel === highlight.changeLabel) ??
    null
  );
};

const buildTafChangeImpact = (
  highlight: TafChangeHighlight,
  segment: TafForecastSegment | null,
  previousSegment: TafForecastSegment | null,
  index: number,
): AviationImpactItem => {
  const windImpact = buildWindImpact(segment);
  const cloudImpact = buildCloudImpact(segment);
  const weatherTone = getTafWeatherTone(segment);
  const weather = describeTafSegmentWeather(segment);
  const keyLayer = findKeyTafCloudLayer(segment);
  const flightRank = getTafFlightCategoryRank(segment?.flightCategory ?? null);
  const previousFlightRank = getTafFlightCategoryRank(previousSegment?.flightCategory ?? null);
  const windSpeed = segment?.windSpeedKts ?? null;
  const previousWindSpeed = previousSegment?.windSpeedKts ?? null;
  const gust = segment?.windGustKts ?? null;
  const previousGust = previousSegment?.windGustKts ?? null;
  const cloudRaw = keyLayer?.raw ?? segment?.clouds?.[0] ?? null;
  const hasWeather = Boolean(segment?.weather?.length);
  const hadWeather = Boolean(previousSegment?.weather?.length);
  const weatherClears = Boolean(previousSegment && hadWeather && !hasWeather);
  const weatherArrives = Boolean(previousSegment && !hadWeather && hasWeather);
  const flightWorsens = flightRank !== null && previousFlightRank !== null && flightRank > previousFlightRank;
  const flightImproves = flightRank !== null && previousFlightRank !== null && flightRank < previousFlightRank;
  const windStrengthens =
    (typeof windSpeed === "number" && typeof previousWindSpeed === "number" && windSpeed - previousWindSpeed >= 5) ||
    (typeof gust === "number" && typeof previousGust === "number" && gust - previousGust >= 8);
  const windWeakens =
    (typeof windSpeed === "number" && typeof previousWindSpeed === "number" && previousWindSpeed - windSpeed >= 5) ||
    (typeof gust === "number" && typeof previousGust === "number" && previousGust - gust >= 8);
  const suppressors: string[] = [];
  const supporters: string[] = [];

  if (weatherTone === "negative") {
    suppressors.push(`${weather.label}会压低日照和边界层升温`);
  } else if (weatherArrives) {
    suppressors.push(`${weather.label}开始出现，升温条件转差`);
  } else if (weatherClears) {
    supporters.push("显著天气消退，降水压温信号减弱");
  } else if (!hasWeather) {
    supporters.push("没有显著天气现象，暂不按降水压温");
  }

  if (cloudImpact.tone === "negative") {
    suppressors.push(cloudImpact.summary);
  } else if (cloudImpact.tone === "positive") {
    supporters.push(cloudImpact.summary);
  }

  if (windImpact.tone === "negative" || windStrengthens) {
    suppressors.push(windStrengthens ? "风力较前一段增强，热量更容易被搅散" : windImpact.summary);
  } else if (windImpact.tone === "positive" || windWeakens) {
    supporters.push(windWeakens ? "风力较前一段减弱，地面更容易积温" : windImpact.summary);
  }

  if (flightWorsens || (flightRank !== null && flightRank >= 2)) {
    suppressors.push(`${buildFlightCategoryLabel(segment?.flightCategory ?? null)}，代表能见度或云底条件变差`);
  } else if (flightImproves) {
    supporters.push("飞行类别改善，云底/能见度信号转好");
  }

  const tone: AviationImpactTone =
    suppressors.length > 0 ? "negative" : supporters.length > 0 ? "positive" : "neutral";
  const reason = tone === "negative" ? suppressors[0] : tone === "positive" ? supporters[0] : "这一段没有明显压温或助温信号";
  const summary =
    tone === "negative"
      ? `${highlight.headlineZh}，偏抑制升温`
      : tone === "positive"
        ? `${highlight.headlineZh}，偏利于升温`
        : `${highlight.headlineZh}，先按中性看`;
  const detailParts = [
    reason,
    windImpact.metric ? `风：${windImpact.metric}，${formatWindSpeedLabel(windSpeed, gust)}` : null,
    cloudRaw ? `云：${cloudRaw}` : null,
    weather.raw ? `天气：${weather.raw}（${weather.label}）` : `天气：${weather.label}`,
  ].filter((part): part is string => Boolean(part));

  return {
    id: `${highlight.changeLabel}-${highlight.timeFrom ?? index}`,
    label: index === 0 ? "当前最先看" : "后续变化",
    tone,
    summary,
    detail: `${detailParts.join("；")}。这不是单看一个缩写，而是把风、云、天气现象和能见度一起折算成对当天升温的影响。`,
    raw: highlight.changeLabel === "BASE" ? null : highlight.changeLabel,
    metric: segment ? buildFlightCategoryLabel(segment.flightCategory) : "未匹配到细分段",
  };
};

const buildMetarWindowLabel = (reports: MetarRecentReport[], timeZone?: string) => {
  if (!reports.length) {
    return "最近 4 小时";
  }

  const newest = reports[0];
  const oldest = reports[reports.length - 1];
  if (!newest || !oldest) {
    return "最近 4 小时";
  }

  return `${formatTime(oldest.observedAt, timeZone)} - ${formatTime(newest.observedAt, timeZone)}`;
};

const buildMetarTrendSummary = (reports: MetarRecentReport[], displayUnit: KellyTemperatureUnit) => {
  if (reports.length < 2) {
    return "最近 4 小时内可用报文较少，先以最新一报的温度和露点为主。";
  }

  const latest = reports[0];
  const earliest = reports[reports.length - 1];
  if (!latest || !earliest) {
    return "最近 4 小时内可用报文较少，先以最新一报的温度和露点为主。";
  }

  const trendParts: string[] = [];
  if (typeof latest.temperatureC === "number" && typeof earliest.temperatureC === "number") {
    trendParts.push(`气温从 ${formatTemperature(earliest.temperatureC, displayUnit)} 走到 ${formatTemperature(latest.temperatureC, displayUnit)}`);
  }
  if (typeof latest.dewpointC === "number" && typeof earliest.dewpointC === "number") {
    trendParts.push(`露点从 ${formatTemperature(earliest.dewpointC, displayUnit)} 走到 ${formatTemperature(latest.dewpointC, displayUnit)}`);
  }

  return trendParts.length > 0
    ? `${trendParts.join("；")}。`
    : "最近 4 小时报文已列出，可以重点对比温度、露点和风况有没有连续变化。";
};

const EffectToneBadge = ({ tone }: { tone: AviationImpactTone }) => (
  <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] ${AVIATION_EFFECT_STYLES[tone]}`}>
    {AVIATION_EFFECT_LABELS[tone]}
  </span>
);

const AviationMetric = ({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string | null;
}) => (
  <div className="rounded-[20px] border border-white/8 bg-[rgba(12,18,29,0.98)] px-4 py-4">
    <div className="eyebrow text-white/42">{label}</div>
    <div className="data-mono mt-2 text-[1.45rem] font-semibold text-white">{value}</div>
    {hint ? <div className="mt-2 text-xs leading-5 text-white/52">{hint}</div> : null}
  </div>
);

const AviationImpactCard = ({
  item,
  compact = false,
}: {
  item: AviationImpactItem;
  compact?: boolean;
}) => (
  <div
    className={`rounded-[22px] border border-white/8 bg-[rgba(12,18,29,0.98)] ${
      compact ? "px-3.5 py-3.5" : "px-4 py-4"
    }`}
  >
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="eyebrow flex items-center gap-2 text-white/44">{item.label}</div>
      <EffectToneBadge tone={item.tone} />
    </div>

    <div className={`${compact ? "mt-3 text-base" : "mt-3 text-lg"} font-semibold leading-7 text-white`}>{item.summary}</div>

    <div className="mt-2 flex flex-wrap items-center gap-2">
      {item.metric ? (
        <span className="inline-flex rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] text-white/68">
          {item.metric}
        </span>
      ) : null}
      {item.raw ? (
        <span className="data-mono inline-flex rounded-full border border-[rgba(114,229,255,0.22)] bg-[rgba(114,229,255,0.08)] px-2.5 py-1 text-[11px] text-[var(--accent-secondary)]">
          {item.raw}
        </span>
      ) : null}
    </div>

    <div className="mt-3 text-sm leading-6 text-white/62">{item.detail}</div>
  </div>
);

const AviationModalSection = ({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) => (
  <section className="rounded-[24px] border border-white/8 bg-[rgba(13,19,30,0.98)] px-4 py-4">
    <div className="eyebrow text-white/40">{eyebrow}</div>
    <div className="mt-2 text-lg font-semibold text-white">{title}</div>
    <div className="mt-4">{children}</div>
  </section>
);

const getTemperatureTone = (ratio: number) => {
  if (ratio <= 0.18) {
    return {
      solid: "rgba(114,229,255,0.26)",
      surface: "rgba(114,229,255,0.14)",
      line: "#72E5FF",
    };
  }

  if (ratio <= 0.42) {
    return {
      solid: "rgba(56,214,180,0.28)",
      surface: "rgba(56,214,180,0.14)",
      line: "#38D6B4",
    };
  }

  if (ratio <= 0.68) {
    return {
      solid: "rgba(138,240,194,0.26)",
      surface: "rgba(138,240,194,0.14)",
      line: "#8AF0C2",
    };
  }

  return {
    solid: "rgba(242,183,109,0.28)",
    surface: "rgba(242,183,109,0.14)",
    line: "#F2B76D",
  };
};

const WindGlyph = ({
  direction,
  size = 15,
}: {
  direction: string | null | undefined;
  size?: number;
}) => {
  const degrees = getWindDirectionDegrees(direction);
  const label = getWindDirectionLabel(direction);

  if (degrees === null) {
    return <span className="text-xs text-white/40">--</span>;
  }

  return (
    <span
      title={label}
      aria-label={label}
      className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-black/20 text-white/80"
    >
      <Navigation className="text-[var(--accent-secondary)]" size={size} style={{ transform: `rotate(${degrees}deg)` }} />
    </span>
  );
};

const InspectorStat = ({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: ReactNode;
}) => (
  <div className="rounded-[18px] border border-white/8 bg-black/20 px-3 py-3">
    <div className="eyebrow flex items-center gap-2">
      {icon}
      {label}
    </div>
    <div className="data-mono mt-2 text-lg font-semibold text-white">{value}</div>
  </div>
);

const ConfidenceCard = ({
  title,
  score,
  label,
  detail,
}: {
  title: string;
  score: number | null;
  label: string;
  detail?: string | null;
}) => (
  <div className="min-w-[220px] rounded-[20px] border border-white/8 bg-black/20 px-4 py-3">
    <div className="eyebrow">{title}</div>
    <div className="mt-3">
      <PredictabilityDots score={score} label={label} />
    </div>
    {detail ? <div className="mt-3 text-xs leading-6 text-white/52">{detail}</div> : null}
  </div>
);

const buildPredictabilityDetail = (
  predictabilityLabel: string | undefined,
  availableTemperatureHours: number,
  totalHours: number,
) =>
  `把握度参考为 ${(predictabilityLabel ?? "--").trim()}，温度时序覆盖 ${availableTemperatureHours}/${totalHours} 小时。`;

const CONFIDENCE_LABEL: Record<IntradaySignalsSummary["confidence"], string> = {
  high: "高",
  medium: "中",
  low: "低",
};

const StatusPill = ({
  label,
  tone,
}: {
  label: string;
  tone: "good" | "warn" | "muted";
}) => (
  <span
    className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] ${
      tone === "good"
        ? "border-[rgba(138,240,194,0.24)] bg-[rgba(138,240,194,0.1)] text-[var(--success)]"
        : tone === "warn"
          ? "border-[rgba(242,183,109,0.24)] bg-[rgba(242,183,109,0.1)] text-[var(--warning)]"
          : "border-white/10 bg-white/[0.03] text-white/54"
    }`}
  >
    {label}
  </span>
);

const SignalPathCard = ({
  title,
  body,
}: {
  title: string;
  body: string;
}) => (
  <div className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-3">
    <div className="eyebrow">{title}</div>
    <div className="mt-2 text-sm leading-6 text-white/74">{body}</div>
  </div>
);

export const WeatherOverview = ({
  pageUrl,
  reportText,
  items,
  metar,
  taf,
  displayUnit,
  locationTimezone,
  selectedTimestamp,
  onSelectTimestamp,
  currentItem,
  selectedItem,
  intradaySignals,
  marketReference,
  predictabilityScore: predictabilityScoreInput,
  predictabilityLabel: predictabilityLabelInput,
}: {
  pageUrl: string;
  reportText: string;
  items: HourlyWeatherItem[];
  metar: DashboardMetarSnapshot;
  taf: DashboardTafSnapshot;
  displayUnit: KellyTemperatureUnit;
  locationTimezone?: string;
  selectedTimestamp: string | null;
  onSelectTimestamp: (timestamp: string) => void;
  currentItem: HourlyWeatherItem | null;
  selectedItem: HourlyWeatherItem | null;
  intradaySignals: IntradaySignalsSummary;
  marketReference: MarketReferenceSummary;
  predictabilityScore?: number | null;
  predictabilityLabel?: string;
}) => {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const momentumFrameRef = useRef<number | null>(null);
  const initialTimelineSignatureRef = useRef<string | null>(null);
  const dragStateRef = useRef({
    active: false,
    pointerId: -1,
    startX: 0,
    scrollLeft: 0,
    lastX: 0,
    lastTime: 0,
    velocity: 0,
    moved: false,
  });

  const [timelineLayout, setTimelineLayout] = useState<TimelineLayoutPreset>(() =>
    resolveTimelineLayoutPreset(detectViewportWidth()),
  );
  const [hoveredTimestamp, setHoveredTimestamp] = useState<string | null>(null);
  const [stablePredictabilityScore, setStablePredictabilityScore] = useState<number | null>(
    predictabilityScoreInput ?? null,
  );
  const [stablePredictabilityLabel, setStablePredictabilityLabel] = useState<string | null>(
    typeof predictabilityLabelInput === "string" &&
      predictabilityLabelInput.trim() &&
      predictabilityLabelInput.trim() !== "--"
      ? predictabilityLabelInput.trim()
      : null,
  );
  const [stablePredictabilityState, setStablePredictabilityState] = useState<{
    score: number | null;
    label: string | null;
  }>(() => ({
    score:
      typeof predictabilityScoreInput === "number" && Number.isFinite(predictabilityScoreInput)
        ? predictabilityScoreInput
        : null,
    label:
      typeof predictabilityLabelInput === "string" &&
      predictabilityLabelInput.trim() &&
      predictabilityLabelInput.trim() !== "--"
      ? predictabilityLabelInput.trim()
      : null,
  }));
  const [activeHeroPanel, setActiveHeroPanel] = useState<HeroPanelKey>("intraday");
  const [openAviationPanel, setOpenAviationPanel] = useState<AviationDetailPanelKey | null>(null);

  useEffect(() => {
    const handleResize = () => {
      setTimelineLayout(resolveTimelineLayoutPreset(window.innerWidth));
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (!openAviationPanel) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenAviationPanel(null);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [openAviationPanel]);

  useEffect(() => {
    if (typeof predictabilityScoreInput === "number" && Number.isFinite(predictabilityScoreInput)) {
      setStablePredictabilityScore(predictabilityScoreInput);
    }
  }, [predictabilityScoreInput]);

  useEffect(() => {
    if (typeof predictabilityLabelInput !== "string") {
      return;
    }
    const nextLabel = predictabilityLabelInput.trim();
    if (!nextLabel || nextLabel === "--") {
      return;
    }
    setStablePredictabilityLabel(nextLabel);
  }, [predictabilityLabelInput]);

  useEffect(() => {
    const nextScore =
      typeof predictabilityScoreInput === "number" && Number.isFinite(predictabilityScoreInput)
        ? predictabilityScoreInput
        : null;
    const nextLabel =
      typeof predictabilityLabelInput === "string" &&
      predictabilityLabelInput.trim() &&
      predictabilityLabelInput.trim() !== "--"
        ? predictabilityLabelInput.trim()
        : null;

    if (nextScore === null && nextLabel === null) {
      return;
    }

    setStablePredictabilityState((current) => ({
      score: nextScore ?? current.score,
      label: nextLabel ?? current.label,
    }));
  }, [predictabilityLabelInput, predictabilityScoreInput]);

  const currentIndex = useMemo(
    () => items.findIndex((item) => item.timestamp === currentItem?.timestamp),
    [currentItem?.timestamp, items],
  );

  const selectedIndex = useMemo(
    () => items.findIndex((item) => item.timestamp === selectedTimestamp),
    [items, selectedTimestamp],
  );

  const peakIndex = useMemo(() => {
    let candidate = -1;
    let hottest = Number.NEGATIVE_INFINITY;

    items.forEach((item, index) => {
      if (typeof item.temperatureC !== "number") {
        return;
      }

      if (item.temperatureC > hottest) {
        hottest = item.temperatureC;
        candidate = index;
      }
    });

    return candidate;
  }, [items]);

  const selectedOrHoveredItem =
    items.find((item) => item.timestamp === hoveredTimestamp) ?? selectedItem ?? currentItem ?? items[0] ?? null;
  const isMobileTimeline = timelineLayout.key === "mobile";
  const isStackedTimeline = timelineLayout.key !== "desktop";
  const timelineStep = timelineLayout.itemWidth + timelineLayout.itemGap;

  const temperatures = items
    .map((item) => item.temperatureC)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const minTemperature = temperatures.length ? Math.min(...temperatures) : 0;
  const maxTemperature = temperatures.length ? Math.max(...temperatures) : 0;
  const temperatureRange = Math.max(maxTemperature - minTemperature, 1);
  const trackWidth = Math.max(
    timelineLayout.trackPadding * 2 + items.length * timelineLayout.itemWidth + Math.max(0, items.length - 1) * timelineLayout.itemGap,
    timelineLayout.trackMinWidth,
  );

  const summaryText = reportText.trim() || UI_TEXT.weatherOverview.summarySyncing;
  const inspectorSummary = summarizeHour(selectedOrHoveredItem);
  const timelineContentSignature =
    items.length > 0 ? `${items[0]?.timestamp ?? ""}|${items[items.length - 1]?.timestamp ?? ""}|${items.length}` : "empty";
  const timelineDayLabel = items[0] ? formatMonthDay(items[0].timestamp, locationTimezone) : "--";
  const timelineDescription =
    timelineDayLabel !== "--"
      ? `${timelineDayLabel} 当地时间的小时轨道，只展示当天，不拼接下一天。`
      : UI_TEXT.weatherOverview.timelineDescription;
  const timelineCoverageLabel =
    timelineDayLabel !== "--" ? `${timelineDayLabel} 当天已解析 ${items.length} 小时` : "等待当天小时数据";
  const defaultSelectionFollowsCurrent = !selectedTimestamp || selectedTimestamp === currentItem?.timestamp;
  const availableTemperatureHours = items.filter((item) => typeof item.temperatureC === "number").length;
  const totalHours = Math.max(items.length, 1);
  const resolvedPredictabilityScore =
    typeof predictabilityScoreInput === "number" && Number.isFinite(predictabilityScoreInput)
      ? predictabilityScoreInput
      : stablePredictabilityState.score ?? stablePredictabilityScore;
  const rawPredictabilityLabel =
    typeof predictabilityLabelInput === "string" &&
      predictabilityLabelInput.trim() &&
      predictabilityLabelInput.trim() !== "--"
      ? predictabilityLabelInput.trim()
      : stablePredictabilityState.label ?? stablePredictabilityLabel;
  const resolvedPredictabilityLabel = translatePredictabilityLabel(rawPredictabilityLabel ?? "--");
  const predictabilityDetail = buildPredictabilitySummaryDetail(
    resolvedPredictabilityLabel,
    availableTemperatureHours,
    totalHours,
  );
  const predictabilityLabel = resolvedPredictabilityLabel;
  const currentKellyRoute = marketReference.targetDate
    ? `${marketReference.kellyRoute}?targetDate=${encodeURIComponent(marketReference.targetDate)}`
    : marketReference.kellyRoute;
  const metarObservation = metar.observation;
  const tafForecast = taf.forecast;
  const metarPrimary = metarObservation ? buildMetarHeadline(metarObservation, displayUnit) : "暂未拿到最新实况";
  const metarSecondary = buildMetarDetail(metarObservation, locationTimezone);
  const tafPrimary = buildTafHeadline(tafForecast, displayUnit);
  const tafSecondary = buildTafDetail(tafForecast, locationTimezone, displayUnit);
  const metarReports = metar.recentReports ?? metar.recentObservations ?? [];
  const metarWindowLabel = buildMetarWindowLabel(metarReports, locationTimezone);
  const metarTrendSummary = buildMetarTrendSummary(metarReports, displayUnit);
  const tafImpactItems = buildTafImpactItems(tafForecast);
  const tafActiveForecast = tafForecast?.activeForecast ?? taf.forecasts[0] ?? null;
  const tafDailySummary = tafForecast?.dailySummary ?? null;
  const tafMaxExtreme = findTafExtreme(tafForecast, "max");
  const tafMinExtreme = findTafExtreme(tafForecast, "min");
  const tafHasTemperatureExtremes = Boolean(tafMaxExtreme || tafMinExtreme);
  const tafChangeHighlights = tafDailySummary?.changeHighlights?.length
    ? tafDailySummary.changeHighlights
    : taf.forecasts.slice(0, 4).map((segment) => ({
        changeLabel: segment.changeLabel,
        timeFrom: segment.timeFrom,
        timeTo: segment.timeTo,
        headlineZh: segment.headlineZh ?? "继续观察风云变化",
      }));
  const tafChangeImpacts = tafChangeHighlights.map((item, index) => {
    const segment = findMatchingTafSegment(item, taf.forecasts, tafForecast);
    const previousHighlight = index > 0 ? tafChangeHighlights[index - 1] : null;
    const previousSegment = previousHighlight ? findMatchingTafSegment(previousHighlight, taf.forecasts, tafForecast) : null;
    return {
      highlight: item,
      impact: buildTafChangeImpact(item, segment, previousSegment, index),
    };
  });
  const tafCloudLayers = tafActiveForecast?.cloudLayers ?? [];
  const tafWeatherItems = tafActiveForecast?.weather?.length
    ? tafActiveForecast.weather
    : tafDailySummary?.dominantWeather ?? [];
  const heroPanels = {
    intraday: {
      label: "今天怎么看",
      hint: intradaySignals.headline,
    },
    kelly: {
      label: "Kelly 机会",
      hint: marketReference.summary,
    },
  } satisfies Record<HeroPanelKey, { label: string; hint: string }>;

  const trackGradient = useMemo(() => {
    if (!items.length) {
      return "linear-gradient(90deg, rgba(114,229,255,0.12), rgba(242,183,109,0.12))";
    }

    const steps = items.flatMap((item, index) => {
      const ratio =
        typeof item.temperatureC === "number" ? (item.temperatureC - minTemperature) / temperatureRange : 0.5;
      const tone = getTemperatureTone(ratio);
      const start = (index / items.length) * 100;
      const end = ((index + 1) / items.length) * 100;
      return [`${tone.solid} ${start}%`, `${tone.solid} ${end}%`];
    });

    return `linear-gradient(90deg, ${steps.join(", ")})`;
  }, [items, minTemperature, temperatureRange]);

  const stopMomentum = () => {
    if (momentumFrameRef.current !== null) {
      window.cancelAnimationFrame(momentumFrameRef.current);
      momentumFrameRef.current = null;
    }
  };

  const scrollToIndex = (index: number, behavior: ScrollBehavior = "smooth") => {
    const node = trackRef.current;
    if (!node || index < 0 || index >= items.length) {
      return;
    }

    const left =
      timelineLayout.trackPadding + index * timelineStep - node.clientWidth / 2 + timelineLayout.itemWidth / 2;
    node.scrollTo({ left: Math.max(0, left), behavior });
  };

  const snapToNearest = () => {
    const node = trackRef.current;
    if (!node) {
      return;
    }

    const nearestIndex = Math.max(
      0,
      Math.min(
        items.length - 1,
        Math.round(
          (node.scrollLeft + node.clientWidth / 2 - timelineLayout.trackPadding - timelineLayout.itemWidth / 2) /
            timelineStep,
        ),
      ),
    );
    const target = items[nearestIndex];
    if (target) {
      onSelectTimestamp(target.timestamp);
      scrollToIndex(nearestIndex, "smooth");
    }
  };

  const runMomentum = (velocity: number) => {
    if (!trackRef.current) {
      return;
    }

    let currentVelocity = velocity * -20;

    const tick = () => {
      if (!trackRef.current) {
        return;
      }

      trackRef.current.scrollLeft += currentVelocity;
      currentVelocity *= 0.92;

      if (Math.abs(currentVelocity) < 0.6) {
        stopMomentum();
        snapToNearest();
        return;
      }

      momentumFrameRef.current = window.requestAnimationFrame(tick);
    };

    stopMomentum();
    momentumFrameRef.current = window.requestAnimationFrame(tick);
  };

  useEffect(() => {
    const node = trackRef.current;
    if (!node) {
      return stopMomentum;
    }

    const signature = `${timelineContentSignature}:${timelineLayout.key}`;
    const isFreshTrack = initialTimelineSignatureRef.current !== signature;
    initialTimelineSignatureRef.current = signature;

    if (isFreshTrack && items.length > 8 && defaultSelectionFollowsCurrent) {
      node.scrollTo({ left: 0, behavior: "auto" });
      return stopMomentum;
    }

    if (selectedIndex >= 0) {
      scrollToIndex(selectedIndex, isFreshTrack ? "auto" : "smooth");
    }

    return stopMomentum;
  }, [defaultSelectionFollowsCurrent, items.length, selectedIndex, timelineContentSignature, timelineLayout.key]);

  const selectedHourInspector = (
    <div className="rounded-[24px] border border-white/8 bg-black/20 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="eyebrow">{UI_TEXT.weatherOverview.selectedHour}</div>
          <div className={`mt-2 font-semibold text-white ${timelineLayout.inspectorValueClassName}`}>
            {selectedOrHoveredItem
              ? `${formatTime(selectedOrHoveredItem.timestamp, locationTimezone)} · ${formatTemperature(selectedOrHoveredItem.temperatureC, displayUnit)}`
              : "--"}
          </div>
        </div>

        <WindGlyph direction={selectedOrHoveredItem?.windDirection} />
      </div>

      <div className="mt-3 text-sm leading-6 text-white/60">{inspectorSummary}</div>

      <div
        className={`mt-4 grid gap-3 ${
          isMobileTimeline
            ? "grid-cols-1 sm:grid-cols-3"
            : isStackedTimeline
              ? "grid-cols-1 sm:grid-cols-3"
              : "grid-cols-1"
        }`}
      >
        <InspectorStat
          label={UI_TEXT.weatherOverview.precipitationProbability}
          value={
            selectedOrHoveredItem?.precipitationProbabilityPct !== null
              ? `${formatNumber(selectedOrHoveredItem.precipitationProbabilityPct, 0)}%`
              : "--"
          }
          icon={<CloudRain className="h-3.5 w-3.5 text-[var(--accent-secondary)]" />}
        />
        <InspectorStat
          label={UI_TEXT.weatherOverview.apparentTemperature}
          value={formatTemperature(selectedOrHoveredItem?.feelsLikeC, displayUnit)}
          icon={<Thermometer className="h-3.5 w-3.5 text-[var(--warning)]" />}
        />
        <InspectorStat
          label={UI_TEXT.weatherOverview.wind}
          value={formatWindRange(selectedOrHoveredItem)}
          icon={<Wind className="h-3.5 w-3.5 text-[var(--accent)]" />}
        />
      </div>
    </div>
  );

  const aviationModalTitle = openAviationPanel === "metar" ? "温度 / 露点实况" : "TAF 对温度的影响";
  const aviationModalDescription =
    openAviationPanel === "metar"
      ? "把最新一报的温度、露点放大显示，同时保留最近 4 小时的 METAR 原始报文，方便你直接回看。"
      : "先把真正影响当天升温的量摆到最前面，再把风、云、天气现象和原始 TAF 一起展开。";
  const aviationModalSourceUrl =
    openAviationPanel === "metar"
      ? metarObservation?.sourceUrl ?? null
      : tafForecast?.sourceUrl ?? tafForecast?.officialSourceUrl ?? null;
  const aviationModalSourceLabel = openAviationPanel === "metar" ? "打开 METAR 原文" : "打开 TAF 原文";

  const metarModalContent = (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
      <AviationModalSection eyebrow="最新一报" title={metarPrimary}>
        <div className="grid gap-3 sm:grid-cols-2">
          <AviationMetric
            label="当前气温"
            value={formatTemperature(metarObservation?.temperatureC ?? metarReports[0]?.temperatureC ?? null, displayUnit)}
            hint={`观测时间 ${formatDateTime(metarObservation?.observedAt ?? metarReports[0]?.observedAt, locationTimezone)}`}
          />
          <AviationMetric
            label="当前露点"
            value={formatTemperature(metarObservation?.dewpointC ?? metarReports[0]?.dewpointC ?? null, displayUnit)}
            hint="露点越靠近气温，空气越湿；和升温判断一起看更稳。"
          />
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <AviationMetric
            label="风向"
            value={formatWindDirectionLabel(metarObservation?.windDirectionDegrees ?? metarReports[0]?.windDirectionDegrees ?? null)}
          />
          <AviationMetric
            label="风速"
            value={formatWindSpeedLabel(metarObservation?.windSpeedKts ?? metarReports[0]?.windSpeedKts ?? null)}
          />
          <AviationMetric
            label="最近窗口"
            value={metarWindowLabel}
            hint={metarObservation?.stationName ?? metarObservation?.stationId ?? metarReports[0]?.stationId ?? "机场站点"}
          />
        </div>

        <div className="mt-4 rounded-[20px] border border-white/8 bg-[rgba(10,15,23,0.98)] px-4 py-4 text-sm leading-6 text-white/66">
          {metarTrendSummary}
        </div>
      </AviationModalSection>

      <AviationModalSection eyebrow="最近 4 小时" title="METAR 原始报文">
        {metarReports.length > 0 ? (
          <div className="space-y-3">
            {metarReports.map((report, index) => (
              <div key={`${report.observedAt}-${index}`} className="rounded-[20px] border border-white/8 bg-[rgba(10,15,23,0.98)] px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-white">{index === 0 ? "最新一报" : `回看第 ${index + 1} 报`}</div>
                    <div className="mt-1 text-xs text-white/52">{formatDateTime(report.observedAt, locationTimezone)}</div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <span className="data-mono rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-white/74">
                      气温 {formatTemperature(report.temperatureC, displayUnit)}
                    </span>
                    <span className="data-mono rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-white/74">
                      露点 {formatTemperature(report.dewpointC, displayUnit)}
                    </span>
                  </div>
                </div>

                <div className="mt-3 text-xs leading-5 text-white/56">
                  风向 {formatWindDirectionLabel(report.windDirectionDegrees)} · 风速 {formatWindSpeedLabel(report.windSpeedKts)}
                </div>

                <div className="data-mono mt-3 overflow-x-auto rounded-[16px] border border-white/8 bg-[rgba(7,12,18,0.92)] px-3 py-3 text-[12px] leading-6 text-[#dff7ff]">
                  {report.rawReport ?? "当前这条没有保留下原始报文。"}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-[20px] border border-white/8 bg-[rgba(10,15,23,0.98)] px-4 py-4 text-sm leading-6 text-white/60">
            当前没有可展开的近 4 小时报文，先以最新一报为主。
          </div>
        )}
      </AviationModalSection>
    </div>
  );

  const tafModalContent = (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
      <div className="space-y-4">
        <AviationModalSection eyebrow="TAF 关键信号" title={tafPrimary}>
          {tafHasTemperatureExtremes ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {tafMaxExtreme ? (
                <AviationMetric
                  label="TAF 最高"
                  value={formatTafExtremeValue(tafForecast, "max", displayUnit)}
                  hint={buildTafExtremeHint(tafForecast, "max", locationTimezone)}
                />
              ) : null}
              {tafMinExtreme ? (
                <AviationMetric
                  label="TAF 最低"
                  value={formatTafExtremeValue(tafForecast, "min", displayUnit)}
                  hint={buildTafExtremeHint(tafForecast, "min", locationTimezone)}
                />
              ) : null}
            </div>
          ) : (
            <div className="rounded-[18px] border border-[rgba(242,183,109,0.18)] bg-[rgba(242,183,109,0.08)] px-4 py-3 text-sm leading-6 text-white/66">
              {buildTafTemperatureNotice(tafForecast)}
            </div>
          )}

          {tafHasTemperatureExtremes && tafDailySummary?.temperatureExtremes?.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {tafDailySummary.temperatureExtremes.map((item) => (
                <span
                  key={item.raw}
                  className="data-mono rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-white/72"
                >
                  {item.raw} · {item.kind === "max" ? "最高" : "最低"} {formatTemperature(item.temperatureC, displayUnit)}
                  {item.occursAt ? ` / ${formatDateTime(item.occursAt, locationTimezone)}` : ""}
                </span>
              ))}
            </div>
          ) : null}

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {tafImpactItems.map((item) => (
              <div key={item.id}>
                <AviationImpactCard item={item} compact />
              </div>
            ))}
          </div>

          {tafHasTemperatureExtremes ? (
            <div className="mt-4 rounded-[20px] border border-white/8 bg-[rgba(10,15,23,0.98)] px-4 py-4 text-sm leading-6 text-white/66">
              {buildTafTemperatureNotice(tafForecast)}
            </div>
          ) : null}
        </AviationModalSection>

        <AviationModalSection eyebrow="变化节点" title="这份 TAF 后面怎么变">
          <div className="space-y-3">
            {tafChangeImpacts.length > 0 ? (
              tafChangeImpacts.map(({ highlight, impact }, index) => (
                <div key={impact.id} className="rounded-[20px] border border-white/8 bg-[rgba(10,15,23,0.98)] px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-white">
                        {highlight.changeLabel === "BASE" ? "起始段" : highlight.changeLabel}
                      </div>
                      <div className="mt-1 text-xs text-white/52">{formatTafWindow(highlight.timeFrom, highlight.timeTo, locationTimezone)}</div>
                    </div>
                    <EffectToneBadge tone={impact.tone} />
                  </div>

                  <div className="mt-3 text-base font-semibold leading-7 text-white">{impact.summary}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-white/68">
                      {index === 0 ? "当前最先看" : "后续变化"}
                    </span>
                    {impact.metric ? (
                      <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] text-white/68">
                        {impact.metric}
                      </span>
                    ) : null}
                    {impact.raw ? (
                      <span className="data-mono rounded-full border border-[rgba(114,229,255,0.22)] bg-[rgba(114,229,255,0.08)] px-2.5 py-1 text-[11px] text-[var(--accent-secondary)]">
                        {impact.raw}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-3 text-sm leading-6 text-white/64">{impact.detail}</div>
                </div>
              ))
            ) : (
              <div className="rounded-[20px] border border-white/8 bg-[rgba(10,15,23,0.98)] px-4 py-4 text-sm leading-6 text-white/60">
                当前这份 TAF 暂未拆出更多变化节点。
              </div>
            )}
          </div>
        </AviationModalSection>
      </div>

      <div className="space-y-4">
        <AviationModalSection eyebrow="当前生效段" title={tafSecondary}>
          <div className="grid gap-3">
            <AviationMetric
              label="时段"
              value={formatTafWindow(tafActiveForecast?.timeFrom, tafActiveForecast?.timeTo, locationTimezone)}
            />
            <AviationMetric
              label="风向 / 风速"
              value={`${formatWindDirectionLabel(tafActiveForecast?.windDirectionDegrees ?? null)} · ${formatWindSpeedLabel(
                tafActiveForecast?.windSpeedKts ?? null,
                tafActiveForecast?.windGustKts ?? null,
              )}`}
            />
            <AviationMetric
              label="能见度 / 飞行类别"
              value={`${tafActiveForecast?.visibilityKm !== null && tafActiveForecast?.visibilityKm !== undefined ? `${formatNumber(tafActiveForecast.visibilityKm, 0)} km` : "--"} · ${buildFlightCategoryLabel(tafActiveForecast?.flightCategory ?? null)}`}
            />
          </div>
        </AviationModalSection>

        <AviationModalSection eyebrow="云层 / 天空术语" title="保留原始代码，但先给你解释">
          {tafCloudLayers.length > 0 ? (
            <div className="space-y-3">
              {tafCloudLayers.map((layer, index) => (
                <div key={`${layer.raw}-${index}`} className="rounded-[20px] border border-white/8 bg-[rgba(10,15,23,0.98)] px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="text-sm font-medium text-white">{TAF_CLOUD_LABELS[layer.cover] ?? layer.cover}</div>
                    <span className="data-mono rounded-full border border-[rgba(114,229,255,0.22)] bg-[rgba(114,229,255,0.08)] px-2.5 py-1 text-[11px] text-[var(--accent-secondary)]">
                      {layer.raw}
                    </span>
                  </div>

                  <div className="mt-3 text-sm leading-6 text-white/66">
                    {layer.cover === "CAVOK"
                      ? "CAVOK 表示能见度好、无显著天气、无重要低云/积雨云/浓积云；它不是缺失云层，而是晴空条件的综合简码。"
                      : `${layer.raw} 表示 ${TAF_CLOUD_LABELS[layer.cover] ?? layer.cover}${
                          layer.baseFt ? `，云底大约在 ${formatNumber(layer.baseFt, 0)} ft` : "，但这条没有明确给出云底高度"
                        }。${
                          ["BKN", "OVC", "VV"].includes(layer.cover)
                            ? "这类云量偏多的云层通常会削弱白天日照，偏不利于升温。"
                            : ["FEW", "SKC", "NSC", "NCD"].includes(layer.cover)
                              ? "这类云量偏少时，对升温压制相对有限。"
                              : "这类云量介于中间，后续还是要继续看实况怎么演变。"
                        }`}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-[20px] border border-white/8 bg-[rgba(10,15,23,0.98)] px-4 py-4 text-sm leading-6 text-white/60">
              当前这段 TAF 没有拆出更细的云层结构。
            </div>
          )}
        </AviationModalSection>

        <AviationModalSection eyebrow="天气现象" title="为什么这里不直接写雨量">
          {tafWeatherItems.length > 0 ? (
            <div className="space-y-3">
              {tafWeatherItems.map((item, index) => (
                <div key={`${item.raw}-${index}`} className="rounded-[20px] border border-white/8 bg-[rgba(10,15,23,0.98)] px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="text-sm font-medium text-white">{item.labelZh}</div>
                    <span className="data-mono rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-white/74">
                      {item.raw}
                    </span>
                  </div>
                  <div className="mt-3 text-sm leading-6 text-white/66">
                    TAF 这里给的是天气现象代码，不是毫米雨量。`{item.raw}` 说明这段有 {item.labelZh}，通常要和风、云一起判断它是不是会压住白天升温。
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-[20px] border border-white/8 bg-[rgba(10,15,23,0.98)] px-4 py-4 text-sm leading-6 text-white/60">
              当前生效段没有明显的天气现象代码，所以这里只能先判断“暂无显著降水信号”。
            </div>
          )}
        </AviationModalSection>

        <AviationModalSection eyebrow="原始报文" title="完整 TAF">
          <div className="data-mono overflow-x-auto rounded-[18px] border border-white/8 bg-[rgba(7,12,18,0.92)] px-3 py-3 text-[12px] leading-6 text-[#dff7ff]">
            {tafForecast?.rawTaf ?? "当前没有可展示的原始 TAF 报文。"}
          </div>
        </AviationModalSection>
      </div>
    </div>
  );

  const aviationModal =
    typeof document !== "undefined"
      ? createPortal(
          <AnimatePresence>
            {openAviationPanel ? (
              <div className="fixed inset-0 z-[90]">
                <motion.div
                  className="absolute inset-0 bg-[rgba(3,8,14,0.74)] backdrop-blur-md"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  onClick={() => setOpenAviationPanel(null)}
                />

                <div
                  className="absolute inset-0 flex items-start overflow-hidden px-3 py-3 sm:px-6 sm:py-5 lg:px-8"
                  onClick={() => setOpenAviationPanel(null)}
                >
                  <motion.div
                    role="dialog"
                    aria-modal="true"
                    aria-label={aviationModalTitle}
                    initial={{ opacity: 0, y: 24, scale: 0.985 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 18, scale: 0.99 }}
                    transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
                    className="mx-auto flex h-[calc(100dvh-1.5rem)] w-full max-w-6xl flex-col overflow-hidden rounded-[30px] border border-[var(--border-strong)] bg-[#101722] shadow-[0_40px_140px_rgba(0,0,0,0.56)] sm:h-[calc(100dvh-2.5rem)]"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className="shrink-0 border-b border-white/8 px-4 py-4 sm:px-5 sm:py-5">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="max-w-3xl">
                        <div className="eyebrow flex items-center gap-2">
                          {openAviationPanel === "metar" ? (
                            <>
                              <Radar className="h-4 w-4 text-[var(--accent)]" />
                              <Droplets className="h-4 w-4 text-[var(--accent-secondary)]" />
                            </>
                          ) : (
                            <>
                              <Wind className="h-4 w-4 text-[var(--warning)]" />
                              <Cloudy className="h-4 w-4 text-[var(--accent-secondary)]" />
                            </>
                          )}
                          {openAviationPanel === "metar" ? "METAR 细看" : "TAF 细看"}
                        </div>
                        <div className="mt-2 text-[1.75rem] font-semibold leading-tight text-white">{aviationModalTitle}</div>
                        <div className="mt-3 max-w-3xl text-sm leading-6 text-white/62">{aviationModalDescription}</div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {aviationModalSourceUrl ? (
                          <a
                            href={aviationModalSourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white/70 transition hover:border-white/18 hover:bg-white/[0.05]"
                          >
                            {aviationModalSourceLabel}
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        ) : null}

                        <button
                          type="button"
                          onClick={() => setOpenAviationPanel(null)}
                          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3.5 py-2 text-sm text-white/70 transition hover:border-white/18 hover:bg-white/[0.05]"
                        >
                          <X className="h-4 w-4" />
                          关闭
                        </button>
                      </div>
                      </div>
                    </div>

                    <ScrollArea className="min-h-0 flex-1">
                      <ScrollViewport className="px-4 py-4 sm:px-5 sm:py-5">
                        {openAviationPanel === "metar" ? metarModalContent : tafModalContent}
                      </ScrollViewport>
                      <ScrollBar />
                    </ScrollArea>
                  </motion.div>
                </div>
              </div>
            ) : null}
          </AnimatePresence>,
          document.body,
        )
      : null;

  return (
    <section className="overview-panel terminal-panel self-start flex min-h-0 flex-col p-5">
      <div className="panel-section flex min-h-0 flex-col gap-4">
        <div className="rounded-[28px] border border-white/8 bg-[linear-gradient(160deg,rgba(18,24,38,0.96),rgba(15,20,30,0.92))] p-5">
          <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_230px] xl:grid-cols-[minmax(0,1fr)_240px]">
            <div className="min-w-0">
              <div className="eyebrow flex items-center gap-2">
                <Thermometer className="h-4 w-4 text-[var(--accent)]" />
                {UI_TEXT.weatherOverview.currentDecision}
              </div>

              <div className="mt-4 flex flex-wrap items-end gap-4">
                <div className={`data-mono font-semibold leading-none text-white ${timelineLayout.currentValueClassName}`}>
                  {formatTemperature(currentItem?.temperatureC, displayUnit)}
                </div>

                <div className="space-y-1 pb-2 text-sm leading-6 text-white/64">
                  <div>{UI_TEXT.weatherOverview.currentMoment} {currentItem ? formatDateTime(currentItem.timestamp, locationTimezone) : "--"}</div>
                  <div>{UI_TEXT.weatherOverview.feelsLike} {formatTemperature(currentItem?.feelsLikeC, displayUnit)}</div>
                  <div>{UI_TEXT.weatherOverview.wind} {formatWindRange(currentItem)}</div>
                </div>
              </div>

              <p className="mt-4 max-h-[5.25rem] max-w-2xl overflow-hidden text-[15px] leading-7 text-white/82 sm:max-h-[7rem]">
                {summaryText}
              </p>

              <div className="mt-4 flex flex-wrap gap-3">
                <ConfidenceCard
                  title="当天最高温判断置信度"
                  score={resolvedPredictabilityScore ?? null}
                  detail={isMobileTimeline ? null : predictabilityDetail}
                  label={predictabilityLabel ?? "--"}
                />
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2.5">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white/66">
                  <CloudRain className="h-4 w-4 text-[var(--accent-secondary)]" />
                  {UI_TEXT.weatherOverview.currentPrecipitation}
                  {selectedOrHoveredItem?.precipitationProbabilityPct !== null
                    ? ` ${formatNumber(selectedOrHoveredItem.precipitationProbabilityPct, 0)}%`
                    : " --"}
                </div>

                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white/66">
                  <Wind className="h-4 w-4 text-[var(--warning)]" />
                  {UI_TEXT.weatherOverview.currentWind} {formatWindRange(selectedOrHoveredItem)}
                </div>
              </div>

            </div>

            <div className="rounded-[24px] border border-white/8 bg-black/20 p-3">
              <div className="eyebrow">快捷查看</div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                {(Object.keys(heroPanels) as HeroPanelKey[]).map((panelKey) => {
                  const active = activeHeroPanel === panelKey;
                  return (
                    <button
                      key={panelKey}
                      type="button"
                      onClick={() => setActiveHeroPanel(panelKey)}
                      onFocus={() => setActiveHeroPanel(panelKey)}
                      onMouseEnter={() => setActiveHeroPanel(panelKey)}
                      title={heroPanels[panelKey].hint}
                      className={`rounded-full border px-2.5 py-2 text-center text-xs font-medium transition ${
                        active
                          ? "border-[rgba(143,246,217,0.28)] bg-[rgba(56,214,180,0.12)] text-white"
                          : "border-white/8 bg-white/[0.03] text-white/72 hover:border-white/16 hover:bg-white/[0.05]"
                      }`}
                    >
                      {heroPanels[panelKey].label}
                    </button>
                  );
                })}
              </div>

              <div className="mt-4 rounded-[22px] border border-white/8 bg-[rgba(255,255,255,0.03)] p-3">
                {activeHeroPanel === "intraday" ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="eyebrow flex items-center gap-2">
                          <Radar className="h-4 w-4 text-[var(--accent)]" />
                          今天怎么看
                        </div>
                        <div className="mt-2 text-base font-semibold text-white">{intradaySignals.headline}</div>
                      </div>

                      <StatusPill label={`把握度 ${CONFIDENCE_LABEL[intradaySignals.confidence]}`} tone="good" />
                    </div>

                    <div className="max-h-[5.25rem] overflow-hidden rounded-[18px] border border-white/8 bg-black/20 px-4 py-3 text-sm leading-6 text-white/74 sm:max-h-[7rem]">
                      <div className="eyebrow">当前主线</div>
                      <div className="mt-2">{intradaySignals.baseCase}</div>
                    </div>

                    <a
                      href="#home-intraday-detail"
                      className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white/72 transition hover:border-white/18 hover:bg-white/[0.05]"
                    >
                      看完整判断
                    </a>
                  </div>
                ) : null}

                {activeHeroPanel === "kelly" ? (
                  <div className="space-y-3">
                    <div className="eyebrow flex items-center gap-2">
                      <Thermometer className="h-4 w-4 text-[var(--warning)]" />
                      Kelly 机会
                    </div>
                    <div className="text-base font-semibold text-white">{marketReference.summary}</div>
                    <div className="hidden space-y-2 text-sm leading-6 text-white/68 xl:block">
                      {marketReference.notes.slice(0, 2).map((note) => (
                        <div key={note}>• {note}</div>
                      ))}
                    </div>
                    <a
                      href={currentKellyRoute}
                      className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white/72 transition hover:border-white/18 hover:bg-white/[0.05]"
                    >
                      打开 Kelly 页面
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className="timeline-card flex min-h-0 flex-col overflow-hidden rounded-[28px] border border-white/8 bg-[rgba(255,255,255,0.025)]">
          <div className="px-5 py-5">
            <div className="eyebrow">{UI_TEXT.weatherOverview.timelineTitle}</div>
            <div className="mt-2 text-sm leading-6 text-white/58">{timelineDescription}</div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <div className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-white/60">
                {timelineCoverageLabel}
              </div>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (currentIndex >= 0) {
                    const item = items[currentIndex];
                    if (item) {
                      onSelectTimestamp(item.timestamp);
                      scrollToIndex(currentIndex);
                    }
                  }
                }}
              >
                {UI_TEXT.weatherOverview.now}
              </Button>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (peakIndex >= 0) {
                    const item = items[peakIndex];
                    if (item) {
                      onSelectTimestamp(item.timestamp);
                      scrollToIndex(peakIndex);
                    }
                  }
                }}
              >
                {UI_TEXT.weatherOverview.peak}
              </Button>

              <div className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-white/60">
                {UI_TEXT.weatherOverview.currentHour} {currentItem ? formatTime(currentItem.timestamp, locationTimezone) : "--"}
              </div>

              <div className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-white/60">
                {UI_TEXT.weatherOverview.range}{" "}
                {temperatures.length
                  ? `${formatTemperature(minTemperature, displayUnit)} - ${formatTemperature(maxTemperature, displayUnit)}`
                  : "--"}
              </div>
            </div>
          </div>

          <div className="soft-divider" />

          <div
            className="grid gap-5 px-3 pb-5 pt-4"
            style={
              isStackedTimeline
                ? undefined
                : {
                    gridTemplateColumns: `minmax(0,1fr) ${timelineLayout.inspectorWidth}px`,
                    alignItems: "start",
                  }
            }
          >
            <div
              className="timeline-scrim relative px-2"
              style={{
                height: `${timelineLayout.scrimMinHeight}px`,
                minHeight: `${timelineLayout.scrimMinHeight}px`,
              }}
            >
              <div
              ref={trackRef}
              tabIndex={0}
              className="timeline-track relative h-full overflow-x-auto overflow-y-hidden px-3 focus:outline-none"
              onKeyDown={(event) => {
                if (!items.length) {
                  return;
                }

                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  const nextIndex = Math.min(items.length - 1, (selectedIndex >= 0 ? selectedIndex : 0) + 1);
                  const target = items[nextIndex];
                  if (target) {
                    onSelectTimestamp(target.timestamp);
                    scrollToIndex(nextIndex);
                  }
                }

                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  const nextIndex = Math.max(0, (selectedIndex >= 0 ? selectedIndex : 0) - 1);
                  const target = items[nextIndex];
                  if (target) {
                    onSelectTimestamp(target.timestamp);
                    scrollToIndex(nextIndex);
                  }
                }

                if (event.key === "Home") {
                  event.preventDefault();
                  const target = items[0];
                  if (target) {
                    onSelectTimestamp(target.timestamp);
                    scrollToIndex(0);
                  }
                }

                if (event.key === "End") {
                  event.preventDefault();
                  const target = items[items.length - 1];
                  if (target) {
                    onSelectTimestamp(target.timestamp);
                    scrollToIndex(items.length - 1);
                  }
                }

                if (event.key.toLowerCase() === "n" && currentIndex >= 0) {
                  event.preventDefault();
                  const target = items[currentIndex];
                  if (target) {
                    onSelectTimestamp(target.timestamp);
                    scrollToIndex(currentIndex);
                  }
                }
              }}
              onPointerDown={(event) => {
                if (!trackRef.current) {
                  return;
                }

                dragStateRef.current.active = true;
                dragStateRef.current.pointerId = event.pointerId;
                dragStateRef.current.startX = event.clientX;
                dragStateRef.current.scrollLeft = trackRef.current.scrollLeft;
                dragStateRef.current.moved = false;
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (!dragStateRef.current.active || !trackRef.current) {
                  return;
                }

                const delta = event.clientX - dragStateRef.current.startX;
                if (Math.abs(delta) > 4) {
                  dragStateRef.current.moved = true;
                }

                trackRef.current.scrollLeft = dragStateRef.current.scrollLeft - delta;
              }}
              onPointerUp={(event) => {
                if (!dragStateRef.current.active) {
                  return;
                }

                dragStateRef.current.active = false;
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }

                window.setTimeout(() => {
                  dragStateRef.current.moved = false;
                }, 120);
              }}
              onPointerCancel={(event) => {
                dragStateRef.current.active = false;
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
                dragStateRef.current.moved = false;
              }}
              onWheel={(event) => {
                if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
                  event.preventDefault();
                }
              }}
            >
              <div className="relative h-full" style={{ width: `${trackWidth}px`, minHeight: `${timelineLayout.trackMinHeight}px` }}>
                <div
                  className="pointer-events-none absolute inset-x-0 overflow-hidden border border-white/8"
                  style={{
                    top: `${timelineLayout.markerTop + 2}px`,
                    height: `${timelineLayout.bandHeight}px`,
                    borderRadius: `${Math.max(20, timelineLayout.cardRadius + 4)}px`,
                  }}
                >
                  <div className="absolute inset-0 opacity-90" style={{ background: trackGradient }} />
                  <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.18),rgba(255,255,255,0.02)_24%,rgba(5,9,15,0.38)_100%)]" />
                  <div
                    className="absolute inset-y-0 left-0 right-0 flex"
                    style={{ gap: `${timelineLayout.itemGap}px`, paddingInline: `${timelineLayout.trackPadding}px` }}
                  >
                    {items.map((item) => (
                      <div
                        key={`${item.timestamp}-band`}
                        className="relative h-full shrink-0"
                        style={{ width: `${timelineLayout.itemWidth}px` }}
                      >
                        <div
                          className="absolute w-px bg-white/8"
                          style={{
                            top: `${timelineLayout.bandInset}px`,
                            bottom: `${timelineLayout.bandInset}px`,
                            right: `${Math.round(timelineLayout.itemGap / -2)}px`,
                          }}
                        />
                        <div
                          className="absolute bottom-0 left-0 right-0 rounded-t-[12px] bg-[linear-gradient(180deg,rgba(114,229,255,0.1),rgba(114,229,255,0.32))]"
                          style={{
                            height: `${Math.max(6, ((item.precipitationProbabilityPct ?? 0) / 100) * timelineLayout.precipMaxHeight)}px`,
                            opacity: item.precipitationProbabilityPct ? 0.9 : 0.18,
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {peakIndex >= 0 ? (
                  <div
                    className="pointer-events-none absolute top-0 z-[4] flex -translate-x-1/2 flex-col items-center gap-1"
                    style={{
                      top: `${timelineLayout.markerTop}px`,
                      left: `${timelineLayout.trackPadding + peakIndex * timelineStep + timelineLayout.itemWidth / 2}px`,
                    }}
                  >
                    <span className="rounded-full border border-[rgba(242,183,109,0.28)] bg-[rgba(242,183,109,0.12)] px-2 py-0.5 text-[10px] text-[var(--warning)]">
                      {UI_TEXT.weatherOverview.peak}
                    </span>
                  </div>
                ) : null}

                {currentIndex >= 0 ? (
                  <div
                    className="pointer-events-none absolute bottom-0 z-[3] w-px bg-gradient-to-b from-transparent via-[var(--warning)] to-transparent"
                    style={{
                      top: `${timelineLayout.currentLineTop}px`,
                      left: `${timelineLayout.trackPadding + currentIndex * timelineStep + timelineLayout.itemWidth / 2}px`,
                    }}
                  />
                ) : null}

                <div
                  className="absolute bottom-0 left-0 right-0 z-[2] flex items-end pb-1"
                  style={{ gap: `${timelineLayout.itemGap}px`, paddingInline: `${timelineLayout.trackPadding}px` }}
                >
                  {items.map((item, index) => {
                    const isActive = item.timestamp === selectedTimestamp;
                    const isCurrent = item.timestamp === currentItem?.timestamp;
                    const ratio =
                      typeof item.temperatureC === "number" ? (item.temperatureC - minTemperature) / temperatureRange : 0.5;
                    const tone = getTemperatureTone(ratio);

                    return (
                      <button
                        key={item.timestamp}
                        type="button"
                        onMouseEnter={() => setHoveredTimestamp(item.timestamp)}
                        onMouseLeave={() => setHoveredTimestamp((current) => (current === item.timestamp ? null : current))}
                        onClick={(event) => {
                          if (dragStateRef.current.moved) {
                            event.preventDefault();
                            return;
                          }

                          onSelectTimestamp(item.timestamp);
                          scrollToIndex(index);
                        }}
                        className={`hour-cell relative flex shrink-0 flex-col justify-between overflow-hidden border text-left transition ${
                          isActive
                            ? "hour-cell-active border-[var(--border-strong)] bg-white/[0.06]"
                            : "border-white/8 bg-[rgba(10,14,22,0.74)] hover:border-white/16 hover:bg-white/[0.05]"
                        } ${isMobileTimeline ? "px-2 py-2" : "px-3 py-3"}`}
                        style={{
                          height: `${timelineLayout.cardHeight}px`,
                          width: `${timelineLayout.itemWidth}px`,
                          borderRadius: `${timelineLayout.cardRadius}px`,
                        }}
                      >
                        {isActive ? (
                          <motion.div
                            layoutId="hour-active-outline"
                            transition={{ type: "spring", stiffness: 340, damping: 28 }}
                            className="absolute inset-0 border border-[rgba(143,246,217,0.34)]"
                            style={{ borderRadius: `${timelineLayout.cardRadius}px` }}
                          />
                        ) : null}

                        <div
                          className="pointer-events-none absolute inset-x-0 top-0 opacity-90"
                          style={{
                            height: `${Math.round(timelineLayout.cardHeight * 0.32)}px`,
                            background: `linear-gradient(180deg, ${tone.surface}, rgba(255,255,255,0))`,
                          }}
                        />

                        <div className="relative z-[1]">
                          <div className="flex items-center justify-between gap-2">
                            <span className={`data-mono font-semibold text-white ${timelineLayout.cardTimeClassName}`}>
                              {formatTime(item.timestamp, locationTimezone)}
                            </span>
                            {isCurrent ? (
                              <span className="rounded-full border border-[rgba(242,183,109,0.3)] bg-[rgba(242,183,109,0.12)] px-1.5 py-0.5 text-[10px] text-[var(--warning)]">
                                {UI_TEXT.weatherOverview.nowBadge}
                              </span>
                            ) : null}
                          </div>

                          <div className={`${isMobileTimeline ? "mt-1.5" : "mt-2"} data-mono font-semibold text-white ${timelineLayout.cardTemperatureClassName}`}>
                            {formatTemperature(item.temperatureC, displayUnit)}
                          </div>
                        </div>

                        <div className="relative z-[1] space-y-1.5">
                          <div className="flex items-center justify-between gap-2 text-[10px] text-white/58">
                            <span>{UI_TEXT.weatherOverview.precipitation}</span>
                            <span className="data-mono text-white/78">
                              {item.precipitationProbabilityPct !== null ? `${formatNumber(item.precipitationProbabilityPct, 0)}%` : "--"}
                            </span>
                          </div>

                          <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.max(8, item.precipitationProbabilityPct ?? 0)}%`,
                                background: `linear-gradient(90deg, ${tone.line}, rgba(114,229,255,0.34))`,
                                opacity: item.precipitationProbabilityPct !== null ? 1 : 0.28,
                              }}
                            />
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            </div>

            {!isStackedTimeline ? selectedHourInspector : null}
            {isStackedTimeline ? <div className="px-4">{selectedHourInspector}</div> : null}
          </div>
        </div>

        <div className="rounded-[24px] border border-white/8 bg-[rgba(255,255,255,0.018)] px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="eyebrow text-white/36">机场温度证据</div>
              <div className="mt-1 text-sm leading-6 text-white/54">
                把 METAR 和 TAF 里真正影响当天温度的量单独拎出来。首页先给你结论和解释，点开再看原始报文。
              </div>
            </div>

            <a
              href={pageUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/60 transition hover:border-white/18 hover:bg-white/[0.05]"
            >
              {UI_TEXT.weatherOverview.sourcePage}
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>

          <div className="mt-4 grid gap-3 xl:grid-cols-2">
            <motion.button
              type="button"
              whileHover={{ y: -4, scale: 1.006 }}
              whileTap={{ scale: 0.995 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              onClick={() => setOpenAviationPanel("metar")}
              className="group relative overflow-hidden rounded-[26px] border border-white/8 bg-[linear-gradient(160deg,rgba(17,26,38,0.94),rgba(10,16,24,0.96))] p-5 text-left"
            >
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(114,229,255,0.14),transparent_44%)] opacity-80" />

              <div className="relative z-[1] flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="eyebrow flex items-center gap-2">
                    <Radar className="h-4 w-4 text-[var(--accent)]" />
                    <Droplets className="h-4 w-4 text-[var(--accent-secondary)]" />
                    温度 / 露点
                  </div>
                  <div className="mt-2 text-lg font-semibold text-white">最新一报先看大字，再点进去回看近 4 小时报文</div>
                </div>

                <span
                  className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] ${
                    metarObservation?.stale
                      ? "border-[rgba(242,183,109,0.24)] bg-[rgba(242,183,109,0.1)] text-[var(--warning)]"
                      : "border-[rgba(138,240,194,0.24)] bg-[rgba(138,240,194,0.1)] text-[var(--success)]"
                  }`}
                >
                  {metarObservation?.stale ? "最近缓存" : "最新实况"}
                </span>
              </div>

              <div className="relative z-[1] mt-5 grid gap-3 sm:grid-cols-2">
                <AviationMetric
                  label="当前气温"
                  value={formatTemperature(metarObservation?.temperatureC ?? metarReports[0]?.temperatureC ?? null, displayUnit)}
                  hint={metarPrimary}
                />
                <AviationMetric
                  label="当前露点"
                  value={formatTemperature(metarObservation?.dewpointC ?? metarReports[0]?.dewpointC ?? null, displayUnit)}
                  hint="露点直接和湿度、云底、体感一起影响白天升温判断。"
                />
              </div>

              <div className="relative z-[1] mt-4 flex flex-wrap gap-2">
                <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-xs text-white/68">
                  {metarWindowLabel}
                </span>
                <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-xs text-white/68">
                  风况 {formatWindDirectionLabel(metarObservation?.windDirectionDegrees ?? metarReports[0]?.windDirectionDegrees ?? null)}
                </span>
                <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-xs text-white/68">
                  风速 {formatWindSpeedLabel(metarObservation?.windSpeedKts ?? metarReports[0]?.windSpeedKts ?? null)}
                </span>
              </div>

              <div className="relative z-[1] mt-4 text-sm leading-6 text-white/64">{metarTrendSummary}</div>

              <div className="relative z-[1] mt-4 inline-flex items-center gap-2 text-sm font-medium text-white/82 transition group-hover:text-white">
                点开看最近 4 小时 METAR 报文
                <ExternalLink className="h-4 w-4" />
              </div>
            </motion.button>

            <motion.button
              type="button"
              whileHover={{ y: -4, scale: 1.006 }}
              whileTap={{ scale: 0.995 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              onClick={() => setOpenAviationPanel("taf")}
              className="group relative overflow-hidden rounded-[26px] border border-white/8 bg-[linear-gradient(160deg,rgba(21,24,35,0.95),rgba(12,15,22,0.96))] p-5 text-left"
            >
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(242,183,109,0.12),transparent_38%)] opacity-80" />

              <div className="relative z-[1] flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="eyebrow flex items-center gap-2">
                    <Clock3 className="h-4 w-4 text-[var(--warning)]" />
                    <Cloudy className="h-4 w-4 text-[var(--accent-secondary)]" />
                    TAF 影响温度
                  </div>
                  <div className="mt-2 text-lg font-semibold text-white">把专业术语先翻译成“利于升温还是压温”</div>
                </div>

                <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] text-white/68">
                  点开看原始 TAF
                </span>
              </div>

              <div className="relative z-[1] mt-5 grid gap-2">
                {tafImpactItems.map((item) => (
                  <div key={item.id}>
                    <AviationImpactCard item={item} compact />
                  </div>
                ))}
              </div>

              <div className="relative z-[1] mt-4 text-sm leading-6 text-white/64">
                {buildTafTemperatureNotice(tafForecast)}
              </div>

              <div className="relative z-[1] mt-4 inline-flex items-center gap-2 text-sm font-medium text-white/82 transition group-hover:text-white">
                点开看变化节点、TX/TN（如有）和完整 TAF
                <ExternalLink className="h-4 w-4" />
              </div>
            </motion.button>
          </div>
        </div>

        <div id="home-intraday-detail" className="rounded-[28px] border border-white/8 bg-[rgba(255,255,255,0.025)] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="eyebrow flex items-center gap-2">
                <Radar className="h-4 w-4 text-[var(--accent)]" />
                今天怎么看
              </div>
              <div className="mt-2 text-lg font-semibold text-white">{intradaySignals.headline}</div>
            </div>

            <StatusPill label={`把握度 ${CONFIDENCE_LABEL[intradaySignals.confidence]}`} tone="good" />
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            <SignalPathCard title="大致判断" body={intradaySignals.baseCase} />
            <SignalPathCard title="偏高的话" body={intradaySignals.upsideCase} />
            <SignalPathCard title="偏低的话" body={intradaySignals.downsideCase} />
          </div>

          <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(260px,0.88fr)]">
            <div className="rounded-[20px] border border-white/8 bg-black/20 px-4 py-3">
              <div className="eyebrow flex items-center gap-2">
                <BadgeCheck className="h-4 w-4 text-[var(--success)]" />
                这次主要参考
              </div>
              <div className="mt-3 space-y-2 text-sm leading-6 text-white/72">
                {intradaySignals.evidence.slice(0, 3).map((item) => (
                  <div key={item}>• {item}</div>
                ))}
              </div>
            </div>

            <div className="rounded-[20px] border border-white/8 bg-black/20 px-4 py-3">
              <div className="eyebrow flex items-center gap-2">
                <Clock3 className="h-4 w-4 text-[var(--warning)]" />
                下一次看点
              </div>
              <div className="mt-2 text-sm font-medium text-white">
                {intradaySignals.nextObservationAt
                  ? formatDateTime(intradaySignals.nextObservationAt, locationTimezone)
                  : "等待下一轮小时刷新"}
              </div>
              <div className="mt-3 text-xs leading-5 text-white/52">
                继续维持当前判断：{intradaySignals.confirmationRules[0] ?? "等待更多确认信号"}
              </div>
              <div className="mt-2 text-xs leading-5 text-white/52">
                需要重新判断：{intradaySignals.invalidationRules[0] ?? "若刷新明显背离当前判断，就重新评估"}
              </div>
            </div>
          </div>
        </div>
        {aviationModal}
      </div>
    </section>
  );
};
