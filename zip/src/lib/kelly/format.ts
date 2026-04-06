import { formatDateTime, formatNumber } from "@/utils";
import type { KellyCurvePoint, KellyTone } from "./types";

export const KELLY_EMPTY_VALUE = "--";

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export const formatKellyPercent = (value: number | null | undefined, digits = 1) =>
  value === null || value === undefined || Number.isNaN(value)
    ? KELLY_EMPTY_VALUE
    : `${formatNumber(value, digits)}%`;

export const formatKellySignedPercent = (value: number | null | undefined, digits = 1) =>
  value === null || value === undefined || Number.isNaN(value)
    ? KELLY_EMPTY_VALUE
    : `${value > 0 ? "+" : ""}${formatNumber(value, digits)}%`;

export const formatKellyUsd = (value: number | null | undefined) =>
  value === null || value === undefined || Number.isNaN(value) ? KELLY_EMPTY_VALUE : usdFormatter.format(value);

export const formatKellyTimestamp = (value: string | null | undefined, timeZone?: string) =>
  value ? formatDateTime(value, timeZone) : KELLY_EMPTY_VALUE;

export const normalizeTone = (tone: KellyTone | undefined) => tone ?? "neutral";

export type KellyCurveGeometry = {
  linePath: string;
  areaPath: string;
  points: Array<{ x: number; y: number; source: KellyCurvePoint }>;
  minX: number;
  maxX: number;
  maxY: number;
  plotLeft: number;
  plotTop: number;
  plotWidth: number;
  plotHeight: number;
};

type CurvePadding = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

const DEFAULT_PADDING: CurvePadding = {
  top: 20,
  right: 22,
  bottom: 30,
  left: 22,
};

export const buildKellyCurveGeometry = (
  samples: KellyCurvePoint[],
  width: number,
  height: number,
  padding: CurvePadding = DEFAULT_PADDING,
): KellyCurveGeometry | null => {
  const points = samples.filter(
    (sample) =>
      Number.isFinite(sample.temperatureC) &&
      Number.isFinite(sample.probabilityPct) &&
      sample.probabilityPct >= 0,
  );

  if (!points.length) {
    return null;
  }

  const minX = Math.min(...points.map((sample) => sample.temperatureC));
  const maxX = Math.max(...points.map((sample) => sample.temperatureC));
  const maxY = Math.max(...points.map((sample) => sample.probabilityPct), 1);
  const plotLeft = padding.left;
  const plotTop = padding.top;
  const plotWidth = Math.max(1, width - padding.left - padding.right);
  const plotHeight = Math.max(1, height - padding.top - padding.bottom);

  const mapX = (value: number) =>
    plotLeft + ((value - minX) / Math.max(maxX - minX, 1)) * plotWidth;
  const mapY = (value: number) => plotTop + (1 - value / maxY) * plotHeight;

  const mapped = points.map((sample) => ({
    x: mapX(sample.temperatureC),
    y: mapY(sample.probabilityPct),
    source: sample,
  }));

  const linePath = mapped
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");

  const firstPoint = mapped[0];
  const lastPoint = mapped[mapped.length - 1];
  const bottom = plotTop + plotHeight;
  const areaPath = `${linePath} L ${lastPoint.x.toFixed(2)} ${bottom.toFixed(2)} L ${firstPoint.x.toFixed(2)} ${bottom.toFixed(2)} Z`;

  return {
    linePath,
    areaPath,
    points: mapped,
    minX,
    maxX,
    maxY,
    plotLeft,
    plotTop,
    plotWidth,
    plotHeight,
  };
};

export const projectKellyCurveX = (temperatureC: number, geometry: KellyCurveGeometry) =>
  geometry.plotLeft + ((temperatureC - geometry.minX) / Math.max(geometry.maxX - geometry.minX, 1)) * geometry.plotWidth;
