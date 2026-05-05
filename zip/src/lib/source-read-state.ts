import type { DataFreshnessState } from "../types";

export type SourceReadState = {
  label: string;
  className: string;
};

const SOURCE_READ_STATE_STYLES = {
  unread: "border-white/12 bg-white/[0.04] text-white/58",
  pending: "border-[rgba(114,229,255,0.24)] bg-[rgba(114,229,255,0.09)] text-[var(--accent-secondary)]",
  ready: "border-[rgba(138,240,194,0.24)] bg-[rgba(138,240,194,0.1)] text-[var(--success)]",
} as const;

export const resolveSourceReadState = (
  freshness: DataFreshnessState | null,
  hasRuntimeData: boolean,
): SourceReadState => {
  if (hasRuntimeData) {
    return {
      label: "已读取",
      className: SOURCE_READ_STATE_STYLES.ready,
    };
  }

  if (freshness === "revalidating") {
    return {
      label: "读取中",
      className: SOURCE_READ_STATE_STYLES.pending,
    };
  }

  return {
    label: "暂无读取",
    className: SOURCE_READ_STATE_STYLES.unread,
  };
};
