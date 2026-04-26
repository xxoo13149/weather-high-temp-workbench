import type {
  KellyMarketRow,
  KellyRecommendation,
  KellyRiskMode,
  KellyStreamMarketPatch,
  KellyWorkbenchResponse,
} from "./types";

const KELLY_FLOOR_ENTRY_PRICE = 0.1;
const KELLY_FLOOR_ENTRY_EPSILON = 1e-6;

const isFloorEntryPrice = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) && value <= KELLY_FLOOR_ENTRY_PRICE + KELLY_FLOOR_ENTRY_EPSILON;

export const shouldHideKellyFloorMarket = (
  market: Pick<KellyMarketRow, "yesBestAsk" | "yesPrice" | "noBestAsk" | "noPrice">,
) =>
  isFloorEntryPrice(market.yesBestAsk ?? market.yesPrice) ||
  isFloorEntryPrice(market.noBestAsk ?? market.noPrice);

const isTradableKellyRow = (market: KellyMarketRow) =>
  market.parseStatus === "matched" &&
  market.lifecycle === "tradable" &&
  (market.entrySourceYes !== "unavailable" || market.entrySourceNo !== "unavailable") &&
  !shouldHideKellyFloorMarket(market);

const applyKellyPatch = (
  market: KellyMarketRow,
  patch: KellyStreamMarketPatch | undefined,
): KellyMarketRow => {
  if (!patch) {
    return market;
  }

  return {
    ...market,
    lifecycle: patch.lifecycle,
    inactiveReason: patch.inactiveReason,
    observationFloorBlocked: patch.observationFloorBlocked,
    entrySourceYes: patch.entrySourceYes,
    entrySourceNo: patch.entrySourceNo,
    yesPrice: patch.yesPrice,
    noPrice: patch.noPrice,
    yesBestBid: patch.yesBestBid,
    yesBestAsk: patch.yesBestAsk,
    noBestBid: patch.noBestBid,
    noBestAsk: patch.noBestAsk,
    rawProbabilityYes: patch.rawProbabilityYes,
    rawProbabilityNo: patch.rawProbabilityNo,
    fairYes: patch.fairYes,
    fairNo: patch.fairNo,
    spreadPct: patch.spreadPct,
    edgeYes: patch.edgeYes,
    edgeNo: patch.edgeNo,
    kellyYes: patch.kellyYes,
    kellyNo: patch.kellyNo,
    recommendedSide: patch.recommendedSide,
    suggestedStake: patch.suggestedStake,
    updatedAt: patch.updatedAt,
  };
};

export const deriveKellyRecommendations = (
  markets: KellyMarketRow[],
  minEdgeOrBankroll: number,
  _riskMode?: KellyRiskMode,
  explicitMinEdge?: number,
): KellyRecommendation[] => {
  const minEdge = typeof explicitMinEdge === "number" ? explicitMinEdge : minEdgeOrBankroll;

  return markets
    .filter((market) => !shouldHideKellyFloorMarket(market))
    .filter((market) => market.recommendedSide !== "none")
    .map((market) => {
      const side: KellyRecommendation["side"] = market.recommendedSide === "yes" ? "yes" : "no";
      const fairPrice = side === "yes" ? market.fairYes : market.fairNo;
      const marketPrice =
        side === "yes" ? (market.yesBestAsk ?? market.yesPrice ?? 0) : (market.noBestAsk ?? market.noPrice ?? 0);
      const kellyFraction = side === "yes" ? market.kellyYes : market.kellyNo;
      const edge = side === "yes" ? market.edgeYes : market.edgeNo;

      return {
        slot: "primary" as const,
        marketId: market.marketId,
        title: market.title,
        marketUrl: market.marketUrl,
        side,
        edge,
        fairPrice,
        marketPrice,
        kellyFraction,
        suggestedStake: market.suggestedStake,
        reason:
          edge >= minEdge
            ? "当前可买价仍低于我们的公允价，可以继续纳入执行判断。"
            : "当前优势已回落到观察区间，先保留观察。",
      };
    })
    .sort((left, right) => right.suggestedStake - left.suggestedStake || right.edge - left.edge)
    .slice(0, 2)
    .map((entry, index) => ({
      ...entry,
      slot: index === 0 ? "primary" : "secondary",
    }));
};

export const deriveKellyBestObservation = (markets: KellyMarketRow[]): KellyRecommendation | null => {
  const ranked = [...markets]
    .filter((market) => !shouldHideKellyFloorMarket(market))
    .filter((market) => market.parseStatus === "matched")
    .sort((left, right) => {
      const leftEdge = Math.max(left.edgeYes, left.edgeNo);
      const rightEdge = Math.max(right.edgeYes, right.edgeNo);
      return rightEdge - leftEdge || (left.spreadPct ?? 999) - (right.spreadPct ?? 999);
    });

  const best = ranked[0];
  if (!best) {
    return null;
  }

  const side = best.edgeYes >= best.edgeNo ? "yes" : "no";
  return {
    slot: "secondary",
    marketId: best.marketId,
    title: best.title,
    marketUrl: best.marketUrl,
    side,
    edge: side === "yes" ? best.edgeYes : best.edgeNo,
    fairPrice: side === "yes" ? best.fairYes : best.fairNo,
    marketPrice: side === "yes" ? (best.yesBestAsk ?? best.yesPrice ?? 0) : (best.noBestAsk ?? best.noPrice ?? 0),
    kellyFraction: side === "yes" ? best.kellyYes : best.kellyNo,
    suggestedStake: 0,
    reason: "当前最值得盯盘的一档还没过执行阈值，先作为观察位保留。",
  };
};

export const mergeKellyStreamPatches = (
  snapshot: KellyWorkbenchResponse,
  patches: KellyStreamMarketPatch[],
  riskMode: KellyRiskMode,
  minEdge: number,
  _frames?: KellyWorkbenchResponse["frameSeries"],
): KellyWorkbenchResponse => {
  if (patches.length === 0 && snapshot.riskMode === riskMode && snapshot.minEdge === minEdge) {
    return snapshot;
  }

  const patchMap = new Map(patches.map((patch) => [patch.marketId, patch]));
  const combined = [...snapshot.markets, ...snapshot.inactiveMarkets];
  const patched = combined.map((market) => applyKellyPatch(market, patchMap.get(market.marketId)));
  const markets = patched.filter(isTradableKellyRow);
  const inactiveMarkets = patched.filter((market) => !isTradableKellyRow(market));
  const visibleTradableMarkets = markets.filter((market) => !shouldHideKellyFloorMarket(market));

  return {
    ...snapshot,
    riskMode,
    minEdge,
    markets,
    inactiveMarkets,
    frameSeries: snapshot.frameSeries,
    recommendations: deriveKellyRecommendations(visibleTradableMarkets, minEdge),
    bestObservation: deriveKellyBestObservation(visibleTradableMarkets),
  };
};
