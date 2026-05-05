import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, ChevronUp, Orbit } from "lucide-react";

import type { KellyWorkbenchProps } from "@/lib/kelly";
import { formatKellyPercent, formatKellySignedPercent, formatKellyUsd } from "@/lib/kelly";
import { cn } from "@/lib/utils";
import { KellyControlBar } from "./KellyControlBar";
import { KellyEvidenceInspector } from "./KellyEvidenceInspector";
import { KellyMarketTable } from "./KellyMarketTable";
import { KellyOpportunityPanel } from "./KellyOpportunityPanel";
import { KellySummaryStrip } from "./KellySummaryStrip";
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
  const [showControls, setShowControls] = useState(false);
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
  const primaryOpportunity =
    data.opportunities.find((opportunity) => opportunity.tier === "primary") ?? data.opportunities[0] ?? null;
  const selectedMarket =
    data.markets.find((market) => market.id === resolvedSelectedMarketId) ??
    data.inactiveMarkets?.find((market) => market.id === resolvedSelectedMarketId) ??
    null;

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

        <KellySummaryStrip metrics={data.summaryMetrics} />

        <section className="kelly-block kelly-priority-band">
          <div className="kelly-block__header">
            <div>
              <div className="eyebrow">执行优先级</div>
              <h3 className="kelly-block__title">先确认主仓，再决定是否进入完整盘口</h3>
            </div>
            <div className="text-sm text-white/48">主仓建议、当前活跃档位与参数入口放在同一层，减少首屏来回切换。</div>
          </div>

          <div className="kelly-priority-grid">
            <article className="kelly-priority-card is-primary">
              <div className="kelly-priority-card__eyebrow">主仓结论</div>
              <strong className="kelly-priority-card__title">
                {primaryOpportunity?.marketLabel ?? data.opportunityEmptyState ?? "当前没有过线机会"}
              </strong>
              <p className="kelly-priority-card__copy">
                {primaryOpportunity?.thesis ?? "当前先保留观察位，等待 edge 与流动性同步。"}
              </p>
              <div className="kelly-priority-card__metrics">
                <div>
                  <span>方向</span>
                  <strong>{primaryOpportunity?.side ? `买 ${primaryOpportunity.side === "yes" ? "Yes" : primaryOpportunity.side === "no" ? "No" : "观察"}` : "--"}</strong>
                </div>
                <div>
                  <span>主侧优势</span>
                  <strong className="data-mono">{formatKellySignedPercent(primaryOpportunity?.edgePct)}</strong>
                </div>
                <div>
                  <span>建议金额</span>
                  <strong className="data-mono">{formatKellyUsd(primaryOpportunity?.suggestedStakeUsd)}</strong>
                </div>
              </div>
            </article>

            <article className="kelly-priority-card">
              <div className="kelly-priority-card__eyebrow">当前活跃盘口</div>
              <strong className="kelly-priority-card__title">
                {selectedMarket?.shortLabel ?? selectedMarket?.label ?? "等待选中档位"}
              </strong>
              <p className="kelly-priority-card__copy">
                {selectedMarket?.recommendation
                  ? `${selectedMarket.recommendation} / ${selectedMarket.recommendationSide ?? "观察"}`
                  : "点击主表中的档位，展开双边价格与补充说明。"}
              </p>
              <div className="kelly-priority-card__metrics">
                <div>
                  <span>建议下注</span>
                  <strong className="data-mono">{formatKellyUsd(selectedMarket?.suggestedStakeUsd)}</strong>
                </div>
                <div>
                  <span>盘口宽度</span>
                  <strong className="data-mono">
                    {selectedMarket?.spreadLabel ?? formatKellyPercent(selectedMarket?.spreadPct)}
                  </strong>
                </div>
                <div>
                  <span>刷新时间</span>
                  <strong>{selectedMarket?.updatedAtLabel ?? "--"}</strong>
                </div>
              </div>
            </article>
          </div>

          <div className="kelly-priority-actions">
            <button
              type="button"
              className="kelly-priority-toggle"
              aria-expanded={showControls}
              onClick={() => setShowControls((current) => !current)}
            >
              <span>{showControls ? "收起完整参数" : "展开参数与风险控制"}</span>
              {showControls ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>

            {data.statusNote ? <div className="kelly-priority-note">{data.statusNote}</div> : null}
          </div>
        </section>

        <AnimatePresence initial={false}>
          {showControls ? (
            <motion.div
              initial={{ opacity: 0, height: 0, y: -6 }}
              animate={{ opacity: 1, height: "auto", y: 0 }}
              exit={{ opacity: 0, height: 0, y: -6 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
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
            </motion.div>
          ) : null}
        </AnimatePresence>

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
              selectionKey={resolvedSelectedMarketId}
            />
          </aside>
        </div>
      </div>
    </section>
  );
};
