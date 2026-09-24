import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { config } from "@/config.ts";
import type { MarketEvent } from "@/exchanges/types.ts";
import { log } from "@/lib/logger.ts";
import { anthropic } from "./anthropic.ts";

const TriageSchema = z.object({
  picks: z.array(
    z.object({
      event_id: z.string(),
      reason: z.string(),
    }),
  ),
});

const SYSTEM = `You pick which prediction markets are worth an expensive deep-dive research run.
A deep dive searches the web for statistics, news and expert forecasts, then estimates probabilities.
Prefer events where public information can plausibly give an edge over the crowd:
sports with rich stats, elections with polling, scheduled announcements, measurable thresholds, events the crowd may be mispricing.
Avoid events that are close to pure noise (very short-horizon crypto up/down, coin flips) or where nothing is knowable in advance.
Where a market price is shown, an extreme price (near 0 or 1) is usually right; a mid-range price on a researchable question is more interesting.`;

const summarize = (event: MarketEvent) => {
  const prices = event.markets
    .slice(0, 6)
    .map((market) => `${market.title}: ${Math.round(market.outcomes[0].price * 100)}%`)
    .join("; ");
  const more = event.markets.length > 6 ? ` (+${event.markets.length - 6} more)` : "";
  return `${event.id} | ${event.category} | closes ${event.closingDate ?? "n/a"} | vol ${Math.round(event.totalVolume)} | ${event.title} | ${prices}${more}`;
};

// One cheap call over the whole candidate list; returns event ids ranked best-first
export const triageEvents = async (events: MarketEvent[], limit: number) => {
  if (events.length === 0 || limit === 0) return [];
  if (events.length <= limit) return events.map((event) => event.id);

  const response = await anthropic.messages.parse({
    model: config.TRIAGE_MODEL,
    max_tokens: 8000,
    output_config: { effort: "low", format: zodOutputFormat(TriageSchema) },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Today is ${new Date().toISOString().slice(0, 10)}.
Pick up to ${limit} events worth researching, best first. Use the exact event ids.

id | category | closes | volume | title | outcome1 prices
${events.map(summarize).join("\n")}`,
      },
    ],
  });

  if (response.stop_reason === "refusal" || !response.parsed_output) {
    log.warn("triage returned nothing", { stopReason: response.stop_reason });
    return [];
  }

  const known = new Set(events.map((event) => event.id));
  const picks = response.parsed_output.picks.filter((pick) => known.has(pick.event_id)).slice(0, limit);
  log.info("triage picks", { picks });
  return picks.map((pick) => pick.event_id);
};
