import { config } from "@/config.ts";
import { dueBets, updateBet, type Bet } from "@/db/bets.ts";
import { isPaused } from "@/db/kv.ts";
import { EXCHANGE_LABELS, type Exchange } from "@/exchanges/types.ts";
import { errorMessage, log } from "@/lib/logger.ts";
import { settings } from "@/settings.ts";
import { expectedReturn } from "@/strategy/sizing.ts";
import { betLink, escapeHtml, failureMessage, money, pct } from "@/telegram/format.ts";
import { clearButtons, notify } from "@/telegram/notify.ts";

const skip = async (bet: Bet, reason: string) => {
  await updateBet(bet.id, { status: "skipped", error: reason }, ["placing"]);
  await clearButtons(bet.telegramMessageId);
  await notify(
    `⏭️ Skipped ${betLink(bet)} → ${escapeHtml(bet.outcomeLabel)}\n${escapeHtml(reason)}`,
  );
};

// Re-check everything right before money moves: the market may have closed,
// the price may have moved, or capital may have been used by another bet.
export const executeBet = async (exchange: Exchange, bet: Bet) => {
  // claim it; if this fails the bet was cancelled or another tick got it first
  if (!(await updateBet(bet.id, { status: "placing" }, ["pending"]))) return;

  try {
    const event = await exchange.getEvent(bet.eventId);
    const market = event.markets.find((item) => item.id === bet.marketId);
    if (event.status !== "open" || market?.status !== "open")
      return await skip(bet, "Market is no longer open.");

    const quote = await exchange.quote({
      eventId: bet.eventId,
      marketId: bet.marketId,
      outcomeId: bet.outcomeId,
      amount: bet.stake,
    });
    const edge = expectedReturn(bet.probability, quote.avgPrice);
    if (edge < settings.minEdge) {
      return await skip(
        bet,
        `Price moved to ${pct(quote.avgPrice)}; expected return is now ${pct(edge, true)}.`,
      );
    }

    // capital was reserved when the bet was proposed; for live bets also confirm the wallet can cover it
    if (!bet.dryRun && !exchange.canTrade) {
      return await skip(bet, `No ${EXCHANGE_LABELS[exchange.name]} account is connected.`);
    }
    if (!bet.dryRun && (await exchange.getAvailableBalance()) < bet.stake) {
      return await skip(bet, `Not enough balance in the ${EXCHANGE_LABELS[exchange.name]} wallet.`);
    }

    const order = bet.dryRun
      ? {
          id: `paper-${bet.id}`,
          avgPrice: quote.avgPrice,
          shares: quote.shares,
          amount: quote.amount,
          status: "filled",
        }
      : await exchange.placeOrder({
          eventId: bet.eventId,
          marketId: bet.marketId,
          outcomeId: bet.outcomeId,
          amount: bet.stake,
          maxSlippage: settings.maxSlippage,
        });

    // what was actually spent: Kalshi buys whole contracts, so it can come in under the stake
    const stake = order.amount > 0 && order.amount < bet.stake ? order.amount : bet.stake;
    await updateBet(bet.id, {
      status: "placed",
      stake,
      orderId: order.id,
      fillPrice: order.avgPrice || quote.avgPrice,
      shares: order.shares || quote.shares,
      expectedReturn: edge,
    });
    await clearButtons(bet.telegramMessageId);
    await notify(
      `✅ ${bet.dryRun ? "Paper bet" : "Bet"} placed: ${betLink(bet)} → <b>${escapeHtml(bet.outcomeLabel)}</b>\n` +
        `${money(stake, bet.currency)} at ${pct(order.avgPrice || quote.avgPrice)} · expected ${pct(edge, true)}`,
    );
    log.info("bet placed", { betId: bet.id, orderId: order.id, dryRun: bet.dryRun });
  } catch (error) {
    // an order error is not retried: it's safer to miss a bet than to place it twice
    await updateBet(bet.id, { status: "failed", error: errorMessage(error) });
    await clearButtons(bet.telegramMessageId);
    await notify(
      failureMessage(`Could not place: ${bet.eventTitle} → ${bet.outcomeLabel}`, error),
      { level: "alert" },
    );
    log.error("bet failed", { betId: bet.id, error: errorMessage(error) });
  }
};

export const runExecute = async (exchange: Exchange) => {
  if (await isPaused()) return 0;
  const due = (await dueBets(new Date().toISOString())).filter(
    (bet) => bet.exchange === exchange.name,
  );
  for (const bet of due) await executeBet(exchange, bet);
  return due.length;
};
