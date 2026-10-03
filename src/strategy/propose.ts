import { marketKind } from "@/data/kind.ts";
import { sizingFor } from "@/exchanges/mode.ts";
import { money } from "@/telegram/format.ts";
import type { Confidence } from "@/db/bets.ts";
import type { Exchange, Market, MarketEvent, Outcome } from "@/exchanges/types.ts";
import { describeError } from "@/lib/errors.ts";
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

// The best bet that didn't make it, and why: shown in the scan summary so a
// "0 proposed" scan still tells you what the research found
export type NearMiss = {
  marketTitle: string;
  outcomeLabel: string;
  modelProbability: number;
  marketPrice: number;
  probability: number;
  confidence: Confidence;
  // the price of the last check: the listed price, or the live quote if it got that far
  price: number;
  expectedReturn: number;
  reason: string;
};

export type Verdict = { proposal: Proposal | null; nearMiss: NearMiss | null };

// Prices this close to 0/1 are almost always right and fee floors eat any edge
const MIN_PRICE = 0.03;
const MAX_PRICE = 0.97;
const QUOTE_ATTEMPTS = 4;
// what counts as a live reading, per kind, for the near-miss note
const LIVE_READING: Partial<Record<string, string>> = {
  sports: "bookmaker odds for this line",
  "post-count": "the count so far",
  weather: "the station’s readings after the day’s peak",
};

const needs = `+${Math.round(settings.minEdge * 100)}%`;

type Priced =
  | { ok: true; stake: number; quotedPrice: number; expectedReturn: number }
  | { ok: false; quotedPrice: number; expectedReturn: number; reason: string };

// Price the stake with a live quote (fees + price impact included), shrinking it
// until the edge survives or the stake drops below the market minimum.
const priceStake = async (
  exchange: Exchange,
  event: MarketEvent,
  market: Market,
  outcome: Outcome,
  probability: number,
  initialStake: number,
  // the smallest order, and the stake increment (₦1, or 1¢)
  minStake: number,
  step: number,
): Promise<Priced> => {
  let stake = initialStake;
  let last: Priced = {
    ok: false,
    quotedPrice: outcome.price,
    expectedReturn: 0,
    reason: "no quote",
  };
  for (let attempt = 0; attempt < QUOTE_ATTEMPTS && stake >= minStake - 1e-9; attempt++) {
    const quote = await exchange.quote({
      eventId: event.id,
      marketId: market.id,
      outcomeId: outcome.id,
      amount: stake,
    });
    const edge = expectedReturn(probability, quote.avgPrice);
    if (quote.completeFill && edge >= settings.minEdge) {
      return { ok: true, stake, quotedPrice: quote.avgPrice, expectedReturn: edge };
    }
    last = {
      ok: false,
      quotedPrice: quote.avgPrice,
      expectedReturn: edge,
      reason: quote.completeFill
        ? `fees and price impact eat the edge (needs ${needs})`
        : "not enough liquidity",
    };
    stake = Math.floor(stake / 2 / step) * step;
  }
  return last;
};

export const proposeBet = async (
  exchange: Exchange,
  event: MarketEvent,
  estimates: Estimate[],
  bankroll: Bankroll,
  // whether the research found a live reading (see DeepDive.liveData)
  liveData: boolean,
): Promise<Verdict> => {
  const candidates: Proposal[] = [];
  const misses: NearMiss[] = [];
  const kind = marketKind(event);
  const blocked =
    !liveData && (settings.liveReadingRequiredKinds as readonly string[]).includes(kind);

  for (const estimate of estimates) {
    const market = event.markets.find((item) => item.id === estimate.marketId);
    if (!market || market.status !== "open") continue;

    for (const [index, outcome] of market.outcomes.entries()) {
      if (
        outcome.price < Math.max(MIN_PRICE, settings.minOutcomePrice) ||
        outcome.price > MAX_PRICE
      )
        continue;

      const modelProbability =
        index === 0 ? estimate.probabilityOutcome1 : 1 - estimate.probabilityOutcome1;
      const probability = blendProbability(modelProbability, outcome.price, estimate.confidence);
      const miss = (price: number, edge: number, reason: string) =>
        misses.push({
          marketTitle: market.title,
          outcomeLabel: outcome.label,
          modelProbability,
          marketPrice: outcome.price,
          probability,
          confidence: estimate.confidence,
          price,
          expectedReturn: edge,
          reason,
        });

      // cheap pre-check at the listed price before spending quote calls; the real price is only worse
      const listedEdge = expectedReturn(probability, outcome.price);
      if (listedEdge < settings.minEdge) {
        miss(outcome.price, listedEdge, `edge too small (needs ${needs})`);
        continue;
      }
      if (blocked) {
        miss(
          outcome.price,
          listedEdge,
          `no bet without a live reading (${LIVE_READING[kind] ?? "current data"})`,
        );
        continue;
      }

      // the smallest order this outcome takes: the exchange minimum, or its minimum share count
      // at this price (Polymarket: 5 shares), plus a little for the fee
      const minStake = Math.max(
        market.minOrderAmount,
        (market.minShares ?? 0) * outcome.price * 1.02,
      );
      const stake = stakeFor({
        probability,
        price: outcome.price,
        bankroll: bankroll.bankroll,
        deployable: bankroll.deployable,
        minOrderAmount: minStake,
        step: bankroll.currency === "USD" ? 0.01 : 1,
        kellyMultiplier: settings.kellyFraction,
        ...sizingFor(exchange.name),
      });
      if (stake === 0) {
        miss(
          outcome.price,
          listedEdge,
          `the smallest order (${money(minStake, bankroll.currency)}) is too big a share of the bankroll`,
        );
        continue;
      }

      try {
        const step = bankroll.currency === "USD" ? 0.01 : 1;
        const priced = await priceStake(
          exchange,
          event,
          market,
          outcome,
          probability,
          stake,
          minStake,
          step,
        );
        if (!priced.ok) {
          miss(priced.quotedPrice, priced.expectedReturn, priced.reason);
          continue;
        }
        candidates.push({
          market,
          outcome,
          modelProbability,
          probability,
          confidence: estimate.confidence,
          stake: priced.stake,
          quotedPrice: priced.quotedPrice,
          expectedReturn: priced.expectedReturn,
          expectedProfit: priced.stake * priced.expectedReturn,
        });
      } catch (error) {
        miss(outcome.price, listedEdge, `quote failed: ${describeError(error).message}`);
      }
    }
  }

  // One bet per event: in combined events the markets are correlated, so stacking bets compounds risk
  candidates.sort((a, b) => b.expectedProfit - a.expectedProfit);
  misses.sort((a, b) => b.expectedReturn - a.expectedReturn);
  return { proposal: candidates[0] ?? null, nearMiss: misses[0] ?? null };
};
