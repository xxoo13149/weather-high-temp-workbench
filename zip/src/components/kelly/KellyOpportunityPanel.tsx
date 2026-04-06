import { ArrowUpRight, Minus, TrendingDown, TrendingUp } from "lucide-react";

import type { KellyOpportunity } from "@/lib/kelly";
import {
  formatKellyPercent,
  formatKellySignedPercent,
  formatKellyUsd,
} from "@/lib/kelly";
import { cn } from "@/lib/utils";

type KellyOpportunityPanelProps = {
  opportunities: KellyOpportunity[];
  selectedMarketId?: string | null;
  selectedOpportunityId?: string | null;
  onSelectOpportunity?: (opportunityId: string) => void;
};

const SIDE_META = {
  yes: {
    label: "YES",
    icon: TrendingUp,
    className: "border-[rgba(107,231,255,0.24)] bg-[rgba(107,231,255,0.08)] text-[var(--accent-strong)]",
  },
  no: {
    label: "NO",
    icon: TrendingDown,
    className: "border-[rgba(255,200,107,0.24)] bg-[rgba(255,200,107,0.08)] text-[var(--warning)]",
  },
  watch: {
    label: "WATCH",
    icon: Minus,
    className: "border-white/10 bg-white/[0.04] text-white/72",
  },
} as const;

const tierMeta = {
  primary: {
    title: "主 / 副仓建议",
    description: "适合执行的机会放在前排。",
  },
  secondary: {
    title: "观察仓 / 备选",
    description: "记录已接近平价或需要再确认的标的。",
  },
} as const;

const renderOpportunityCard = (
  opportunity: KellyOpportunity,
  selected: boolean,
  onSelectOpportunity?: (opportunityId: string) => void,
) => {
  const side = SIDE_META[opportunity.side];
  const Icon = side.icon;

  return (
    <button
      key={opportunity.id}
      type="button"
      className={cn("kelly-opportunity-card", selected && "is-active")}
      onClick={() => onSelectOpportunity?.(opportunity.id)}
    >
      <div className="kelly-opportunity-card__topline">
        <div>
          <div className="eyebrow">{opportunity.title}</div>
          <div className="kelly-opportunity-card__title">{opportunity.marketLabel}</div>
        </div>
        <span className={cn("kelly-side-badge", side.className)}>
          <Icon className="h-3.5 w-3.5" />
          {side.label}
        </span>
      </div>

      <p className="kelly-opportunity-card__thesis">{opportunity.thesis}</p>

      <div className="kelly-opportunity-card__metrics">
        <div>
          <span>Edge</span>
          <strong className="data-mono">{formatKellySignedPercent(opportunity.edgePct)}</strong>
        </div>
        <div>
          <span>Fair</span>
          <strong className="data-mono">{formatKellyPercent(opportunity.fairPricePct)}</strong>
        </div>
        <div>
          <span>Market</span>
          <strong className="data-mono">{formatKellyPercent(opportunity.marketPricePct)}</strong>
        </div>
        <div>
          <span>Stake</span>
          <strong className="data-mono">{formatKellyUsd(opportunity.suggestedStakeUsd)}</strong>
        </div>
      </div>

      <div className="kelly-opportunity-card__footer">
        <div className="kelly-opportunity-card__confidence">
          <span>Kelly</span>
          <strong className="data-mono">{formatKellyPercent(opportunity.kellyPct)}</strong>
          {opportunity.confidenceLabel ? <em>{opportunity.confidenceLabel}</em> : null}
        </div>

        <div className="kelly-opportunity-card__tags">
          {(opportunity.tags ?? []).slice(0, 3).map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      </div>

      <div className="kelly-opportunity-card__reasons">
        {opportunity.reasons.slice(0, 3).map((reason) => (
          <div key={reason}>
            <ArrowUpRight className="h-3.5 w-3.5 text-[var(--accent)]" />
            <span>{reason}</span>
          </div>
        ))}
      </div>
    </button>
  );
};

export const KellyOpportunityPanel = ({
  opportunities,
  selectedMarketId,
  selectedOpportunityId,
  onSelectOpportunity,
}: KellyOpportunityPanelProps) => {
  const groups = {
    primary: opportunities.filter((opportunity) => opportunity.tier === "primary"),
    secondary: opportunities.filter((opportunity) => opportunity.tier === "secondary"),
  };

  return (
    <section className="kelly-block">
      <div className="kelly-block__header">
        <div>
          <div className="eyebrow">Opportunities</div>
          <h3 className="kelly-block__title">主副仓建议</h3>
        </div>
        <div className="text-sm text-white/48">面板已经预留 market id 级别的高亮能力，后面可和市场表、曲线、逐帧分析联动。</div>
      </div>

      <div className="kelly-opportunity-grid">
        {(Object.keys(groups) as Array<keyof typeof groups>).map((key) => (
          <div key={key} className="kelly-opportunity-column">
            <div className="kelly-opportunity-column__header">
              <div className="text-sm font-medium text-white">{tierMeta[key].title}</div>
              <div className="text-xs leading-5 text-white/46">{tierMeta[key].description}</div>
            </div>

            <div className="kelly-opportunity-column__list">
              {groups[key].length > 0 ? (
                groups[key].map((opportunity) =>
                  renderOpportunityCard(
                    opportunity,
                    opportunity.id === selectedOpportunityId || opportunity.marketId === selectedMarketId,
                    onSelectOpportunity,
                  ),
                )
              ) : (
                <div className="kelly-empty-block">当前没有可展示的机会位。</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};
