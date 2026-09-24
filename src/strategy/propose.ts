import { config } from "@/config.ts";
import type { Confidence } from "@/db/bets.ts";
import type { Exchange, Market, MarketEvent, Outcome } from "@/exchanges/types.ts";
import { errorMessage, log } from "@/lib/logger.ts";
import type { Estimate } from "@/research/deep-dive.ts";
import { settings } from "@/settings.ts";
import type { Bankroll } from "./bankroll.ts";
import { blendProbability, expectedReturn, stakeFor } from "./sizing.ts";

export type Proposal = {
  market: Market;
  outcome: Outcome;
  modelProbability: number;
  probability: number;
  confidence: Confidence;
  stake: number;
  quotedPrice: number;
  expectedReturn: number;
  expectedProfit: number;
};

// Prices this close to 0/1 are almost always right and fee floors eat any edge
const MIN_PRICE = 0.03;
const MAX_PRICE = 0.97;
const QUOTE_ATTEMPTS = 4;

// Price the stake with a live quote (fees + price impact included), shrinking it
// until the edge survives or the stake drops below the market minimum.
const priceStake = async (
  exchange: Exchange,
  event: MarketEvent,
  market: Market,
  outcome: Outcome,
  probability: number,
  initialStake: number,
) => {
  let stake = initialStake;
  for (let attempt = 0; attempt < QUOTE_ATTEMPTS && stake >= market.minOrderAmount; attempt++) {
    const quote = await exchange.quote({ eventId: event.id, marketId: market.id, outcomeId: outcome.id, amount: stake });
    const edge = expectedReturn(probability, quote.avgPrice);
    if (quote.completeFill && edge >= settings.minEdge) {
      return { stake, quotedPrice: quote.avgPrice, expectedReturn: edge };
    }
    stake = Math.floor(stake / 2);
  }
  return null;
};

export const proposeBet = async (
  exchange: Exchange,
  event: MarketEvent,
  estimates: Estimate[],
  bankroll: Bankroll,
): Promise<Proposal | null> => {
  const candidates: Proposal[] = [];

  for (const estimate of estimates) {
    const market = event.markets.find((item) => item.id === estimate.marketId);
    if (!market || market.status !== "open") continue;

    for (const [index, outcome] of market.outcomes.entries()) {
      if (outcome.price < MIN_PRICE || outcome.price > MAX_PRICE) continue;

      const modelProbability = index === 0 ? estimate.probabilityOutcome1 : 1 - estimate.probabilityOutcome1;
      const probability = blendProbability(modelProbability, outcome.price, estimate.confidence);
      // cheap pre-check at the listed price before spending quote calls; the real price is only worse
      if (expectedReturn(probability, outcome.price) < settings.minEdge) continue;

      const stake = stakeFor({
        probability,
        price: outcome.price,
        bankroll: bankroll.bankroll,
        deployable: bankroll.deployable,
        minOrderAmount: market.minOrderAmount,
        kellyMultiplier: settings.kellyFraction,
        maxBetFraction: settings.maxBetFraction,
      });
      if (stake === 0) continue;

      try {
        const priced = await priceStake(exchange, event, market, outcome, probability, stake);
        if (!priced) continue;
        candidates.push({
          market,
          outcome,
          modelProbability,
          probability,
          confidence: estimate.confidence,
          ...priced,
          expectedProfit: priced.stake * priced.expectedReturn,
        });
      } catch (error) {
        log.warn("quote failed", { eventId: event.id, marketId: market.id, error: errorMessage(error) });
      }
    }
  }

  // One bet per event: in combined events the markets are correlated, so stacking bets compounds risk
  candidates.sort((a, b) => b.expectedProfit - a.expectedProfit);
  return candidates[0] ?? null;
};
