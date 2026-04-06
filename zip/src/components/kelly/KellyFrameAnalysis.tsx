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
        <div className="eyebrow">Frames</div>
        <h3 className="kelly-block__title">逐帧分析</h3>
      </div>
      <div className="text-sm text-white/48">保留批次级轨迹，用于后续记录盘口价、fair 价和天气证据怎样一起移动。</div>
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
                      <span>Market</span>
                      <strong className="data-mono">{formatKellyPercent(row.marketPricePct)}</strong>
                    </div>
                    <div>
                      <span>Fair</span>
                      <strong className="data-mono">{formatKellyPercent(row.fairPricePct)}</strong>
                    </div>
                    <div>
                      <span>Yes edge</span>
                      <strong className="data-mono text-[var(--accent)]">{formatKellySignedPercent(row.yesEdgePct)}</strong>
                    </div>
                    <div>
                      <span>No edge</span>
                      <strong className="data-mono text-[var(--warning)]">{formatKellySignedPercent(row.noEdgePct)}</strong>
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
