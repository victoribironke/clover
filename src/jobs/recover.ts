import { listBets, updateBet, type Bet } from "@/db/bets.ts";
import type { Exchange } from "@/exchanges/types.ts";
import { errorMessage, log } from "@/lib/logger.ts";
import { escapeHtml, money, pct } from "@/telegram/format.ts";
import { clearButtons, notify } from "@/telegram/notify.ts";

// Placing a bet takes seconds. A bet still "placing" after this long was claimed by an
// executor that died mid-way (usually a restart during a deploy).
const STUCK_AFTER_MS = 10 * 60_000;
// allow for clock differences between us and Bayse when matching orders to the claim time
const CLOCK_SKEW_MS = 2 * 60_000;

const label = (bet: Bet) => `<b>${escapeHtml(bet.eventTitle)}</b> → ${escapeHtml(bet.outcomeLabel)}`;

const recoverPaper = async (bet: Bet) => {
  // nothing was sent anywhere, so it's safe to queue it again; the next tick re-quotes it
  if (!(await updateBet(bet.id, { status: "pending", error: "interrupted while placing; retried" }, ["placing"]))) return;
  await notify(`↩️ Paper bet ${label(bet)} was interrupted while placing. It's queued again and will be re-checked on the next tick.`);
};

const recoverLive = async (exchange: Exchange, bet: Bet) => {
  const orders = await exchange.findOrders({
    eventId: bet.eventId,
    marketId: bet.marketId,
    outcomeId: bet.outcomeId,
    sinceIso: new Date(Date.parse(bet.updatedAt) - CLOCK_SKEW_MS).toISOString(),
  });

  const order = orders[0];
  if (order) {
    // the order did reach Bayse: record it as placed. If Bayse doesn't report the share
    // count (e.g. a resting CLOB order), derive it so settlement pays out correctly.
    const fillPrice = order.avgPrice || bet.quotedPrice;
    const updated = await updateBet(
      bet.id,
      {
        status: "placed",
        orderId: order.id,
        fillPrice,
        shares: order.shares || bet.stake / (fillPrice * exchange.payoutPerShare),
        error: orders.length > 1 ? `recovered; ${orders.length} matching orders found, used the first` : "recovered after interruption",
      },
      ["placing"],
    );
    if (!updated) return;
    await clearButtons(bet.telegramMessageId);
    await notify(
      `✅ Recovered: ${label(bet)}\nThe bot was interrupted while placing this bet, but the order did reach Bayse.\n` +
        `${money(bet.stake)} at ${pct(order.avgPrice || bet.quotedPrice)} · order <code>${escapeHtml(order.id)}</code>`,
    );
    return;
  }

  // No order on Bayse: nothing was bought. Orders are never retried automatically.
  if (!(await updateBet(bet.id, { status: "failed", error: "interrupted before the order reached Bayse" }, ["placing"]))) return;
  await clearButtons(bet.telegramMessageId);
  await notify(
    `⚠️ ${label(bet)} was interrupted before its order reached Bayse. Nothing was bought, and it won't be retried automatically.`,
  );
};

// Runs on every tick, before new bets are executed
export const recoverStuckBets = async (exchange: Exchange) => {
  const cutoff = Date.now() - STUCK_AFTER_MS;
  const stuck = (await listBets(["placing"], 100)).filter((bet) => Date.parse(bet.updatedAt) < cutoff);

  for (const bet of stuck) {
    try {
      log.warn("recovering stuck bet", { betId: bet.id, dryRun: bet.dryRun, since: bet.updatedAt });
      if (bet.dryRun) await recoverPaper(bet);
      else await recoverLive(exchange, bet);
    } catch (error) {
      // can't reach Bayse to check: leave it as "placing" and try again next tick
      log.error("stuck bet recovery failed", { betId: bet.id, error: errorMessage(error) });
    }
  }
  return stuck.length;
};
