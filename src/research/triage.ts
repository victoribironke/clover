import { z } from "zod";
import { config } from "@/config.ts";
import { recordUsage } from "@/db/spend.ts";
import type { MarketEvent } from "@/exchanges/types.ts";
import { log } from "@/lib/logger.ts";
import { generate } from "@/llm/gemini.ts";
import { settings } from "@/settings.ts";
import { isTradeable, nowUtc } from "./describe-event.ts";

const SYSTEM = `Pick prediction markets worth web research. Only pick markets that settle on a measurable number from a public data source: a price, exchange rate, temperature, post/stream count, chart position, or official statistic. Sports matches are fine too (results, goals, shots, passes, corners): favor ones with bookmaker lines to compare against. Never pick markets decided by a person's choice (awards, evictions, guests, retirements, elections), and never likes, views, reposts or follower counts (anyone can buy those with bots).
Best targets, pick these first: weather readings (forecast models are strong a day or two out) and post counts by an account or person (posting habits are steady). Then chart positions, stream counts and price thresholds.
Favor ones where current data, trends, or forecasts can beat the crowd, at mid-range prices. Skip pure noise: 15-minute, hourly and daily up/down moves are close to coin flips. Reply with refs only, best first. Picking none is fine.`;

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["refs"],
  properties: { refs: { type: "array", items: { type: "string" } } },
};

const parse = z.object({ refs: z.array(z.string()) });

// e.g. "e4|CRYPTO|09-24 22:00|Will Bitcoin be above $84,371.62 by 10:00 PM GMT?|Yes 41"
const line = (event: MarketEvent, index: number) => {
  const prices = event.markets
    .filter(isTradeable)
    .slice(0, 3)
    .map((market) => `${market.title.slice(0, 30)} ${Math.round(market.outcomes[0].price * 100)}`)
    .join(",");
  return `e${index + 1}|${event.category}|${(event.resolutionDate ?? event.closingDate)?.slice(5, 16).replace("T", " ") ?? "-"}|${event.title.slice(0, 90)}|${prices}`;
};

// One cheap call (no web search) over the whole candidate list; returns event ids, best first
export const triageEvents = async (events: MarketEvent[], limit: number) => {
  // Always screen, even a short list: screening is what enforces "measurable data only",
  // and it costs a fraction of a cent
  if (events.length === 0 || limit === 0) return [];

  const result = await generate({
    system: SYSTEM,
    prompt: `Now ${nowUtc()}. Pick up to ${limit}.\nref|category|resolves(UTC)|title|prices(%)\n${events.map(line).join("\n")}`,
    jsonSchema: schema,
    parse,
    webSearch: false,
    // includes thinking tokens; only what's used is billed
    maxOutputTokens: 4000,
  });
  const costUsd = await recordUsage(result.usage);

  const picks = result.data.refs
    .map((ref) => events[Number(ref.replace(/^e/, "")) - 1]?.id)
    .filter((id): id is string => Boolean(id));
  const unique = [...new Set(picks)].slice(0, limit);
  log.info("triage", { picks: unique.length, usage: result.usage, costUsd });
  return unique;
};
