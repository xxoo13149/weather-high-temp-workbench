import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { AppError } from "../src/domain/errors.js";
import {
  extractMultiModelHighchartsUrl,
  extractMultiModelImageUrl,
  extractMultiModelPageInventory,
} from "../src/providers/meteoblue/multimodel.js";

const fixture = (name: string): string =>
  readFileSync(join(process.cwd(), "tests", "fixtures", name), "utf8");

describe("multimodel url extraction", () => {
  test("extracts the official png download link", () => {
    expect(extractMultiModelImageUrl(fixture("multimodel.html"))).toBe(
      "https://my.meteoblue.com/images/meteogram_multimodel?format=png&download=1&sig=abc123",
    );
  });

  test("extracts the public highcharts link", () => {
    expect(extractMultiModelHighchartsUrl(fixture("multimodel.html"))).toBe(
      "https://my.meteoblue.com/images/meteogram_multimodel?format=highcharts&download=1&sig=chart123",
    );
  });

  test("throws when the download link is missing", () => {
    expect(() => extractMultiModelImageUrl(fixture("multimodel-missing.html"))).toThrowError(AppError);
  });

  test("throws when the highcharts link is missing", () => {
    expect(() => extractMultiModelHighchartsUrl(fixture("multimodel-missing.html"))).toThrowError(AppError);
  });
  test("extracts selected page inventory with per-model last update", () => {
    const inventory = extractMultiModelPageInventory(fixture("multimodel-inventory.html"));

    expect(inventory.warnings).toEqual([]);
    expect(inventory.models).toHaveLength(3);
    expect(inventory.models[0]).toMatchObject({
      modelCode: "IFS025",
      sourceDisplayName: "IFS 0.25°",
      pageOrder: 0,
      pageLastUpdatedAt: "2026-04-04T00:00:00.000Z",
      pageLastUpdatedLabel: "00:00 UTC",
      sourceProvider: "ECMWF",
    });
  });
});


