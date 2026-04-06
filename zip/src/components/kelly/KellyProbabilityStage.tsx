import { ChartSpline, Radar, Target } from "lucide-react";
import { useMemo } from "react";

import type { KellyProbabilityPanelData } from "@/lib/kelly";
import {
  buildKellyCurveGeometry,
  projectKellyCurveX,
} from "@/lib/kelly";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/utils";

type KellyProbabilityStageProps = {
  probability: KellyProbabilityPanelData;
  selectedMarketId?: string | null;
};

const CHART_WIDTH = 720;
const CHART_HEIGHT = 320;

const bandToneStyles = {
  neutral: "rgba(255,255,255,0.06)",
  accent: "rgba(107,231,255,0.12)",
  success: "rgba(133,243,180,0.12)",
  warning: "rgba(255,200,107,0.12)",
  danger: "rgba(255,107,107,0.12)",
} as const;

const markerToneStyles = {
  neutral: "rgba(255,255,255,0.3)",
  accent: "rgba(107,231,255,0.72)",
  success: "rgba(133,243,180,0.72)",
  warning: "rgba(255,200,107,0.72)",
  danger: "rgba(255,107,107,0.72)",
} as const;

export const KellyProbabilityStage = ({
  probability,
  selectedMarketId,
}: KellyProbabilityStageProps) => {
  const geometry = useMemo(
    () => buildKellyCurveGeometry(probability.samples, CHART_WIDTH, CHART_HEIGHT),
    [probability.samples],
  );

  return (
    <section className="kelly-block">
      <div className="kelly-block__header">
        <div>
          <div className="eyebrow">Probability</div>
          <h3 className="kelly-block__title">{probability.title}</h3>
        </div>
        <div className="text-sm text-white/48">{probability.subtitle}</div>
      </div>

      <div className="kelly-probability-layout">
        <div className="kelly-curve-shell">
          <div className="kelly-curve-meta">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/68">
              <ChartSpline className="h-3.5 w-3.5 text-[var(--accent)]" />
              主观分布
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/68">
              <Target className="h-3.5 w-3.5 text-[var(--warning)]" />
              盘口阈值
            </div>
          </div>

          {geometry ? (
            <svg
              viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
              className="kelly-curve-svg"
              role="img"
              aria-label={probability.title}
            >
              <defs>
                <linearGradient id="kelly-curve-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgba(107,231,255,0.34)" />
                  <stop offset="65%" stopColor="rgba(107,231,255,0.08)" />
                  <stop offset="100%" stopColor="rgba(107,231,255,0)" />
                </linearGradient>
              </defs>

              {[0.25, 0.5, 0.75, 1].map((ratio) => {
                const y = geometry.plotTop + geometry.plotHeight * (1 - ratio);
                return (
                  <line
                    key={ratio}
                    x1={geometry.plotLeft}
                    x2={geometry.plotLeft + geometry.plotWidth}
                    y1={y}
                    y2={y}
                    stroke="rgba(255,255,255,0.08)"
                    strokeDasharray="4 8"
                  />
                );
              })}

              {probability.confidenceBands?.map((band) => {
                const x = projectKellyCurveX(band.fromC, geometry);
                const width = projectKellyCurveX(band.toC, geometry) - x;
                const tone = band.tone ?? "neutral";
                return (
                  <g key={band.id}>
                    <rect
                      x={x}
                      y={geometry.plotTop}
                      width={Math.max(width, 2)}
                      height={geometry.plotHeight}
                      fill={bandToneStyles[tone]}
                    />
                    <text x={x + 8} y={geometry.plotTop + 18} fill="rgba(255,255,255,0.62)" fontSize="11">
                      {band.label}
                    </text>
                  </g>
                );
              })}

              {probability.thresholds.map((marker) => {
                const x = projectKellyCurveX(marker.temperatureC, geometry);
                const tone = marker.tone ?? "neutral";
                const active = marker.marketId && marker.marketId === selectedMarketId;
                return (
                  <g key={marker.id}>
                    <line
                      x1={x}
                      x2={x}
                      y1={geometry.plotTop}
                      y2={geometry.plotTop + geometry.plotHeight}
                      stroke={markerToneStyles[tone]}
                      strokeWidth={active ? 2.5 : 1.25}
                      strokeDasharray={active ? undefined : "6 8"}
                    />
                    <rect
                      x={x - 32}
                      y={geometry.plotTop - 4}
                      width={64}
                      height={22}
                      rx={11}
                      fill={active ? "rgba(107,231,255,0.18)" : "rgba(255,255,255,0.06)"}
                      stroke={active ? "rgba(107,231,255,0.4)" : "rgba(255,255,255,0.1)"}
                    />
                    <text x={x} y={geometry.plotTop + 11} fill="rgba(255,255,255,0.92)" fontSize="11" textAnchor="middle">
                      {marker.label}
                    </text>
                  </g>
                );
              })}

              <path d={geometry.areaPath} fill="url(#kelly-curve-fill)" />
              <path
                d={geometry.linePath}
                fill="none"
                stroke="rgba(107,231,255,0.94)"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {geometry.points.map((point) => (
                <g key={`${point.source.temperatureC}-${point.source.probabilityPct}`}>
                  <circle cx={point.x} cy={point.y} r="4" fill="rgba(107,231,255,1)" />
                  <text
                    x={point.x}
                    y={geometry.plotTop + geometry.plotHeight + 18}
                    fill="rgba(255,255,255,0.68)"
                    fontSize="11"
                    textAnchor="middle"
                  >
                    {formatNumber(point.source.temperatureC, 0)}°C
                  </text>
                </g>
              ))}
            </svg>
          ) : (
            <div className="kelly-empty-block">当前没有分布曲线数据。</div>
          )}
        </div>

        <aside className="kelly-probability-side">
          <div className="kelly-probability-side__intro">
            <div className="eyebrow flex items-center gap-2">
              <Radar className="h-4 w-4 text-[var(--accent)]" />
              分布说明
            </div>
            <p>{probability.summary ?? "这里放你的主观概率解释、置信带和阈值含义。"}</p>
          </div>

          <div className="kelly-threshold-list">
            {probability.thresholds.map((marker) => {
              const active = marker.marketId && marker.marketId === selectedMarketId;
              return (
                <article key={marker.id} className={cn("kelly-threshold-item", active && "is-active")}>
                  <div className="kelly-threshold-item__title">
                    <span>{marker.label}</span>
                    <strong className="data-mono">{formatNumber(marker.temperatureC, 0)}°C</strong>
                  </div>
                  {marker.detail ? <div className="kelly-threshold-item__detail">{marker.detail}</div> : null}
                </article>
              );
            })}
          </div>

          {probability.notes?.length ? (
            <div className="kelly-note-list">
              {probability.notes.map((note) => (
                <div key={note}>{note}</div>
              ))}
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
};
