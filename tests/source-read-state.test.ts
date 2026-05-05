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
});
