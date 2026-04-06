import { Lock, Radio, Waves } from "lucide-react";

import type { KellyMarketRow } from "@/lib/kelly";
import {
  formatKellyPercent,
  formatKellySignedPercent,
  formatKellyUsd,
} from "@/lib/kelly";
import { cn } from "@/lib/utils";

type KellyMarketTableProps = {
  markets: KellyMarketRow[];
  selectedMarketId?: string | null;
  onSelectMarket?: (marketId: string) => void;
};

const statusMeta = {
  tradable: { label: "Tradable", icon: Radio },
  thin: { label: "Thin", icon: Waves },
  locked: { label: "Locked", icon: Lock },
} as const;

const resolveKellyDisplay = (row: KellyMarketRow) => {
  if ((row.yesKellyPct ?? 0) > 0) {
    return `Y ${formatKellyPercent(row.yesKellyPct)}`;
  }

  if ((row.noKellyPct ?? 0) > 0) {
    return `N ${formatKellyPercent(row.noKellyPct)}`;
  }

  return "--";
};

export const KellyMarketTable = ({
  markets,
  selectedMarketId,
  onSelectMarket,
}: KellyMarketTableProps) => (
  <section className="kelly-block">
    <div className="kelly-block__header">
      <div>
        <div className="eyebrow">Markets</div>
        <h3 className="kelly-block__title">盘口分解</h3>
      </div>
      <div className="text-sm text-white/48">市场表保留 Yes / No 双边 edge 与 fair price，对应你后面要接的盘口逐帧分析。</div>
    </div>

    <div className="kelly-market-table-shell">
      <table className="kelly-market-table">
        <thead>
          <tr>
            <th>区间</th>
            <th>Yes 价</th>
            <th>Fair Yes</th>
            <th>Yes edge</th>
            <th>No 价</th>
            <th>Fair No</th>
            <th>No edge</th>
            <th>Kelly</th>
            <th>建议</th>
          </tr>
        </thead>
        <tbody>
          {markets.map((market) => {
            const status = statusMeta[market.status ?? "tradable"];
            const StatusIcon = status.icon;
            const active = market.id === selectedMarketId;

            return (
              <tr
                key={market.id}
                className={cn("kelly-market-row", active && "is-active")}
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
                <td className="data-mono">{formatKellyPercent(market.yesPricePct)}</td>
                <td className="data-mono">{formatKellyPercent(market.fairYesPct)}</td>
                <td className="data-mono text-[var(--accent)]">{formatKellySignedPercent(market.yesEdgePct)}</td>
                <td className="data-mono">{formatKellyPercent(market.noPricePct)}</td>
                <td className="data-mono">{formatKellyPercent(market.fairNoPct)}</td>
                <td className="data-mono text-[var(--warning)]">{formatKellySignedPercent(market.noEdgePct)}</td>
                <td>
                  <div className="data-mono">{resolveKellyDisplay(market)}</div>
                  {market.suggestedStakeUsd ? <div className="kelly-market-row__aux">{formatKellyUsd(market.suggestedStakeUsd)}</div> : null}
                </td>
                <td>
                  <div className="kelly-recommendation-badge">{market.recommendation ?? "--"}</div>
                  {market.detail ? <div className="kelly-market-row__aux">{market.detail}</div> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  </section>
);
