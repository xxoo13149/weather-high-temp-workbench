import { afterEach, describe, expect, test, vi } from "vitest";

const { fetchJsonMock } = vi.hoisted(() => ({
  fetchJsonMock: vi.fn(),
}));

vi.mock("../src/lib/http.js", () => ({
  fetchJson: fetchJsonMock,
}));

import {
  buildGibsWmsUrl,
  buildRainViewerTileUrl,
  fetchSupplementalEvidence,
  latLonToTile,
  resolveGibsSnapshotDate,
  selectLatestRainViewerFrame,
} from "../src/providers/supplemental/service.js";

describe("supplemental evidence service", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    fetchJsonMock.mockReset();
  });

  test("converts coordinates to Web Mercator tile coordinates", () => {
    expect(latLonToTile(0, 0, 1)).toEqual({ x: 1, y: 1 });
    expect(latLonToTile(37.451, 126.451, 7)).toEqual({ x: 108, y: 49 });
  });

  test("selects the newest RainViewer radar frame and builds a tile URL", () => {
    const frame = selectLatestRainViewerFrame({
      host: "https://tilecache.rainviewer.com",
      radar: {
        past: [
          { time: 1_777_200_000, path: "/v2/radar/older" },
          { time: 1_777_210_000, path: "/v2/radar/newer" },
        ],
      },
    });

    expect(frame).toEqual({ time: 1_777_210_000, path: "/v2/radar/newer" });
    expect(
      buildRainViewerTileUrl({
        host: "https://tilecache.rainviewer.com/",
        path: "/v2/radar/newer",
        latitude: 37.451,
        longitude: 126.451,
        zoom: 7,
      }),
    ).toEqual({
      tile: { x: 108, y: 49 },
      url: "https://tilecache.rainviewer.com/v2/radar/newer/512/7/108/49/2/1_1.png",
    });
  });

  test("builds a NASA GIBS WMS snapshot URL around the requested location", () => {
    const { bbox, url } = buildGibsWmsUrl({
      latitude: 37.451,
      longitude: 126.451,
      date: "2026-04-25",
      width: 512,
      height: 512,
    });
    const parsed = new URL(url);

    expect(parsed.hostname).toBe("gibs.earthdata.nasa.gov");
    expect(parsed.searchParams.get("LAYERS")).toBe("VIIRS_SNPP_CorrectedReflectance_TrueColor");
    expect(parsed.searchParams.get("TIME")).toBe("2026-04-25");
    expect(parsed.searchParams.get("BBOX")).toBe(`${bbox.west},${bbox.south},${bbox.east},${bbox.north}`);
  });

  test("uses a one-day lookback for GIBS near-real-time imagery", () => {
    expect(resolveGibsSnapshotDate(new Date("2026-04-26T10:00:00.000Z"))).toBe("2026-04-25");
  });

  test("returns radar and satellite evidence when RainViewer has frames", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      generated: 1_777_210_100,
      host: "https://tilecache.rainviewer.com",
      radar: {
        past: [{ time: 1_777_210_000, path: "/v2/radar/newer" }],
      },
    });

    const result = await fetchSupplementalEvidence({
      id: "seoul_icn",
      name: "Incheon International Airport",
      timezone: "Asia/Seoul",
      latitude: 37.451,
      longitude: 126.451,
    });

    expect(fetchJsonMock).toHaveBeenCalledWith("https://api.rainviewer.com/public/weather-maps.json");
    expect(result.radar).toMatchObject({
      provider: "RainViewer",
      tileUrl: "https://tilecache.rainviewer.com/v2/radar/newer/512/7/108/49/2/1_1.png",
      signal: "frame_available",
    });
    expect(result.satellite).toMatchObject({
      provider: "NASA GIBS",
      layer: "VIIRS_SNPP_CorrectedReflectance_TrueColor",
    });
    expect(result.sourceStatuses).toHaveLength(2);
    expect(result.interpretation.headlineZh).toContain("雷达");
  });

  test("keeps global satellite evidence when RainViewer has no usable frame", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      host: "https://tilecache.rainviewer.com",
      radar: {
        past: [],
      },
    });

    const result = await fetchSupplementalEvidence({
      id: "miami_mia",
      name: "Miami International Airport",
      timezone: "America/New_York",
      latitude: 25.7934,
      longitude: -80.2906,
    });

    expect(result.radar).toBeNull();
    expect(result.satellite?.imageUrl).toContain("gibs.earthdata.nasa.gov");
    expect(result.sourceStatuses.find((source) => source.key === "rainviewer-radar")).toMatchObject({
      hasRuntimeData: false,
      runtimeStatus: "unavailable",
    });
    expect(result.warnings).toContain("RainViewer did not return a usable radar frame.");
  });
});
