import { afterEach, describe, expect, test, vi } from "vitest";
import { gzipSync } from "node:zlib";

const { fetchBinaryMock, fetchJsonMock } = vi.hoisted(() => ({
  fetchBinaryMock: vi.fn(),
  fetchJsonMock: vi.fn(),
}));

vi.mock("../src/lib/http.js", () => ({
  fetchBinary: fetchBinaryMock,
  fetchJson: fetchJsonMock,
}));

import { __resetMetarTestState, fetchMetarSnapshot, resolveMetarStationId } from "../src/providers/metar/service.js";

describe("METAR service", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    fetchBinaryMock.mockReset();
    fetchJsonMock.mockReset();
    __resetMetarTestState();
  });

  test("returns no observation when a mapped METAR station temporarily returns invalid JSON", async () => {
    fetchBinaryMock.mockRejectedValueOnce(new Error("cache unavailable"));
    fetchJsonMock.mockRejectedValueOnce(new Error("Unexpected end of JSON input"));

    const result = await fetchMetarSnapshot({
      id: "masroor_opmr",
      name: "Masroor Air Base",
      timezone: "Asia/Karachi",
    });

    expect(resolveMetarStationId("masroor_opmr")).toBe("OPKC");
    expect(fetchJsonMock).toHaveBeenCalledWith(expect.stringContaining("ids=OPKC"));
    expect(result).toEqual({
      observation: null,
      recentTemperatures: [],
      recentObservations: [],
      recentReports: [],
    });
  });

  test("returns no observation when the upstream payload shape is unusable", async () => {
    fetchBinaryMock.mockRejectedValueOnce(new Error("cache unavailable"));
    fetchJsonMock.mockResolvedValueOnce({ unexpected: true });

    const result = await fetchMetarSnapshot({
      id: "guangzhou_can",
      name: "Guangzhou Baiyun International Airport",
      timezone: "Asia/Shanghai",
    });

    expect(result).toEqual({
      observation: null,
      recentTemperatures: [],
      recentObservations: [],
      recentReports: [],
    });
  });

  test("parses a healthy METAR payload into latest observation, recent temperatures, and 4-hour reports", async () => {
    fetchBinaryMock.mockRejectedValueOnce(new Error("cache unavailable"));
    fetchJsonMock.mockResolvedValueOnce([
      {
        icaoId: "ZGGG",
        reportTime: "2026-04-22T09:00:00Z",
        temp: 29,
        dewp: 21,
        wdir: 140,
        wspd: 8,
        rawOb: "METAR ZGGG 220900Z 14008KT ...",
        name: "Guangzhou",
      },
      {
        icaoId: "ZGGG",
        reportTime: "2026-04-22T07:00:00Z",
        temp: 27,
        dewp: 20,
        rawOb: "METAR ZGGG 220700Z 15006KT ...",
      },
      {
        icaoId: "ZGGG",
        reportTime: "2026-04-22T04:00:00Z",
        temp: 24,
        dewp: 18,
        rawOb: "METAR ZGGG 220400Z 12005KT ...",
      },
    ]);

    const result = await fetchMetarSnapshot({
      id: "guangzhou_can",
      name: "Guangzhou Baiyun International Airport",
      timezone: "Asia/Shanghai",
    });

    expect(result.observation).toMatchObject({
      stationId: "ZGGG",
      temperatureC: 29,
      dewpointC: 21,
      windDirectionDegrees: 140,
      windSpeedKts: 8,
      stationName: "Guangzhou",
    });
    expect(result.recentTemperatures).toEqual([
      {
        observedAt: "2026-04-22T09:00:00.000Z",
        temperatureC: 29,
      },
      {
        observedAt: "2026-04-22T07:00:00.000Z",
        temperatureC: 27,
      },
      {
        observedAt: "2026-04-22T04:00:00.000Z",
        temperatureC: 24,
      },
    ]);
    expect(result.recentObservations).toEqual([
      {
        stationId: "ZGGG",
        stationName: "Guangzhou",
        observedAt: "2026-04-22T09:00:00.000Z",
        temperatureC: 29,
        dewpointC: 21,
        windDirectionDegrees: 140,
        windSpeedKts: 8,
        rawReport: "METAR ZGGG 220900Z 14008KT ...",
      },
      {
        stationId: "ZGGG",
        stationName: null,
        observedAt: "2026-04-22T07:00:00.000Z",
        temperatureC: 27,
        dewpointC: 20,
        windDirectionDegrees: null,
        windSpeedKts: null,
        rawReport: "METAR ZGGG 220700Z 15006KT ...",
      },
    ]);
    expect(result.recentReports).toEqual(result.recentObservations);
  });

  test("falls back to the official cache snapshot when the per-station history query fails", async () => {
    fetchBinaryMock.mockResolvedValueOnce({
      body: Buffer.from(
        gzipSync(
          [
            "raw_text,station_id,observation_time,latitude,longitude,temp_c,dewpoint_c,wind_dir_degrees,wind_speed_kt,wind_gust_kt,visibility_statute_mi,altim_in_hg,sea_level_pressure_mb,corrected,auto,auto_station,maintenance_indicator_on,no_signal,lightning_sensor_off,freezing_rain_sensor_off,present_weather_sensor_off,wx_string,sky_cover,cloud_base_ft_agl,sky_cover,cloud_base_ft_agl,sky_cover,cloud_base_ft_agl,sky_cover,cloud_base_ft_agl,flight_category,three_hr_pressure_tendency_mb,maxT_c,minT_c,maxT24hr_c,minT24hr_c,precip_in,pcp3hr_in,pcp6hr_in,pcp24hr_in,snow_in,vert_vis_ft,metar_type,elevation_m",
            '"METAR KLGA 230851Z 05004KT 10SM SCT250 08/07 A2994 RMK AO2","KLGA",2026-04-23T08:51:00.000Z,40.7794,-73.8803,7.8,6.7,50,4,,10+,29.94,1013.9,,,TRUE,TRUE,,,,,,SCT,25000,,,,,,,VFR,-0.05,,,,,,,,,,,METAR,9',
          ].join("\n"),
        ),
      ),
      contentType: "application/gzip",
      headers: new Headers(),
    });
    fetchJsonMock.mockRejectedValueOnce(new Error("history endpoint flaky"));

    const result = await fetchMetarSnapshot({
      id: "newyork_lga",
      name: "LaGuardia Airport",
      timezone: "America/New_York",
    });

    expect(fetchBinaryMock).toHaveBeenCalledWith(
      "https://aviationweather.gov/data/cache/metars.cache.csv.gz",
      expect.objectContaining({
        headers: expect.objectContaining({
          accept: "text/csv,application/gzip,*/*",
        }),
      }),
    );
    expect(result.observation).toMatchObject({
      stationId: "KLGA",
      temperatureC: 7.8,
      dewpointC: 6.7,
      windDirectionDegrees: 50,
      windSpeedKts: 4,
      rawReport: "METAR KLGA 230851Z 05004KT 10SM SCT250 08/07 A2994 RMK AO2",
      cacheHit: true,
    });
    expect(result.recentTemperatures).toEqual([
      {
        observedAt: "2026-04-23T08:51:00.000Z",
        temperatureC: 7.8,
      },
    ]);
    expect(result.recentObservations).toEqual([
      {
        stationId: "KLGA",
        stationName: null,
        observedAt: "2026-04-23T08:51:00.000Z",
        temperatureC: 7.8,
        dewpointC: 6.7,
        windDirectionDegrees: 50,
        windSpeedKts: 4,
        rawReport: "METAR KLGA 230851Z 05004KT 10SM SCT250 08/07 A2994 RMK AO2",
      },
    ]);
    expect(result.recentReports).toEqual(result.recentObservations);
  });

  test("covers the expanded airport METAR mapping for newly enabled cities", () => {
    expect(resolveMetarStationId("losangeles_lax")).toBe("KLAX");
    expect(resolveMetarStationId("paris_cdg")).toBe("LFPG");
    expect(resolveMetarStationId("hongkong_hkg")).toBe("VHHH");
    expect(resolveMetarStationId("taipei_tpe")).toBe("RCTP");
    expect(resolveMetarStationId("seoul_icn")).toBe("RKSI");
    expect(resolveMetarStationId("wellington_wlg")).toBe("NZWN");
    expect(resolveMetarStationId("masroor_opmr")).toBe("OPKC");
  });
});
