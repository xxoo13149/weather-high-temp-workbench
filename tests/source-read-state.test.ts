import { describe, expect, test } from "vitest";

describe("resolveSourceReadState", () => {
  test("treats cached or revalidating runtime data as already readable", async () => {
    const modulePath = new URL("../zip/src/lib/source-read-state.ts", import.meta.url).href;
    const { resolveSourceReadState } = (await import(modulePath)) as {
      resolveSourceReadState: (
        freshness: "fresh" | "revalidating" | "fallback_error" | null,
        hasRuntimeData: boolean,
      ) => { label: string };
    };

    expect(resolveSourceReadState("fresh", true).label).toBe("已读取");
    expect(resolveSourceReadState("revalidating", true).label).toBe("已读取");
    expect(resolveSourceReadState("fallback_error", true).label).toBe("已读取");
  });

  test("only shows pending when a source is still empty and currently loading", async () => {
    const modulePath = new URL("../zip/src/lib/source-read-state.ts", import.meta.url).href;
    const { resolveSourceReadState } = (await import(modulePath)) as {
      resolveSourceReadState: (
        freshness: "fresh" | "revalidating" | "fallback_error" | null,
        hasRuntimeData: boolean,
      ) => { label: string };
    };

    expect(resolveSourceReadState("revalidating", false).label).toBe("读取中");
    expect(resolveSourceReadState("fallback_error", false).label).toBe("暂无读取");
    expect(resolveSourceReadState(null, false).label).toBe("暂无读取");
  });
  test("only treats multimodel insight as readable when it has real parsed analysis output", async () => {
    const modulePath = new URL("../zip/src/lib/source-read-state.ts", import.meta.url).href;
    const { resolveMultiModelAnalysisReadState } = (await import(modulePath)) as {
      resolveMultiModelAnalysisReadState: (
        insight:
          | {
              fetchedAt: string;
              modelCount: number;
              rankedModels: Array<{ modelName: string }>;
              sourceProof: { pageFetchedAt: string; modelNames: string[] };
            }
          | null,
      ) => { hasRuntimeData: boolean; readAt: string | null; observedAt: string | null };
    };

    expect(
      resolveMultiModelAnalysisReadState({
        fetchedAt: "2026-05-06T08:05:00.000Z",
        modelCount: 3,
        rankedModels: [],
        sourceProof: {
          pageFetchedAt: "2026-05-06T08:00:00.000Z",
          modelNames: ["IFS", "ICON", "GFS"],
        },
      }),
    ).toMatchObject({
      hasRuntimeData: true,
      readAt: "2026-05-06T08:05:00.000Z",
      observedAt: "2026-05-06T08:00:00.000Z",
    });

    expect(
      resolveMultiModelAnalysisReadState({
        fetchedAt: "2026-05-06T08:05:00.000Z",
        modelCount: 0,
        rankedModels: [],
        sourceProof: {
          pageFetchedAt: "2026-05-06T08:00:00.000Z",
          modelNames: [],
        },
      }),
    ).toMatchObject({
      hasRuntimeData: false,
      readAt: null,
      observedAt: null,
    });
  });
});
