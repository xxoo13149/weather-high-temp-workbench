import { describe, expect, test } from "vitest";

describe("collectHomeDisplayWarnings", () => {
  test("filters optional degradations from homepage and analysis warning lines", async () => {
    const modulePath = new URL("../zip/src/display-text.ts", import.meta.url).href;
    const { collectDisplayWarnings, collectHomeDisplayWarnings } = (await import(modulePath)) as {
      collectDisplayWarnings: (args: { dashboardWarnings?: string[] }) => string[];
      collectHomeDisplayWarnings: (args: { dashboardWarnings?: string[] }) => string[];
    };
    const meteogramWarning =
      "Embedded meteogram enrichment unavailable; using parsed week table data only. Meteoblue week meteogram fetch exceeded 3500ms.";
    const refreshWarning =
      "Background refresh is in progress; showing the most recent cached week page data.";
    const partialWindowWarning =
      "The parsed 1h view did not expose a full 24-hour window; returned the available hours.";
    const staleFallbackWarning =
      "Serving stale page-derived multimodel insights because the latest highcharts refresh failed.";
    const hardFailureWarning = "Insight refresh failed after 20s.";

    expect(
      collectDisplayWarnings({
        dashboardWarnings: [meteogramWarning, refreshWarning, partialWindowWarning, staleFallbackWarning, hardFailureWarning],
      }),
    ).toEqual([hardFailureWarning]);

    expect(
      collectHomeDisplayWarnings({
        dashboardWarnings: [meteogramWarning, refreshWarning, partialWindowWarning, staleFallbackWarning, hardFailureWarning],
      }),
    ).toEqual([hardFailureWarning]);
  });
});
