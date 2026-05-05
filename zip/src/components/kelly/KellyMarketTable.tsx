import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, ChevronUp, Lock, Radio, Waves } from "lucide-react";

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
}: KellyMarketTableProps) => {
  const tradableMarkets = markets.filter((market) => (market.status ?? "tradable") === "tradable");
  const watchMarkets = markets.filter((market) => (market.status ?? "tradable") !== "tradable");
  const [watchExpanded, setWatchExpanded] = useState(false);
  const [showMarketRules, setShowMarketRules] = useState(false);
  const [expandedMarketId, setExpandedMarketId] = useState<string | null>(null);

  useEffect(() => {
    setWatchExpanded(Boolean(selectedMarketId && watchMarkets.some((market) => market.id === selectedMarketId)));
  }, [selectedMarketId, watchMarkets]);

  useEffect(() => {
    if (watchMarkets.length === 0) {
      setWatchExpanded(false);
    }
  }, [watchMarkets.length]);

  useEffect(() => {
    if (!expandedMarketId || [...markets, ...inactiveMarkets].some((market) => market.id === expandedMarketId)) {
      return;
    }

    setExpandedMarketId(null);
  }, [expandedMarketId, inactiveMarkets, markets]);

  const renderMarketCard = (market: KellyMarketRow) => {
    const status = statusMeta[market.status ?? "tradable"];
    const StatusIcon = status.icon;
    const active = market.id === selectedMarketId;
    const expanded = active && expandedMarketId === market.id;
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
        aria-expanded={expanded}
        onClick={() => {
          onSelectMarket?.(market.id);
          setExpandedMarketId((current) => (current === market.id ? null : market.id));
        }}
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
            <span className="kelly-market-card__decision-sub">
              {buildDecisionSummary(market, focusSide, focusEdgePct, kellyPct)}
            </span>
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
              <span>Kelly</span>
              <strong>{formatKellyPercent(kellyPct)}</strong>
            </div>
            <div className="kelly-market-card__metric">
              <span>最新盘口</span>
              <strong>{market.updatedAtLabel ?? "--"}</strong>
            </div>
          </div>
        </div>

        <AnimatePresence initial={false}>
          {expanded ? (
            <motion.div
              initial={{ opacity: 0, height: 0, y: -6 }}
              animate={{ opacity: 1, height: "auto", y: 0 }}
              exit={{ opacity: 0, height: 0, y: -6 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="kelly-market-card__expanded"
            >
              <div className="kelly-market-card__temp-grid">
                {buildSideBlock("Yes", market.yesPricePct, market.fairYesPct, market.yesEdgePct)}
                {buildSideBlock("No", market.noPricePct, market.fairNoPct, market.noEdgePct)}
              </div>

              <div className="kelly-market-card__remark-row">
                {detail ? <div className="kelly-recommendation-badge">{detail}</div> : null}
                {note && note !== detail ? <div className="kelly-market-card__remark">{note}</div> : null}
              </div>
              <div className="kelly-market-card__meta-rail">
                <span>{`推荐侧 ${buildRecommendationLabel(market)}`}</span>
                <span>{`盘口宽度 ${market.spreadLabel ?? formatKellyPercent(market.spreadPct)}`}</span>
              </div>
              <div className="kelly-market-card__expanded-meta">
                <div className="kelly-market-card__expanded-chip">
                  <span>最新盘口</span>
                  <strong>{market.updatedAtLabel ?? "--"}</strong>
                </div>
                <div className="kelly-market-card__expanded-chip">
                  <span>盘口宽度</span>
                  <strong>{market.spreadLabel ?? formatKellyPercent(market.spreadPct)}</strong>
                </div>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </button>
    );
  };

  return (
    <section className="kelly-block kelly-market-panel">
      <div className="kelly-block__header kelly-market-panel__header">
        <div>
          <div className="eyebrow">温度档位主表</div>
          <h3 className="kelly-block__title">先看当前最能执行的档位，再点开单卡查看双边 book</h3>
        </div>
        <div className="kelly-market-panel__meta">
          <span>{tradableMarkets.length} 个可执行档位</span>
          <span>点击卡片展开 book 与证据联动</span>
        </div>
      </div>

      <button
        type="button"
        className="kelly-market-rules-toggle"
        aria-expanded={showMarketRules}
        onClick={() => setShowMarketRules((current) => !current)}
      >
        <span>{showMarketRules ? "收起定价规则" : "查看定价规则"}</span>
        {showMarketRules ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      <AnimatePresence initial={false}>
        {showMarketRules ? (
          <motion.div
            initial={{ opacity: 0, height: 0, y: -4 }}
            animate={{ opacity: 1, height: "auto", y: 0 }}
            exit={{ opacity: 0, height: 0, y: -4 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="kelly-market-table__rules"
          >
            <span className="kelly-market-table__rule">可买价默认取 best ask</span>
            <span className="kelly-market-table__rule">主侧优势 = 我们估值 - 当前可买价</span>
            <span className="kelly-market-table__rule">双侧 book 仅在展开卡片显示</span>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {tradableMarkets.length === 0 ? (
        <div className="kelly-empty-block">{emptyText ?? "当前没有可展示的温度档位。"}</div>
      ) : (
        <div className="kelly-market-list" role="list">
          {tradableMarkets.map(renderMarketCard)}
        </div>
      )}

      {watchMarkets.length > 0 ? (
        <details
          className={cn("kelly-watch-block", watchExpanded && "is-open")}
          open={watchExpanded}
          onToggle={(event) => setWatchExpanded((event.currentTarget as HTMLDetailsElement).open)}
        >
          <summary className="kelly-watch-block__header">
            <div>
              <div className="eyebrow">观察与受限档位</div>
              <h4>{watchMarkets.length} 个非主执行档位按需展开</h4>
            </div>
          </summary>
          <div className="kelly-market-list">
            {watchMarkets.map(renderMarketCard)}
          </div>
        </details>
      ) : null}

      {inactiveMarkets.length > 0 ? buildInactiveList(inactiveMarkets) : null}
    </section>
  );
};
