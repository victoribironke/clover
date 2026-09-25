import { marketKind } from "@/data/kind.ts";
import type { MarketEvent, PriceHistory } from "@/exchanges/types.ts";
import { measurementTime } from "./measurement.ts";
import type { Study, StudyMarket } from "./stats.ts";

const MINUTE = 60_000;
const PATH_HOURS = 6;
const PATH_STEP_MINUTES = 5;

type Point = { t: number; p: number };

// Last known price at `time`; null if the series doesn't reach back that far
export const priceAt = (series: Point[], time: number) => {
  let price: number | null = null;
  for (const point of series) {
    if (point.t > time) break;
    price = point.p;
  }
  return price;
};

// The moment the answer is fixed: the measurement time when the title names one, else the close
export const anchorFor = (event: MarketEvent) => {
  const close = event.closingDate ?? event.resolutionDate;
  const closeAt = close ? Date.parse(close) : null;
  const measured = measurementTime(event)?.getTime() ?? null;
  const anchorAt = measured !== null && (closeAt === null || measured <= closeAt) ? measured : closeAt;
  return { anchorAt, closeAt, anchorIsMeasurement: anchorAt !== null && anchorAt === measured };
};

export const buildStudy = (event: MarketEvent, status: Study["status"], history: PriceHistory, now = Date.now()): Study => {
  const { anchorAt, closeAt, anchorIsMeasurement } = anchorFor(event);

  const markets: StudyMarket[] = event.markets.map((market) => {
    const series = history[market.id] ?? [];
    const at = (minutesBefore: number) => (anchorAt === null ? null : priceAt(series, anchorAt - minutesBefore * MINUTE));
    // only meaningful when trading continued after the measurement
    const afterTime = anchorAt === null ? null : anchorAt + 15 * MINUTE;
    const after15 =
      anchorIsMeasurement && afterTime !== null && closeAt !== null && afterTime < closeAt && afterTime <= now
        ? priceAt(series, afterTime)
        : null;
    const path: [number, number][] = [];
    if (anchorAt !== null) {
      for (let minutes = PATH_HOURS * 60; minutes >= 0; minutes -= PATH_STEP_MINUTES) {
        const price = priceAt(series, anchorAt - minutes * MINUTE);
        if (price !== null) path.push([minutes, price]);
      }
    }
    const won =
      status === "resolved" && market.resolvedOutcomeId ? market.resolvedOutcomeId === market.outcomes[0].id : null;
    return { marketId: market.id, title: market.title, won, at60: at(60), at30: at(30), at10: at(10), after15, path };
  });

  return {
    eventId: event.id,
    title: event.title,
    category: event.category,
    kind: marketKind(event),
    status,
    anchorAt: anchorAt === null ? null : new Date(anchorAt).toISOString(),
    anchorIsMeasurement,
    closeAt: closeAt === null ? null : new Date(closeAt).toISOString(),
    resolvedAt: event.resolvedAt,
    markets,
    recordedAt: new Date(now).toISOString(),
  };
};
