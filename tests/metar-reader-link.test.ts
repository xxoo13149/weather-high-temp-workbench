import { describe, expect, test } from "vitest";

describe("buildMetarReaderUrl", () => {
  test("builds a METAR Reader link from a four-letter ICAO station code", async () => {
    const modulePath = new URL("../zip/src/lib/metar-reader.ts", import.meta.url).href;
    const { buildMetarReaderUrl } = (await import(modulePath)) as {
      buildMetarReaderUrl: (stationCode: string | null | undefined) => string | null;
    };

    expect(buildMetarReaderUrl("zspd")).toBe("https://www.metarreader.com/ZSPD");
  });

  test("does not build links for non-ICAO station labels", async () => {
    const modulePath = new URL("../zip/src/lib/metar-reader.ts", import.meta.url).href;
    const { buildMetarReaderUrl } = (await import(modulePath)) as {
      buildMetarReaderUrl: (stationCode: string | null | undefined) => string | null;
    };

    expect(buildMetarReaderUrl("LFS")).toBeNull();
    expect(buildMetarReaderUrl(null)).toBeNull();
  });
});
