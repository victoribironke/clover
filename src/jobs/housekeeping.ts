import { publish } from "@/db/kv.ts";
import type { Exchange } from "@/exchanges/types.ts";
import { errorMessage, log } from "@/lib/logger.ts";
import { backfillBetKinds } from "./backfill.ts";
import { recoverStuckBets } from "./recover.ts";
import { runSettle } from "./settle.ts";

// Bookkeeping that every scan and the daily summary run first: sort out bets a crash left
// half-placed, settle resolved bets (so their stakes free up for new bets), and record the
// wallet for the panel. Cheap: no Gemini, a few Bayse and Firestore calls.
export const runHousekeeping = async (exchange: Exchange) => {
  const recovered = await recoverStuckBets(exchange);
  const settled = await runSettle(exchange);
  // the real Bayse wallet, for the panel (read-only; recorded in paper mode too)
  await exchange
    .getWallet()
    .then((wallet) => publish("wallet", wallet))
    .catch((error) => log.warn("wallet snapshot failed", { error: errorMessage(error) }));
  // one-off data migration; a no-op once it has run, and never allowed to break anything
  await backfillBetKinds(exchange).catch((error) =>
    log.error("backfill failed", { error: errorMessage(error) }),
  );
  return { recovered, settled };
};
