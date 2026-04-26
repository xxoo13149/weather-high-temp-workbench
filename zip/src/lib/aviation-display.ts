import type { KellyTemperatureUnit, MetarObservation, TafForecastOverview } from "../types";
import { formatDateTime, formatNumber, formatTemperature } from "../utils";

type BuildMetarDetailOptions = {
  includeStationName?: boolean;
};

const degreesToWindLabelZh = (value: number | null | undefined) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "变向风";
  }

  const normalized = ((value % 360) + 360) % 360;
  const labels = ["北风", "东北风", "东风", "东南风", "南风", "西南风", "西风", "西北风"];
  const index = Math.round(normalized / 45) % labels.length;
  return labels[index] ?? "变向风";
};

const formatWindKts = (value: number | null | undefined) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "--";
  }

  return `${formatNumber(value, 0)} kt`;
};

const buildMetarWindText = (observation: MetarObservation) => {
  if (typeof observation.windSpeedKts !== "number" || !Number.isFinite(observation.windSpeedKts)) {
    return "风况 --";
  }

  const directionLabel = degreesToWindLabelZh(observation.windDirectionDegrees);
  const degreesLabel =
    typeof observation.windDirectionDegrees === "number" && Number.isFinite(observation.windDirectionDegrees)
      ? ` ${Math.round(observation.windDirectionDegrees)}°`
      : "";

  return `${directionLabel}${degreesLabel} · ${formatWindKts(observation.windSpeedKts)}`;
};

const buildStationLabel = (stationName: string | null | undefined, stationId: string) =>
  stationName ? `${stationName} · ${stationId}` : stationId;

const buildTafActiveSummary = (forecast: TafForecastOverview) => {
  const summary = forecast.dailySummary;
  const active = forecast.activeForecast;

  const parts = [
    summary?.temperatureTrend?.headlineZh ?? null,
    summary?.activeWindTextZh ?? null,
    summary?.activeCloudTextZh ?? null,
    summary?.activeWeatherTextZh ?? null,
    active?.headlineZh ?? null,
  ].filter((value): value is string => Boolean(value));

  return parts.slice(0, 2).join(" | ");
};

export const formatLocalDateTimeLabel = (value: string | null | undefined, timeZone?: string) => formatDateTime(value, timeZone);

export const buildMetarHeadline = (
  observation: MetarObservation | null | undefined,
  displayUnit: KellyTemperatureUnit,
) => {
  if (!observation) {
    return "暂未拿到机场实况";
  }

  return `气温 ${formatTemperature(observation.temperatureC, displayUnit)} · 露点 ${formatTemperature(observation.dewpointC, displayUnit)}`;
};

export const buildMetarDetail = (
  observation: MetarObservation | null | undefined,
  timeZone?: string,
  options: BuildMetarDetailOptions = {},
) => {
  if (!observation) {
    return "等待最新机场实况。";
  }

  const parts = [
    options.includeStationName ? buildStationLabel(observation.stationName, observation.stationId) : null,
    `观测 ${formatLocalDateTimeLabel(observation.observedAt, timeZone)}`,
    buildMetarWindText(observation),
  ].filter((value): value is string => Boolean(value));

  return parts.join(" | ");
};

export const buildTafHeadline = (
  forecast: TafForecastOverview | null | undefined,
  displayUnit: KellyTemperatureUnit,
) => {
  if (!forecast) {
    return "暂未拿到 TAF 机场预报";
  }

  const summary = forecast.dailySummary;
  const temperatureLabels = [
    summary?.maxTemperatureC !== null && summary?.maxTemperatureC !== undefined
      ? `最高 ${formatTemperature(summary.maxTemperatureC, displayUnit)}`
      : null,
    summary?.minTemperatureC !== null && summary?.minTemperatureC !== undefined
      ? `最低 ${formatTemperature(summary.minTemperatureC, displayUnit)}`
      : null,
  ].filter((value): value is string => Boolean(value));

  if (temperatureLabels.length > 0) {
    return temperatureLabels.join(" · ");
  }

  return summary?.activeHeadlineZh ?? forecast.activeForecast?.headlineZh ?? "已获取 TAF 预报";
};

export const buildTafDetail = (
  forecast: TafForecastOverview | null | undefined,
  timeZone: string | undefined,
  displayUnit: KellyTemperatureUnit,
) => {
  if (!forecast) {
    return "等待机场预报。";
  }

  const summary = forecast.dailySummary;
  const activeSummary = buildTafActiveSummary(forecast);
  const temperatureTrend =
    summary?.temperatureTrend?.headlineZh &&
    summary?.maxTemperatureC !== null &&
    summary?.minTemperatureC !== null
      ? `TAF 预估区间 ${formatTemperature(summary.minTemperatureC, displayUnit)} - ${formatTemperature(summary.maxTemperatureC, displayUnit)}`
      : summary?.temperatureTrend?.headlineZh ?? null;

  const parts = [
    forecast.issuedAt ? `签发 ${formatLocalDateTimeLabel(forecast.issuedAt, timeZone)}` : null,
    temperatureTrend,
    activeSummary || null,
  ].filter((value): value is string => Boolean(value));

  return parts.slice(0, 3).join(" | ");
};
