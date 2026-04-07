import { ActivitySquare, Flag, GaugeCircle, Sparkles } from "lucide-react";

import type { KellySummaryMetric } from "@/lib/kelly";
import { cn } from "@/lib/utils";

type KellySummaryStripProps = {
  metrics: KellySummaryMetric[];
  variant?: "main" | "side";
};

const ICONS = [GaugeCircle, ActivitySquare, Flag, Sparkles];

const toneClassMap = {
  neutral: "border-white/8 text-white/84",
  accent: "border-[var(--border-strong)] text-white",
  success: "border-[rgba(133,243,180,0.24)] text-white",
  warning: "border-[rgba(255,200,107,0.22)] text-white",
  danger: "border-[rgba(255,107,107,0.22)] text-white",
} as const;

export const KellySummaryStrip = ({ metrics, variant = "main" }: KellySummaryStripProps) => {
  const isSide = variant === "side";

  return (
    <section className={cn("kelly-block kelly-summary-strip", isSide && "kelly-summary-strip--side")}>
      <div className="kelly-block__header">
        <div>
          <div className="eyebrow">{isSide ? "快速摘要" : "当前概况"}</div>
          <h3 className="kelly-block__title">{isSide ? "先看这些" : "核心数据"}</h3>
        </div>
        <div className="text-sm text-white/48">{isSide ? "用于快速定位当前档位的结论" : "用最少信息概括当前决策面。"}</div>
      </div>

      <div className="kelly-summary-strip__list">
        {metrics.map((metric, index) => {
          const Icon = ICONS[index % ICONS.length];
          const tone = metric.tone ?? "neutral";

          return (
            <article
              key={metric.id}
              className={cn(
                "kelly-summary-strip__item",
                toneClassMap[tone],
                isSide && "kelly-summary-strip__item--side",
              )}
            >
              <div className="kelly-summary-strip__label">
                <Icon className="h-4 w-4 text-[var(--accent)]" />
                <span>{metric.label}</span>
              </div>
              <div className="kelly-summary-strip__value data-mono">{metric.value}</div>
              {metric.detail ? <div className="kelly-summary-strip__detail">{metric.detail}</div> : null}
            </article>
          );
        })}
      </div>
    </section>
  );
};
