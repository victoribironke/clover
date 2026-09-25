import type { Exchange } from "@/exchanges/types.ts";
import { publish, releaseLock, tryLock } from "@/db/kv.ts";
import { errorMessage, log } from "@/lib/logger.ts";
import { backfillBetKinds } from "./backfill.ts";
import { runExecute } from "./execute.ts";
import { recoverStuckBets } from "./recover.ts";
import { runSettle } from "./settle.ts";

// Frequent, cheap work: sort out bets a crash left half-placed, place bets whose
// cancel window has passed, settle resolved ones
export const runTick = async (exchange: Exchange) => {
  if (!(await tryLock("tick", 10 * 60_000)).acquired) {
    return { recovered: 0, executed: 0, settled: 0, skippedReason: "tick already running" };
  }
  try {
    const recovered = await recoverStuckBets(exchange);
    const executed = await runExecute(exchange);
    const settled = await runSettle(exchange);
    // the real Bayse wallet, for the panel (read-only; recorded in paper mode too)
    await exchange
      .getWallet()
      .then((wallet) => publish("wallet", wallet))
      .catch((error) => log.warn("wallet snapshot failed", { error: errorMessage(error) }));
    // one-off data migration; a no-op once it has run, and never allowed to break the tick
    await backfillBetKinds(exchange).catch((error) => log.error("backfill failed", { error: errorMessage(error) }));
    return { recovered, executed, settled };
  } finally {
    await releaseLock("tick");
  }
};
