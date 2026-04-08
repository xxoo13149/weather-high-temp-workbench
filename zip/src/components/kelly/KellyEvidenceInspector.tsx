import { ArrowUpRight, Clock3, DatabaseZap, ScanSearch } from "lucide-react";

import type { KellyEvidenceSection, KellySummaryMetric, KellySyncMetric, KellyWorkbenchData } from "@/lib/kelly";
import { cn } from "@/lib/utils";

type KellyEvidenceInspectorProps = {
  syncMetrics?: KellySyncMetric[];
  sections: KellyEvidenceSection[];
  methodologyNotes?: string[];
  methodologyModels?: KellyWorkbenchData["methodologyModels"];
};

const toneClassMap = {
  neutral: "text-white/78",
  accent: "text-[var(--accent)]",
  success: "text-[var(--success)]",
  warning: "text-[var(--warning)]",
  danger: "text-[var(--danger)]",
} as const;

const syncToneClassMap: Record<NonNullable<KellySummaryMetric["tone"]>, string> = {
  neutral: "border-white/10 text-white/84",
  accent: "border-[var(--border-strong)] text-white",
  success: "border-[rgba(133,243,180,0.2)] text-white",
  warning: "border-[rgba(255,200,107,0.2)] text-white",
  danger: "border-[rgba(255,107,107,0.2)] text-white",
} as const;

export const KellyEvidenceInspector = ({
  syncMetrics = [],
  sections,
  methodologyNotes,
  methodologyModels,
}: KellyEvidenceInspectorProps) => {
  const visibleSyncMetrics = syncMetrics.filter((metric) => metric.id === "stream" || metric.value !== "--");

  return (
    <section className="kelly-block kelly-side-block">
    <div className="kelly-block__header">
      <div>
        <div className="eyebrow">右侧核对区</div>
        <h3 className="kelly-block__title">时间、新鲜度、证据与公式口径</h3>
      </div>
      <div className="text-sm text-white/48">右侧只负责回查和解释，不和主表争首屏注意力。</div>
    </div>

    <div className="kelly-evidence-stack">
      {visibleSyncMetrics.length > 0 ? (
        <article className="kelly-evidence-card">
          <div className="kelly-evidence-card__header">
            <div className="kelly-evidence-card__title">
              <Clock3 className="h-4 w-4 text-[var(--accent)]" />
              时间与新鲜度
            </div>
            <p>四个时间块都收在右侧，不占主决策视线。</p>
          </div>

          <div className="kelly-side-sync-grid">
            {visibleSyncMetrics.map((metric) => (
              <article key={metric.id} className={cn("kelly-side-sync-card", syncToneClassMap[metric.tone ?? "neutral"])}>
                <div className="kelly-side-sync-card__label">{metric.label}</div>
                <div className="kelly-side-sync-card__value data-mono">{metric.value}</div>
                {metric.detail ? <div className="kelly-side-sync-card__detail">{metric.detail}</div> : null}
              </article>
            ))}
          </div>
        </article>
      ) : null}

      {sections.map((section) => (
        <article key={section.id} className="kelly-evidence-card">
          <div className="kelly-evidence-card__header">
            <div className="kelly-evidence-card__title">
              <DatabaseZap className="h-4 w-4 text-[var(--accent)]" />
              {section.title}
            </div>
            {section.description ? <p>{section.description}</p> : null}
          </div>

          <div className="kelly-evidence-card__items">
            {section.items.map((item) => (
              <div key={item.id} className="kelly-evidence-item">
                <div className="kelly-evidence-item__head">
                  <span>{item.label}</span>
                  <strong className={cn("data-mono", toneClassMap[item.tone ?? "neutral"])}>{item.value}</strong>
                </div>
                {item.detail ? <div className="kelly-evidence-item__detail">{item.detail}</div> : null}
                {item.sourceLabel || item.sourceUrl ? (
                  <div className="kelly-evidence-item__source">
                    <ScanSearch className="h-3.5 w-3.5" />
                    {item.sourceUrl ? (
                      <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                        {item.sourceLabel ?? "打开来源"}
                        <ArrowUpRight className="h-3 w-3" />
                      </a>
                    ) : (
                      <span>{item.sourceLabel}</span>
                    )}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </article>
      ))}

      {methodologyNotes?.length ? (
        <div className="kelly-methodology-notes">
          <div className="eyebrow">方法备注</div>
          {methodologyNotes.map((note) => (
            <div key={note}>{note}</div>
          ))}
        </div>
      ) : null}

      {methodologyModels?.length ? (
        <article className="kelly-evidence-card">
          <div className="kelly-evidence-card__header">
            <div className="kelly-evidence-card__title">
              <DatabaseZap className="h-4 w-4 text-[var(--accent)]" />
              参与模型 / 排除模型
            </div>
            <p>展开看当前偏差、修正峰值和权重拆解，不把关键口径藏在代码里。</p>
          </div>

          <div className="kelly-methodology-models">
            {methodologyModels.map((model) => (
              <div key={model.id} className={cn("kelly-methodology-model", !model.included && "is-excluded")}>
                <div className="kelly-methodology-model__head">
                  <strong>{model.modelLabel}</strong>
                  <span>{model.statusLabel}</span>
                </div>
                <div className="kelly-methodology-model__grid">
                  <div>
                    <span>当前预测</span>
                    <strong className="data-mono">{model.currentPredictionLabel}</strong>
                  </div>
                  <div>
                    <span>当前偏差</span>
                    <strong className="data-mono">{model.biasNowLabel}</strong>
                  </div>
                  <div>
                    <span>修正峰值</span>
                    <strong className="data-mono">{model.adjustedPeakLabel}</strong>
                  </div>
                  <div>
                    <span>最终权重</span>
                    <strong className="data-mono">{model.weightLabel}</strong>
                  </div>
                </div>
                {model.detail ? <div className="kelly-evidence-item__detail">{model.detail}</div> : null}
              </div>
            ))}
          </div>
        </article>
      ) : null}
    </div>
  </section>
  );
};
