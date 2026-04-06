import { Activity, ArrowUpRight, Gauge, RefreshCw, Search, ShieldCheck, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deriveKellyRecommendations } from "../kelly";
import type { KellyRecommendation, KellyRiskMode, KellyWorkbenchResponse, LocationDirectoryEntry } from "../types";
import { formatDateTime, formatTime, valueOrDash } from "../utils";

const RISK_OPTIONS: Array<{ value: KellyRiskMode; label: string }> = [
  { value: "conservative", label: "保守" },
  { value: "balanced", label: "平衡" },
  { value: "aggressive", label: "进取" },
];

type FrameEntry = {
  id: string;
  marketId: string;
  title: string;
  side: KellyRecommendation["side"];
  generatedAt: string;
  edge: number;
  fairPrice: number;
  marketPrice: number;
};

const percent = (value: number | null | undefined, digits = 1) =>
  typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : "--";
const price = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? value.toFixed(3) : "--";
const usd = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? `$${value.toFixed(0)}` : "--";

const buildFrameEntry = (recommendation: KellyRecommendation | null, generatedAt: string): FrameEntry | null =>
  recommendation
    ? {
        id: `${generatedAt}:${recommendation.marketId}:${recommendation.side}`,
        marketId: recommendation.marketId,
        title: recommendation.title,
        side: recommendation.side,
        generatedAt,
        edge: recommendation.edge,
        fairPrice: recommendation.fairPrice,
        marketPrice: recommendation.marketPrice,
      }
    : null;

const KellyChart = ({
  snapshot,
  selectedMarketId,
  onSelect,
}: {
  snapshot: KellyWorkbenchResponse;
  selectedMarketId: string | null;
  onSelect: (marketId: string) => void;
}) => {
  const curve = snapshot.probabilityCurve;
  const width = 900;
  const height = 300;
  const padding = { top: 18, right: 18, bottom: 34, left: 24 };
  const minT = curve[0]?.temperatureC ?? 0;
  const maxT = curve[curve.length - 1]?.temperatureC ?? 1;
  const maxDensity = Math.max(...curve.map((point) => point.density), 0.01);
  const span = Math.max(maxT - minT, 1);
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const x = (value: number) => padding.left + ((value - minT) / span) * plotWidth;
  const y = (value: number) => padding.top + plotHeight - (value / maxDensity) * plotHeight;
  const path = curve.map((point, index) => `${index === 0 ? "M" : "L"} ${x(point.temperatureC).toFixed(2)} ${y(point.density).toFixed(2)}`).join(" ");

  return (
    <svg className="h-[260px] w-full" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Kelly probability curve">
      <defs>
        <linearGradient id="kellyCurveFill" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="rgba(154,230,110,0.34)" />
          <stop offset="100%" stopColor="rgba(154,230,110,0.02)" />
        </linearGradient>
      </defs>
      {snapshot.markets.filter((market) => market.parseStatus === "matched").slice(0, 8).map((market) => {
        const start = market.contractType === "atMost" ? minT : (market.bucketStartC ?? minT);
        const end = market.contractType === "atLeast" ? maxT : (market.bucketEndC ?? maxT);
        return (
          <rect
            key={market.marketId}
            x={x(start)}
            y={padding.top}
            width={Math.max(2, x(end) - x(start))}
            height={plotHeight}
            rx="12"
            fill={market.marketId === selectedMarketId ? "rgba(255,200,107,0.14)" : "rgba(107,231,255,0.06)"}
            stroke={market.marketId === selectedMarketId ? "rgba(255,200,107,0.4)" : "rgba(107,231,255,0.14)"}
            onClick={() => onSelect(market.marketId)}
            style={{ cursor: "pointer" }}
          />
        );
      })}
      <path d={`${path} L ${x(maxT)} ${padding.top + plotHeight} L ${x(minT)} ${padding.top + plotHeight} Z`} fill="url(#kellyCurveFill)" />
      <path d={path} fill="none" stroke="rgba(154,230,110,0.92)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

export const KellyWorkbench = ({
  snapshot,
  locations,
  activeLocationId,
  timezone,
  bankroll,
  riskMode,
  minEdge,
  actualTemperatureText,
  loading,
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
  bankroll: number;
  riskMode: KellyRiskMode;
  minEdge: number;
  actualTemperatureText: string;
  loading: boolean;
  error: string | null;
  streamState: string;
  onLocationChange: (locationId: string) => void;
  onTargetDateChange: (targetDate: string) => void;
  onBankrollChange: (bankroll: number | null) => void;
  onRiskModeChange: (riskMode: KellyRiskMode) => void;
  onMinEdgeChange: (minEdge: number | null) => void;
  onActualTemperatureChange: (value: string) => void;
  onRefresh: () => void;
}) => {
  const [selectedMarketId, setSelectedMarketId] = useState<string | null>(null);
  const [frames, setFrames] = useState<FrameEntry[]>([]);
  const lastFrameIdRef = useRef<string | null>(null);
  const recommendations = useMemo(() => deriveKellyRecommendations(snapshot?.markets ?? [], bankroll, riskMode, minEdge), [bankroll, minEdge, riskMode, snapshot?.markets]);
  const activeRecommendations = recommendations.length > 0 ? recommendations : snapshot?.recommendations ?? [];

  useEffect(() => {
    setFrames([]);
    lastFrameIdRef.current = null;
  }, [snapshot?.location.id, snapshot?.targetDate]);

  useEffect(() => {
    if (!snapshot?.markets.length) {
      setSelectedMarketId(null);
      return;
    }
    if (selectedMarketId && snapshot.markets.some((market) => market.marketId === selectedMarketId)) {
      return;
    }
    setSelectedMarketId(snapshot.recommendations[0]?.marketId ?? snapshot.markets[0]?.marketId ?? null);
  }, [selectedMarketId, snapshot]);

  useEffect(() => {
    if (!snapshot) {
      return;
    }
    const focus = activeRecommendations.find((item) => item.marketId === selectedMarketId) ?? activeRecommendations[0] ?? null;
    const frame = buildFrameEntry(focus, snapshot.generatedAt);
    if (!frame || frame.id === lastFrameIdRef.current) {
      return;
    }
    lastFrameIdRef.current = frame.id;
    setFrames((current) => [frame, ...current].slice(0, 10));
  }, [activeRecommendations, selectedMarketId, snapshot]);

  const selectedMarket = snapshot?.markets.find((market) => market.marketId === selectedMarketId) ?? null;
  const locationLabel = locations.find((item) => item.id === activeLocationId)?.displayNameZh ?? locations.find((item) => item.id === activeLocationId)?.displayName ?? snapshot?.location.name ?? "--";

  if (!snapshot && loading) {
    return <section className="terminal-panel flex min-h-[420px] items-center justify-center px-6 py-10"><div className="panel-section text-center"><div className="eyebrow">Kelly 实验台</div><div className="mt-3 text-3xl font-semibold text-white">正在同步天气与盘口</div><div className="mt-3 text-sm text-white/56">先拉取天气证据，再匹配市场并建立实时流。</div></div></section>;
  }
  if (!snapshot) {
    return <section className="terminal-panel flex min-h-[380px] items-center justify-center px-6 py-10"><div className="panel-section max-w-xl text-center"><div className="rounded-full border border-[rgba(255,107,107,0.24)] bg-[rgba(255,107,107,0.08)] px-3 py-1 text-xs text-[var(--danger)]">Kelly 实验台暂不可用</div><div className="mt-4 text-sm leading-6 text-white/62">{error ?? "当前还没有可用的 Kelly 快照。"}</div></div></section>;
  }

  return (
    <section className="flex min-h-0 flex-col gap-4">
      <div className="terminal-panel"><div className="panel-section grid gap-4 px-4 py-4 md:grid-cols-[1.2fr_repeat(6,minmax(0,1fr))] md:px-5">
        <div className="space-y-2"><div className="eyebrow">Kelly 实验台</div><h2 className="text-[clamp(1.35rem,2vw,1.85rem)] font-semibold tracking-[-0.02em] text-white">{locationLabel}</h2><p className="text-sm leading-6 text-white/56">把天气证据、公允概率、盘口价格和 Kelly 建议放到同一工作面。</p><div className="flex flex-wrap gap-2 text-xs text-white/52"><span className="rounded-full border border-white/10 px-2.5 py-1">分析 {formatDateTime(snapshot.generatedAt, timezone)}</span><span className="rounded-full border border-white/10 px-2.5 py-1">实时流 {streamState}</span></div></div>
        <label className="space-y-1.5 text-sm text-white/70"><span className="text-[11px] uppercase tracking-[0.16em] text-white/38">地点</span><select value={activeLocationId} onChange={(event) => onLocationChange(event.target.value)} className="h-11 w-full rounded-[16px] border border-white/10 bg-black/20 px-3 text-white outline-none">{locations.map((location) => <option key={location.id} value={location.id}>{location.displayNameZh || location.displayName}</option>)}</select></label>
        <label className="space-y-1.5 text-sm text-white/70"><span className="text-[11px] uppercase tracking-[0.16em] text-white/38">目标日期</span><select value={snapshot.targetDate} onChange={(event) => onTargetDateChange(event.target.value)} className="h-11 w-full rounded-[16px] border border-white/10 bg-black/20 px-3 text-white outline-none">{snapshot.availableTargetDates.map((date) => <option key={date} value={date}>{date}</option>)}</select></label>
        <label className="space-y-1.5 text-sm text-white/70"><span className="text-[11px] uppercase tracking-[0.16em] text-white/38">本金</span><Input type="number" min="1" step="1" value={Number.isFinite(bankroll) ? String(bankroll) : ""} onChange={(event) => onBankrollChange(event.target.value ? Number.parseFloat(event.target.value) : null)} /></label>
        <label className="space-y-1.5 text-sm text-white/70"><span className="text-[11px] uppercase tracking-[0.16em] text-white/38">风险模式</span><select value={riskMode} onChange={(event) => onRiskModeChange(event.target.value as KellyRiskMode)} className="h-11 w-full rounded-[16px] border border-white/10 bg-black/20 px-3 text-white outline-none">{RISK_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label className="space-y-1.5 text-sm text-white/70"><span className="text-[11px] uppercase tracking-[0.16em] text-white/38">最小 Edge</span><Input type="number" min="0" max="100" step="0.1" value={Number.isFinite(minEdge) ? String(minEdge * 100) : ""} onChange={(event) => onMinEdgeChange(event.target.value ? Number.parseFloat(event.target.value) / 100 : null)} /></label>
        <label className="space-y-1.5 text-sm text-white/70"><span className="text-[11px] uppercase tracking-[0.16em] text-white/38">参考温度</span><Input value={actualTemperatureText} placeholder="留空则使用系统参考温度" onChange={(event) => onActualTemperatureChange(event.target.value)} /></label>
        <div className="flex flex-col gap-2"><Button type="button" onClick={onRefresh} disabled={loading} className="h-11 justify-center"><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />刷新分析</Button><div className="flex items-center justify-center gap-2 rounded-[16px] border border-white/8 bg-white/[0.03] px-3 py-2 text-xs text-white/56"><Activity className="h-4 w-4" />实时流 {streamState}</div></div>
      </div></div>

      {error ? <div className="rounded-[18px] border border-[rgba(255,107,107,0.22)] bg-[rgba(255,107,107,0.08)] px-4 py-3 text-sm text-[var(--danger)]">{error}</div> : null}

      <div className="grid gap-4 xl:grid-cols-[0.92fr_1.35fr_0.95fr]">
        <div className="terminal-panel"><div className="panel-section flex h-full flex-col gap-3 px-4 py-4 md:px-5"><div className="flex items-center gap-2 text-white/62"><ShieldCheck className="h-4 w-4 text-[var(--accent)]" /><span className="text-sm font-medium">主副仓建议</span></div>{[activeRecommendations[0] ?? null, activeRecommendations[1] ?? null].map((recommendation, index) => <button key={recommendation?.marketId ?? index} type="button" onClick={() => recommendation && setSelectedMarketId(recommendation.marketId)} className="rounded-[20px] border border-white/8 bg-white/[0.03] p-4 text-left"><div className="text-[11px] uppercase tracking-[0.18em] text-white/40">{index === 0 ? "Primary" : "Secondary"}</div>{recommendation ? <><div className="mt-3 text-base font-semibold text-white">{recommendation.title}</div><div className="mt-2 flex flex-wrap gap-2 text-xs text-white/54"><span className="rounded-full border border-white/10 px-2 py-0.5 uppercase tracking-[0.12em]">{recommendation.side}</span><span>公允 {price(recommendation.fairPrice)}</span><span>入场 {price(recommendation.marketPrice)}</span></div><div className="mt-3 flex items-end justify-between gap-3"><div className="text-[var(--accent)]">{percent(recommendation.edge, 1)}</div><div className="text-white">{usd(recommendation.suggestedStake)}</div></div><div className="mt-3 text-sm text-white/56">{recommendation.reason}</div></> : <div className="mt-3 text-sm text-white/48">当前没有达到阈值的机会。</div>}</button>)}<div className="rounded-[20px] border border-white/8 bg-white/[0.03] p-4"><div className="text-[11px] uppercase tracking-[0.18em] text-white/40">摘要</div><div className="mt-3 grid gap-3 sm:grid-cols-2 text-sm text-white/62"><div><div className="text-white/40">最可能区间</div><div className="mt-1 text-lg font-semibold text-white">{snapshot.distributionSummary.mostLikelyRangeLabel}</div></div><div><div className="text-white/40">参考温度</div><div className="mt-1 text-lg font-semibold text-white">{valueOrDash(snapshot.weatherEvidence.currentReferenceTemperatureC, "°C")}</div></div><div><div className="text-white/40">模型参与数</div><div className="mt-1 text-lg font-semibold text-white">{snapshot.weatherEvidence.participatingModelCount}</div></div><div><div className="text-white/40">收缩系数</div><div className="mt-1 text-lg font-semibold text-white">{percent(snapshot.distributionSummary.shrink, 1)}</div></div></div></div></div></div>
        <div className="terminal-panel"><div className="panel-section flex h-full flex-col gap-4 px-4 py-4 md:px-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="eyebrow">连续温度分布</div><div className="mt-2 text-lg font-semibold text-white">{snapshot.distributionSummary.mostLikelyRangeLabel}</div><div className="mt-1 text-sm text-white/54">中位 {valueOrDash(snapshot.distributionSummary.medianTemperatureC, "°C")} · 模式 {valueOrDash(snapshot.distributionSummary.modeTemperatureC, "°C")} · 分歧 {valueOrDash(snapshot.distributionSummary.peakSpreadC, "°C")}</div></div><div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-white/58"><TrendingUp className="h-3.5 w-3.5 text-[var(--accent)]" />先看高温落点，再看市场定价</div></div><div className="overflow-hidden rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.01))] p-3"><KellyChart snapshot={snapshot} selectedMarketId={selectedMarketId} onSelect={setSelectedMarketId} /></div><div className="overflow-x-auto"><table className="min-w-full text-left text-sm text-white/72"><thead className="text-[11px] uppercase tracking-[0.14em] text-white/38"><tr><th className="pb-3 pr-4">合约</th><th className="pb-3 pr-4">盘口</th><th className="pb-3 pr-4">公允</th><th className="pb-3 pr-4">Yes edge</th><th className="pb-3 pr-4">No edge</th><th className="pb-3 pr-4">仓位</th></tr></thead><tbody>{[...snapshot.markets].sort((a, b) => Math.max(b.edgeYes, b.edgeNo) - Math.max(a.edgeYes, a.edgeNo)).map((market) => <tr key={market.marketId} className={`border-t border-white/6 ${market.marketId === selectedMarketId ? "bg-white/[0.04]" : ""}`}><td className="py-3 pr-4"><button type="button" className="text-left" onClick={() => setSelectedMarketId(market.marketId)}><div className="font-medium text-white">{market.title}</div><div className="mt-1 text-xs text-white/44">{market.bucketLabel}</div></button></td><td className="py-3 pr-4 data-mono"><div>Yes {price(market.yesBestAsk ?? market.yesPrice)}</div><div className="text-white/46">No {price(market.noBestAsk ?? market.noPrice)}</div></td><td className="py-3 pr-4 data-mono"><div>Yes {price(market.fairYes)}</div><div className="text-white/46">No {price(market.fairNo)}</div></td><td className="py-3 pr-4 data-mono text-[var(--accent)]">{percent(market.edgeYes, 1)}</td><td className="py-3 pr-4 data-mono">{percent(market.edgeNo, 1)}</td><td className="py-3 pr-4 data-mono"><div>{usd(market.suggestedStake)}</div><div className="text-white/46">{market.recommendedSide}</div></td></tr>)}</tbody></table></div></div></div>
        <div className="terminal-panel"><div className="panel-section flex h-full flex-col gap-3 px-4 py-4 md:px-5"><div className="flex items-center gap-2 text-white/62"><Search className="h-4 w-4 text-[var(--accent)]" /><span className="text-sm font-medium">证据与逐帧分析</span></div><div className="rounded-[20px] border border-white/8 bg-white/[0.03] p-4 text-sm text-white/62"><div className="text-[11px] uppercase tracking-[0.18em] text-white/40">天气证据</div><div className="mt-3 space-y-2"><div className="flex justify-between gap-3"><span>参考来源</span><strong className="text-white">{snapshot.weatherEvidence.currentReferenceSource}</strong></div><div className="flex justify-between gap-3"><span>天气时刻</span><strong className="text-white">{formatTime(snapshot.weatherEvidence.currentWeatherTimestamp, timezone)}</strong></div><div className="flex justify-between gap-3"><span>模型时刻</span><strong className="text-white">{formatTime(snapshot.weatherEvidence.targetModelTimestamp, timezone)}</strong></div><div className="flex justify-between gap-3"><span>抓取时间</span><strong className="text-white">{formatDateTime(snapshot.weatherEvidence.fetchedAt, timezone)}</strong></div></div>{snapshot.weatherEvidence.sourceSummaryZh ? <div className="mt-3 rounded-[16px] border border-white/8 bg-black/20 px-3 py-2 leading-6 text-white/58">{snapshot.weatherEvidence.sourceSummaryZh}</div> : null}</div><div className="rounded-[20px] border border-white/8 bg-white/[0.03] p-4 text-sm text-white/62"><div className="text-[11px] uppercase tracking-[0.18em] text-white/40">回查与状态</div><div className="mt-3 space-y-2">{snapshot.sourceStatus.map((status) => <div key={status.kind} className="flex items-start justify-between gap-3"><div><div className="font-medium text-white">{status.label}</div><div className="mt-1 text-xs leading-5 text-white/46">{status.kind === "stream" ? (status.state === "fresh" || streamState === "connected" ? "已收到实时盘口更新。" : "等待前端建立实时订阅。") : (status.detail ?? "--")}</div></div><div className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] uppercase tracking-[0.12em] text-white/56">{status.state}</div></div>)}</div><div className="mt-3 grid gap-2"><a href={snapshot.sourceLinks.meteoblueWeekUrl} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-[14px] border border-white/8 bg-black/20 px-3 py-2 text-white/72"><span>meteoblue 周页</span><ArrowUpRight className="h-4 w-4" /></a><a href={snapshot.sourceLinks.polymarketSearchUrl} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-[14px] border border-white/8 bg-black/20 px-3 py-2 text-white/72"><span>Polymarket 搜索</span><ArrowUpRight className="h-4 w-4" /></a></div></div>{selectedMarket ? <div className="rounded-[20px] border border-white/8 bg-white/[0.03] p-4 text-sm text-white/62"><div className="flex items-center gap-2 text-white/68"><Gauge className="h-4 w-4 text-[var(--accent)]" />当前聚焦</div><div className="mt-2 text-base font-semibold text-white">{selectedMarket.title}</div><div className="mt-2 grid gap-2"><div className="flex justify-between gap-3"><span>推荐方向</span><strong className="text-white">{selectedMarket.recommendedSide}</strong></div><div className="flex justify-between gap-3"><span>盘口 spread</span><strong className="text-white">{percent(selectedMarket.spreadPct, 1)}</strong></div><div className="flex justify-between gap-3"><span>最后更新</span><strong className="text-white">{formatDateTime(selectedMarket.updatedAt, timezone)}</strong></div></div></div> : null}<div className="flex-1 space-y-2 overflow-y-auto pr-1">{frames.length > 0 ? frames.map((frame) => <button key={frame.id} type="button" onClick={() => setSelectedMarketId(frame.marketId)} className={`w-full rounded-[18px] border px-4 py-3 text-left ${frame.marketId === selectedMarketId ? "border-[rgba(154,230,110,0.28)] bg-[rgba(154,230,110,0.08)]" : "border-white/8 bg-white/[0.03]"}`}><div className="flex items-start justify-between gap-3"><div><div className="font-medium text-white">{frame.title}</div><div className="mt-1 text-xs text-white/46">{formatTime(frame.generatedAt, timezone)} · {frame.side.toUpperCase()}</div></div><div className="data-mono text-[var(--accent)]">{percent(frame.edge, 1)}</div></div><div className="mt-2 grid grid-cols-2 gap-2 text-xs text-white/56"><div>市场价 {price(frame.marketPrice)}</div><div>公允价 {price(frame.fairPrice)}</div></div></button>) : <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-6 text-sm text-white/56">等待第一帧实时更新，这里会滚动记录盘口和公允价的变化。</div>}</div></div></div>
      </div>
    </section>
  );
};
