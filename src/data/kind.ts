import type { MarketEvent } from "@/exchanges/types.ts";
import { isRecurringCount } from "./index.ts";
import { parseWeatherQuestion } from "./weather.ts";

// What a market actually measures. Finer than the exchange's categories (Bayse files weather
// under OTHERS and mixes streams with chart positions under ENTERTAINMENT), so results can be
// compared by type: e.g. "are weather bets really more profitable than post counts?"
export type MarketKind = "weather" | "post-count" | "streams" | "chart" | "price" | "economy" | "other";

export const MARKET_KINDS: MarketKind[] = ["weather", "post-count", "streams", "chart", "price", "economy", "other"];

type Classifiable = Pick<MarketEvent, "title" | "category" | "resolutionDate" | "closingDate">;

export const marketKind = (event: Classifiable): MarketKind => {
  const title = event.title;
  const category = event.category.toUpperCase();
  if (parseWeatherQuestion(event as MarketEvent) || /\b(temperature|rainfall|weather)\b/i.test(title)) return "weather";
  if (isRecurringCount(event as MarketEvent)) return "post-count";
  if (/\bstreams?\b/i.test(title)) return "streams";
  if (/\b(chart|top songs|top 10|#1 song|billboard|apple music|spotify)\b/i.test(title)) return "chart";
  if (category === "CRYPTO" || category === "FINANCE" || /\b(price|up or down|above \$|below \$)/i.test(title)) return "price";
  if (category === "ECONOMY" || category === "ECONOMICS") return "economy";
  return "other";
};
