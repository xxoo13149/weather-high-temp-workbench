import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { parseWeekPage } from "../src/providers/meteoblue/week.js";

const fixture = (name: string): string =>
  readFileSync(join(process.cwd(), "tests", "fixtures", name), "utf8");

const referenceDate = new Date("2026-03-27T15:30:00.000Z");
const timeZone = "Asia/Shanghai";
const locationName = "Shanghai Pudong International Airport";

const minimalThreeHourTable = `
  <div class="three-hourly-table">
    <table class="picto three-hourly-view">
      <tbody>
        <tr class="times"><th></th><td><div class="cell time"><time datetime="2026-03-28T03:00:00+08:00">03</time></div></td></tr>
        <tr class="icons"><th></th><td><img class="picon3h" src="https://static.example/icon.svg" alt="Cloudy" /></td></tr>
        <tr class="temperatures"><th></th><td><div class="cell">10°</div></td></tr>
      </tbody>
    </table>
  </div>
`;

describe("parseWeekPage", () => {
  test("parses the 3h table and weather report", () => {
    const parsed = parseWeekPage(fixture("week-complete.html"), referenceDate, timeZone, locationName);

    expect(parsed.sourceObservedAt).toBe("2026-03-27T23:30:00.000Z");
    expect(parsed.threeHourItems).toHaveLength(2);
    expect(parsed.threeHourItems[0]).toMatchObject({
      timestamp: "2026-03-28T03:00:00+08:00",
      summary: "Partly cloudy",
      temperatureC: 10,
      feelsLikeC: 8,
      windDirection: "SSW",
      windSpeedKphMin: 7,
      windSpeedKphMax: 17,
      precipitationMm: 0,
      precipitationProbabilityPct: 0,
    });
    expect(parsed.report.available).toBe(true);
    expect(parsed.report.sourceTextEn).toContain("Temperatures peaking at 21");
    expect(parsed.report.textZh).toContain("最高气温");
    expect(parsed.report.textZh).not.toContain("紫外线");
    expect(parsed.report.textZh).not.toContain("可信度");
    expect(parsed.report.metrics).toMatchObject({
      maxTemperatureC: 21,
      uvIndex: 7,
      forecastDayLabel: "Saturday",
      predictability: "high",
      predictabilityScore: 3,
    });
  });

  test("keeps parsing the report when only a reduced 3h table is available", () => {
    const parsed = parseWeekPage(fixture("week-missing.html"), referenceDate, timeZone, locationName);

    expect(parsed.threeHourItems).toHaveLength(1);
    expect(parsed.report.available).toBe(true);
    expect(parsed.partial).toBe(false);
  });

  test("extracts report from h3.report-heading and translates current meteoblue sentence variants", () => {
    const html = `
      <!DOCTYPE html>
      <html lang="en">
        <body>
          <section class="weather-report-text">
            <h3 class="report-heading">Weather report for Shanghai Pudong International Airport</h3>
            <p>
              During the night and in the morning a few clouds are expected, and some more clouds roll across in the afternoon.
              The sun will not be visible. Temperatures as high as 21 °C are foreseen.
              The UV-Index climbs up to 7, don't forget to use sunscreen when spending the day outside.
              Overnight into Saturday blows a light breeze (7 to 12 km/h). During the day a gentle breeze is expected (12 to 20 km/h).
              Winds blowing overnight from South and by day from Southeast.
              The weather forecast for Shanghai Pudong International Airport for Saturday is likely to be accurate.
            </p>
          </section>
          ${minimalThreeHourTable}
        </body>
      </html>
    `;

    const parsed = parseWeekPage(html, referenceDate, timeZone, locationName);

    expect(parsed.report.available).toBe(true);
    expect(parsed.report.sourceTextEn).toContain("The UV-Index climbs up to 7");
    expect(parsed.report.textZh).toContain("最高气温");
    expect(parsed.report.textZh).not.toContain("紫外线指数");
    expect(parsed.report.textZh).not.toContain("天气预报可信度");
    expect(parsed.report.textZh).not.toContain("UV-Index");
  });

  test("keeps non-empty Chinese output when a sentence does not match translation templates", () => {
    const html = `
      <!DOCTYPE html>
      <html lang="en">
        <body>
          <section class="weather-report-text">
            <h3 class="report-heading">Weather report for Shanghai Pudong International Airport</h3>
            <p>
              A bespoke synoptic setup persists. The weather forecast for Shanghai Pudong International Airport for Saturday is likely to be accurate.
            </p>
          </section>
          ${minimalThreeHourTable}
        </body>
      </html>
    `;

    const parsed = parseWeekPage(html, referenceDate, timeZone, locationName);

    expect(parsed.report.available).toBe(true);
    expect(parsed.report.textZh).toMatch(/[\u4e00-\u9fff]/);
    expect(parsed.report.textZh?.trim().length).toBeGreaterThan(0);
    expect(parsed.report.textZh).not.toContain("暂未细译");
    expect(parsed.report.textZh).not.toMatch(/[A-Za-z]{2,}/);
  });

  test("extracts only real one-hour fields without guessing", () => {
    const parsed = parseWeekPage(fixture("week-complete.html"), referenceDate, timeZone, locationName);

    expect(parsed.oneHourItems).toHaveLength(2);
    expect(parsed.oneHourItems[0]).toMatchObject({
      timestamp: "2026-03-28T03:00:00+08:00",
      temperatureC: 10,
      feelsLikeC: 8,
      windDirection: "SSW",
      windSpeedKphMin: 7,
      windSpeedKphMax: 17,
      precipitationMm: 0,
      precipitationProbabilityPct: 0,
      summaryZh: "局部多云。",
    });
    expect(parsed.oneHourItems[1]).toMatchObject({
      timestamp: "2026-03-28T04:00:00+08:00",
      temperatureC: 11,
      feelsLikeC: 9,
      windDirection: "ESE",
      windSpeedKphMin: 8,
      windSpeedKphMax: 15,
      precipitationMm: 1.1,
      precipitationProbabilityPct: 20,
      summaryZh: "晴朗。",
    });
  });

  test("adds field-level warnings when 1h optional rows are missing", () => {
    const html = `
      <!DOCTYPE html>
      <html lang="en">
        <body>
          <section class="weather-report-text">
            <h3 class="report-heading">Weather report for Shanghai Pudong International Airport</h3>
            <p>Temperatures peaking at 18 °C. The weather forecast for Shanghai Pudong International Airport for Saturday is likely to be accurate.</p>
          </section>
          <table class="picto hourly-view">
            <tbody>
              <tr class="times">
                <td><time datetime="2026-03-28T03:00:00+08:00">03</time></td>
                <td><time datetime="2026-03-28T04:00:00+08:00">04</time></td>
              </tr>
              <tr class="icons">
                <td><img class="picon1h" alt="Partly cloudy" src="https://example.com/1.svg" /></td>
                <td><img class="picon1h" alt="Clear" src="https://example.com/2.svg" /></td>
              </tr>
              <tr class="temperatures"><td>10°</td><td>11°</td></tr>
              <tr class="windspeeds"><td>7-12</td><td>8-13</td></tr>
              <tr class="precips"><td>-</td><td>0.2</td></tr>
            </tbody>
          </table>
          ${minimalThreeHourTable}
        </body>
      </html>
    `;

    const parsed = parseWeekPage(html, referenceDate, timeZone, locationName);

    expect(parsed.oneHourWarnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("feelsLikeC"),
        expect.stringContaining("precipitationProbabilityPct"),
        expect.stringContaining("windDirection"),
      ]),
    );
  });

  test("extracts 1h probability, feels-like and wind metadata from aria and data attributes", () => {
    const html = `
      <!DOCTYPE html>
      <html lang="en">
        <body>
          <section class="weather-report-text">
            <h3 class="report-heading">Weather report for Shanghai Pudong International Airport</h3>
            <p>Temperatures peaking at 18 °C. The weather forecast for Shanghai Pudong International Airport for Saturday is likely to be accurate.</p>
          </section>
          <table class="picto hourly-view">
            <tbody>
              <tr class="times">
                <td><time datetime="2026-03-28T03:00:00+08:00">03</time></td>
                <td><time datetime="2026-03-28T04:00:00+08:00">04</time></td>
              </tr>
              <tr class="icons">
                <td><img class="picon1h" alt="Partly cloudy" src="https://example.com/1.svg" /></td>
                <td><img class="picon1h" alt="Clear" src="https://example.com/2.svg" /></td>
              </tr>
              <tr class="temperatures"><td>10°</td><td>11°</td></tr>
              <tr class="feels_like">
                <td><span data-value="8">feels like 8°</span></td>
                <td><span aria-label="apparent temperature 9°">9°</span></td>
              </tr>
              <tr class="windspeeds">
                <td aria-label="Wind Northwest 7-12 km/h">7-12</td>
                <td data-winddir="ENE" title="8-13 km/h">8-13</td>
              </tr>
              <tr class="precipitation">
                <td data-precip="0.0" data-tooltip="0% probability"></td>
                <td data-precip="0.6" data-tooltip="35% probability"></td>
              </tr>
            </tbody>
          </table>
          ${minimalThreeHourTable}
        </body>
      </html>
    `;

    const parsed = parseWeekPage(html, referenceDate, timeZone, locationName);

    expect(parsed.oneHourItems[0]).toMatchObject({
      feelsLikeC: 8,
      windDirection: "NW",
      windSpeedKphMin: 7,
      windSpeedKphMax: 12,
      precipitationMm: 0,
      precipitationProbabilityPct: 0,
    });
    expect(parsed.oneHourItems[1]).toMatchObject({
      feelsLikeC: 9,
      windDirection: "ENE",
      windSpeedKphMin: 8,
      windSpeedKphMax: 13,
      precipitationMm: 0.6,
      precipitationProbabilityPct: 35,
    });
  });

  test("normalizes source timestamps to the location timezone when datetime omits offset", () => {
    const html = `
      <!DOCTYPE html>
      <html lang="en">
        <body>
          <section class="weather-report-text">
            <h3 class="report-heading">Weather report for Munich Airport</h3>
            <p>Temperatures peaking at 16 °C. The weather forecast for Munich Airport for Saturday is likely to be accurate.</p>
          </section>
          <div class="three-hourly-table">
            <table class="picto three-hourly-view">
              <tbody>
                <tr class="times">
                  <td><time datetime="2026-04-04T18:00:00">18</time></td>
                </tr>
                <tr class="icons">
                  <td><img class="picon3h" alt="Cloudy" src="https://example.com/icon.svg" /></td>
                </tr>
                <tr class="temperatures"><td>12°</td></tr>
              </tbody>
            </table>
          </div>
        </body>
      </html>
    `;

    const parsed = parseWeekPage(
      html,
      new Date("2026-04-04T12:00:00.000Z"),
      "Europe/Berlin",
      "Munich Airport",
    );

    expect(parsed.threeHourItems[0]?.timestamp).toBe("2026-04-04T18:00:00+02:00");
  });

  test("normalizes imperial temperatures into canonical Celsius fields for Miami-style pages", () => {
    const html = `
      <!DOCTYPE html>
      <html lang="en">
        <body>
          <section class="weather-report-text">
            <h3 class="report-heading">Weather report for Miami International Airport</h3>
            <p>
              During the night and in the morning a few clouds are expected, and some more clouds roll across in the afternoon.
              Temperatures peaking at 76 °F.
              Overnight into Saturday blows a light breeze (7 to 12 km/h). During the day a gentle breeze is expected (12 to 20 km/h).
              Winds blowing overnight from South and by day from Southeast.
              The weather forecast for Miami International Airport for Saturday is likely to be accurate.
            </p>
          </section>
          <table class="picto hourly-view">
            <tbody>
              <tr class="times">
                <td><time datetime="2026-03-28T03:00:00-04:00">03</time></td>
                <td><time datetime="2026-03-28T04:00:00-04:00">04</time></td>
              </tr>
              <tr class="icons">
                <td><img class="picon1h" alt="Partly cloudy" src="https://example.com/1.svg" /></td>
                <td><img class="picon1h" alt="Clear" src="https://example.com/2.svg" /></td>
              </tr>
              <tr class="temperatures"><td>72°</td><td>73°</td></tr>
              <tr class="feels_like"><td>70°</td><td>74°</td></tr>
              <tr class="windspeeds"><td>7-12</td><td>8-13</td></tr>
              <tr class="precips"><td>-</td><td>0.0</td></tr>
            </tbody>
          </table>
          <div class="three-hourly-table">
            <table class="picto three-hourly-view">
              <tbody>
                <tr class="times">
                  <td><time datetime="2026-03-28T03:00:00-04:00">03</time></td>
                </tr>
                <tr class="icons">
                  <td><img class="picon3h" alt="Cloudy" src="https://static.example/icon.svg" /></td>
                </tr>
                <tr class="temperatures"><td>72°</td></tr>
              </tbody>
            </table>
          </div>
        </body>
      </html>
    `;

    const parsed = parseWeekPage(
      html,
      new Date("2026-03-28T06:00:00.000Z"),
      "America/New_York",
      "Miami International Airport",
      "F",
    );

    expect(parsed.oneHourItems[0]).toMatchObject({
      temperatureC: 22.2,
      feelsLikeC: 21.1,
    });
    expect(parsed.oneHourItems[1]).toMatchObject({
      temperatureC: 22.8,
      feelsLikeC: 23.3,
    });
    expect(parsed.threeHourItems[0]?.temperatureC).toBeCloseTo(22.2, 1);
    expect(parsed.report.metrics.maxTemperatureC).toBeCloseTo(24.4, 1);
    expect(parsed.report.textZh).toContain("24.4°C");
    expect(parsed.report.textZh).not.toContain("76°C");
  });

  test("prefers the source-selected temperature unit over inactive toggle options", () => {
    const html = `
      <!DOCTYPE html>
      <html lang="en">
        <body>
          <ul class="unit-selector">
            <li class="selected"><a class="unit" data-type="temp" data-unit="CELSIUS">°C</a></li>
            <li><a class="unit" data-type="temp" data-unit="FAHRENHEIT">°F</a></li>
          </ul>
          <section class="weather-report-text">
            <h3 class="report-heading">Weather report for Shanghai Pudong International Airport</h3>
            <p>Temperatures peaking at 21 °C. The weather forecast for Shanghai Pudong International Airport for Saturday is likely to be accurate.</p>
          </section>
          <table class="picto hourly-view">
            <tbody>
              <tr class="times">
                <td><time datetime="2026-03-28T03:00:00+08:00">03</time></td>
                <td><time datetime="2026-03-28T06:00:00+08:00">06</time></td>
              </tr>
              <tr class="icons">
                <td><img class="picon1h" alt="Partly cloudy" src="https://example.com/1.svg" /></td>
                <td><img class="picon1h" alt="Clear" src="https://example.com/2.svg" /></td>
              </tr>
              <tr class="temperatures"><td>20°</td><td>18°</td></tr>
              <tr class="windspeeds"><td>7-12</td><td>8-13</td></tr>
              <tr class="precips"><td>-</td><td>0.0</td></tr>
            </tbody>
          </table>
          ${minimalThreeHourTable}
        </body>
      </html>
    `;

    const parsed = parseWeekPage(html, referenceDate, timeZone, locationName, "F");

    expect(parsed.oneHourItems[0]?.temperatureC).toBe(20);
    expect(parsed.oneHourItems[1]?.temperatureC).toBe(18);
    expect(parsed.report.metrics.maxTemperatureC).toBe(21);
    expect(parsed.report.textZh).toContain("21°C");
  });
});
