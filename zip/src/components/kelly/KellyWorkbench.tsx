import { Orbit, Radar, RefreshCw } from "lucide-react";
import { useMemo } from "react";

import type { KellyWorkbenchProps } from "@/lib/kelly";
import { cn } from "@/lib/utils";
import { KellyControlBar } from "./KellyControlBar";
import { KellyEvidenceInspector } from "./KellyEvidenceInspector";
import { KellyFrameAnalysis } from "./KellyFrameAnalysis";
import { KellyMarketTable } from "./KellyMarketTable";
import { KellyOpportunityPanel } from "./KellyOpportunityPanel";
import { KellyProbabilityStage } from "./KellyProbabilityStage";
import { KellySummaryStrip } from "./KellySummaryStrip";
import "./kelly-workbench.css";

const syncToneClassMap = {
  neutral: "text-white/72",
  accent: "text-[var(--accent)]",
  success: "text-[var(--success)]",
  warning: "text-[var(--warning)]",
  danger: "text-[var(--danger)]",
} as const;

export const KellyWorkbench = ({
  data,
  className,
  selectedMarketId,
  selectedOpportunityId,
  selectedFrameId,
  disabled = false,
  refreshing = false,
  onLocationChange,
  onTargetDateChange,
  onBankrollChange,
  onMinEdgeChange,
  onRiskModeChange,
  onRefresh,
  onSelectOpportunity,
  onSelectMarket,
  onSelectFrame,
}: KellyWorkbenchProps) => {
  const resolvedSelectedMarketId = useMemo(() => {
    if (selectedMarketId) {
      return selectedMarketId;
    }

    if (selectedOpportunityId) {
      const match = data.opportunities.find((opportunity) => opportunity.id === selectedOpportunityId);
      if (match?.marketId) {
        return match.marketId;
      }
    }

    return data.opportunities.find((opportunity) => opportunity.tier === "primary")?.marketId ?? data.markets[0]?.id ?? null;
  }, [data.markets, data.opportunities, selectedMarketId, selectedOpportunityId]);

  const handleSelectOpportunity = (opportunityId: string) => {
    onSelectOpportunity?.(opportunityId);

    const match = data.opportunities.find((opportunity) => opportunity.id === opportunityId);
    if (match?.marketId) {
      onSelectMarket?.(match.marketId);
    }
  };

  return (
    <section className={cn("terminal-panel kelly-shell", className)}>
      <div className="panel-section kelly-shell__inner">
        <header className="kelly-shell__header">
          <div className="kelly-shell__hero">
            <div className="eyebrow flex items-center gap-2">
              <Orbit className="h-4 w-4 text-[var(--accent)]" />
              Market Lab / Kelly
            </div>
            <h2 className="kelly-shell__title">{data.title}</h2>
            <p className="kelly-shell__subtitle">{data.subtitle}</p>
          </div>

          <div className="kelly-sync-strip">
            {data.syncMetrics.map((metric) => (
              <article key={metric.id} className="kelly-sync-card">
                <div className="kelly-sync-card__label">{metric.label}</div>
                <div className={cn("kelly-sync-card__value data-mono", syncToneClassMap[metric.tone ?? "neutral"])}>
                  {metric.value}
                </div>
                {metric.detail ? <div className="kelly-sync-card__detail">{metric.detail}</div> : null}
              </article>
            ))}
          </div>
        </header>

        <div className="kelly-shell__hint">
          <span className="kelly-shell__hint-badge">
            <Radar className="h-3.5 w-3.5" />
            UI skeleton only
          </span>
          <span>组件树已经给出控制条、摘要、机会位、概率主视觉、盘口表、证据 inspector、逐帧分析的接线口。</span>
          <span className="kelly-shell__hint-status">
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            {refreshing ? "Waiting for new synthesis" : "Ready for real data"}
          </span>
        </div>

        <KellyControlBar
          data={data}
          disabled={disabled}
          refreshing={refreshing}
          onLocationChange={onLocationChange}
          onTargetDateChange={onTargetDateChange}
          onBankrollChange={onBankrollChange}
          onMinEdgeChange={onMinEdgeChange}
          onRiskModeChange={onRiskModeChange}
          onRefresh={onRefresh}
        />

        <KellySummaryStrip metrics={data.summaryMetrics} />

        <div className="kelly-layout">
          <div className="kelly-main-column">
            <KellyOpportunityPanel
              opportunities={data.opportunities}
              selectedMarketId={resolvedSelectedMarketId}
              selectedOpportunityId={selectedOpportunityId}
              onSelectOpportunity={handleSelectOpportunity}
            />

            <KellyProbabilityStage
              probability={data.probability}
              selectedMarketId={resolvedSelectedMarketId}
            />

            <KellyMarketTable
              markets={data.markets}
              selectedMarketId={resolvedSelectedMarketId}
              onSelectMarket={onSelectMarket}
            />
          </div>

          <aside className="kelly-side-column">
            <KellyEvidenceInspector
              sections={data.evidenceSections}
              methodologyNotes={data.methodologyNotes}
            />
            <KellyFrameAnalysis
              groups={data.frameAnalysisGroups}
              selectedFrameId={selectedFrameId}
              onSelectFrame={onSelectFrame}
            />
          </aside>
        </div>
      </div>
    </section>
  );
};
