import { parseWeatherQuestion } from "@/data/weather.ts";
import type { MarketEvent } from "@/exchanges/types.ts";

// Hours ahead of UTC for the zones Bayse titles use. No zone means WAT.
// US Eastern is EDT (UTC-4) from mid-March to early November, EST (UTC-5) otherwise.
const easternOffset = (date: Date) => {
  const month = date.getUTCMonth();
  return month >= 2 && month <= 10 ? -4 : -5;
};

const zoneOffset = (zone: string | undefined, day: Date) => {
  switch (zone?.toUpperCase()) {
    case "GMT":
    case "UTC":
      return 0;
    case "ET":
    case "EDT":
    case "EST":
      return easternOffset(day);
    default:
      return 1;
  }
};

// When the market's quantity is actually measured. Often earlier than the close:
// "Posts by 1PM Today?" is measured at 1 PM but trades until 23:59, so prices
// "10 minutes before close" would just be the already-settled answer.
export const measurementTime = (event: MarketEvent): Date | null => {
  const weather = parseWeatherQuestion(event);
  if (weather) return weather.at;

  const match = event.title.match(/\bby\s+(\d{1,2})(?::(\d{2}))?\s*(AM|PM)(?:\s+(WAT|GMT|UTC|ET|EDT|EST))?\b/i);
  const day = event.resolutionDate ?? event.closingDate;
  if (!match || !day) return null;
  const [, hour, minute, meridiem, zone] = match;
  const hour24 = (Number(hour) % 12) + (meridiem!.toUpperCase() === "PM" ? 12 : 0);
  const offset = zoneOffset(zone, new Date(day));
  // the calendar day in that zone of the resolution date
  const local = new Date(Date.parse(day) + offset * 3_600_000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour24 - offset, Number(minute ?? 0)));
};
