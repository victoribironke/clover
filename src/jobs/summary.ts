import { alertsSince } from "@/db/alerts.ts";
import { countAnalysesSince } from "@/db/analyses.ts";
import { ALL_STATUSES, betTotalsFromBets, listBets, type Bet } from "@/db/bets.ts";
import { spendToday } from "@/db/spend.ts";
import { isDryRun } from "@/exchanges/mode.ts";
import type { Exchange } from "@/exchanges/types.ts";
import { errorMessage, log } from "@/lib/logger.ts";
import { within } from "@/lib/within.ts";
import { getBankroll } from "@/strategy/bankroll.ts";
import { dailySummaryMessage } from "@/telegram/format.ts";
import { notify } from "@/telegram/notify.ts";
import { runHousekeeping } from "./housekeeping.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const PLACED = new Set(["placed", "won", "lost", "void"]);
const SETTLED = new Set(["won", "lost", "void"]);
const OPEN = new Set(["pending", "placing", "placed"]);

// One exchange's last 24 hours in one message (Cloud Scheduler runs it at 23:30 WAT; /summary on
// demand). Settles first so the day's results are complete, and always sends, even in quiet mode.
// Research spend, deep dives and problems are shared, so they're shown with the first exchange.
type SummaryOptions = { shared?: boolean; bets?: Bet[]; runBookkeeping?: boolean };

export const buildDailySummary = async (
  exchange: Exchange,
  { shared = true, bets: knownBets, runBookkeeping = true }: SummaryOptions = {},
) => {
  if (runBookkeeping) {
    await runHousekeeping(exchange).catch((error) =>
      log.error("housekeeping failed", { exchange: exchange.name, error: errorMessage(error) }),
    );
  }

  const since = new Date(Date.now() - DAY_MS);
  const sinceIso = since.toISOString();
  const bets = knownBets ?? (await listBets(ALL_STATUSES, 10_000));
  const dryRun = isDryRun(exchange);
  const [bankroll, wallet, spent, deepDives, alerts] = await Promise.all([
    getBankroll(exchange, betTotalsFromBets(bets, exchange.name, dryRun)),
    exchange.canTrade ? within(exchange.getWallet(), 5_000, null) : Promise.resolve(null),
    shared ? spendToday() : Promise.resolve(0),
    shared ? countAnalysesSince(sinceIso) : Promise.resolve(0),
    shared ? alertsSince(since) : Promise.resolve([]),
  ]);

  // the record the bot is running now on this exchange: paper while dryRun, live after
  const mine = bets.filter((bet) => bet.exchange === exchange.name && bet.dryRun === dryRun);
  return dailySummaryMessage({
    placed: mine.filter((bet) => PLACED.has(bet.status) && bet.createdAt >= sinceIso),
    settled: mine.filter((bet) => SETTLED.has(bet.status) && bet.updatedAt >= sinceIso),
    open: mine.filter((bet) => OPEN.has(bet.status)),
    bankroll,
    wallet,
    spentUsd: spent,
    deepDives,
    alerts,
    shared,
  });
};

export const buildDailySummaries = async (exchanges: Exchange[]) => {
  for (const exchange of exchanges) {
    await runHousekeeping(exchange).catch((error) =>
      log.error("housekeeping failed", { exchange: exchange.name, error: errorMessage(error) }),
    );
  }
  const bets = await listBets(ALL_STATUSES, 10_000);
  const messages = [];
  for (const [index, exchange] of exchanges.entries()) {
    messages.push(
      await buildDailySummary(exchange, {
        shared: index === 0,
        bets,
        runBookkeeping: false,
      }),
    );
  }
  return messages;
};

export const runDailySummary = async (exchanges: Exchange[]) => {
  const messages = await buildDailySummaries(exchanges);
  for (const message of messages) await notify(message, { level: "always" });
  return { sent: exchanges.length };
};
