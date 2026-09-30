import { alertsSince } from "@/db/alerts.ts";
import { countAnalysesSince } from "@/db/analyses.ts";
import { ALL_STATUSES, listBets } from "@/db/bets.ts";
import { spendToday } from "@/db/spend.ts";
import type { Exchange } from "@/exchanges/types.ts";
import { errorMessage, log } from "@/lib/logger.ts";
import { settings } from "@/settings.ts";
import { getBankroll } from "@/strategy/bankroll.ts";
import { dailySummaryMessage } from "@/telegram/format.ts";
import { notify } from "@/telegram/notify.ts";
import { runHousekeeping } from "./housekeeping.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const PLACED = new Set(["placed", "won", "lost", "void"]);
const SETTLED = new Set(["won", "lost", "void"]);
const OPEN = new Set(["pending", "placing", "placed"]);

// The last 24 hours in one message (Cloud Scheduler runs it at 23:30 WAT; /summary on demand).
// Settles first so the day's results are complete, and always sends, even in quiet mode.
export const buildDailySummary = async (exchange: Exchange) => {
  await runHousekeeping(exchange).catch((error) =>
    log.error("housekeeping failed", { error: errorMessage(error) }),
  );

  const since = new Date(Date.now() - DAY_MS);
  const sinceIso = since.toISOString();
  const [bets, bankroll, wallet, spent, deepDives, alerts] = await Promise.all([
    listBets(ALL_STATUSES, 10_000),
    getBankroll(exchange),
    exchange.getWallet().catch(() => null),
    spendToday(),
    countAnalysesSince(sinceIso),
    alertsSince(since),
  ]);

  // the record the bot is running now: paper while dryRun, live after
  const mine = bets.filter((bet) => bet.dryRun === settings.dryRun);
  return dailySummaryMessage({
    placed: mine.filter((bet) => PLACED.has(bet.status) && bet.createdAt >= sinceIso),
    settled: mine.filter((bet) => SETTLED.has(bet.status) && bet.updatedAt >= sinceIso),
    open: mine.filter((bet) => OPEN.has(bet.status)),
    bankroll,
    wallet,
    spentUsd: spent,
    deepDives,
    alerts,
  });
};

export const runDailySummary = async (exchange: Exchange) => {
  await notify(await buildDailySummary(exchange), { level: "always" });
  return { sent: true };
};
