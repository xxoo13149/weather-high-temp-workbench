import { Activity, Clock3, Database, ExternalLink, ShieldCheck, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { formatLocalDateTimeLabel } from "../lib/aviation-display";
import { HOME_DETAIL_ID, HOME_DETAIL_SLOT, HOME_DETAIL_SOURCE } from "../lib/home-detail-contract";
import { buildMetarReaderUrl } from "../lib/metar-reader";
import { resolveMultiModelAnalysisReadState, resolveSourceReadState } from "../lib/source-read-state";
import type {
  DashboardMetarSnapshot,
  DashboardResponse,
  DashboardSourceMetadata,
  DashboardTafSnapshot,
  HourlyWeatherResponse,
  KellyTemperatureUnit,
  MultiModelInsightResponse,
  WeatherReportResponse,
} from "../types";
import { formatTemperature } from "../utils";

type CapabilityStatus = DashboardSourceMetadata["contract"]["currentSources"]["baselineForecast"]["status"];
type FreshnessState = DashboardSourceMetadata["freshness"]["hourly"];

type SourceRow = {
  id: string;
  label: string;
  provider: string;
  website: string;
  stationCode: string | null;
  status: CapabilityStatus;
  freshness: FreshnessState | null;
  hasRuntimeData: boolean;
  observedAt: string | null;
  readAt: string | null;
  sourceUrl: string | null;
  sourceLinks: {
    label: string;
    url: string;
    ariaLabel: string;
  }[];
  detail: string;
  runtimeNote: string;
};

const statusLabel: Record<CapabilityStatus, string> = {
  production: "生产已接入",
  planned: "计划/试运行",
  candidate: "候选待接入",
  unavailable: "当前不可用",
};

const statusClassName: Record<CapabilityStatus, string> = {
  production: "border-[rgba(138,240,194,0.24)] bg-[rgba(138,240,194,0.1)] text-[var(--success)]",
  planned: "border-[rgba(242,183,109,0.24)] bg-[rgba(242,183,109,0.1)] text-[var(--warning)]",
  candidate: "border-white/12 bg-white/[0.04] text-white/68",
  unavailable: "border-[rgba(255,107,107,0.2)] bg-[rgba(255,107,107,0.08)] text-[var(--danger)]",
};

const formatTimeLabel = (value: string | null | undefined, timeZone?: string) =>
  value ? formatLocalDateTimeLabel(value, timeZone) : "等待下一次读取";

const compactStationLabel = (row: SourceRow) => row.stationCode ?? row.provider;

const buildAviationWeatherRawUrl = (kind: "metar" | "taf", stationCode: string | null | undefined) =>
  stationCode
    ? `https://aviationweather.gov/api/data/${kind}?format=raw&ids=${encodeURIComponent(stationCode)}`
    : null;

export const HomeReferenceCard = ({
  hourly,
  metar,
  taf,
  report,
  multimodel,
  insight,
  sourceMetadata,
  pageUrl,
  displayUnit,
  locationTimezone,
  mobileSummary = false,
}: {
  hourly: Pick<HourlyWeatherResponse, "fetchedAt" | "sourceObservedAt" | "freshness" | "pageUrl" | "sourceType" | "items">;
  metar: DashboardMetarSnapshot | null | undefined;
  taf: DashboardTafSnapshot | null | undefined;
  report: Pick<WeatherReportResponse, "fetchedAt" | "sourceObservedAt" | "freshness" | "pageUrl">;
  multimodel: Pick<
    DashboardResponse["multimodel"],
    "displayUpdatedAt" | "freshness" | "imageFetchedAt" | "pageFetchedAt" | "pageUrl"
  >;
  insight: Pick<
    MultiModelInsightResponse,
    "fetchedAt" | "freshness" | "modelCount" | "pageUrl" | "rankedModels" | "sourceProof"
  > | null;
  sourceMetadata: DashboardSourceMetadata;
  pageUrl: string;
  displayUnit: KellyTemperatureUnit;
  locationTimezone?: string;
  mobileSummary?: boolean;
}) => {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const observation = metar?.observation ?? null;
  const tafForecast = taf?.forecast ?? null;
  const contract = sourceMetadata.contract;
  const primaryMetarStationCode = contract.currentSources.primaryObservation.stationCode;
  const metarReaderUrl = buildMetarReaderUrl(primaryMetarStationCode);
  const multimodelAnalysisReadState = resolveMultiModelAnalysisReadState(insight);
  const hasMultiModelInsight = multimodelAnalysisReadState.hasRuntimeData;
  const multimodelReadAt = multimodelAnalysisReadState.readAt;
  const multimodelObservedAt = multimodelAnalysisReadState.observedAt;

  const rows = useMemo<SourceRow[]>(
    () => {
      const hourlySourceUrl = hourly.pageUrl || pageUrl;
      const metarSourceUrl =
        observation?.sourceUrl ?? buildAviationWeatherRawUrl("metar", primaryMetarStationCode);
      const multimodelSourceUrl = insight?.pageUrl ?? multimodel.pageUrl;
      const tafSourceUrl =
        tafForecast?.officialSourceUrl ??
        tafForecast?.sourceUrl ??
        buildAviationWeatherRawUrl("taf", contract.targetUpgrades.taf.stationCode);

      return [
        {
          id: "hourly",
          label: "小时预报",
          provider: "Meteoblue",
          website: "meteoblue.com",
          stationCode: null,
          status: contract.currentSources.baselineForecast.status,
          freshness: hourly.freshness,
          hasRuntimeData: hourly.items.length > 0,
          observedAt: hourly.sourceObservedAt ?? report.sourceObservedAt,
          readAt: hourly.fetchedAt,
          sourceUrl: hourlySourceUrl,
          sourceLinks: hourlySourceUrl
            ? [{ label: "打开来源", url: hourlySourceUrl, ariaLabel: "打开小时预报来源" }]
            : [],
          detail: contract.currentSources.baselineForecast.detail,
          runtimeNote: `来源类型：${hourly.sourceType}；天气摘要读取：${formatTimeLabel(report.fetchedAt, locationTimezone)}`,
        },
        {
          id: "metar",
          label: "机场实况 METAR",
          provider: "AviationWeather",
          website: "aviationweather.gov",
          stationCode: primaryMetarStationCode,
          status: contract.currentSources.primaryObservation.status,
          freshness: observation?.freshness ?? null,
          hasRuntimeData: Boolean(observation),
          observedAt: observation?.observedAt ?? null,
          readAt: observation?.fetchedAt ?? null,
          sourceUrl: metarSourceUrl,
          sourceLinks: [
            ...(metarSourceUrl
              ? [{ label: "原始 METAR", url: metarSourceUrl, ariaLabel: "打开 AviationWeather 原始 METAR" }]
              : []),
            ...(metarReaderUrl
              ? [{ label: "METAR Reader", url: metarReaderUrl, ariaLabel: `打开 ${primaryMetarStationCode} METAR Reader` }]
              : []),
          ],
          detail: contract.currentSources.primaryObservation.detail,
          runtimeNote: observation
            ? `最新气温 ${formatTemperature(observation.temperatureC, displayUnit)}，露点 ${formatTemperature(
                observation.dewpointC,
                displayUnit,
              )}`
            : "当前还没有拿到可用实况。",
        },
        {
          id: "multimodel",
          label: "多模型参考",
          provider: "Meteoblue",
          website: "meteoblue.com",
          stationCode: null,
          status: contract.currentSources.modelEnvelope.status,
          freshness: insight?.freshness ?? multimodel.freshness,
          hasRuntimeData: hasMultiModelInsight,
          observedAt: multimodelObservedAt,
          readAt: multimodelReadAt,
          sourceUrl: multimodelSourceUrl,
          sourceLinks: multimodelSourceUrl
            ? [{ label: "打开来源", url: multimodelSourceUrl, ariaLabel: "打开多模型来源" }]
            : [],
          detail: contract.currentSources.modelEnvelope.detail,
          runtimeNote: hasMultiModelInsight
            ? `已解析 ${insight?.modelCount ?? insight?.rankedModels.length ?? 0} 个模型，用于核对最高温时间和温度区间是否一致。`
            : "用于核对不同模型对最高温时间和温度区间是否一致。",
        },
        {
          id: "taf",
          label: "机场预报 TAF",
          provider: "AviationWeather",
          website: "aviationweather.gov",
          stationCode: contract.targetUpgrades.taf.stationCode,
          status: contract.targetUpgrades.taf.status,
          freshness: tafForecast?.freshness ?? null,
          hasRuntimeData: Boolean(tafForecast),
          observedAt: tafForecast?.issuedAt ?? null,
          readAt: tafForecast?.fetchedAt ?? null,
          sourceUrl: tafSourceUrl,
          sourceLinks: tafSourceUrl
            ? [{ label: "打开来源", url: tafSourceUrl, ariaLabel: "打开 TAF 来源" }]
            : [],
          detail: contract.targetUpgrades.taf.detail,
          runtimeNote:
            typeof tafForecast?.dailySummary?.maxTemperatureC === "number"
            ? `本报发布了 TX 最高温组：${formatTemperature(tafForecast.dailySummary.maxTemperatureC, displayUnit)}`
            : "若原始 TAF 未发布 TX/TN 极值组，这里只显示风、云和天气现象信号。",
        },
      ];
    },
    [
      contract,
      displayUnit,
      hasMultiModelInsight,
      hourly,
      insight,
      locationTimezone,
      metarReaderUrl,
      multimodel,
      multimodelObservedAt,
      multimodelReadAt,
      observation,
      pageUrl,
      primaryMetarStationCode,
      report,
      tafForecast,
    ],
  );

  const readableCount = rows.filter((row) => row.hasRuntimeData).length;
  const primaryStation = contract.settlementReference.stationCode ?? contract.settlementReference.label;
  const freshestReadAt = rows
    .map((row) => row.readAt)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
  const visibleRows = mobileSummary ? rows.slice(0, 1) : rows;
  const hiddenRowCount = Math.max(rows.length - visibleRows.length, 0);
  const useMobileDetailSheet = mobileSummary;

  const detailModal =
    typeof document !== "undefined"
      ? createPortal(
          <AnimatePresence>
            {detailsOpen ? (
              <motion.div
                className={`fixed inset-0 z-[80] bg-black/62 backdrop-blur-md ${
                  useMobileDetailSheet ? "flex items-end" : "flex items-center justify-center px-3 py-5 sm:px-5"
                }`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setDetailsOpen(false)}
              >
                <motion.div
                  role="dialog"
                  aria-modal="true"
                  aria-label="数据源读取详情"
                  data-home-detail-layer={HOME_DETAIL_ID.referenceDetails}
                  className={`terminal-panel flex w-full flex-col overflow-hidden ${
                    useMobileDetailSheet
                      ? "max-h-[86dvh] rounded-t-[30px] border-x-0 border-b-0"
                      : "max-h-[min(88dvh,760px)] max-w-4xl"
                  }`}
                  initial={useMobileDetailSheet ? { opacity: 0, y: 28 } : { opacity: 0, y: 28, scale: 0.98 }}
                  animate={useMobileDetailSheet ? { opacity: 1, y: 0 } : { opacity: 1, y: 0, scale: 1 }}
                  exit={useMobileDetailSheet ? { opacity: 0, y: 18 } : { opacity: 0, y: 18, scale: 0.985 }}
                  transition={{ duration: 0.22, ease: "easeOut" }}
                  onClick={(event) => event.stopPropagation()}
                >
                  <div
                    className="panel-section flex items-start justify-between gap-4 border-b border-white/8 px-5 py-5"
                    data-home-detail-slot={HOME_DETAIL_SLOT.summary}
                  >
                    <div>
                      <div className="eyebrow flex items-center gap-2">
                        <Database className="h-4 w-4 text-[var(--accent)]" />
                        数据源读取详情
                      </div>
                      <div className="mt-2 text-2xl font-semibold text-white">当前站点：{primaryStation}</div>
                      <div className="mt-2 text-sm leading-6 text-white/56">
                        首页只显示摘要；这里展开每个数据源的网站、接入状态、读取状态和最近时间点。
                      </div>
                    </div>

                    <button
                      type="button"
                      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-white/66 transition hover:border-white/18 hover:bg-white/[0.06] hover:text-white"
                      aria-label="关闭数据源详情"
                      onClick={() => setDetailsOpen(false)}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div
                    className="panel-section min-h-0 flex-1 overflow-y-auto px-5 py-5"
                    data-home-detail-slot={HOME_DETAIL_SLOT.sourceList}
                  >
                    <div className="grid gap-3">
                      {rows.map((row) => {
                        const state = resolveSourceReadState(row.freshness, row.hasRuntimeData);

                        return (
                          <div
                            key={row.id}
                            className="rounded-[22px] border border-white/8 bg-[rgba(12,18,29,0.96)] px-4 py-4"
                            data-home-detail-source={HOME_DETAIL_SOURCE.referenceRow}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div className="text-base font-semibold text-white">{row.label}</div>
                                <div className="mt-1 text-sm text-white/56">
                                  {row.website}
                                  {row.stationCode ? ` · ${row.stationCode}` : ""}
                                </div>
                              </div>

                              <div className="flex flex-wrap gap-2">
                                <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] ${statusClassName[row.status]}`}>
                                  {statusLabel[row.status]}
                                </span>
                                <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] ${state.className}`}>
                                  {state.label}
                                </span>
                              </div>
                            </div>

                            <div className="mt-4 grid gap-3 text-sm leading-6 text-white/62 sm:grid-cols-2">
                              <div>
                                <span className="text-white/38">读取时间：</span>
                                {formatTimeLabel(row.readAt, locationTimezone)}
                              </div>
                              <div>
                                <span className="text-white/38">源时间：</span>
                                {formatTimeLabel(row.observedAt, locationTimezone)}
                              </div>
                            </div>

                            <div className="mt-3 text-sm leading-6 text-white/64">{row.detail}</div>
                            <div className="mt-2 text-xs leading-5 text-white/48">{row.runtimeNote}</div>

                            {row.sourceLinks.length > 0 ? (
                              <div className="mt-4 flex flex-wrap gap-2">
                                {row.sourceLinks.map((link) => (
                                  <a
                                    key={`${row.id}-${link.url}`}
                                    href={link.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    aria-label={link.ariaLabel}
                                    className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/62 transition hover:border-white/18 hover:bg-white/[0.06] hover:text-white"
                                  >
                                    {link.label}
                                    <ExternalLink className="h-3.5 w-3.5" />
                                  </a>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </motion.div>
              </motion.div>
            ) : null}
          </AnimatePresence>,
          document.body,
        )
      : null;

  return (
    <section className="terminal-panel home-reference-card--compact flex flex-col px-3 py-2.5">
      <div className="panel-section flex flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="eyebrow flex items-center gap-2 text-white/50">
              <ShieldCheck className="h-4 w-4 text-[var(--accent-secondary)]" />
              数据源状态
            </div>
            <div className="mt-1.5 text-lg font-semibold text-white">{readableCount}/{rows.length} 路在线基线</div>
            <div className="home-reference-card__description mt-1 max-w-[21rem] text-sm leading-6 text-white/52">
              先确认当前结论依赖哪些源在线，详细站点与读取时间放在详情里。
            </div>
          </div>

          <div className="flex min-w-0 flex-col items-start gap-1.5">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-white/62">
              <Clock3 className="h-3.5 w-3.5 text-[var(--warning)]" />
              {freshestReadAt ? formatTimeLabel(freshestReadAt, locationTimezone) : "等待读取"}
            </span>
            <button
              type="button"
              data-home-detail-trigger={HOME_DETAIL_ID.referenceDetails}
              data-home-detail-source={HOME_DETAIL_SOURCE.referenceSummary}
              className="inline-flex h-7 items-center justify-center gap-1 rounded-full border border-white/10 bg-white/[0.035] px-2.5 text-[11px] font-medium text-white/62 transition hover:border-white/18 hover:bg-white/[0.06] hover:text-white"
              onClick={() => setDetailsOpen(true)}
            >
              <Activity className="h-3.5 w-3.5 text-[var(--accent)]" />
              详情
            </button>
            {metarReaderUrl ? (
              <a
                href={metarReaderUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={`打开 ${primaryMetarStationCode} METAR Reader`}
                className="inline-flex h-7 items-center justify-center gap-1 rounded-full border border-white/10 bg-white/[0.035] px-2.5 text-[11px] font-medium text-white/62 transition hover:border-white/18 hover:bg-white/[0.06] hover:text-white"
              >
                <ExternalLink className="h-3.5 w-3.5 text-[var(--accent-secondary)]" />
                机场报文
              </a>
            ) : null}
            <div className="text-[11px] text-white/42">参考站点 {primaryStation}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-1.5">
          {visibleRows.map((row) => {
            const state = resolveSourceReadState(row.freshness, row.hasRuntimeData);

            return (
              <div
                key={row.id}
                onClick={() => setDetailsOpen(true)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setDetailsOpen(true);
                  }
                }}
                role="button"
                tabIndex={0}
                data-home-detail-trigger={HOME_DETAIL_ID.referenceDetails}
                data-home-detail-source={HOME_DETAIL_SOURCE.referenceRow}
                className={`group flex w-full flex-wrap items-start justify-between text-left transition ${
                  mobileSummary
                    ? "gap-1.5 rounded-[12px] border border-white/5 bg-white/[0.015] px-2.5 py-1.5"
                    : "gap-2 rounded-[14px] border border-white/7 bg-white/[0.025] px-2.5 py-2 hover:border-white/14 hover:bg-white/[0.04]"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-xs font-semibold leading-5 text-white">{row.label}</div>
                    <div className="text-[11px] uppercase tracking-[0.12em] text-white/38">{compactStationLabel(row)}</div>
                  </div>
                  <div className="home-reference-card__row-detail mt-1 text-[12px] leading-5 text-white/48">
                    {row.website} · 最新读取 {formatTimeLabel(row.readAt, locationTimezone)}
                  </div>
                  <div className="home-reference-card__row-note mt-1 text-[12px] leading-5 text-white/42">{row.runtimeNote}</div>
                </div>

                <div className="flex items-center gap-1.5">
                  {row.sourceUrl && !mobileSummary ? (
                    <a
                      href={row.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`打开${row.label}来源`}
                      onClick={(event) => event.stopPropagation()}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-white/52 transition hover:border-white/18 hover:bg-white/[0.07] hover:text-white"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ) : null}
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] ${state.className}`}>
                    {state.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

      </div>

      {detailModal}
    </section>
  );
};
