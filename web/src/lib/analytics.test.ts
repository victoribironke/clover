import { describe, expect, test } from "bun:test";
import { calibration, filterBets, resultsByKind } from "./analytics";
import type { Bet } from "./types";

let seq = 0;
const bet = (overrides: Partial<Bet>): Bet => ({
  id: String(seq++),
  exchange: "bayse",
  currency: "NGN",
  eventId: "e",
  marketId: "m",
  outcomeId: "o",
  eventTitle: "Test",
  marketTitle: "Test",
  outcomeLabel: "Yes",
  analysisId: null,
  probability: 0.6,
  marketPrice: 0.5,
  quotedPrice: 0.52,
  expectedReturn: 0.1,
  confidence: "medium",
  stake: 500,
  rationale: "",
  status: "placed",
  dryRun: true,
  executeAt: "2026-09-24T10:00:00Z",
  orderId: null,
  fillPrice: null,
  shares: null,
  pnl: null,
  error: null,
  createdAt: `2026-09-24T09:${String(seq).padStart(2, "0")}:00Z`,
  updatedAt: "2026-09-24T09:30:00Z",
  ...overrides,
});

const bets = [
  bet({ kind: "weather", status: "won", pnl: 400, stake: 500, probability: 0.65, quotedPrice: 0.55 }),
  bet({ kind: "weather", status: "won", pnl: 300, stake: 500, probability: 0.62, quotedPrice: 0.6 }),
  bet({ kind: "weather", status: "lost", pnl: -500, stake: 500, probability: 0.68, quotedPrice: 0.58 }),
  bet({ kind: "post-count", status: "void", pnl: 0, stake: 300 }),
  bet({ kind: "post-count", status: "placed", stake: 700 }),
  bet({ status: "lost", pnl: -200, stake: 200, probability: 0.3, quotedPrice: 0.25 }),
  bet({ kind: "weather", status: "cancelled", stake: 900 }),
  bet({ kind: "weather", status: "won", pnl: 900, stake: 1000, dryRun: false }),
];

describe("filterBets", () => {
  test("filters by mode, status group and kind", () => {
    expect(filterBets(bets, { mode: "paper", status: "all", kind: "weather" })).toHaveLength(4);
    expect(filterBets(bets, { mode: "paper", status: "won", kind: "all" })).toHaveLength(2);
    expect(filterBets(bets, { mode: "paper", status: "not-placed", kind: "all" })).toHaveLength(1);
    expect(filterBets(bets, { mode: "live", status: "all", kind: "all" })).toHaveLength(1);
    expect(filterBets(bets, { mode: "paper", status: "all", kind: "unclassified" })).toHaveLength(1);
  });
});

describe("resultsByKind", () => {
  const rows = resultsByKind(bets, "paper");
  test("totals each kind, leaving out bets that were never placed", () => {
    const weather = rows.find((row) => row.kind === "weather")!;
    expect(weather).toMatchObject({ bets: 3, won: 2, lost: 1, staked: 1500, pnl: 200 });
    expect(weather.winRate).toBeCloseTo(2 / 3);
    expect(weather.roi).toBeCloseTo(200 / 1500);
  });
  test("reports void rate and open bets", () => {
    expect(rows.find((row) => row.kind === "post-count")).toMatchObject({ bets: 2, open: 1, voided: 1, voidRate: 1, winRate: null });
  });
});

describe("calibration", () => {
  test("buckets decided bets by the bot's probability", () => {
    const result = calibration(bets, "paper", "probability");
    expect(result.n).toBe(4);
    const bucket = result.buckets.find((b) => b.label === "60-70%")!;
    expect(bucket.n).toBe(3);
    expect(bucket.actual).toBeCloseTo(2 / 3);
  });
  test("brier score: 0 is perfect, 0.25 is a coin flip", () => {
    const perfect = calibration([bet({ status: "won", probability: 1 }), bet({ status: "lost", probability: 0 })], "paper", "probability");
    expect(perfect.brier).toBe(0);
    const coin = calibration([bet({ status: "won", probability: 0.5 }), bet({ status: "lost", probability: 0.5 })], "paper", "probability");
    expect(coin.brier).toBeCloseTo(0.25);
  });
});
