import { AlertTriangle } from "lucide-react";

export const WarningLines = ({ items }: { items: string[] }) =>
  items.length ? (
    <section className="terminal-panel warning-lines-panel px-4 py-4">
      <div className="panel-section warning-lines-list space-y-2">
        {items.map((item) => (
          <div
            key={item}
            className="warning-lines-item flex items-start gap-3 rounded-[18px] border border-[rgba(255,183,111,0.18)] bg-[rgba(255,183,111,0.08)] px-4 py-3 text-sm leading-6 text-[#ffe5c0]"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]" />
            <span>{item}</span>
          </div>
        ))}
      </div>
    </section>
  ) : null;
