import type { MarketEvent } from "@/exchanges/types.ts";

const TYPE_NOTE: Record<MarketEvent["type"], string> = {
  single: "Single binary market.",
  combined: "Mutually exclusive markets: exactly one market resolves YES, the rest resolve NO.",
  grouped: "Independent markets: each resolves on its own.",
};

// Plain-text description of an event for the research model. Market prices are
// deliberately left out so the model forms an independent estimate instead of
// anchoring on the crowd; the sizing step blends the two afterwards.
export const describeEvent = (event: MarketEvent) => {
  const lines = [
    `Event: ${event.title}`,
    `Category: ${event.category}`,
    `Structure: ${TYPE_NOTE[event.type]}`,
    event.closingDate && `Trading closes: ${event.closingDate}`,
    event.resolutionDate && `Resolves: ${event.resolutionDate}`,
    event.resolutionSource && `Resolution source: ${event.resolutionSource}`,
    event.description && `Description: ${event.description}`,
    event.additionalContext && `Additional context: ${event.additionalContext}`,
    "",
    "Markets:",
    ...event.markets.map((market) =>
      [
        `- market_id: ${market.id}`,
        `  question: ${market.title}`,
        `  outcome1: ${market.outcomes[0].label}, outcome2: ${market.outcomes[1].label}`,
        market.rules && `  rules: ${market.rules.replace(/\s+/g, " ").trim()}`,
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  ];
  return lines.filter((line): line is string => typeof line === "string").join("\n");
};
