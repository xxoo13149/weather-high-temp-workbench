import { ArrowUpRight, DatabaseZap, ScanSearch } from "lucide-react";

import type { KellyEvidenceSection } from "@/lib/kelly";
import { cn } from "@/lib/utils";

type KellyEvidenceInspectorProps = {
  sections: KellyEvidenceSection[];
  methodologyNotes?: string[];
};

const toneClassMap = {
  neutral: "text-white/78",
  accent: "text-[var(--accent)]",
  success: "text-[var(--success)]",
  warning: "text-[var(--warning)]",
  danger: "text-[var(--danger)]",
} as const;

export const KellyEvidenceInspector = ({
  sections,
  methodologyNotes,
}: KellyEvidenceInspectorProps) => (
  <section className="kelly-block kelly-side-block">
    <div className="kelly-block__header">
      <div>
        <div className="eyebrow">Evidence</div>
        <h3 className="kelly-block__title">证据 inspector</h3>
      </div>
      <div className="text-sm text-white/48">天气、盘口、方法论三层拆开显示，方便核查真实值与来源。</div>
    </div>

    <div className="kelly-evidence-stack">
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
                        {item.sourceLabel ?? "Open source"}
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
          <div className="eyebrow">Method notes</div>
          {methodologyNotes.map((note) => (
            <div key={note}>{note}</div>
          ))}
        </div>
      ) : null}
    </div>
  </section>
);
