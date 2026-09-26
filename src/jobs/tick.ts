import type { Exchange } from "@/exchanges/types.ts";
import { releaseLock, tryLock } from "@/db/kv.ts";
import { runExecute } from "./execute.ts";
import { runHousekeeping } from "./housekeeping.ts";

// Housekeeping plus placing bets whose cancel window has passed. Scans now do both themselves;
// this stays for local runs and as a manual /jobs/tick.
export const runTick = async (exchange: Exchange) => {
  if (!(await tryLock("tick", 10 * 60_000)).acquired) {
    return { recovered: 0, executed: 0, settled: 0, skippedReason: "tick already running" };
  }
  try {
    const { recovered, settled } = await runHousekeeping(exchange);
    const executed = await runExecute(exchange);
    return { recovered, executed, settled };
  } finally {
    await releaseLock("tick");
  }
};
