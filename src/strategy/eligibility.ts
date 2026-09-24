import type { MarketEvent } from "@/exchanges/types.ts";
import { settings } from "@/settings.ts";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

// Cheap, deterministic filters before any money is spent on research
export const eligibleEvents = (events: MarketEvent[], exclude: Set<string>, now = Date.now()) =>
  events.filter((event) => {
    if (event.status !== "open" || exclude.has(event.id)) return false;
    if (!event.supportedCurrencies.includes("NGN")) return false;
    if (!(settings.categories as readonly string[]).includes(event.category)) return false;
    if (!event.markets.some((market) => market.status === "open")) return false;
    // Many events carry only one of the two dates; either is a fair stand-in for the other.
    // No dates at all means a long-running market (e.g. an election), which is out of scope.
    const closeAt = event.closingDate ?? event.resolutionDate;
    const resolveAt = event.resolutionDate ?? event.closingDate;
    if (!closeAt || !resolveAt) return false;
    // trading must stay open past the cancel window, and the result must land soon
    const untilClose = new Date(closeAt).getTime() - now;
    const untilResolve = new Date(resolveAt).getTime() - now;
    return untilClose >= settings.minMinutesBeforeClose * MINUTE && untilResolve <= settings.maxHoursToResolve * HOUR;
  });
