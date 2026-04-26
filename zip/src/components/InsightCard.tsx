import { Activity, ArrowRight, CheckCheck, LoaderCircle, ThermometerSun } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UI_TEXT } from "../display-text";
import type { InsightViewModel } from "../mappers";
import type { KellyTemperatureUnit } from "../types";
import { formatDateTime, formatTemperature, formatTemperatureDelta, formatTime } from "../utils";

const DEBOUNCE_MS = 420;
const WEATHER_TIMESTAMP_LABEL = "天气时刻";
const WEATHER_TIMESTAMP_HINT = "参考温度当前对应的天气时刻";

export const InsightCard = ({
  insight,
  loading,
  error,
  displayUnit,
  locationTimezone,
  selectedWeatherTimestamp,
  selectedModelTimestamp,
  actualTemperatureC,
  manualTemperatureText,
  referenceMode,
  onSelectTimestamp,
  onTemperatureChange,
  onResetTemperature,
  onOpenDetails,
}: {
  insight: InsightViewModel | null;
  loading: boolean;
  error: string | null;
  displayUnit: KellyTemperatureUnit;
  locationTimezone?: string;
  selectedWeatherTimestamp: string | null;
  selectedModelTimestamp: string | null;
  actualTemperatureC: number | null;
  manualTemperatureText: string;
  referenceMode: "default" | "manual";
  onSelectTimestamp: (value: string | null) => void;
  onTemperatureChange: (value: string) => void;
  onResetTemperature: () => void;
  onOpenDetails: () => void;
}) => {
  const [draftValue, setDraftValue] = useState(manualTemperatureText);
  const [inputPending, setInputPending] = useState(false);
  const [updatedPulse, setUpdatedPulse] = useState(false);

  const quickMatches = useMemo(() => (insight?.rankedModels ?? []).slice(0, 3), [insight?.rankedModels]);
  const timestamps = insight?.availableTimestamps ?? [];

  useEffect(() => {
    setDraftValue(manualTemperatureText);
  }, [manualTemperatureText]);

  useEffect(() => {
    if (draftValue === manualTemperatureText) {
      return;
    }

    setInputPending(true);
    const timer = window.setTimeout(() => {
      onTemperatureChange(draftValue);
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [draftValue, manualTemperatureText, onTemperatureChange]);

  useEffect(() => {
    if (inputPending && !loading && draftValue === manualTemperatureText) {
      setInputPending(false);
      setUpdatedPulse(true);
      const timer = window.setTimeout(() => setUpdatedPulse(false), 1200);
      return () => window.clearTimeout(timer);
    }
  }, [draftValue, inputPending, loading, manualTemperatureText]);

  const referenceLabel =
    referenceMode === "manual"
      ? UI_TEXT.insight.manual
      : insight?.referenceTemperature.source === "selected-model-mean"
        ? UI_TEXT.insight.modelMean
        : UI_TEXT.insight.currentMoment;

  const feedback = inputPending || loading
    ? UI_TEXT.insight.calculating
    : updatedPulse
      ? UI_TEXT.insight.updated
      : UI_TEXT.insight.idle;
  const weatherTimestampCaption = selectedWeatherTimestamp
    ? formatDateTime(selectedWeatherTimestamp, locationTimezone)
    : WEATHER_TIMESTAMP_HINT;
  const modelTimestampCaption = selectedModelTimestamp
    ? formatDateTime(selectedModelTimestamp, locationTimezone)
    : UI_TEXT.insight.autoNearest;

  return (
    <section className="terminal-panel flex h-full flex-col px-5 py-5">
      <div className="panel-section flex h-full flex-col gap-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="eyebrow flex items-center gap-2">
              <Activity className="h-4 w-4 text-[var(--accent)]" />
              {UI_TEXT.insight.eyebrow}
            </div>
            <h2 className="mt-3 text-[1.95rem] font-semibold tracking-[-0.04em] text-white">{UI_TEXT.insight.title}</h2>
            <p className="mt-2 text-sm leading-6 text-white/58">{UI_TEXT.insight.description}</p>
          </div>

          <Button type="button" variant="secondary" size="sm" onClick={onOpenDetails}>
            {UI_TEXT.insight.openDetails}
          </Button>
        </div>

        <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="eyebrow">{UI_TEXT.insight.referenceTemperature}</div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] text-white/68">
              {inputPending || loading ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin text-[var(--accent)]" />
              ) : updatedPulse ? (
                <CheckCheck className="h-3.5 w-3.5 text-[var(--success)]" />
              ) : (
                <ThermometerSun className="h-3.5 w-3.5 text-[var(--warning)]" />
              )}
              {feedback}
            </div>
          </div>

          <div className="mt-3 flex gap-2">
            <Input
              value={draftValue}
              onChange={(event) => setDraftValue(event.target.value)}
              placeholder={`${UI_TEXT.insight.temperatureInputPlaceholder} (°${displayUnit})`}
              inputMode="decimal"
            />
            <Button
              type="button"
              variant={referenceMode === "default" ? "default" : "outline"}
              onClick={onResetTemperature}
            >
              {UI_TEXT.insight.resetDefault}
            </Button>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-3">
              <div className="eyebrow">{UI_TEXT.insight.currentReference}</div>
              <div className="data-mono mt-2 text-2xl font-semibold text-white">
                {formatTemperature(actualTemperatureC, displayUnit)}
              </div>
              <div className="mt-2 text-xs text-white/54">{UI_TEXT.insight.source} {referenceLabel}</div>
            </div>

            <div className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-3">
              <div className="eyebrow">{WEATHER_TIMESTAMP_LABEL}</div>
              <div className="data-mono mt-2 text-2xl font-semibold text-white">
                {selectedWeatherTimestamp ? formatTime(selectedWeatherTimestamp, locationTimezone) : "--"}
              </div>
              <div className="mt-2 text-xs text-white/54">{weatherTimestampCaption}</div>
            </div>

            <div className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-3">
              <div className="eyebrow">{UI_TEXT.insight.modelTimestamp}</div>
              <div className="data-mono mt-2 text-2xl font-semibold text-white">
                {selectedModelTimestamp ? formatTime(selectedModelTimestamp, locationTimezone) : "--"}
              </div>
              <div className="mt-2 text-xs text-white/54">{modelTimestampCaption}</div>
            </div>
          </div>

          {timestamps.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {timestamps.slice(0, 6).map((timestamp) => {
                const active = timestamp === selectedModelTimestamp;
                return (
                  <button
                    key={timestamp}
                    type="button"
                    onClick={() => onSelectTimestamp(timestamp)}
                    className={`rounded-full border px-3 py-1.5 text-xs transition ${
                      active
                        ? "border-[var(--border-strong)] bg-[rgba(56,214,180,0.14)] text-white"
                        : "border-white/10 bg-white/[0.03] text-white/56 hover:border-white/18 hover:text-white/74"
                    }`}
                  >
                    {formatTime(timestamp, locationTimezone)}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        <div className="grid gap-3">
          {quickMatches.length > 0 ? (
            quickMatches.map((model, index) => (
              <article
                key={`${model.modelName}-${model.dayPeakTimestamp ?? "none"}`}
                className={`rounded-[24px] border p-4 transition ${
                  index === 0
                    ? "border-[rgba(56,214,180,0.26)] bg-[linear-gradient(135deg,rgba(56,214,180,0.12),rgba(255,255,255,0.03))]"
                    : "border-white/8 bg-white/[0.03]"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="eyebrow">{UI_TEXT.insight.candidatePrefix} {index + 1}</div>
                    <div className="mt-2 text-xl font-semibold text-white">{model.modelName}</div>
                  </div>

                  <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-white/58">
                    {UI_TEXT.analysis.deviation} {formatTemperatureDelta(model.deltaToActualTemperatureC, displayUnit, 1, true)}
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-[18px] border border-white/8 bg-black/20 px-3 py-3">
                    <div className="eyebrow">{UI_TEXT.insight.currentPrediction}</div>
                    <div className="data-mono mt-2 text-2xl font-semibold text-white">
                      {formatTemperature(model.currentTemperatureC, displayUnit)}
                    </div>
                  </div>

                  <div className="rounded-[18px] border border-white/8 bg-black/20 px-3 py-3">
                    <div className="eyebrow">{UI_TEXT.insight.peakTemperature}</div>
                    <div className="data-mono mt-2 text-2xl font-semibold text-white">
                      {formatTemperature(model.dayPeakTemperatureC, displayUnit)}
                    </div>
                  </div>

                  <div className="rounded-[18px] border border-white/8 bg-black/20 px-3 py-3">
                    <div className="eyebrow">{UI_TEXT.insight.peakWindow}</div>
                    <div className="data-mono mt-2 text-2xl font-semibold text-white">
                      {model.dayPeakTimestamp ? formatTime(model.dayPeakTimestamp, locationTimezone) : "--"}
                    </div>
                  </div>
                </div>
              </article>
            ))
          ) : (
            <div className="rounded-[24px] border border-white/8 bg-white/[0.03] px-4 py-5 text-sm leading-7 text-white/58">
              {UI_TEXT.insight.waitingResult}
            </div>
          )}
        </div>

        <div className="mt-auto flex items-center justify-between gap-3 rounded-[20px] border border-white/8 bg-black/20 px-4 py-3 text-xs text-white/54">
          <span>{UI_TEXT.insight.footer}</span>
          <Button type="button" variant="ghost" size="sm" onClick={onOpenDetails}>
            {UI_TEXT.insight.enterAnalysis}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>

        {error ? <div className="text-sm text-[var(--warning)]">{error}</div> : null}
      </div>
    </section>
  );
};
