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
  locked: { label: "附录", icon: Lock },
} as const;

const formatBlockValue = (value: number | null | undefined, signed = false) =>
  signed ? formatKellySignedPercent(value) : formatKellyPercent(value);

const buildSideBlock = (
  title: "Yes" | "No",
  price: number | null | undefined,
  fair: number | null | undefined,
  edge: number | null | undefined,
) => (
  <div className={cn("kelly-market-table__block", title === "Yes" ? "is-yes" : "is-no")}>
    <div className="kelly-market-table__block-title">{title === "Yes" ? "买 Yes 一侧" : "买 No 一侧"}</div>
    <div className="kelly-market-table__block-row">
      <span>当前可买价</span>
      <strong>{formatBlockValue(price)}</strong>
    </div>
    <div className="kelly-market-table__block-row">
      <span>我们估的价格</span>
      <strong>{formatBlockValue(fair)}</strong>
    </div>
    <div className="kelly-market-table__block-row">
      <span>当前优势</span>
      <strong>{formatBlockValue(edge, true)}</strong>
    </div>
  </div>
);

const buildRecommendationLabel = (market: KellyMarketRow) => {
  if (market.recommendationSide && market.recommendationSide !== "观察") {
    return `${market.recommendation ?? "执行"} ${market.recommendationSide}`;
  }

  return market.recommendation ?? "观察";
};

const buildInactiveReason = (market: KellyMarketRow) =>
  market.inactiveReason ?? market.detail ?? market.note ?? "当前没有可执行盘口。";

const buildInactiveList = (inactiveMarkets: KellyMarketRow[]) => (
  <details className="kelly-inactive-block">
    <summary className="kelly-inactive-block__header">
      <div>
        <div className="eyebrow">已结束 / 当前不可交易档位</div>
        <h4>这些档位已移出主表，但仍保留在附录里便于回查</h4>
      </div>
    </summary>
    <div className="kelly-inactive-list">
      {inactiveMarkets.map((market) => (
        <article key={market.id} className="kelly-inactive-item">
          <div className="kelly-inactive-item__head">
            <strong>{market.label}</strong>
            <span>{market.rangeLabel}</span>
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
  <section className="kelly-block">
    <div className="kelly-block__header">
      <div>
        <div className="eyebrow">温度档位主表</div>
        <h3 className="kelly-block__title">当前日期下全部仍可交易的档位都在这里</h3>
      </div>
      <div className="text-sm text-white/60">负 edge 也会显示，`minEdge` 只影响建议高亮和建议金额。</div>
    </div>

    <div className="kelly-market-table__rules text-sm text-white/62">
      <span>当前可买价默认取 best ask；缺失时该侧视为当前不可执行。</span>
      <span>优势 = 我们估值 - 当前可买价。</span>
      <span>建议金额 = Kelly × 本金。</span>
    </div>

    {markets.length === 0 ? (
      <div className="kelly-empty-block">{emptyText ?? "暂时没有可展示合约，请稍后刷新或检查市场匹配。"}</div>
    ) : (
      <div className="kelly-market-table-shell">
        <table className="kelly-market-table">
          <thead>
            <tr>
              <th>温度档位</th>
              <th>当前建议</th>
              <th>买 Yes</th>
              <th>买 No</th>
              <th>建议下注</th>
              <th>盘口宽度</th>
              <th>最新盘口时间</th>
              <th>备注</th>
            </tr>
          </thead>
          <tbody>
            {markets.map((market) => {
              const status = statusMeta[market.status ?? "tradable"];
              const StatusIcon = status.icon;
              const active = market.id === selectedMarketId;
              const kellyPct =
                market.recommendationSide === "买 Yes"
                  ? market.yesKellyPct
                  : market.recommendationSide === "买 No"
                    ? market.noKellyPct
                    : Math.max(market.yesKellyPct ?? 0, market.noKellyPct ?? 0);

              return (
                <tr
                  key={market.id}
                  className={cn("kelly-market-row", active && "is-active")}
                  data-selected={active ? "true" : "false"}
                  onClick={() => onSelectMarket?.(market.id)}
                >
                  <td>
                    <div className="kelly-market-row__title">
                      <strong>{market.label}</strong>
                      <span>{market.rangeLabel}</span>
                    </div>
                    <div className="kelly-market-row__status">
                      <StatusIcon className="h-3.5 w-3.5" />
                      {status.label}
                    </div>
                  </td>
                  <td className="kelly-market-table__recommendation">
                    <div>{buildRecommendationLabel(market)}</div>
                    <div className="kelly-market-table__recommendation-sub">
                      建议仓位比例 {formatKellyPercent(kellyPct)}
                    </div>
                  </td>
                  <td>{buildSideBlock("Yes", market.yesPricePct, market.fairYesPct, market.yesEdgePct)}</td>
                  <td>{buildSideBlock("No", market.noPricePct, market.fairNoPct, market.noEdgePct)}</td>
                  <td className="kelly-market-table__stake">{formatKellyUsd(market.suggestedStakeUsd)}</td>
                  <td className="kelly-market-table__spread">
                    {market.spreadLabel ?? formatKellyPercent(market.spreadPct)}
                  </td>
                  <td className="kelly-market-table__updated">{market.updatedAtLabel ?? "--"}</td>
                  <td>
                    <div className="kelly-recommendation-badge">{market.detail ?? "暂时没有额外说明。"}</div>
                    {market.note ? <div className="kelly-market-row__aux">{market.note}</div> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    )}

    {inactiveMarkets.length > 0 ? buildInactiveList(inactiveMarkets) : null}
  </section>
);
