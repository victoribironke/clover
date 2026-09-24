import { z } from "zod";
import { config } from "@/config.ts";
import { recordUsage } from "@/db/spend.ts";
import type { MarketEvent } from "@/exchanges/types.ts";
import { log } from "@/lib/logger.ts";
import { generate } from "@/llm/gemini.ts";
import { settings } from "@/settings.ts";
import { isTradeable, nowUtc } from "./describe-event.ts";

const SYSTEM = `Pick prediction markets worth web research. Favor questions where public info (stats, polls, odds, schedules) can beat the crowd and mid-range prices. Skip noise (short-term crypto, coin flips) and unknowables. Reply with refs only, best first.`;

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["refs"],
  properties: { refs: { type: "array", items: { type: "string" } } },
};

const parse = z.object({ refs: z.array(z.string()) });

// e.g. "e4|SPORTS|09-27|Arsenal vs Chelsea: Winner|Arsenal 48,Draw 27,Chelsea 25"
const line = (event: MarketEvent, index: number) => {
  const prices = event.markets
    .filter(isTradeable)
    .slice(0, 3)
    .map((market) => `${market.title.slice(0, 30)} ${Math.round(market.outcomes[0].price * 100)}`)
    .join(",");
  return `e${index + 1}|${event.category}|${(event.resolutionDate ?? event.closingDate)?.slice(11, 16) ?? "-"}|${event.title.slice(0, 90)}|${prices}`;
};

// One cheap call (no web search) over the whole candidate list; returns event ids, best first
export const triageEvents = async (events: MarketEvent[], limit: number) => {
  if (events.length === 0 || limit === 0) return [];
  if (events.length <= limit) return events.map((event) => event.id);

  const result = await generate({
    system: SYSTEM,
    prompt: `Now ${nowUtc()}. All events resolve within hours. Pick up to ${limit}.\nref|category|resolves(UTC)|title|prices(%)\n${events.map(line).join("\n")}`,
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
