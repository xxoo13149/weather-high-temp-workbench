import { Activity, ArrowRight, CheckCheck, ChevronDown, ChevronUp, LoaderCircle, ThermometerSun } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";

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
  mobileSummary = false,
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
  mobileSummary?: boolean;
}) => {
  const [draftValue, setDraftValue] = useState(manualTemperatureText);
  const [inputPending, setInputPending] = useState(false);
  const [updatedPulse, setUpdatedPulse] = useState(false);
  const [showMobileReferenceEditor, setShowMobileReferenceEditor] = useState(referenceMode === "manual");
  const [showTimeAnchors, setShowTimeAnchors] = useState(false);
  const [showMoreMatches, setShowMoreMatches] = useState(false);
  const onTemperatureChangeRef = useRef(onTemperatureChange);

  const quickMatches = useMemo(() => (insight?.rankedModels ?? []).slice(0, 3), [insight?.rankedModels]);
  const timestamps = insight?.availableTimestamps ?? [];
  const featuredMatch = quickMatches[0] ?? null;
  const remainingMatches = quickMatches.slice(1);

  useEffect(() => {
    onTemperatureChangeRef.current = onTemperatureChange;
  }, [onTemperatureChange]);

  useEffect(() => {
    setDraftValue(manualTemperatureText);
  }, [manualTemperatureText]);

  useEffect(() => {
    if (draftValue === manualTemperatureText) {
      return;
    }

    setInputPending(true);
    const timer = window.setTimeout(() => {
      onTemperatureChangeRef.current(draftValue);
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [draftValue, manualTemperatureText]);

  useEffect(() => {
    if (inputPending && !loading && draftValue === manualTemperatureText) {
      setInputPending(false);
      setUpdatedPulse(true);
      const timer = window.setTimeout(() => setUpdatedPulse(false), 1200);
      return () => window.clearTimeout(timer);
    }
  }, [draftValue, inputPending, loading, manualTemperatureText]);

  useEffect(() => {
    if (!mobileSummary) {
      return;
    }

    setShowMobileReferenceEditor(referenceMode === "manual");
  }, [mobileSummary, referenceMode]);

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
  const headerTitle = mobileSummary ? "贴近实况模型" : UI_TEXT.insight.title;
  const detailsLabel = mobileSummary ? "看分析" : UI_TEXT.insight.openDetails;
  const mobileReferenceToggleLabel = showMobileReferenceEditor
    ? "收起调整"
    : referenceMode === "manual"
      ? "修改手动温度"
      : "调整参考温度";
  const currentReferenceStat = (
    <div className="insight-reference-stat px-2.5 py-2">
      <div className="eyebrow">{UI_TEXT.insight.currentReference}</div>
      <div className="data-mono mt-1 text-lg font-semibold text-white">
        {formatTemperature(actualTemperatureC, displayUnit)}
      </div>
      <div className="mt-1 text-[11px] leading-4 text-white/54">{UI_TEXT.insight.source} {referenceLabel}</div>
    </div>
  );
  const weatherTimestampStat = (
    <div className="insight-reference-stat border-t border-white/7 px-2.5 py-2">
      <div className="eyebrow">{WEATHER_TIMESTAMP_LABEL}</div>
      <div className="data-mono mt-1 text-lg font-semibold text-white">
        {selectedWeatherTimestamp ? formatTime(selectedWeatherTimestamp, locationTimezone) : "--"}
      </div>
      <div className="mt-1 text-[11px] leading-4 text-white/54">{weatherTimestampCaption}</div>
    </div>
  );
  const modelTimestampStat = (
    <div className="insight-reference-stat border-t border-white/7 px-2.5 py-2">
      <div className="eyebrow">{UI_TEXT.insight.modelTimestamp}</div>
      <div className="data-mono mt-1 text-lg font-semibold text-white">
        {selectedModelTimestamp ? formatTime(selectedModelTimestamp, locationTimezone) : "--"}
      </div>
      <div className="mt-1 text-[11px] leading-4 text-white/54">{modelTimestampCaption}</div>
    </div>
  );
  const handleResetTemperature = () => {
    onResetTemperature();
    if (mobileSummary) {
      setShowMobileReferenceEditor(false);
    }
  };
  const referenceEditor = (
    <>
      <div className="mt-2 grid grid-cols-1 gap-2">
        <Input
          value={draftValue}
          onChange={(event) => setDraftValue(event.target.value)}
          placeholder={`${UI_TEXT.insight.temperatureInputPlaceholder} (°${displayUnit})`}
          inputMode="decimal"
        />
        <Button
          type="button"
          variant={referenceMode === "default" ? "default" : "outline"}
          onClick={handleResetTemperature}
        >
          {UI_TEXT.insight.resetDefault}
        </Button>
      </div>

      {mobileSummary ? (
        <div className="mt-2 text-[11px] leading-4 text-white/54">
          {UI_TEXT.insight.modelTimestamp} {selectedModelTimestamp ? formatTime(selectedModelTimestamp, locationTimezone) : "--"} · {modelTimestampCaption}
        </div>
      ) : null}
    </>
  );
  const referenceStats = (
    <div className="insight-micro-stat-grid mt-2 grid grid-cols-1 overflow-hidden rounded-[14px] border border-white/7 bg-white/[0.02]">
      {currentReferenceStat}
      {weatherTimestampStat}
      {mobileSummary ? null : modelTimestampStat}
    </div>
  );

  return (
    <section className="terminal-panel insight-panel insight-panel--compact flex flex-col px-3 py-3">
      <div className="panel-section flex flex-col gap-2.5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="eyebrow flex items-center gap-2">
              <Activity className="h-4 w-4 text-[var(--accent)]" />
              {UI_TEXT.insight.eyebrow}
            </div>
            <h2 className="mt-1.5 text-[1.45rem] font-semibold tracking-[-0.04em] text-white">{headerTitle}</h2>
            <p className="insight-panel__description mt-1 max-w-[30rem] text-sm leading-6 text-white/58">{UI_TEXT.insight.description}</p>
          </div>

          <Button type="button" variant="secondary" size="sm" onClick={onOpenDetails}>
            {detailsLabel}
          </Button>
        </div>

        <div className="insight-reference-panel rounded-[18px] border px-3 py-2.5">
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

          {mobileSummary ? (
            <>
              {referenceStats}

              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => setShowMobileReferenceEditor((current) => !current)}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-white/68 transition hover:border-white/18 hover:bg-white/[0.05] hover:text-white"
                  aria-controls="insight-reference-editor"
                  aria-expanded={showMobileReferenceEditor}
                >
                  {showMobileReferenceEditor ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  {mobileReferenceToggleLabel}
                </button>

                <AnimatePresence initial={false}>
                  {showMobileReferenceEditor ? (
                    <motion.div
                      id="insight-reference-editor"
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.16, ease: "easeOut" }}
                    >
                      {referenceEditor}
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>
            </>
          ) : (
            <>
              {referenceEditor}
              {referenceStats}
            </>
          )}

          {timestamps.length > 0 && !mobileSummary ? (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setShowTimeAnchors((current) => !current)}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-white/68 transition hover:border-white/18 hover:bg-white/[0.05] hover:text-white"
                aria-expanded={showTimeAnchors}
              >
                {showTimeAnchors ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                {showTimeAnchors ? "收起模型时刻" : `展开模型时刻 (${Math.min(timestamps.length, 6)})`}
              </button>

              <AnimatePresence initial={false}>
                {showTimeAnchors ? (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.16, ease: "easeOut" }}
                    className="mt-3 flex flex-wrap gap-2 overflow-hidden"
                  >
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
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          ) : null}
        </div>

        <div className="grid gap-2">
          {featuredMatch ? (
            <>
              <article className={`insight-match-card rounded-[18px] border ${mobileSummary ? "px-2.5 py-2" : "px-3 py-2.5"}`}>
                <div className={`flex flex-wrap justify-between ${mobileSummary ? "gap-2 items-center" : "gap-3 items-start"}`}>
                  <div className={mobileSummary ? "flex min-w-0 flex-1 items-center gap-1.5" : ""}>
                    {mobileSummary ? null : <div className="eyebrow">{`${UI_TEXT.insight.candidatePrefix} 1`}</div>}
                    <div
                      data-insight-model-name={mobileSummary ? "featured" : undefined}
                      className={`${mobileSummary ? "min-w-0 truncate text-sm font-semibold" : "mt-1 text-base font-semibold leading-5"} text-white`}
                    >
                      {featuredMatch.modelName}
                    </div>
                    {mobileSummary ? <span className="text-[9px] text-white/30">首位匹配</span> : null}
                  </div>

                  <div
                    className={
                      mobileSummary
                        ? "shrink-0 text-[10px] text-white/44"
                        : "rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-white/58"
                    }
                  >
                    {UI_TEXT.analysis.deviation}{" "}
                    {formatTemperatureDelta(featuredMatch.deltaToActualTemperatureC, displayUnit, 1, true)}
                  </div>
                </div>

                <div
                  className={`insight-micro-stat-grid ${mobileSummary ? "mt-1 rounded-[12px] border-white/5 bg-white/[0.012]" : "mt-2 rounded-[14px] border-white/7 bg-white/[0.02]"} grid grid-cols-1 overflow-hidden border`}
                >
                  <div className={`insight-match-metric ${mobileSummary ? "px-2.5 py-1.5" : "px-2.5 py-2"}`}>
                    <div className="eyebrow">{mobileSummary ? "现在" : UI_TEXT.insight.currentPrediction}</div>
                    <div className={`data-mono ${mobileSummary ? "mt-0.5" : "mt-1"} text-lg font-semibold text-white`}>
                      {formatTemperature(featuredMatch.currentTemperatureC, displayUnit)}
                    </div>
                  </div>

                  <div className={`insight-match-metric border-t ${mobileSummary ? "border-white/5 px-2.5 py-1.5" : "border-white/7 px-2.5 py-2"}`}>
                    <div className="eyebrow">{mobileSummary ? "最高" : UI_TEXT.insight.peakTemperature}</div>
                    <div className={`data-mono ${mobileSummary ? "mt-0.5" : "mt-1"} text-lg font-semibold text-white`}>
                      {formatTemperature(featuredMatch.dayPeakTemperatureC, displayUnit)}
                    </div>
                  </div>

                  {mobileSummary ? null : (
                    <div className="insight-match-metric border-t border-white/7 px-2.5 py-2">
                      <div className="eyebrow">{UI_TEXT.insight.peakWindow}</div>
                      <div className="data-mono mt-1 text-lg font-semibold text-white">
                        {featuredMatch.dayPeakTimestamp ? formatTime(featuredMatch.dayPeakTimestamp, locationTimezone) : "--"}
                      </div>
                    </div>
                  )}
                </div>

                {mobileSummary ? (
                  <div className="mt-0.5 text-[10px] leading-4 text-white/46">
                    {featuredMatch.dayPeakTimestamp
                      ? `峰值约 ${formatTime(featuredMatch.dayPeakTimestamp, locationTimezone)}`
                      : "峰值时段待定"}
                  </div>
                ) : null}
              </article>

              {remainingMatches.length > 0 && !mobileSummary ? (
                <div className="rounded-[16px] border border-white/8 bg-black/20 px-3 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="eyebrow">其余候选</div>
                    <button
                      type="button"
                      onClick={() => setShowMoreMatches((current) => !current)}
                      className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-white/68 transition hover:border-white/18 hover:bg-white/[0.05] hover:text-white"
                      aria-expanded={showMoreMatches}
                    >
                      {showMoreMatches ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      {showMoreMatches ? "收起其余候选" : `展开另外 ${remainingMatches.length} 个`}
                    </button>
                  </div>

                  <AnimatePresence initial={false}>
                    {showMoreMatches ? (
                      <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.16, ease: "easeOut" }}
                        className="mt-3 grid gap-2 overflow-hidden"
                      >
                        {remainingMatches.map((model, index) => (
                          <div key={`${model.modelName}-${model.dayPeakTimestamp ?? "none"}`} className="insight-match-metric rounded-[14px] border px-3 py-2">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div className="eyebrow">{UI_TEXT.insight.candidatePrefix} {index + 2}</div>
                                <div className="mt-1 text-base font-semibold text-white">{model.modelName}</div>
                              </div>

                              <div className="text-xs text-white/58">
                                {UI_TEXT.analysis.deviation} {formatTemperatureDelta(model.deltaToActualTemperatureC, displayUnit, 1, true)}
                              </div>
                            </div>

                            <div className="mt-2 grid gap-1.5 text-xs text-white/66">
                              <div>{UI_TEXT.insight.currentPrediction} {formatTemperature(model.currentTemperatureC, displayUnit)}</div>
                              <div>{UI_TEXT.insight.peakTemperature} {formatTemperature(model.dayPeakTemperatureC, displayUnit)}</div>
                              <div>{UI_TEXT.insight.peakWindow} {model.dayPeakTimestamp ? formatTime(model.dayPeakTimestamp, locationTimezone) : "--"}</div>
                            </div>
                          </div>
                        ))}
                      </motion.div>
                    ) : (
                      <div className="mt-2 text-sm leading-6 text-white/54">
                        默认只展开最贴近实况的首位模型，其余候选按需查看。
                      </div>
                    )}
                  </AnimatePresence>
                </div>
              ) : null}
            </>
          ) : (
            <div className="insight-empty rounded-[24px] border px-4 py-5 text-sm leading-7 text-white/58">
              {UI_TEXT.insight.waitingResult}
            </div>
          )}
        </div>

        {mobileSummary ? null : (
          <div className="insight-footer flex flex-wrap items-center justify-between gap-3 rounded-[16px] border px-3 py-2 text-xs text-white/54">
            <span className="min-w-0 leading-5">{UI_TEXT.insight.footer}</span>
            <Button type="button" variant="ghost" size="sm" onClick={onOpenDetails}>
              {UI_TEXT.insight.enterAnalysis}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        )}

        {error ? <div className="text-sm text-[var(--warning)]">{error}</div> : null}
      </div>
    </section>
  );
};
