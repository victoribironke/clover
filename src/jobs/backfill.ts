import { marketKind } from "@/data/kind.ts";
import { ALL_STATUSES, listBets, updateBet } from "@/db/bets.ts";
import { hasFlag, setFlag } from "@/db/kv.ts";
import type { Exchange } from "@/exchanges/types.ts";
import { errorMessage, log } from "@/lib/logger.ts";

const FLAG = "backfill-bet-kind-v1";

// One-off: bets placed before 2026-09-25 have no category/kind. Look their events up once and
// fill them in, so result breakdowns by market type include the whole history. A flag in
// Firestore stops it from running again.
export const backfillBetKinds = async (exchange: Exchange) => {
  if (await hasFlag(FLAG)) return 0;

  const missing = (await listBets(ALL_STATUSES, 10_000)).filter((bet) => !bet.kind);
  let filled = 0;
  for (const [eventId, bets] of Map.groupBy(missing, (bet) => bet.eventId)) {
    let category = "";
    try {
      category = (await exchange.getEvent(eventId)).category;
    } catch (error) {
      // event no longer served: classify from the title alone
      log.warn("backfill: event lookup failed", { eventId, error: errorMessage(error) });
    }
    for (const bet of bets) {
      const kind = marketKind({ title: bet.eventTitle, category, resolutionDate: null, closingDate: null });
      await updateBet(bet.id, category ? { category, kind } : { kind });
      filled++;
    }
  }

  await setFlag(FLAG);
  log.info("backfilled bet kinds", { filled });
  return filled;
};
