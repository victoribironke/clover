import type { Market, MarketEvent } from "@/exchanges/types.ts";

// Markets priced outside this band are never bet on, so they're not worth research tokens
const MIN_PRICE = 0.03;
const MAX_PRICE = 0.97;

export const isTradeable = (market: Market) =>
  market.status === "open" && market.outcomes.some((outcome) => outcome.price >= MIN_PRICE && outcome.price <= MAX_PRICE);

const clip = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};

export type DescribedEvent = {
  text: string;
  // short refs ("m1", "m2", …) cost far fewer tokens than UUIDs, in and out
  marketIdByRef: Map<string, string>;
};

// Compact plain-text brief for the research model. Prices are left out on
// purpose so the model forms its own estimate; sizing blends the two later.
export const describeEvent = (event: MarketEvent): DescribedEvent => {
  const markets = event.markets.filter(isTradeable);
  const marketIdByRef = new Map(markets.map((market, index) => [`m${index + 1}`, market.id]));
  const omitted = event.markets.length - markets.length;

  // rules repeat across the markets of one event, so print each distinct text once
  const sharedRules = new Set(markets.map((market) => market.rules)).size === 1 ? markets[0]?.rules : undefined;

  const lines = [
    `Event: ${event.title}`,
    event.closingDate && `Closes: ${event.closingDate.slice(0, 16)}`,
    event.resolutionSource && `Source: ${clip(event.resolutionSource, 150)}`,
    // descriptions often repeat the rules verbatim
    event.description && clip(event.description, 500) !== clip(sharedRules ?? "", 500) && `Info: ${clip(event.description, 400)}`,
    event.type === "combined" &&
      `Mutually exclusive: one market resolves YES.${omitted ? ` ${omitted} long-shot options not listed.` : ""}`,
    sharedRules && `Rules: ${clip(sharedRules, 500)}`,
    "Markets (outcome1/outcome2):",
    ...markets.map((market, index) => {
      const rules = !sharedRules && market.rules ? ` | rules: ${clip(market.rules, 250)}` : "";
      return `m${index + 1}: ${market.title} (${market.outcomes[0].label}/${market.outcomes[1].label})${rules}`;
    }),
  ];

  return { text: lines.filter((line): line is string => typeof line === "string").join("\n"), marketIdByRef };
};
