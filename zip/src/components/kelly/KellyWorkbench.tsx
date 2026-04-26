import { useMemo } from "react";
import { Orbit } from "lucide-react";

import type { KellyWorkbenchProps } from "@/lib/kelly";
import { cn } from "@/lib/utils";
import { KellyControlBar } from "./KellyControlBar";
import { KellyEvidenceInspector } from "./KellyEvidenceInspector";
import { KellyMarketTable } from "./KellyMarketTable";
import { KellyOpportunityPanel } from "./KellyOpportunityPanel";
import "./kelly-workbench.css";

export const KellyWorkbench = ({
  data,
  className,
  selectedMarketId,
  selectedOpportunityId,
  disabled = false,
  refreshing = false,
  onLocationChange,
  onTargetDateChange,
  onBankrollChange,
  onMinEdgeChange,
  onActualTemperatureChange,
  onRiskModeChange,
  onRefresh,
  onSelectOpportunity,
  onSelectMarket,
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

    return (
      data.opportunities.find((opportunity) => opportunity.tier === "primary")?.marketId ??
      data.markets[0]?.id ??
      data.inactiveMarkets?.[0]?.id ??
      null
    );
  }, [data.inactiveMarkets, data.markets, data.opportunities, selectedMarketId, selectedOpportunityId]);

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
              <Orbit className={cn("h-4 w-4 text-[var(--accent)] kelly-shell__orbit", refreshing && "is-loading")} />
              Kelly 决策台
            </div>
            <h2 className="kelly-shell__title">{data.title}</h2>
            <p className="kelly-shell__subtitle">{data.subtitle}</p>
          </div>

          <div className={cn("kelly-shell__signal", refreshing && "is-refreshing")}>
            <span className="kelly-shell__signal-dot" />
            {refreshing ? "保持上一份快照并刷新盘口" : "盘口与证据已就绪"}
          </div>
        </header>

        <div className="kelly-date-strip" role="tablist" aria-label="目标日期">
          {data.dateChips.map((chip) => (
            <button
              key={chip.value}
              type="button"
              className={cn("kelly-date-chip", chip.selected && "is-active")}
              disabled={disabled}
              aria-pressed={chip.selected}
              onClick={() => onTargetDateChange?.(chip.value)}
            >
              <span className="kelly-date-chip__label">{chip.label}</span>
              <strong className="kelly-date-chip__short">{chip.shortLabel}</strong>
            </button>
          ))}
        </div>

        <KellyControlBar
          data={data}
          disabled={disabled}
          refreshing={refreshing}
          onLocationChange={onLocationChange}
          onTargetDateChange={onTargetDateChange}
          onBankrollChange={onBankrollChange}
          onMinEdgeChange={onMinEdgeChange}
          onActualTemperatureChange={onActualTemperatureChange}
          onRiskModeChange={onRiskModeChange}
          onRefresh={onRefresh}
        />

        {data.statusNote ? <div className="kelly-status-note">{data.statusNote}</div> : null}

        <div className="kelly-layout">
          <div className="kelly-main-column">
            <KellyOpportunityPanel
              opportunities={data.opportunities}
              emptyText={data.opportunityEmptyState}
              selectedMarketId={resolvedSelectedMarketId}
              selectedOpportunityId={selectedOpportunityId}
              onSelectOpportunity={handleSelectOpportunity}
            />

            <KellyMarketTable
              markets={data.markets}
              inactiveMarkets={data.inactiveMarkets}
              emptyText={data.marketEmptyState}
              selectedMarketId={resolvedSelectedMarketId}
              onSelectMarket={onSelectMarket}
            />
          </div>

          <aside className="kelly-side-column">
            <KellyEvidenceInspector
              syncMetrics={data.syncMetrics}
              sections={data.evidenceSections}
            />
          </aside>
        </div>
      </div>
    </section>
  );
};
