import { ActivitySquare, Flag, GaugeCircle, Sparkles } from "lucide-react";

import type { KellySummaryMetric } from "@/lib/kelly";
import { cn } from "@/lib/utils";

type KellySummaryStripProps = {
  metrics: KellySummaryMetric[];
};

const ICONS = [GaugeCircle, ActivitySquare, Flag, Sparkles];

const toneClassMap = {
  neutral: "border-white/8 text-white/84",
  accent: "border-[var(--border-strong)] text-white",
  success: "border-[rgba(133,243,180,0.24)] text-white",
  warning: "border-[rgba(255,200,107,0.22)] text-white",
  danger: "border-[rgba(255,107,107,0.22)] text-white",
} as const;

export const KellySummaryStrip = ({ metrics }: KellySummaryStripProps) => (
  <section className="kelly-block">
    <div className="kelly-block__header">
      <div>
        <div className="eyebrow">Snapshot</div>
        <h3 className="kelly-block__title">判断摘要</h3>
      </div>
      <div className="text-sm text-white/48">先给你一屏能直接决策的摘要，再下钻到分布、盘口和证据。</div>
    </div>

    <div className="kelly-summary-grid">
      {metrics.map((metric, index) => {
        const Icon = ICONS[index % ICONS.length];
        const tone = metric.tone ?? "neutral";

        return (
          <article key={metric.id} className={cn("kelly-summary-card", toneClassMap[tone])}>
            <div className="kelly-summary-card__label">
              <Icon className="h-4 w-4 text-[var(--accent)]" />
              {metric.label}
            </div>
            <div className="kelly-summary-card__value data-mono">{metric.value}</div>
            {metric.detail ? <div className="kelly-summary-card__detail">{metric.detail}</div> : null}
          </article>
        );
      })}
    </div>
  </section>
);
