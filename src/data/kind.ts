import type { MarketEvent } from "@/exchanges/types.ts";
import { isRecurringCount } from "./index.ts";
import { parseWeatherQuestion } from "./weather.ts";

// What a market actually measures. Finer than the exchange's categories (Bayse files weather
// under OTHERS and mixes streams with chart positions under ENTERTAINMENT), so results can be
// compared by type: e.g. "are weather bets really more profitable than post counts?"
// "engagement" (likes, views, reposts, followers) is its own kind because anyone who buys bots
// can move the number, and Bayse voids these more often for manipulation.
// "match-stats" (shots, passes, corners, cards…) is split from "sports" because bookmakers rarely
// price those lines, so there's no market to check the model's guess against.
export type MarketKind =
  | "weather"
  | "post-count"
  | "engagement"
  | "streams"
  | "chart"
  | "price"
  | "economy"
  | "sports"
  | "match-stats"
  | "other";

export const MARKET_KINDS: MarketKind[] = [
  "weather",
  "post-count",
  "engagement",
  "streams",
  "chart",
  "price",
  "economy",
  "sports",
  "match-stats",
  "other",
];

const MATCH_STATS =
  /\b(shots?|passes|corners?|cards?|bookings?|possession|fouls?|offsides?|tackles?|saves?|throw-?ins?)\b/i;

const ENGAGEMENT =
  /\b(likes?|views?|reposts?|retweets?|followers?|subscribers?|impressions?|comments?|reactions?)\b/i;

type Classifiable = Pick<MarketEvent, "title" | "category" | "resolutionDate" | "closingDate">;

export const marketKind = (event: Classifiable): MarketKind => {
  const title = event.title;
  const category = event.category.toUpperCase();
  // results and goals are "sports"; shots, passes, corners and player stats are "match-stats"
  if (category === "PLAYER STATS") return "match-stats";
  if (category === "SPORTS") return MATCH_STATS.test(title) ? "match-stats" : "sports";
  if (
    parseWeatherQuestion(event as MarketEvent) ||
    /\b(temperature|rainfall|weather)\b/i.test(title)
  )
    return "weather";
  // before post counts: "likes on her latest post" mentions posts but measures engagement
  if (ENGAGEMENT.test(title)) return "engagement";
  if (isRecurringCount(event as MarketEvent)) return "post-count";
  if (/\bstreams?\b/i.test(title)) return "streams";
  if (/\b(chart|top songs|top 10|#1 song|billboard|apple music|spotify)\b/i.test(title))
    return "chart";
  if (
    category === "CRYPTO" ||
    category === "FINANCE" ||
    /\b(price|up or down|above \$|below \$)/i.test(title)
  )
    return "price";
  if (category === "ECONOMY" || category === "ECONOMICS") return "economy";
  return "other";
};
