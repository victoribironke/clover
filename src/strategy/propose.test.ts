import { expect, test } from "bun:test";
import type { Exchange, Market, MarketEvent, QuoteRequest } from "@/exchanges/types.ts";
import type { Bankroll } from "./bankroll.ts";
import { proposeBet } from "./propose.ts";

const market = (id: string, price: number): Market => ({
  id,
  title: `${id} band`,
  rules: "",
  status: "open",
  outcomes: [
    { id: `${id}:yes`, label: "Yes", price },
    { id: `${id}:no`, label: "No", price: 0.99 },
  ],
  minOrderAmount: 0.01,
  minShares: 1,
  feePercentage: 0,
  resolvedOutcomeId: null,
});

test("prices the strongest candidate first and batches its stake sizes", async () => {
  const requests: QuoteRequest[][] = [];
  const exchange = {
    name: "kalshi",
    currency: "USD",
    payoutPerShare: 1,
    quote: async () => {
      throw new Error("single quote should not be used");
    },
    quoteMany: async (batch: QuoteRequest[]) => {
      requests.push(batch);
      return batch.map((request) => ({
        avgPrice: 0.3,
        amount: request.amount,
        shares: request.amount / 0.3,
        fee: 0,
        priceImpact: 0,
        completeFill: true,
      }));
    },
  } as unknown as Exchange;
  const event = {
    exchange: "kalshi",
    id: "weather",
    title: "Highest temperature in New York today?",
    category: "WEATHER",
    status: "open",
    markets: [market("strong", 0.3), market("weak", 0.45)],
  } as MarketEvent;
  const bankroll: Bankroll = {
    exchange: "kalshi",
    currency: "USD",
    capital: 50,
    available: 50,
    exposure: 0,
    bankroll: 50,
    deployable: 50,
    withdrawable: 0,
    realizedPnl: 0,
    dryRun: true,
  };

  const verdict = await proposeBet(
    exchange,
    event,
    [
      { marketId: "strong", probabilityOutcome1: 0.9, confidence: "high" },
      { marketId: "weak", probabilityOutcome1: 0.65, confidence: "high" },
    ],
    bankroll,
    true,
  );

  expect(verdict.proposal?.market.id).toBe("strong");
  expect(requests).toHaveLength(1);
  expect(requests[0]!.length).toBeGreaterThan(1);
});
