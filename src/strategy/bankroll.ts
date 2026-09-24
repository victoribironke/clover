import { config } from "@/config.ts";
import { betTotals } from "@/db/bets.ts";
import type { Exchange } from "@/exchanges/types.ts";
import { settings } from "@/settings.ts";

export type Bankroll = {
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

// Capital rule: the bot only ever works with CAPITAL_NGN. Anything above it is
// profit that is left alone for withdrawal; after losses it works with what's left.
// In dry-run mode the wallet is simulated as capital + paper P&L.
export const getBankroll = async (exchange: Exchange): Promise<Bankroll> => {
  const capital = settings.capitalNgn;
  const dryRun = settings.dryRun;
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
