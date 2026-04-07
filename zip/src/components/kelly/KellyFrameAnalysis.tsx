import { Clapperboard, ScanLine } from "lucide-react";

import type { KellyFrameAnalysisGroup } from "@/lib/kelly";
import { formatKellyPercent, formatKellySignedPercent } from "@/lib/kelly";
import { cn } from "@/lib/utils";

type KellyFrameAnalysisProps = {
  groups: KellyFrameAnalysisGroup[];
  selectedFrameId?: string | null;
  onSelectFrame?: (frameId: string) => void;
};

export const KellyFrameAnalysis = ({
  groups,
  selectedFrameId,
  onSelectFrame,
}: KellyFrameAnalysisProps) => (
  <section className="kelly-block kelly-side-block">
    <div className="kelly-block__header">
      <div>
        <div className="eyebrow">逐帧回看</div>
        <h3 className="kelly-block__title">逐帧分析</h3>
      </div>
      <div className="text-sm text-white/48">记录盘口价、公允价、优势和 spread 的变化，帮助判断市场怎么移动。</div>
    </div>

    <div className="kelly-frame-stack">
      {groups.map((group) => (
        <article key={group.id} className="kelly-frame-group">
          <div className="kelly-frame-group__header">
            <div className="kelly-frame-group__title">
              <Clapperboard className="h-4 w-4 text-[var(--accent)]" />
              {group.title}
            </div>
            {group.description ? <p>{group.description}</p> : null}
          </div>

          <div className="kelly-frame-list">
            {group.rows.map((row) => {
              const active = row.id === selectedFrameId;
              return (
                <button
                  key={row.id}
                  type="button"
                  className={cn("kelly-frame-row", active && "is-active")}
                  onClick={() => onSelectFrame?.(row.id)}
                >
                  <div className="kelly-frame-row__head">
                    <div>
                      <strong>{row.label}</strong>
                      <span>{row.timestampLabel ?? row.marketLabel}</span>
                    </div>
                    <span className="kelly-frame-row__tag">
                      <ScanLine className="h-3.5 w-3.5" />
                      {row.marketLabel}
                    </span>
                  </div>

                  <div className="kelly-frame-row__metrics">
                    <div>
                      <span>Yes 盘口</span>
                      <strong className="data-mono">{formatKellyPercent(row.yesPricePct)}</strong>
                    </div>
                    <div>
                      <span>Fair Yes</span>
                      <strong className="data-mono">{formatKellyPercent(row.fairYesPct)}</strong>
                    </div>
                    <div>
                      <span>No 盘口</span>
                      <strong className="data-mono">{formatKellyPercent(row.noPricePct)}</strong>
                    </div>
                    <div>
                      <span>Fair No</span>
                      <strong className="data-mono">{formatKellyPercent(row.fairNoPct)}</strong>
                    </div>
                    <div>
                      <span>Yes 优势</span>
                      <strong className="data-mono text-[var(--accent)]">{formatKellySignedPercent(row.yesEdgePct)}</strong>
                    </div>
                    <div>
                      <span>No 优势</span>
                      <strong className="data-mono text-[var(--warning)]">{formatKellySignedPercent(row.noEdgePct)}</strong>
                    </div>
                    <div>
                      <span>Spread</span>
                      <strong className="data-mono">{formatKellyPercent(row.spreadPct)}</strong>
                    </div>
                  </div>

                  <div className="kelly-frame-row__signal">{row.weatherSignal}</div>
                  {row.note ? <div className="kelly-frame-row__note">{row.note}</div> : null}
                </button>
              );
            })}
          </div>
        </article>
      ))}
    </div>
  </section>
);
