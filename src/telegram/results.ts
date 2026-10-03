import type { Bet } from "@/db/bets.ts";
import { EXCHANGE_LABELS, type Currency, type ExchangeName } from "@/exchanges/types.ts";
import { escapeHtml, money, pct } from "./format.ts";

// 📈 /results: what has actually paid, per exchange. Which market types make money, and whether the
// bot's probabilities can be trusted (when it said 70%, did about 70% win, and did it beat the price?).

const KIND_LABELS: Record<string, string> = {
  weather: "Weather",
  "post-count": "Post counts",
  engagement: "Engagement",
  streams: "Streams",
  chart: "Charts",
  price: "Prices",
  economy: "Economy",
  sports: "Sports",
  "match-stats": "Match stats",
  other: "Other",
};

const BUCKETS = [
  { label: "under 20%", min: 0, max: 0.2 },
  { label: "20-40%", min: 0.2, max: 0.4 },
  { label: "40-60%", min: 0.4, max: 0.6 },
  { label: "60-80%", min: 0.6, max: 0.8 },
  { label: "80% and up", min: 0.8, max: 1.01 },
];

const signed = (amount: number, currency: Currency) =>
  `${amount > 0 ? "+" : ""}${money(amount, currency)}`;

const price = (bet: Bet) => bet.fillPrice ?? bet.quotedPrice;

// Squared error of a probability against what happened (1 = won, 0 = lost); lower is better
const brier = (bets: Bet[], pick: (bet: Bet) => number) =>
  bets.reduce((total, bet) => total + (pick(bet) - (bet.status === "won" ? 1 : 0)) ** 2, 0) /
  bets.length;

export const resultsMessage = (
  exchange: ExchangeName,
  currency: Currency,
  dryRun: boolean,
  // every bet; this exchange's settled ones, in the mode it's running in, are used
  all: Bet[],
) => {
  const name = EXCHANGE_LABELS[exchange];
  const settled = all.filter(
    (bet) =>
      bet.exchange === exchange &&
      bet.dryRun === dryRun &&
      ["won", "lost", "void"].includes(bet.status),
  );
  const header = `📈 <b>${name} results</b>${dryRun ? " <i>(paper)</i>" : ""}`;
  if (settled.length === 0) return `${header}\nNo settled bets yet.`;

  // voids are refunds: they count as bets but not toward win rates or calibration
  const decided = settled.filter((bet) => bet.status !== "void");
  const won = decided.filter((bet) => bet.status === "won");
  const staked = decided.reduce((total, bet) => total + bet.stake, 0);
  const pnl = settled.reduce((total, bet) => total + (bet.pnl ?? 0), 0);

  const lines = [
    header,
    `${settled.length} settled · ${won.length} won · ${decided.length - won.length} lost · ${settled.length - decided.length} void`,
    `P&L <b>${signed(pnl, currency)}</b> on ${money(staked, currency)} staked${staked > 0 ? ` · return ${pct(pnl / staked, true)}` : ""}`,
    "",
    "<b>By market type</b> (won/bets · P&L · return)",
  ];

  const byKind = Map.groupBy(settled, (bet) => bet.kind ?? "other");
  const rows = [...byKind.entries()]
    .map(([kind, bets]) => {
      const kindDecided = bets.filter((bet) => bet.status !== "void");
      const kindStaked = kindDecided.reduce((total, bet) => total + bet.stake, 0);
      const kindPnl = bets.reduce((total, bet) => total + (bet.pnl ?? 0), 0);
      return {
        kind,
        bets: bets.length,
        won: bets.filter((bet) => bet.status === "won").length,
        staked: kindStaked,
        pnl: kindPnl,
      };
    })
    .sort((a, b) => b.pnl - a.pnl);
  for (const row of rows) {
    lines.push(
      `${escapeHtml(KIND_LABELS[row.kind] ?? row.kind)}: ${row.won}/${row.bets} · ${signed(row.pnl, currency)}` +
        (row.staked > 0 ? ` · ${pct(row.pnl / row.staked, true)}` : ""),
    );
  }

  if (decided.length > 0) {
    lines.push("", "<b>Calibration</b> (the bot's probability → how often it won)");
    for (const bucket of BUCKETS) {
      const inBucket = decided.filter(
        (bet) => bet.probability >= bucket.min && bet.probability < bucket.max,
      );
      if (inBucket.length === 0) continue;
      const average = inBucket.reduce((total, bet) => total + bet.probability, 0) / inBucket.length;
      const rate = inBucket.filter((bet) => bet.status === "won").length / inBucket.length;
      lines.push(
        `${bucket.label}: ${inBucket.length} bets · said ${pct(average)} → won ${pct(rate)}`,
      );
    }
    const bot = brier(decided, (bet) => bet.probability);
    const market = brier(decided, price);
    lines.push(
      `Accuracy (Brier score, lower is better): bot ${bot.toFixed(3)} vs the price paid ${market.toFixed(3)}` +
        ` · ${bot < market ? "the bot was closer" : "the market was closer"}`,
    );
  }
  if (decided.length < 30)
    lines.push("", `<i>Only ${decided.length} decided bets: too few to read much into.</i>`);
  return lines.join("\n");
};
