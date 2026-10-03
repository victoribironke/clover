import { expect, test } from "bun:test";
import type { Bet } from "@/db/bets.ts";
import { resultsMessage } from "./results.ts";

const bet = (overrides: Partial<Bet>): Bet => ({
  id: Math.random().toString(),
  exchange: "kalshi",
  currency: "USD",
  eventId: "e",
  marketId: "m",
  outcomeId: "o",
  eventTitle: "Highest temperature in NYC",
  kind: "weather",
  marketTitle: "72° to 73°",
  outcomeLabel: "Yes",
  analysisId: null,
  probability: 0.7,
  marketPrice: 0.6,
  quotedPrice: 0.6,
  expectedReturn: 0.1,
  confidence: "high",
  stake: 1,
  rationale: "",
  status: "won",
  dryRun: true,
  executeAt: "",
  orderId: null,
  fillPrice: 0.6,
  shares: 1.6,
  pnl: 0.6,
  error: null,
  telegramMessageId: null,
  createdAt: "",
  updatedAt: "",
  ...overrides,
});

test("sums one exchange's settled paper bets, by type, with calibration", () => {
  const bets = [
    bet({}),
    bet({ status: "lost", pnl: -1 }),
    bet({ status: "won", pnl: 0.6 }),
    bet({ kind: "sports", status: "lost", pnl: -1, probability: 0.3 }),
    bet({ status: "void", pnl: 0 }),
    // ignored: another exchange, a live bet, an open bet
    bet({ exchange: "bayse", currency: "NGN", pnl: 999 }),
    bet({ dryRun: false, pnl: 50 }),
    bet({ status: "placed", pnl: null }),
  ];
  const text = resultsMessage("kalshi", "USD", true, bets);
  expect(text).toContain("Kalshi results");
  expect(text).toContain("5 settled · 2 won · 2 lost · 1 void");
  expect(text).toContain("P&L <b>-$0.80</b> on $4.00 staked");
  expect(text).toContain("Weather: 2/4 · +$0.20");
  expect(text).toContain("Sports: 0/1 · -$1.00");
  expect(text).toContain("60-80%: 3 bets · said 70.0% → won 66.7%");
  expect(text).toContain("Brier score");
});

test("says so when nothing has settled", () => {
  expect(resultsMessage("polymarket", "USD", true, [])).toContain("No settled bets yet.");
});
