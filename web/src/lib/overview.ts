import type { Bet, BotSettings, SpendDay } from "./types";

const LIVE = new Set(["pending", "placing", "placed"]);
const SETTLED = new Set(["won", "lost", "void"]);

export type CurvePoint = { at: string; bankroll: number; pnl: number };

export type Overview = {
  mode: "paper" | "live";
  capital: number;
  realizedPnl: number;
  // the capital rule, as in src/strategy/bankroll.ts: the bot works with capital, or less after losses
  workingBankroll: number;
  withdrawable: number;
  inPlay: number;
  openBets: number;
  settledBets: number;
  won: number;
  lost: number;
  voided: number;
  winRate: number | null;
  staked: number;
  roi: number | null;
  researchSpendUsd: number;
  researchSpendMonthUsd: number;
  // capital + cumulative realized P&L after each settlement
  curve: CurvePoint[];
};

// Bets don't record when they settled, only when they last changed; for a settled bet that's
// the settlement (nothing updates it afterwards).
const settledAt = (bet: Bet) => bet.updatedAt;

export const buildOverview = (
  bets: Bet[],
  settings: BotSettings,
  spend: SpendDay[],
  mode: "paper" | "live",
  now = new Date(),
): Overview => {
  const mine = bets.filter((bet) => bet.dryRun === (mode === "paper"));
  const settled = mine.filter((bet) => SETTLED.has(bet.status)).sort((a, b) => settledAt(a).localeCompare(settledAt(b)));
  const open = mine.filter((bet) => LIVE.has(bet.status));
  const won = settled.filter((bet) => bet.status === "won");
  const lost = settled.filter((bet) => bet.status === "lost");

  const realizedPnl = settled.reduce((total, bet) => total + (bet.pnl ?? 0), 0);
  const inPlay = open.reduce((total, bet) => total + bet.stake, 0);
  const staked = [...won, ...lost].reduce((total, bet) => total + bet.stake, 0);
  const capital = settings.capitalNgn;

  let running = 0;
  const curve: CurvePoint[] = [{ at: settled[0]?.createdAt ?? now.toISOString(), bankroll: capital, pnl: 0 }];
  for (const bet of settled) {
    running += bet.pnl ?? 0;
    curve.push({ at: settledAt(bet), bankroll: capital + running, pnl: running });
  }

  const month = now.toISOString().slice(0, 7);
  return {
    mode,
    capital,
    realizedPnl,
    workingBankroll: Math.max(0, Math.min(capital, capital + realizedPnl)),
    withdrawable: Math.max(0, realizedPnl),
    inPlay,
    openBets: open.length,
    settledBets: settled.length,
    won: won.length,
    lost: lost.length,
    voided: settled.length - won.length - lost.length,
    winRate: won.length + lost.length > 0 ? won.length / (won.length + lost.length) : null,
    staked,
    roi: staked > 0 ? realizedPnl / staked : null,
    researchSpendUsd: spend.reduce((total, day) => total + day.usd, 0),
    researchSpendMonthUsd: spend.filter((day) => day.day.startsWith(month)).reduce((total, day) => total + day.usd, 0),
    curve,
  };
};
