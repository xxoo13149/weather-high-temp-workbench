import type { DataFreshnessState, MultiModelInsightResponse } from "../types";

export type SourceReadState = {
  label: string;
  className: string;
};

export type MultiModelAnalysisReadState = {
  hasRuntimeData: boolean;
  readAt: string | null;
  observedAt: string | null;
};

type MultiModelInsightReadInput = Pick<
  MultiModelInsightResponse,
  "fetchedAt" | "modelCount" | "rankedModels" | "sourceProof"
> | null | undefined;

const SOURCE_READ_STATE_STYLES = {
  unread: "border-white/12 bg-white/[0.04] text-white/58",
  pending: "border-[rgba(114,229,255,0.24)] bg-[rgba(114,229,255,0.09)] text-[var(--accent-secondary)]",
  ready: "border-[rgba(138,240,194,0.24)] bg-[rgba(138,240,194,0.1)] text-[var(--success)]",
} as const;

const hasNonBlankValue = (value: string | null | undefined): value is string =>
  typeof value === "string" && value.trim().length > 0;

export const hasResolvedMultiModelAnalysis = (
  insight: MultiModelInsightReadInput,
): insight is NonNullable<MultiModelInsightReadInput> => {
  if (!insight) {
    return false;
  }

  const rankedModelCount = Array.isArray(insight.rankedModels) ? insight.rankedModels.length : 0;
  const proofModelCount = Array.isArray(insight.sourceProof?.modelNames) ? insight.sourceProof.modelNames.length : 0;

  return (
    hasNonBlankValue(insight.fetchedAt) &&
    hasNonBlankValue(insight.sourceProof?.pageFetchedAt) &&
    (rankedModelCount > 0 || (insight.modelCount > 0 && proofModelCount > 0))
  );
};

export const resolveMultiModelAnalysisReadState = (
  insight: MultiModelInsightReadInput,
): MultiModelAnalysisReadState => {
  if (!hasResolvedMultiModelAnalysis(insight)) {
    return {
      hasRuntimeData: false,
      readAt: null,
      observedAt: null,
    };
  }

  return {
    hasRuntimeData: true,
    readAt: insight.fetchedAt,
    observedAt: insight.sourceProof.pageFetchedAt,
  };
};

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
