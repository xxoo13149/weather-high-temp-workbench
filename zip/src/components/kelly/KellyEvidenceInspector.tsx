import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, ChevronDown, ChevronUp, Clock3, DatabaseZap, ScanSearch } from "lucide-react";

import type { KellyEvidenceItem, KellyEvidenceSection, KellySummaryMetric, KellySyncMetric } from "@/lib/kelly";
import { cn } from "@/lib/utils";

type KellyEvidenceInspectorProps = {
  syncMetrics?: KellySyncMetric[];
  sections: KellyEvidenceSection[];
  selectionKey?: string | null;
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

const evidenceToneWeight: Record<NonNullable<KellySummaryMetric["tone"]>, number> = {
  danger: 5,
  warning: 4,
  success: 3,
  accent: 2,
  neutral: 1,
};

const scoreEvidenceItem = (item: KellyEvidenceItem) =>
  (item.value && item.value !== "--" ? 4 : 0) +
  evidenceToneWeight[item.tone ?? "neutral"] * 3 +
  (item.detail ? 2 : 0) +
  (item.sourceLabel || item.sourceUrl ? 1 : 0);

const pickEvidenceSummaryItem = (section: KellyEvidenceSection) =>
  section.items.reduce<KellyEvidenceItem | null>((best, item) => {
    if (best === null) {
      return item;
    }
    return scoreEvidenceItem(item) > scoreEvidenceItem(best) ? item : best;
  }, section.items[0] ?? null);

export const KellyEvidenceInspector = ({
  syncMetrics = [],
  sections,
  selectionKey,
}: KellyEvidenceInspectorProps) => {
  const visibleSyncMetrics = syncMetrics.filter((metric) => metric.id === "stream" || metric.value !== "--");
  const [expandedSectionId, setExpandedSectionId] = useState<string | null>(null);
  const [showSyncDetails, setShowSyncDetails] = useState(false);
  const lastSelectionKeyRef = useRef(selectionKey);

  useEffect(() => {
    if (lastSelectionKeyRef.current === selectionKey) {
      return;
    }

    lastSelectionKeyRef.current = selectionKey;
    setExpandedSectionId(null);
  }, [selectionKey, sections]);

  useEffect(() => {
    if (expandedSectionId && sections.some((section) => section.id === expandedSectionId)) {
      return;
    }

    setExpandedSectionId(null);
  }, [expandedSectionId, sections]);

  return (
    <section className="kelly-block kelly-side-block">
      <div className="kelly-block__header">
        <div>
          <div className="eyebrow">右侧核对区</div>
          <h3 className="kelly-block__title">时间、新鲜度与证据回查</h3>
        </div>
        <div className="text-sm text-white/48">只保留成交决策真正需要回看的信息。</div>
      </div>

      <div className="kelly-evidence-stack">
        {visibleSyncMetrics.length > 0 ? (
          <article className="kelly-evidence-card">
            <div className="kelly-evidence-card__header">
              <div className="kelly-evidence-card__title">
                <Clock3 className="h-4 w-4 text-[var(--accent)]" />
                时间与新鲜度
              </div>
              <button
                type="button"
                className="kelly-evidence-card__mini-toggle"
                aria-expanded={showSyncDetails}
                onClick={() => setShowSyncDetails((current) => !current)}
              >
                {showSyncDetails ? "收起细节" : "展开细节"}
                {showSyncDetails ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            </div>

            <div className="kelly-side-sync-grid">
              {visibleSyncMetrics.map((metric) => (
                <article
                  key={metric.id}
                  className={cn("kelly-side-sync-card", syncToneClassMap[metric.tone ?? "neutral"])}
                >
                  <div className="kelly-side-sync-card__label">{metric.label}</div>
                  <div className="kelly-side-sync-card__value data-mono">{metric.value}</div>
                  {metric.detail && showSyncDetails ? (
                    <div className="kelly-side-sync-card__detail">{metric.detail}</div>
                  ) : null}
                </article>
              ))}
            </div>
          </article>
        ) : null}

        {sections.map((section) => {
          const summaryItem = pickEvidenceSummaryItem(section);
          const summaryCopy =
            section.description ??
            summaryItem?.detail ??
            section.items[0]?.detail ??
            "点击展开这一组证据明细。";
          const clippedSummaryCopy =
            summaryCopy.length > 72 ? `${summaryCopy.slice(0, 72)}...` : summaryCopy;

          return (
            <article key={section.id} className="kelly-evidence-card kelly-evidence-card--compact">
              <button
                type="button"
                className="kelly-evidence-card__toggle"
                aria-expanded={expandedSectionId === section.id}
                onClick={() => setExpandedSectionId((current) => (current === section.id ? null : section.id))}
              >
                <div className="kelly-evidence-card__header">
                  <div>
                    <div className="kelly-evidence-card__title">
                      <DatabaseZap className="h-4 w-4 text-[var(--accent)]" />
                      {section.title}
                    </div>
                    <p>{clippedSummaryCopy}</p>
                  </div>
                  <div className="kelly-evidence-card__summary">
                    <span>{summaryItem?.label ?? section.items[0]?.label ?? "证据"}</span>
                    <strong
                      className={cn(
                        "data-mono",
                        toneClassMap[summaryItem?.tone ?? section.items[0]?.tone ?? "neutral"],
                      )}
                    >
                      {summaryItem?.value ?? section.items[0]?.value ?? "--"}
                    </strong>
                    {expandedSectionId === section.id ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </div>
                </div>
              </button>

              <AnimatePresence initial={false}>
                {expandedSectionId === section.id ? (
                  <motion.div
                    initial={{ opacity: 0, height: 0, y: -6 }}
                    animate={{ opacity: 1, height: "auto", y: 0 }}
                    exit={{ opacity: 0, height: 0, y: -6 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    className="kelly-evidence-card__items"
                  >
                    {section.items.map((item) => (
                      <div key={item.id} className="kelly-evidence-item">
                        <div className="kelly-evidence-item__head">
                          <span>{item.label}</span>
                          <strong className={cn("data-mono", toneClassMap[item.tone ?? "neutral"])}>
                            {item.value}
                          </strong>
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
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </article>
          );
        })}
      </div>
    </section>
  );
};
