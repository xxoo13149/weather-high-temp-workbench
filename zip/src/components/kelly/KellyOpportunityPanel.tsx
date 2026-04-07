import { ArrowUpRight, Eye, TrendingDown, TrendingUp } from "lucide-react";

import type { KellyOpportunity } from "@/lib/kelly";
import { formatKellyPercent, formatKellySignedPercent, formatKellyUsd } from "@/lib/kelly";
import { cn } from "@/lib/utils";

type KellyOpportunityPanelProps = {
  opportunities: KellyOpportunity[];
  emptyText?: string | null;
  selectedMarketId?: string | null;
  selectedOpportunityId?: string | null;
  onSelectOpportunity?: (opportunityId: string) => void;
};

const SIDE_META = {
  yes: {
    label: "买 Yes",
    icon: TrendingUp,
    className: "border-[rgba(107,231,255,0.24)] bg-[rgba(107,231,255,0.08)] text-[var(--accent-strong)]",
  },
  no: {
    label: "买 No",
    icon: TrendingDown,
    className: "border-[rgba(255,200,107,0.24)] bg-[rgba(255,200,107,0.08)] text-[var(--warning)]",
  },
  watch: {
    label: "观察",
    icon: Eye,
    className: "border-white/10 bg-white/[0.04] text-white/72",
  },
} as const;

const TIER_META: Record<KellyOpportunity["tier"], { title: string; description: string; empty: string }> = {
  primary: {
    title: "主仓建议",
    description: "优先看的执行位。",
    empty: "当前还没有主仓机会。",
  },
  secondary: {
    title: "副仓建议",
    description: "次一级机会，用来补充主仓。",
    empty: "当前还没有适合作为副仓的机会。",
  },
  watch: {
    title: "观察位",
    description: "保留最值得继续盯盘的一档。",
    empty: "当前没有额外观察位。",
  },
};

const tierOrder: KellyOpportunity["tier"][] = ["primary", "secondary", "watch"];

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
          <span>当前优势</span>
          <strong className="data-mono">{formatKellySignedPercent(opportunity.edgePct)}</strong>
        </div>
        <div>
          <span>我们估值</span>
          <strong className="data-mono">{formatKellyPercent(opportunity.fairPricePct)}</strong>
        </div>
        <div>
          <span>当前可买价</span>
          <strong className="data-mono">{formatKellyPercent(opportunity.marketPricePct)}</strong>
        </div>
        <div>
          <span>建议金额</span>
          <strong className="data-mono">{formatKellyUsd(opportunity.suggestedStakeUsd)}</strong>
        </div>
      </div>

      <div className="kelly-opportunity-card__footer">
        <div className="kelly-opportunity-card__confidence">
          <span>Kelly 仓位</span>
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

const renderEmptySlot = (tier: KellyOpportunity["tier"], emptyText?: string | null) => (
  <div className="kelly-opportunity-placeholder">
    <div className="kelly-opportunity-placeholder__title">{TIER_META[tier].title}</div>
    <p>{tier === "primary" && emptyText ? emptyText : TIER_META[tier].empty}</p>
  </div>
);

export const KellyOpportunityPanel = ({
  opportunities,
  emptyText,
  selectedMarketId,
  selectedOpportunityId,
  onSelectOpportunity,
}: KellyOpportunityPanelProps) => {
  const groups = {
    primary: opportunities.filter((opportunity) => opportunity.tier === "primary"),
    secondary: opportunities.filter((opportunity) => opportunity.tier === "secondary"),
    watch: opportunities.filter((opportunity) => opportunity.tier === "watch"),
  };

  return (
    <section className="kelly-block">
      <div className="kelly-block__header">
        <div>
          <div className="eyebrow">仓位建议</div>
          <h3 className="kelly-block__title">主仓 / 副仓 / 观察位</h3>
        </div>
        <div className="text-sm text-white/48">三个槽位始终保留，就算当前没有执行机会也不会把首屏结构抽空。</div>
      </div>

      <div className="kelly-opportunity-grid">
        {tierOrder.map((tier) => (
          <div key={tier} className="kelly-opportunity-column">
            <div className="kelly-opportunity-column__header">
              <div className="text-sm font-medium text-white">{TIER_META[tier].title}</div>
              <div className="text-xs leading-5 text-white/46">{TIER_META[tier].description}</div>
            </div>

            <div className="kelly-opportunity-column__list">
              {groups[tier].length > 0
                ? groups[tier].map((opportunity) =>
                    renderOpportunityCard(
                      opportunity,
                      opportunity.id === selectedOpportunityId || opportunity.marketId === selectedMarketId,
                      onSelectOpportunity,
                    ),
                  )
                : renderEmptySlot(tier, emptyText)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};
