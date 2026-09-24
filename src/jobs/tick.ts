import type { Exchange } from "@/exchanges/types.ts";
import { releaseLock, tryLock } from "@/db/kv.ts";
import { runExecute } from "./execute.ts";
import { runSettle } from "./settle.ts";

// Frequent, cheap work: place bets whose cancel window has passed, settle resolved ones
export const runTick = async (exchange: Exchange) => {
  if (!(await tryLock("tick", 10 * 60_000))) return { executed: 0, settled: 0, skippedReason: "tick already running" };
  try {
    const executed = await runExecute(exchange);
    const settled = await runSettle(exchange);
    return { executed, settled };
  } finally {
    await releaseLock("tick");
  }
};
