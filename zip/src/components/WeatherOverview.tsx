import {
  CloudRain,
  ExternalLink,
  Navigation,
  Thermometer,
  Wind,
} from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { UI_TEXT } from "../display-text";
import type { HourlyWeatherItem } from "../types";
import {
  formatDateTime,
  formatNumber,
  formatTime,
  getWindDirectionDegrees,
  getWindDirectionLabel,
  valueOrDash,
} from "../utils";
import { PredictabilityDots } from "./PredictabilityDots";

const ITEM_WIDTH = 102;
const ITEM_GAP = 10;
const TRACK_PADDING = 20;
const BAND_HEIGHT = 82;

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
  detail: string;
}) => (
  <div className="min-w-[220px] rounded-[20px] border border-white/8 bg-black/20 px-4 py-3">
    <div className="eyebrow">{title}</div>
    <div className="mt-3">
      <PredictabilityDots score={score} label={label} />
    </div>
    <div className="mt-3 text-xs leading-6 text-white/52">{detail}</div>
  </div>
);

const buildPredictabilityDetail = (
  predictabilityLabel: string | undefined,
  availableTemperatureHours: number,
  totalHours: number,
) =>
  `复用分析工作区同口径（predictability: ${(predictabilityLabel ?? "--").trim()}），温度时序覆盖 ${availableTemperatureHours}/${totalHours} 小时。`;

export const WeatherOverview = ({
  pageUrl,
  reportText,
  items,
  locationTimezone,
  selectedTimestamp,
  onSelectTimestamp,
  currentItem,
  selectedItem,
  predictabilityScore,
  predictabilityLabel,
}: {
  pageUrl: string;
  reportText: string;
  items: HourlyWeatherItem[];
  locationTimezone?: string;
  selectedTimestamp: string | null;
  onSelectTimestamp: (timestamp: string) => void;
  currentItem: HourlyWeatherItem | null;
  selectedItem: HourlyWeatherItem | null;
  predictabilityScore?: number | null;
  predictabilityLabel?: string;
}) => {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const momentumFrameRef = useRef<number | null>(null);
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

  const [hoveredTimestamp, setHoveredTimestamp] = useState<string | null>(null);

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

  const temperatures = items
    .map((item) => item.temperatureC)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const minTemperature = temperatures.length ? Math.min(...temperatures) : 0;
  const maxTemperature = temperatures.length ? Math.max(...temperatures) : 0;
  const temperatureRange = Math.max(maxTemperature - minTemperature, 1);
  const trackWidth = Math.max(
    TRACK_PADDING * 2 + items.length * ITEM_WIDTH + Math.max(0, items.length - 1) * ITEM_GAP,
    520,
  );

  const summaryText = reportText.trim() || UI_TEXT.weatherOverview.summarySyncing;
  const inspectorSummary = summarizeHour(selectedOrHoveredItem);
  const availableTemperatureHours = items.filter((item) => typeof item.temperatureC === "number").length;
  const totalHours = Math.max(items.length, 1);

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

    const left = TRACK_PADDING + index * (ITEM_WIDTH + ITEM_GAP) - node.clientWidth / 2 + ITEM_WIDTH / 2;
    node.scrollTo({ left: Math.max(0, left), behavior });
  };

  const snapToNearest = () => {
    const node = trackRef.current;
    if (!node) {
      return;
    }

    const step = ITEM_WIDTH + ITEM_GAP;
    const nearestIndex = Math.max(0, Math.min(items.length - 1, Math.round(node.scrollLeft / step)));
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
    if (selectedIndex >= 0) {
      scrollToIndex(selectedIndex, "smooth");
    }

    return stopMomentum;
  }, [selectedIndex]);

  return (
    <section className="overview-panel terminal-panel flex min-h-0 flex-col p-5">
      <div className="panel-section flex min-h-0 flex-1 flex-col gap-4">
        <div className="rounded-[28px] border border-white/8 bg-[linear-gradient(160deg,rgba(18,24,38,0.96),rgba(15,20,30,0.92))] p-5">
          <div className="eyebrow flex items-center gap-2">
            <Thermometer className="h-4 w-4 text-[var(--accent)]" />
            {UI_TEXT.weatherOverview.currentDecision}
          </div>

          <div className="mt-4 flex flex-wrap items-end gap-4">
            <div className="data-mono text-[clamp(3.2rem,6vw,5rem)] font-semibold leading-none text-white">
              {valueOrDash(currentItem?.temperatureC, "°C")}
            </div>

            <div className="space-y-1 pb-2 text-sm leading-6 text-white/64">
              <div>{UI_TEXT.weatherOverview.currentMoment} {currentItem ? formatDateTime(currentItem.timestamp, locationTimezone) : "--"}</div>
              <div>{UI_TEXT.weatherOverview.feelsLike} {valueOrDash(currentItem?.feelsLikeC, "°C")}</div>
              <div>{UI_TEXT.weatherOverview.wind} {formatWindRange(currentItem)}</div>
            </div>
          </div>

          <p className="mt-4 max-w-4xl text-[15px] leading-7 text-white/82">{summaryText}</p>

          <div className="mt-4 flex flex-wrap gap-3">
            <ConfidenceCard
              title="当天最高温判断置信度"
              score={predictabilityScore ?? null}
              label={`最高温判断 ${predictabilityLabel ?? "--"}`}
              detail={buildPredictabilityDetail(predictabilityLabel, availableTemperatureHours, totalHours)}
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
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

            <a
              href={pageUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white/66 transition hover:border-white/18 hover:bg-white/[0.05]"
            >
              {UI_TEXT.weatherOverview.sourcePage}
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        </div>

        <div className="timeline-card flex min-h-0 flex-1 flex-col overflow-hidden rounded-[28px] border border-white/8 bg-[rgba(255,255,255,0.025)]">
          <div className="grid gap-4 px-5 py-4 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
            <div>
              <div className="eyebrow">{UI_TEXT.weatherOverview.timelineTitle}</div>
              <div className="mt-2 text-sm leading-6 text-white/58">{UI_TEXT.weatherOverview.timelineDescription}</div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
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
                  {UI_TEXT.weatherOverview.range} {temperatures.length ? `${formatNumber(minTemperature)}°C - ${formatNumber(maxTemperature)}°C` : "--"}
                </div>
              </div>
            </div>

            <div className="rounded-[24px] border border-white/8 bg-black/20 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="eyebrow">{UI_TEXT.weatherOverview.selectedHour}</div>
                  <div className="mt-2 text-2xl font-semibold text-white">
                    {selectedOrHoveredItem
                    ? `${formatTime(selectedOrHoveredItem.timestamp, locationTimezone)} · ${valueOrDash(selectedOrHoveredItem.temperatureC, "°C")}`
                      : "--"}
                  </div>
                </div>

                <WindGlyph direction={selectedOrHoveredItem?.windDirection} />
              </div>

              <div className="mt-3 text-sm leading-6 text-white/60">{inspectorSummary}</div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
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
                  value={valueOrDash(selectedOrHoveredItem?.feelsLikeC, "°C")}
                  icon={<Thermometer className="h-3.5 w-3.5 text-[var(--warning)]" />}
                />
                <InspectorStat
                  label={UI_TEXT.weatherOverview.wind}
                  value={formatWindRange(selectedOrHoveredItem)}
                  icon={<Wind className="h-3.5 w-3.5 text-[var(--accent)]" />}
                />
              </div>
            </div>
          </div>

          <div className="soft-divider" />

          <div className="timeline-scrim relative min-h-[220px] flex-1 px-2 pb-3 pt-3">
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
              <div className="relative h-full min-h-[210px]" style={{ width: `${trackWidth}px` }}>
                <div
                  className="pointer-events-none absolute inset-x-0 top-2 overflow-hidden rounded-[24px] border border-white/8"
                  style={{ height: `${BAND_HEIGHT}px` }}
                >
                  <div className="absolute inset-0 opacity-90" style={{ background: trackGradient }} />
                  <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.18),rgba(255,255,255,0.02)_24%,rgba(5,9,15,0.38)_100%)]" />
                  <div className="absolute inset-y-0 left-0 right-0 flex gap-[10px] px-[20px]">
                    {items.map((item) => (
                      <div key={`${item.timestamp}-band`} className="relative h-full shrink-0" style={{ width: `${ITEM_WIDTH}px` }}>
                        <div className="absolute inset-y-[14px] right-[-5px] w-px bg-white/8" />
                        <div
                          className="absolute bottom-0 left-0 right-0 rounded-t-[12px] bg-[linear-gradient(180deg,rgba(114,229,255,0.1),rgba(114,229,255,0.32))]"
                          style={{
                            height: `${Math.max(6, ((item.precipitationProbabilityPct ?? 0) / 100) * 22)}px`,
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
                      left: `${TRACK_PADDING + peakIndex * (ITEM_WIDTH + ITEM_GAP) + ITEM_WIDTH / 2}px`,
                    }}
                  >
                    <span className="rounded-full border border-[rgba(242,183,109,0.28)] bg-[rgba(242,183,109,0.12)] px-2 py-0.5 text-[10px] text-[var(--warning)]">
                      {UI_TEXT.weatherOverview.peak}
                    </span>
                  </div>
                ) : null}

                {currentIndex >= 0 ? (
                  <div
                    className="pointer-events-none absolute bottom-0 top-[8px] z-[3] w-px bg-gradient-to-b from-transparent via-[var(--warning)] to-transparent"
                    style={{
                      left: `${TRACK_PADDING + currentIndex * (ITEM_WIDTH + ITEM_GAP) + ITEM_WIDTH / 2}px`,
                    }}
                  />
                ) : null}

                <div className="absolute bottom-0 left-0 right-0 z-[2] flex items-end gap-[10px] px-[20px] pb-1">
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
                        className={`hour-cell relative flex h-[112px] w-[102px] shrink-0 flex-col justify-between overflow-hidden rounded-[20px] border px-3 py-3 text-left transition ${
                          isActive
                            ? "hour-cell-active border-[var(--border-strong)] bg-white/[0.06]"
                            : "border-white/8 bg-[rgba(10,14,22,0.74)] hover:border-white/16 hover:bg-white/[0.05]"
                        }`}
                      >
                        {isActive ? (
                          <motion.div
                            layoutId="hour-active-outline"
                            transition={{ type: "spring", stiffness: 340, damping: 28 }}
                            className="absolute inset-0 rounded-[20px] border border-[rgba(143,246,217,0.34)]"
                          />
                        ) : null}

                        <div
                          className="pointer-events-none absolute inset-x-0 top-0 h-[36px] opacity-90"
                          style={{ background: `linear-gradient(180deg, ${tone.surface}, rgba(255,255,255,0))` }}
                        />

                        <div className="relative z-[1]">
                          <div className="flex items-center justify-between gap-2">
                            <span className="data-mono text-[12px] font-semibold text-white">{formatTime(item.timestamp, locationTimezone)}</span>
                            {isCurrent ? (
                              <span className="rounded-full border border-[rgba(242,183,109,0.3)] bg-[rgba(242,183,109,0.12)] px-1.5 py-0.5 text-[10px] text-[var(--warning)]">
                                {UI_TEXT.weatherOverview.nowBadge}
                              </span>
                            ) : null}
                          </div>

                          <div className="mt-2 data-mono text-[1.35rem] font-semibold text-white">
                            {valueOrDash(item.temperatureC, "°C")}
                          </div>
                        </div>

                        <div className="relative z-[1] space-y-2">
                          <div className="flex items-center justify-between gap-2 text-[11px] text-white/58">
                            <span>{UI_TEXT.weatherOverview.currentPrecipitation}</span>
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
        </div>
      </div>
    </section>
  );
};
