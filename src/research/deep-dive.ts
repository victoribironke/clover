import { z } from "zod";
import { config } from "@/config.ts";
import type { Confidence } from "@/db/bets.ts";
import type { MarketEvent } from "@/exchanges/types.ts";
import { log } from "@/lib/logger.ts";
import { generate } from "@/llm/gemini.ts";
import { recordUsage } from "@/db/spend.ts";
import type { Source, Usage } from "@/llm/types.ts";
import { settings } from "@/settings.ts";
import { describeEvent, nowUtc } from "./describe-event.ts";

export type Estimate = {
  marketId: string;
  probabilityOutcome1: number;
  confidence: Confidence;
};

export type DeepDive = {
  summary: string;
  keyFactors: string[];
  sources: Source[];
  estimates: Estimate[];
  usage: Usage;
  costUsd: number;
};

// Kept short on purpose: every token here is paid on every deep dive
const SYSTEM = `You are a calibrated forecaster for a Nigerian prediction market.
Search the web (at most 4 searches) for recent stats, form, polls, bookmaker/exchange odds, and news, then estimate each market's outcome1 probability.
Resolution rules decide the answer, not the headline. Start from base rates. Bookmaker odds are strong evidence.
Thin evidence: stay near the base rate, confidence "low". Use "high" only when hard recent data settles it.
Mutually exclusive markets: probabilities should sum to about 1 minus the unlisted long shots.
Be brief: summary max 60 words, max 3 factors of max 15 words each.`;

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "factors", "estimates"],
  properties: {
    summary: { type: "string" },
    factors: { type: "array", items: { type: "string" } },
    estimates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ref", "p", "c"],
        properties: {
          ref: { type: "string", description: "market ref, e.g. m1" },
          p: { type: "number", description: "probability of outcome1, 0-1" },
          c: { type: "string", enum: ["low", "medium", "high"] },
        },
      },
    },
  },
};

const parse = z.object({
  summary: z.string(),
  factors: z.array(z.string()),
  estimates: z.array(z.object({ ref: z.string(), p: z.number().min(0).max(1), c: z.enum(["low", "medium", "high"]) })),
});

export const deepDive = async (event: MarketEvent): Promise<DeepDive> => {
  const { text, marketIdByRef } = describeEvent(event);
  const result = await generate({
    system: SYSTEM,
    prompt: `Now ${nowUtc()}.\n${text}`,
    jsonSchema: schema,
    parse,
    webSearch: true,
    // includes thinking/reasoning tokens; only what's used is billed
    maxOutputTokens: 6000,
  });

  const costUsd = await recordUsage(result.usage);
  log.info("deep dive", { eventId: event.id, usage: result.usage, costUsd });

  const estimates = result.data.estimates.flatMap((estimate) => {
    const marketId = marketIdByRef.get(estimate.ref);
    return marketId ? [{ marketId, probabilityOutcome1: estimate.p, confidence: estimate.c }] : [];
  });

  return {
    summary: result.data.summary,
    keyFactors: result.data.factors.slice(0, 3),
    sources: dedupeSources(result.sources).slice(0, 4),
    estimates,
    usage: result.usage,
    costUsd,
  };
};

const dedupeSources = (sources: Source[]) => {
  const seen = new Set<string>();
  return sources.filter((source) => !seen.has(source.url) && seen.add(source.url));
};
