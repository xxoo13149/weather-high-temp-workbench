import { Lock, Radio, Waves } from "lucide-react";

import type { KellyMarketRow } from "@/lib/kelly";
import { formatKellyPercent, formatKellySignedPercent, formatKellyUsd } from "@/lib/kelly";
import { cn } from "@/lib/utils";

type KellyMarketTableProps = {
  markets: KellyMarketRow[];
  inactiveMarkets?: KellyMarketRow[];
  emptyText?: string | null;
  selectedMarketId?: string | null;
  onSelectMarket?: (marketId: string) => void;
};

const statusMeta = {
  tradable: { label: "可交易", icon: Radio },
  thin: { label: "盘口偏薄", icon: Waves },
  locked: { label: "只读", icon: Lock },
} as const;

const formatBlockValue = (value: number | null | undefined, signed = false) =>
  signed ? formatKellySignedPercent(value) : formatKellyPercent(value);

const toComparableValue = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;

const resolveDecisionTone = (market: KellyMarketRow) => {
  if (market.recommendationSide?.includes("Yes")) {
    return "yes";
  }
  if (market.recommendationSide?.includes("No")) {
    return "no";
  }
  return "watch";
};

const resolveFocusMetrics = (market: KellyMarketRow) => {
  const focusSide: "yes" | "no" =
    market.recommendationSide?.includes("Yes")
      ? "yes"
      : market.recommendationSide?.includes("No")
        ? "no"
        : toComparableValue(market.yesEdgePct) >= toComparableValue(market.noEdgePct)
          ? "yes"
          : "no";

  return {
    side: focusSide,
    edgePct: focusSide === "yes" ? market.yesEdgePct : market.noEdgePct,
    kellyPct: focusSide === "yes" ? market.yesKellyPct : market.noKellyPct,
  };
};

const buildSideBlock = (
  title: "Yes" | "No",
  price: number | null | undefined,
  fair: number | null | undefined,
  edge: number | null | undefined,
) => (
  <div className={cn("kelly-market-table__block", title === "Yes" ? "is-yes" : "is-no")}>
    <div className="kelly-market-table__block-title">{title === "Yes" ? "买 Yes" : "买 No"}</div>
    <div className="kelly-market-table__block-row">
      <span>可买价</span>
      <strong>{formatBlockValue(price)}</strong>
    </div>
    <div className="kelly-market-table__block-row">
      <span>估值</span>
      <strong>{formatBlockValue(fair)}</strong>
    </div>
    <div className="kelly-market-table__block-row">
      <span>优势</span>
      <strong>{formatBlockValue(edge, true)}</strong>
    </div>
  </div>
);

const buildRecommendationLabel = (market: KellyMarketRow) => {
  const recommendation = market.recommendation?.trim();
  const side = market.recommendationSide?.trim();

  if (!side) {
    return recommendation ?? "观察";
  }

  if (!recommendation || recommendation === side) {
    return side;
  }

  if (side === "观察" || side === "观望") {
    return recommendation;
  }

  if (recommendation === "观察" || recommendation === "观望" || recommendation === "附录") {
    return side;
  }

  return `${recommendation} / ${side}`;
};

const buildInactiveReason = (market: KellyMarketRow) =>
  market.inactiveReason ?? market.detail ?? market.note ?? "当前没有可执行的盘口。";

const buildExecutionNote = (market: KellyMarketRow) =>
  market.note ?? market.detail ?? "当前没有额外说明。";

const buildDecisionSummary = (
  market: KellyMarketRow,
  focusSide: "yes" | "no",
  edgePct: number | null,
  kellyPct: number | null,
) => {
  const focusSideLabel = focusSide === "yes" ? "Yes" : "No";
  const edgeLabel = formatKellySignedPercent(edgePct);
  const kelly = formatKellyPercent(kellyPct);

  if (market.status === "locked") {
    return `当前不可交易 / Kelly ${kelly}`;
  }

  if (market.recommendationSide?.includes("Yes") || market.recommendationSide?.includes("No")) {
    return `主侧 ${focusSideLabel} / 优势 ${edgeLabel} / Kelly ${kelly}`;
  }

  return `继续观察 / 最佳优势 ${edgeLabel} / Kelly ${kelly}`;
};

const buildHeadlineLabel = (market: KellyMarketRow) => market.shortLabel ?? market.label;

const buildSubline = (market: KellyMarketRow) =>
  [market.contractTypeLabel ?? market.rangeLabel, market.dateLabel].filter(Boolean).join(" / ");

const buildTemperatureHighlight = (market: KellyMarketRow) =>
  market.rangeLabel ?? market.shortLabel ?? market.label ?? "待补充";

const buildInactiveList = (inactiveMarkets: KellyMarketRow[]) => (
  <details className="kelly-inactive-block">
    <summary className="kelly-inactive-block__header">
      <div>
        <div className="eyebrow">已收起 / 当前不可交易档位</div>
        <h4>这些档位暂时移出主表，只保留回查信息。</h4>
      </div>
    </summary>
    <div className="kelly-inactive-list">
      {inactiveMarkets.map((market) => (
        <article key={market.id} className="kelly-inactive-item">
          <div className="kelly-inactive-item__head">
            <strong>{buildHeadlineLabel(market)}</strong>
            <span>{buildSubline(market) || market.rangeLabel}</span>
          </div>
          <div className="kelly-market-row__aux">{buildInactiveReason(market)}</div>
        </article>
      ))}
    </div>
  </details>
);

export const KellyMarketTable = ({
  markets,
  inactiveMarkets = [],
  emptyText,
  selectedMarketId,
  onSelectMarket,
}: KellyMarketTableProps) => (
  <section className="kelly-block kelly-market-panel">
    <div className="kelly-block__header kelly-market-panel__header">
      <div>
        <div className="eyebrow">温度档位主表</div>
        <h3 className="kelly-block__title">先看建议，再看价格、估值和边际优势</h3>
      </div>
      <div className="kelly-market-panel__meta">
        <span>{markets.length} 个可交易档位</span>
        <span>点击档位联动右侧证据</span>
      </div>
    </div>

    <div className="kelly-market-table__rules">
      <span className="kelly-market-table__rule">可买价默认取 best ask</span>
      <span className="kelly-market-table__rule">主侧优势 = 我们估值 - 当前可买价</span>
      <span className="kelly-market-table__rule">建议下注按 Kelly 风控口径计算</span>
    </div>

    {markets.length === 0 ? (
      <div className="kelly-empty-block">{emptyText ?? "当前没有可展示的温度档位。"}</div>
    ) : (
      <div className="kelly-market-list" role="list">
        {markets.map((market) => {
          const status = statusMeta[market.status ?? "tradable"];
          const StatusIcon = status.icon;
          const active = market.id === selectedMarketId;
          const decisionTone = resolveDecisionTone(market);
          const { side: focusSide, edgePct: focusEdgePct, kellyPct } = resolveFocusMetrics(market);
          const detail = market.detail ?? null;
          const note = buildExecutionNote(market);

          return (
            <button
              key={market.id}
              type="button"
              className={cn("kelly-market-card", active && "is-active")}
              data-selected={active ? "true" : "false"}
              data-tone={decisionTone}
              aria-pressed={active}
              onClick={() => onSelectMarket?.(market.id)}
            >
              <div className="kelly-market-card__top">
                <div className="kelly-market-card__identity">
                  <div className="kelly-market-card__eyebrow">{buildSubline(market) || market.rangeLabel}</div>
                  <div className="kelly-market-card__title-row">
                    <strong className="kelly-market-card__title">{buildHeadlineLabel(market)}</strong>
                    <div className="kelly-market-row__status">
                      <StatusIcon className="h-3.5 w-3.5" />
                      {status.label}
                    </div>
                  </div>

                  <div className="kelly-market-card__range">
                    <span className="kelly-market-card__temperature-label">温度档位</span>
                    <strong className="kelly-market-card__temperature-value">{buildTemperatureHighlight(market)}</strong>
                    {market.dateLabel ? <span className="kelly-market-card__temperature-date">{market.dateLabel}</span> : null}
                  </div>
                </div>

                <div className={cn("kelly-market-card__decision", `is-${decisionTone}`)}>
                  <span className="kelly-market-card__decision-label">当前建议</span>
                  <strong>{buildRecommendationLabel(market)}</strong>
                  <span className="kelly-market-card__decision-sub">{buildDecisionSummary(market, focusSide, focusEdgePct, kellyPct)}</span>
                </div>

                <div className="kelly-market-card__meta-grid">
                  <div className="kelly-market-card__metric">
                    <span>建议下注</span>
                    <strong>{formatKellyUsd(market.suggestedStakeUsd)}</strong>
                  </div>
                  <div className="kelly-market-card__metric">
                    <span>主侧优势</span>
                    <strong>{formatKellySignedPercent(focusEdgePct)}</strong>
                  </div>
                  <div className="kelly-market-card__metric">
                    <span>盘口宽度</span>
                    <strong>{market.spreadLabel ?? formatKellyPercent(market.spreadPct)}</strong>
                  </div>
                  <div className="kelly-market-card__metric">
                    <span>最新盘口</span>
                    <strong>{market.updatedAtLabel ?? "--"}</strong>
                  </div>
                </div>
              </div>

              <div className="kelly-market-card__temp-grid">
                {buildSideBlock("Yes", market.yesPricePct, market.fairYesPct, market.yesEdgePct)}
                {buildSideBlock("No", market.noPricePct, market.fairNoPct, market.noEdgePct)}
              </div>

              <div className="kelly-market-card__remark-row">
                {detail ? <div className="kelly-recommendation-badge">{detail}</div> : null}
                {note && note !== detail ? <div className="kelly-market-card__remark">{note}</div> : null}
              </div>
            </button>
          );
        })}
      </div>
    )}

    {inactiveMarkets.length > 0 ? buildInactiveList(inactiveMarkets) : null}
  </section>
);
