import { describe, expect, test } from "bun:test";
import { buildOverview } from "./overview";
import type { Bet } from "./types";

const bet = (overrides: Partial<Bet>): Bet => ({
  id: Math.random().toString(),
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
  createdAt: "2026-09-24T09:00:00Z",
  updatedAt: "2026-09-24T09:30:00Z",
  ...overrides,
});

const settings = { dryRun: true, capitalNgn: 10_000, dailyResearchBudgetUsd: 0.25 };
const now = new Date("2026-09-25T12:00:00Z");

describe("buildOverview", () => {
  const bets = [
    bet({ status: "won", pnl: 480, stake: 520, updatedAt: "2026-09-24T20:00:00Z" }),
    bet({ status: "lost", pnl: -700, stake: 700, updatedAt: "2026-09-24T18:00:00Z" }),
    bet({ status: "void", pnl: 0, stake: 300, updatedAt: "2026-09-24T19:00:00Z" }),
    bet({ status: "placed", stake: 1000 }),
    bet({ status: "cancelled", stake: 900 }),
    // live bets don't count toward the paper view
    bet({ status: "won", pnl: 5000, stake: 1000, dryRun: false }),
  ];
  const overview = buildOverview(bets, settings, [
    { day: "2026-09-24", usd: 0.05 },
    { day: "2026-08-30", usd: 0.1 },
  ], "paper", now);

  test("totals the paper record", () => {
    expect(overview).toMatchObject({ realizedPnl: -220, inPlay: 1000, openBets: 1, won: 1, lost: 1, voided: 1, staked: 1220 });
    expect(overview.winRate).toBeCloseTo(0.5);
    expect(overview.roi).toBeCloseTo(-220 / 1220);
  });

  test("applies the capital rule after losses", () => {
    expect(overview.workingBankroll).toBe(9780);
    expect(overview.withdrawable).toBe(0);
  });

  test("builds the bankroll curve in settlement order", () => {
    expect(overview.curve.map((point) => point.bankroll)).toEqual([10_000, 9_300, 9_300, 9_780]);
  });

  test("splits research spend by month", () => {
    expect(overview.researchSpendUsd).toBeCloseTo(0.15);
    expect(overview.researchSpendMonthUsd).toBeCloseTo(0.05);
  });

  test("profit above capital is withdrawable", () => {
    const winning = buildOverview([bet({ status: "won", pnl: 4293 })], settings, [], "paper", now);
    expect(winning).toMatchObject({ workingBankroll: 10_000, withdrawable: 4293 });
  });
});
