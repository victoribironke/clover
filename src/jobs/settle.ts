import { listBets, updateBet } from "@/db/bets.ts";
import type { Exchange } from "@/exchanges/types.ts";
import { errorMessage, log } from "@/lib/logger.ts";
import { getBankroll } from "@/strategy/bankroll.ts";
import { escapeHtml, money } from "@/telegram/format.ts";
import { notify } from "@/telegram/notify.ts";

// Mark placed bets won/lost/void once their market resolves
export const runSettle = async (exchange: Exchange) => {
  const open = await listBets(["placed"], 500);
  const byEvent = Map.groupBy(open, (bet) => bet.eventId);
  let settled = 0;

  for (const [eventId, bets] of byEvent) {
    try {
      const event = await exchange.getEvent(eventId);
      for (const bet of bets) {
        const market = event.markets.find((item) => item.id === bet.marketId);
        const cancelled = event.status === "cancelled" || market?.status === "cancelled";
        const resolved = (market?.status === "resolved" || event.status === "resolved") && Boolean(market?.resolvedOutcomeId);
        if (!cancelled && !resolved) continue;

        const shares = bet.shares ?? 0;
        const won = !cancelled && market?.resolvedOutcomeId === bet.outcomeId;
        const status = cancelled ? "void" : won ? "won" : "lost";
        const pnl = cancelled ? 0 : won ? shares * exchange.payoutPerShare - bet.stake : -bet.stake;

        if (!(await updateBet(bet.id, { status, pnl }, ["placed"]))) continue;
        settled++;
        const icon = status === "won" ? "🏆" : status === "lost" ? "❌" : "↩️";
        await notify(
          `${icon} <b>${escapeHtml(bet.eventTitle)}</b> → ${escapeHtml(bet.outcomeLabel)}: <b>${status}</b>\n` +
            `Stake ${money(bet.stake)} · P&L <b>${money(pnl)}</b>${bet.dryRun ? " <i>(paper)</i>" : ""}`,
        );
      }
    } catch (error) {
      log.warn("settle check failed", { eventId, error: errorMessage(error) });
    }
  }

  if (settled > 0) {
    const bankroll = await getBankroll(exchange);
    if (bankroll.withdrawable > 0) {
      await notify(`💰 Withdrawable profit is now <b>${money(bankroll.withdrawable)}</b>. Capital stays at ${money(bankroll.capital)}.`);
    }
  }
  return settled;
};
