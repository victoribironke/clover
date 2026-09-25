import type { Bet, MarketKind } from "./types";

export type Mode = "paper" | "live";
export type StatusGroup = "all" | "open" | "won" | "lost" | "void" | "not-placed";

const GROUPS: Record<Exclude<StatusGroup, "all">, Bet["status"][]> = {
  open: ["pending", "placing", "placed"],
  won: ["won"],
  lost: ["lost"],
  void: ["void"],
  "not-placed": ["cancelled", "skipped", "failed"],
};

export const STATUS_GROUPS: StatusGroup[] = ["all", "open", "won", "lost", "void", "not-placed"];

export const kindOf = (bet: Bet): MarketKind | "unclassified" => bet.kind ?? "unclassified";

export const filterBets = (bets: Bet[], filter: { mode: Mode; status: StatusGroup; kind: string }) =>
  bets
    .filter((bet) => bet.dryRun === (filter.mode === "paper"))
    .filter((bet) => filter.status === "all" || GROUPS[filter.status].includes(bet.status))
    .filter((bet) => filter.kind === "all" || kindOf(bet) === filter.kind)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

export type KindRow = {
  kind: MarketKind | "unclassified";
  bets: number;
  open: number;
  won: number;
  lost: number;
  voided: number;
  winRate: number | null;
  voidRate: number | null;
  staked: number;
  pnl: number;
  roi: number | null;
};

// Per market type: did the bets that actually settled make money?
export const resultsByKind = (bets: Bet[], mode: Mode): KindRow[] => {
  const mine = bets.filter((bet) => bet.dryRun === (mode === "paper") && !GROUPS["not-placed"].includes(bet.status));
  const rows = Map.groupBy(mine, kindOf);
  return [...rows.entries()]
    .map(([kind, group]) => {
      const won = group.filter((bet) => bet.status === "won");
      const lost = group.filter((bet) => bet.status === "lost");
      const voided = group.filter((bet) => bet.status === "void");
      const decided = won.length + lost.length;
      const staked = [...won, ...lost].reduce((total, bet) => total + bet.stake, 0);
      const pnl = [...won, ...lost, ...voided].reduce((total, bet) => total + (bet.pnl ?? 0), 0);
      const settled = decided + voided.length;
      return {
        kind,
        bets: group.length,
        open: group.filter((bet) => GROUPS.open.includes(bet.status)).length,
        won: won.length,
        lost: lost.length,
        voided: voided.length,
        winRate: decided ? won.length / decided : null,
        voidRate: settled ? voided.length / settled : null,
        staked,
        pnl,
        roi: staked ? pnl / staked : null,
      };
    })
    .sort((a, b) => b.bets - a.bets);
};

export type CalibrationBucket = { label: string; low: number; high: number; n: number; predicted: number; actual: number };

export type Calibration = {
  buckets: CalibrationBucket[];
  n: number;
  // mean squared error of the probability against the result: lower is better, 0.25 = coin flip
  brier: number | null;
};

const BUCKET_EDGES = [0, 0.2, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0001];

// Were the bot's probabilities right? `field` picks what's being judged: the probability the bot
// bet on (its blend of research and market), or the price it paid (the market's own view).
export const calibration = (bets: Bet[], mode: Mode, field: "probability" | "quotedPrice"): Calibration => {
  const decided = bets.filter((bet) => bet.dryRun === (mode === "paper") && (bet.status === "won" || bet.status === "lost"));
  const buckets = BUCKET_EDGES.slice(0, -1).map((low, index) => {
    const high = BUCKET_EDGES[index + 1]!;
    const inBucket = decided.filter((bet) => bet[field] >= low && bet[field] < high);
    const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
    return {
      label: `${Math.round(low * 100)}-${Math.min(100, Math.round(high * 100))}%`,
      low,
      high,
      n: inBucket.length,
      predicted: mean(inBucket.map((bet) => bet[field])),
      actual: mean(inBucket.map((bet) => (bet.status === "won" ? 1 : 0))),
    };
  });
  const brier = decided.length
    ? decided.reduce((total, bet) => total + (bet[field] - (bet.status === "won" ? 1 : 0)) ** 2, 0) / decided.length
    : null;
  return { buckets, n: decided.length, brier };
};
