import { betTotals } from "@/db/bets.ts";
import { isDryRun } from "@/exchanges/mode.ts";
import type { Currency, Exchange, ExchangeName } from "@/exchanges/types.ts";
import { settings } from "@/settings.ts";

export type Bankroll = {
  exchange: ExchangeName;
  currency: Currency;
  capital: number;
  // cash the bot could spend right now
  available: number;
  // stakes tied up in pending or unsettled bets
  exposure: number;
  // capital we size bets against: the fixed capital, or less after losses
  bankroll: number;
  // what a new bet may still use without dipping into profit or overcommitting
  deployable: number;
  // realized profit above capital, safe to withdraw
  withdrawable: number;
  realizedPnl: number;
  dryRun: boolean;
};

// Capital rule: on each exchange the bot only ever works with that exchange's capital
// (settings.exchanges). Anything above it is profit that is left alone for withdrawal; after
// losses it works with what's left. In dry-run mode the wallet is simulated as capital + paper P&L.
export const getBankroll = async (exchange: Exchange): Promise<Bankroll> => {
  const capital = settings.exchanges[exchange.name].capital;
  const dryRun = isDryRun(exchange);
  const { exposure, realizedPnl, unsent } = await betTotals(exchange.name, dryRun);

  // In live mode the wallet balance already has placed stakes deducted, but not
  // pending ones (they haven't been sent yet), so subtract those separately.
  const walletAvailable = dryRun
    ? capital + realizedPnl - exposure
    : (await exchange.getAvailableBalance()) - unsent;

  const bankroll = Math.max(0, Math.min(capital, walletAvailable + exposure));
  const deployable = Math.max(0, Math.min(walletAvailable, bankroll - exposure));
  const withdrawable = Math.max(0, walletAvailable + exposure - capital);

  return {
    exchange: exchange.name,
    currency: exchange.currency,
    capital,
    available: Math.max(0, walletAvailable),
    exposure,
    bankroll,
    deployable,
    withdrawable,
    realizedPnl,
    dryRun,
  };
};
