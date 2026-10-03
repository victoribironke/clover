import type { Exchange } from "@/exchanges/types.ts";
import { errorMessage, log } from "@/lib/logger.ts";
import { backfillBetKinds } from "./backfill.ts";
import { recoverStuckBets } from "./recover.ts";
import { runSettle } from "./settle.ts";

// Bookkeeping that every scan and the daily summary run first, per exchange: sort out bets a
// crash left half-placed and settle resolved bets (so their stakes free up for new bets).
// Cheap: no AI, a few exchange and Firestore calls.
export const runHousekeeping = async (exchange: Exchange) => {
  const recovered = await recoverStuckBets(exchange);
  const settled = await runSettle(exchange);
  if (exchange.name === "bayse") {
    // one-off data migration for Bayse bets; a no-op once it has run, and never allowed to break anything
    await backfillBetKinds(exchange).catch((error) =>
      log.error("backfill failed", { error: errorMessage(error) }),
    );
  }
  return { recovered, settled };
};
