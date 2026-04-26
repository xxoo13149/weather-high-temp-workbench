import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import {
  extractWeekMeteogramHighchartsUrl,
  parseWeekMeteogramHighcharts,
  resolveWeekMeteogramTemperatureUnit,
} from "../src/providers/meteoblue/meteogram.js";

const fixture = (name: string): string =>
  readFileSync(join(process.cwd(), "tests", "fixtures", name), "utf8");

describe("week meteogram parser", () => {
  test("extracts the embedded highcharts url from the week page", () => {
    expect(extractWeekMeteogramHighchartsUrl(fixture("week-complete.html"))).toBe(
      "https://my.meteoblue.com/images/meteogram?temperature_units=C&windspeed_units=kmh&precipitation_units=mm&format=highcharts&sig=test-week",
    );
  });

  test("parses true hourly temperature, precipitation, wind speed and gust", () => {
    const parsed = parseWeekMeteogramHighcharts(fixture("week-meteogram-highcharts.json"), "Asia/Shanghai");

    expect(parsed.items).toHaveLength(4);
    expect(parsed.items[0]).toMatchObject({
      timestamp: "2026-03-28T00:00:00+08:00",
      endAt: "2026-03-28T01:00:00+08:00",
      iconUrl: "https://static.example/picto-00.png",
      temperatureC: 10,
      windDirection: "SSE",
      windSpeedKphMin: 7.5,
      windSpeedKphMax: 14.5,
      precipitationMm: 0,
      precipitationProbabilityPct: null,
    });
    expect(parsed.items[2]).toMatchObject({
      timestamp: "2026-03-28T02:00:00+08:00",
      temperatureC: 11.4,
      windDirection: null,
      windSpeedKphMin: 8.8,
      windSpeedKphMax: 16.2,
      precipitationMm: 0.25,
    });
  });

  test("normalizes imperial meteogram temperatures back to canonical Celsius", () => {
    const raw = JSON.stringify({
      credits: {
        text: "Last update: 2026-04-09 13:10",
      },
      series: [
        {
          name: "Temperature",
          data: [
            { name: "2026-04-09 00:00:00", y: 72 },
            { name: "2026-04-09 01:00:00", y: 73.3 },
          ],
        },
      ],
    });

    expect(
      resolveWeekMeteogramTemperatureUnit(
        "https://my.meteoblue.com/images/meteogram?temperature_units=F&windspeed_units=mph&format=highcharts",
        "C",
      ),
    ).toBe("F");

    const parsed = parseWeekMeteogramHighcharts(raw, "America/New_York", "F");

    expect(parsed.items[0]?.temperatureC).toBeCloseTo(22.2, 1);
    expect(parsed.items[1]?.temperatureC).toBeCloseTo(22.9, 1);
  });
});
