import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { LOCATION_REGISTRY } from "../src/config.js";
import { PolymarketClient } from "../src/kelly/polymarket.js";

describe("PolymarketClient", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      return new Response(
        JSON.stringify([
          {
            id: "market-1",
            slug: "miami-high-temp-30c-mar-28-2026",
            question: "Will the high temperature in Miami be at least 30C on Mar 28, 2026?",
            eventTitle: "Miami weather",
            conditionId: "condition-1",
            line: 30,
            outcomes: ["Yes", "No"],
            clobTokenIds: ["yes-1", "no-1"],
            volume24hr: 12000,
            liquidity: 34000,
            endDateIso: "2026-03-28T23:59:00-04:00",
          },
        ]),
        {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
        },
      );
    }) as typeof fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("discovers and parses a matched high-temperature market", async () => {
    const client = new PolymarketClient();
    const result = await client.discoverMarkets(LOCATION_REGISTRY.miami_mia, "2026-03-28");

    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates[0]).toMatchObject({
      parseStatus: "matched",
      contractType: "atLeast",
      bucketStartC: 30,
      yesTokenId: "yes-1",
      noTokenId: "no-1",
    });
  });
});

