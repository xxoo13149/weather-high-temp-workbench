import type { KellyMarketRow, KellyRecommendation, KellyRiskMode, KellyStreamMarketPatch, KellyWorkbenchResponse } from "./types";

export const deriveKellyRecommendations = (
  markets: KellyMarketRow[],
  minEdgeOrBankroll: number,
  _riskMode?: KellyRiskMode,
  explicitMinEdge?: number,
): KellyRecommendation[] => {
  const minEdge = typeof explicitMinEdge === "number" ? explicitMinEdge : minEdgeOrBankroll;

  return markets
    .filter((market) => market.recommendedSide !== "none")
    .map((market) => {
      const side: KellyRecommendation["side"] = market.recommendedSide === "yes" ? "yes" : "no";
      const fairPrice = side === "yes" ? market.fairYes : market.fairNo;
      const marketPrice = side === "yes" ? (market.yesBestAsk ?? market.yesPrice ?? 0) : (market.noBestAsk ?? market.noPrice ?? 0);
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
        reason: edge >= minEdge ? "盘口价格仍低于我们的公允价。" : "该机会已回落到观察区间。",
      };
    })
    .sort((left, right) => right.suggestedStake - left.suggestedStake || right.edge - left.edge)
    .slice(0, 2)
    .map((entry, index) => ({
      ...entry,
      slot: index === 0 ? "primary" : "secondary",
    }));
};

export const mergeKellyStreamPatches = (
  snapshot: KellyWorkbenchResponse,
  patches: KellyStreamMarketPatch[],
  riskMode: KellyRiskMode,
  minEdge: number,
): KellyWorkbenchResponse => {
  const patchMap = new Map(patches.map((patch) => [patch.marketId, patch]));
  const markets = snapshot.markets.map((market) => {
    const patch = patchMap.get(market.marketId);
    if (!patch) {
      return market;
    }

    return {
      ...market,
      yesPrice: patch.yesPrice,
      noPrice: patch.noPrice,
      yesBestBid: patch.yesBestBid,
      yesBestAsk: patch.yesBestAsk,
      noBestBid: patch.noBestBid,
      noBestAsk: patch.noBestAsk,
      spreadPct: patch.spreadPct,
      edgeYes: patch.edgeYes,
      edgeNo: patch.edgeNo,
      kellyYes: patch.kellyYes,
      kellyNo: patch.kellyNo,
      recommendedSide: patch.recommendedSide,
      suggestedStake: patch.suggestedStake,
      updatedAt: patch.updatedAt,
    };
  });

  return {
    ...snapshot,
    riskMode,
    minEdge,
    markets,
    recommendations: deriveKellyRecommendations(markets, minEdge),
  };
};
