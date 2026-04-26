import { afterEach, describe, expect, test, vi } from "vitest";

const { fetchJsonMock, fetchTextMock } = vi.hoisted(() => ({
  fetchJsonMock: vi.fn(),
  fetchTextMock: vi.fn(),
}));

vi.mock("../src/lib/http.js", () => ({
  fetchJson: fetchJsonMock,
  fetchText: fetchTextMock,
}));

import { fetchTafSnapshot } from "../src/providers/taf/service.js";

const buildDecodedPage = ({
  title = "Miami International Airport",
  rawTaf,
  cards,
}: {
  title?: string;
  rawTaf: string;
  cards: Array<{
    changeLabel: string;
    timeFromUnix?: number;
    timeToUnix?: number;
    flightCategory: string;
    wind: string;
    visibility: string;
    clouds: string;
    weather?: string;
  }>;
}) => `
  <html>
    <head>
      <title>${title} (KMIA) - TAF Weather Forecast</title>
    </head>
    <body>
      <div>
        <h3>Current TAF Forecast</h3>
        <div class="font-mono">
          <div class="text-gray-900">${rawTaf}</div>
        </div>
      </div>
      <div>
        <h4>Forecast Periods</h4>
        ${cards
          .map(
            (card) => `
              <div>
                <div>
                  <span>${card.changeLabel}</span>
                  ${typeof card.timeFromUnix === "number" ? `<span data-timestamp="${card.timeFromUnix}">from</span>` : ""}
                  ${typeof card.timeToUnix === "number" ? `<span data-timestamp="${card.timeToUnix}">to</span>` : ""}
                  <span>${card.flightCategory}</span>
                </div>
                <div class="grid">
                  <div>
                    <div class="font-medium">Wind</div>
                    <div class="text-gray-900">${card.wind}</div>
                  </div>
                  <div>
                    <div class="font-medium">Visibility</div>
                    <div class="text-gray-900">${card.visibility}</div>
                  </div>
                  ${card.weather
                    ? `<div><div class="font-medium">Weather</div><div class="text-gray-900">${card.weather}</div></div>`
                    : ""}
                  <div>
                    <div class="font-medium">Clouds</div>
                    <div class="text-gray-900">${card.clouds}</div>
                  </div>
                </div>
                <div>
                  <h5>📖 Plain English Explanation:</h5>
                  <p>Already decoded upstream.</p>
                </div>
              </div>
            `,
          )
          .join("")}
      </div>
    </body>
  </html>
`;

describe("TAF service", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    fetchJsonMock.mockReset();
    fetchTextMock.mockReset();
  });

  test("builds the active TAF segment from official structured data and decoded page cards", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-24T16:00:00.000Z"));

    const rawTaf =
      "TAF KMIA 240831Z 2409/2512 10008KT P6SM SCT040 SCT250 FM241500 10015G25KT P6SM SCT025 BKN050 FM250000 11008KT P6SM SCT030 SCT100 BKN250";
    fetchJsonMock.mockResolvedValueOnce([
      {
        icaoId: "KMIA",
        issueTime: "2026-04-24T08:31:00.000Z",
        validTimeFrom: "2026-04-24T09:00:00.000Z",
        validTimeTo: "2026-04-25T12:00:00.000Z",
        rawTAF: rawTaf,
        name: "Miami Intl",
        fcsts: [
          {
            timeFrom: "2026-04-24T09:00:00.000Z",
            timeTo: "2026-04-24T15:00:00.000Z",
            fcstChange: null,
            visib: "6+",
            wdir: 100,
            wspd: 8,
            clouds: [
              { cover: "SCT", base: 4000 },
              { cover: "SCT", base: 25000 },
            ],
          },
          {
            timeFrom: "2026-04-24T15:00:00.000Z",
            timeTo: "2026-04-24T21:00:00.000Z",
            fcstChange: "FM",
            visib: "6+",
            wdir: 100,
            wspd: 15,
            wgst: 25,
            clouds: [
              { cover: "SCT", base: 2500 },
              { cover: "BKN", base: 5000 },
            ],
          },
          {
            timeFrom: "2026-04-25T00:00:00.000Z",
            timeTo: "2026-04-25T06:00:00.000Z",
            fcstChange: "FM",
            visib: "6+",
            wdir: 110,
            wspd: 8,
            clouds: [
              { cover: "SCT", base: 3000 },
              { cover: "BKN", base: 25000 },
            ],
          },
        ],
      },
    ]);
    fetchTextMock.mockResolvedValueOnce(
      buildDecodedPage({
        rawTaf,
        cards: [
          {
            changeLabel: "BASE",
            flightCategory: "VFR",
            wind: "100° at 8 kt",
            visibility: ">6SM",
            clouds: "SCT040 SCT250",
          },
          {
            changeLabel: "FM241500",
            flightCategory: "VFR",
            wind: "100° at 15 kt",
            visibility: ">6SM",
            clouds: "SCT025 BKN050",
          },
          {
            changeLabel: "FM250000",
            flightCategory: "VFR",
            wind: "110° at 8 kt",
            visibility: ">6SM",
            clouds: "SCT030 BKN250",
          },
        ],
      }),
    );

    const result = await fetchTafSnapshot({
      id: "miami_mia",
      name: "Miami International Airport",
      timezone: "America/New_York",
    });

    expect(fetchJsonMock).toHaveBeenCalledWith("https://aviationweather.gov/api/data/taf?format=json&ids=KMIA");
    expect(fetchTextMock).toHaveBeenCalledWith("https://metarcentral.com/airport/KMIA/taf");
    expect(result.forecast).toMatchObject({
      stationId: "KMIA",
      stationName: "Miami Intl",
      rawTaf,
      sourceUrl: "https://metarcentral.com/airport/KMIA/taf",
      officialSourceUrl: "https://aviationweather.gov/api/data/taf?format=json&ids=KMIA",
      activeForecast: {
        changeLabel: "FM",
        plainEnglish: null,
        timeFrom: "2026-04-24T15:00:00.000Z",
        timeTo: "2026-04-24T21:00:00.000Z",
        windSpeedKts: 15,
        windGustKts: 25,
        visibilityKm: 10,
        clouds: ["SCT025", "BKN050"],
        cloudLayers: [
          { raw: "SCT025", cover: "SCT", baseFt: 2500 },
          { raw: "BKN050", cover: "BKN", baseFt: 5000 },
        ],
        flightCategory: "VFR",
      },
    });
    expect(result.forecast?.dailySummary).toMatchObject({
      headlineZh: expect.any(String),
      activeWindTextZh: expect.stringContaining("东风"),
    });
    expect(result.forecasts).toHaveLength(3);
  });

  test("enriches CAVOK and TX/TN groups from the raw TAF text", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-25T12:30:00.000Z"));

    const rawTaf =
      "TAF ZSPD 251100Z 2512/2618 12008KT CAVOK TX16/2512Z TX22/2607Z TN13/2521Z BECMG 2600/2602 15006KT SCT030";

    fetchJsonMock.mockResolvedValueOnce([
      {
        icaoId: "ZSPD",
        issueTime: "2026-04-25T11:00:00.000Z",
        validTimeFrom: "2026-04-25T12:00:00.000Z",
        validTimeTo: "2026-04-26T18:00:00.000Z",
        rawTAF: rawTaf,
        name: "Shanghai/Pudong Intl",
        fcsts: [
          {
            timeFrom: "2026-04-25T12:00:00.000Z",
            timeTo: "2026-04-26T00:00:00.000Z",
            fcstChange: null,
            visib: "CAVOK",
            wdir: 120,
            wspd: 8,
            clouds: [],
          },
          {
            timeFrom: "2026-04-26T00:00:00.000Z",
            timeTo: "2026-04-26T18:00:00.000Z",
            fcstChange: "BECMG",
            visib: "6+",
            wdir: 150,
            wspd: 6,
            clouds: [{ cover: "SCT", base: 3000 }],
          },
        ],
      },
    ]);
    fetchTextMock.mockRejectedValueOnce(new Error("decoded page unavailable"));

    const result = await fetchTafSnapshot({
      id: "shanghai_pvg",
      name: "Shanghai Pudong International Airport",
      timezone: "Asia/Shanghai",
    });

    expect(result.forecast?.dailySummary).toMatchObject({
      maxTemperatureC: 22,
      minTemperatureC: 13,
      temperatureExtremes: [
        {
          raw: "TX16/2512Z",
          kind: "max",
          temperatureC: 16,
          occursAt: "2026-04-25T12:00:00.000Z",
        },
        {
          raw: "TX22/2607Z",
          kind: "max",
          temperatureC: 22,
          occursAt: "2026-04-26T07:00:00.000Z",
        },
        {
          raw: "TN13/2521Z",
          kind: "min",
          temperatureC: 13,
          occursAt: "2026-04-25T21:00:00.000Z",
        },
      ],
    });
    expect(result.forecast?.activeForecast).toMatchObject({
      visibilityKm: 10,
      clouds: ["CAVOK"],
      cloudLayers: [{ raw: "CAVOK", cover: "CAVOK", baseFt: null, cloudType: null }],
      headlineZh: expect.stringContaining("CAVOK 放晴"),
      flightCategory: "VFR",
    });
    expect(result.forecasts[1]).toMatchObject({
      changeLabel: "BECMG",
      clouds: ["SCT030"],
      cloudLayers: [{ raw: "SCT030", cover: "SCT", baseFt: 3000 }],
      headlineZh: expect.stringContaining("疏云"),
    });
  });

  test("keeps the official structured TAF snapshot when the decoded page fetch fails", async () => {
    fetchJsonMock.mockResolvedValueOnce([
      {
        icaoId: "ZGGG",
        issueTime: "2026-04-24T09:00:00.000Z",
        validTimeFrom: "2026-04-24T09:00:00.000Z",
        validTimeTo: "2026-04-25T09:00:00.000Z",
        rawTAF: "TAF ZGGG TEST",
        name: "Guangzhou",
        fcsts: [
          {
            timeFrom: "2026-04-24T09:00:00.000Z",
            timeTo: "2026-04-25T09:00:00.000Z",
            fcstChange: null,
            visib: 3.73,
            wdir: 30,
            wspd: 8,
            clouds: [{ cover: "BKN", base: 1600 }],
          },
        ],
      },
    ]);
    fetchTextMock.mockRejectedValueOnce(new Error("metarcentral unavailable"));

    const result = await fetchTafSnapshot({
      id: "guangzhou_can",
      name: "Guangzhou Baiyun International Airport",
      timezone: "Asia/Shanghai",
    });

    expect(result.forecast).toMatchObject({
      stationId: "ZGGG",
      stationName: "Guangzhou",
      activeForecast: {
        changeLabel: "BASE",
        plainEnglish: null,
        visibilityKm: 6,
        clouds: ["BKN016"],
        flightCategory: "MVFR",
      },
    });
    expect(result.forecast?.dailySummary).toMatchObject({
      activeCloudTextZh: expect.stringContaining("1600ft"),
      headlineZh: expect.any(String),
    });
    expect(result.forecasts).toHaveLength(1);
  });

  test("falls back to the decoded page when the official API is unavailable", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-25T02:00:00.000Z"));

    const baseFrom = Date.parse("2026-04-24T09:00:00.000Z") / 1000;
    const baseTo = Date.parse("2026-04-24T15:00:00.000Z") / 1000;
    const fmFrom = Date.parse("2026-04-25T01:00:00.000Z") / 1000;
    const fmTo = Date.parse("2026-04-25T07:00:00.000Z") / 1000;
    const rawTaf =
      "TAF KMIA 240831Z 2409/2512 10007KT P6SM SCT030 BKN100 FM250100 VRB04KT P6SM FEW030 SCT080";

    fetchJsonMock.mockRejectedValueOnce(new Error("official unavailable"));
    fetchTextMock.mockResolvedValueOnce(
      buildDecodedPage({
        rawTaf,
        cards: [
          {
            changeLabel: "BASE",
            timeFromUnix: baseFrom,
            timeToUnix: baseTo,
            flightCategory: "VFR",
            wind: "100° at 7 kt",
            visibility: ">6SM",
            clouds: "SCT030 BKN100",
          },
          {
            changeLabel: "FM250100",
            timeFromUnix: fmFrom,
            timeToUnix: fmTo,
            flightCategory: "VFR",
            wind: "VRB° at 4 kt",
            visibility: ">6SM",
            clouds: "FEW030 SCT080",
          },
        ],
      }),
    );

    const result = await fetchTafSnapshot({
      id: "miami_mia",
      name: "Miami International Airport",
      timezone: "America/New_York",
    });

    expect(result.forecast).toMatchObject({
      stationId: "KMIA",
      stationName: "Miami International Airport",
      rawTaf,
      sourceUrl: "https://metarcentral.com/airport/KMIA/taf",
      activeForecast: {
        changeLabel: "FM250100",
        plainEnglish: null,
        timeFrom: "2026-04-25T01:00:00.000Z",
        timeTo: "2026-04-25T07:00:00.000Z",
        windDirectionDegrees: null,
        windSpeedKts: 4,
        visibilityKm: 10,
        clouds: ["FEW030", "SCT080"],
        flightCategory: "VFR",
      },
    });
    expect(result.forecasts).toHaveLength(2);
  });
});
