import { collection } from "@/db/firestore.ts";
import { releaseLock, tryLock } from "@/db/kv.ts";
import type { Exchange, MarketEvent, PriceHistory } from "@/exchanges/types.ts";
import { errorMessage, log } from "@/lib/logger.ts";
import { anchorFor, buildStudy } from "@/study/build.ts";
import type { Study } from "@/study/stats.ts";

const HOUR = 3_600_000;
// Bayse keeps 12 hours of 1-minute prices. Runs every 6 hours, looking back 11, so every event's
// final hour is still inside the price window when it's recorded.
const LOOKBACK_HOURS = 11;
// 15-minute / hourly up-and-down markets: hundreds a day and pure noise
const NOISE = /\b\d+\s*minutes?\b|\bhourly\b|\b1 hour\b/i;
// time-boxed series (e.g. "EUR/GBP higher by 6 PM GMT?" opened at 17:03) that live only an hour or two
const MIN_LIFETIME_HOURS = 3;

export const worthStudying = (event: MarketEvent) => {
  if (NOISE.test(event.title)) return false;
  const close = event.closingDate ?? event.resolutionDate;
  if (event.openingDate && close && Date.parse(close) - Date.parse(event.openingDate) < MIN_LIFETIME_HOURS * HOUR) return false;
  return true;
};

// Bayse doesn't always send openingDate. If prices only start within MIN_LIFETIME_HOURS of the
// close even though the price window reaches further back, the market was created late: another
// short-lived series.
const openedLate = (event: MarketEvent, history: PriceHistory, windowStart: Date) => {
  const close = event.closingDate ?? event.resolutionDate;
  const firstPoint = Math.min(...Object.values(history).flatMap((series) => series.map((point) => point.t)));
  if (!close || !Number.isFinite(firstPoint)) return false;
  return firstPoint > windowStart.getTime() + HOUR && Date.parse(close) - firstPoint < MIN_LIFETIME_HOURS * HOUR;
};

// Records how settled markets were priced near the end, plus voids, so we can check whether
// late prices are systematically off (and by which kind) before betting on it. No Gemini calls.
export const runStudy = async (exchange: Exchange) => {
  if (!(await tryLock("study", 30 * 60_000)).acquired) return { recorded: 0, skippedReason: "study already running" };
  const since = new Date(Date.now() - LOOKBACK_HOURS * HOUR);
  let recorded = 0;
  let failed = 0;
  try {
    for (const status of ["resolved", "cancelled"] as const) {
      const events = (await exchange.listSettledEvents(status, since)).filter(worthStudying);
      for (const event of events) {
        const ref = collection("studies").doc(event.id);
        if ((await ref.get()).exists) continue;
        try {
          // voids only count toward void rates; price paths matter for resolved events
          const { anchorAt } = anchorFor(event);
          const history = status === "resolved" && anchorAt !== null ? await exchange.priceHistory(event.id) : {};
          if (openedLate(event, history, since)) continue;
          const study: Study = buildStudy(event, status, history);
          await ref.set(study);
          recorded++;
        } catch (error) {
          failed++;
          log.warn("study: event failed", { eventId: event.id, error: errorMessage(error) });
        }
      }
    }
    return { recorded, failed };
  } finally {
    await releaseLock("study");
  }
};

export const loadStudies = async () => (await collection("studies").get()).docs.map((doc) => doc.data() as Study);
