import { z } from "zod";
import { gatherEventData, isRecurringCount } from "@/data/index.ts";
import type { Confidence } from "@/db/bets.ts";
import { recordUsage } from "@/db/spend.ts";
import type { MarketEvent } from "@/exchanges/types.ts";
import { log } from "@/lib/logger.ts";
import { research } from "@/llm/gemini.ts";
import { reason } from "@/llm/openai.ts";
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
  // the latest measured value or forecast the research was based on, or "none found"
  reading: string;
  // whether that reading is a live value/forecast for the resolution window
  liveData: boolean;
  // the search model's fact brief, as handed to the reasoning model
  facts: string[];
  sources: Source[];
  estimates: Estimate[];
  // both calls together
  usage: Usage;
  costUsd: number;
};

// Two steps. Gemini searches (Google Search is free up to 5,000 a month) and writes a fact brief,
// no opinion. gpt-6-luna then makes the call from that brief: its tokens cost a fraction of
// Gemini's, so the brief can be generous while Gemini's own writing stays short.

// Step 1: the search model gathers facts
const SEARCH_SYSTEM = `You research prediction markets for a forecaster, who can't search and only sees what you write. Find facts, don't forecast.
First find the current state of the measured quantity inside the resolution window: the count or value so far, the latest chart figure, or the forecast for the resolution time. For sports, find current bookmaker odds for these exact lines (several bookmakers if you can), confirmed or expected lineups, injuries and suspensions, recent form and head-to-head, and what's at stake. Use the Data lines if given, open the Data pages, and search (at most 3 searches: pick the queries most likely to find current numbers or odds).
"reading": the single most important current value, with its time and source, or "none" if you only found history. "live": true only if you found a current value, a forecast for the resolution window, or current bookmaker odds for these lines.
"facts": everything useful, one per item, each with its number, date and source: current values and how fast they move, odds per line and bookmaker, forecasts, recent history, and anything in the rules or named source that changes the answer. Say when something couldn't be found. Numbers over adjectives, max 12 facts of max 30 words each.`;

const searchSchema = {
  type: "object",
  additionalProperties: false,
  required: ["reading", "live", "facts"],
  properties: {
    reading: { type: "string" },
    live: { type: "boolean" },
    facts: { type: "array", items: { type: "string" } },
  },
};

const searchParse = z.object({ reading: z.string(), live: z.boolean(), facts: z.array(z.string()) });

// Step 2: the reasoning model decides
const DECIDE_SYSTEM = `You are a calibrated forecaster for a Nigerian prediction market. These markets settle on measurable data or sports results. You get the event, its markets, and a fact brief from a researcher.
Reason from the current numbers: how far the current value is from each threshold and how much it usually moves in the time left. For sports, current bookmaker odds for the same line (with the margin removed) are the strongest evidence; adjust for lineups and injuries only with clear reason. History and averages are only a fallback. Resolution rules and the named source decide the answer. Read each market's line carefully (team total vs match total, over vs under).
Confidence: "high" only when a live reading settles it; "low" when the brief has no live reading.
Mutually exclusive markets: probabilities should sum to about 1 minus the unlisted long shots.
Be brief: summary max 60 words, max 3 factors of max 15 words each.`;

const decideSchema = {
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

const decideParse = z.object({
  summary: z.string(),
  factors: z.array(z.string()),
  estimates: z.array(z.object({ ref: z.string(), p: z.number().min(0).max(1), c: z.enum(["low", "medium", "high"]) })),
});

const addUsage = (a: Usage, b: Usage): Usage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  searches: a.searches + b.searches,
});

export const deepDive = async (event: MarketEvent): Promise<DeepDive> => {
  const { text, marketIdByRef } = describeEvent(event);
  const data = await gatherEventData(event);
  const extra = [
    ...data.notes.map((note) => `Data: ${note}`),
    data.pages.length > 0 && `Data pages: ${data.pages.join(" ")}`,
  ].filter((line): line is string => typeof line === "string");
  const now = `Now ${nowUtc()}.`;

  const found = await research({
    system: SEARCH_SYSTEM,
    prompt: [now, text, ...extra].join("\n"),
    jsonSchema: searchSchema,
    parse: searchParse,
    // includes thinking tokens; only what's used is billed
    maxOutputTokens: 6000,
  });
  const searchCost = await recordUsage(settings.searchModel, found.usage);
  const liveData = data.hasLiveData || found.data.live;
  const facts = found.data.facts.slice(0, 15);

  const decided = await reason({
    system: DECIDE_SYSTEM,
    prompt: [
      now,
      text,
      // the Data lines are hard numbers we fetched ourselves: pass them on as they are
      ...data.notes.map((note) => `Data: ${note}`),
      `Researcher's reading: ${found.data.reading} (${liveData ? "live" : "not live"})`,
      "Facts:",
      ...facts.map((fact) => `- ${fact}`),
    ].join("\n"),
    jsonSchema: decideSchema,
    parse: decideParse,
    effort: "medium",
    // includes reasoning tokens; only what's used is billed
    maxOutputTokens: 8000,
  });
  const decideCost = await recordUsage(settings.reasoningModel, decided.usage);

  const usage = addUsage(found.usage, decided.usage);
  const costUsd = searchCost + decideCost;
  log.info("deep dive", { eventId: event.id, usage, costUsd, liveData, reading: found.data.reading, facts: facts.length });

  // Without a live reading the estimate rests on history (e.g. "this artist has never done
  // 285k first-day streams") while the real number may already be close. Cap confidence at
  // "low", so the bet needs a much larger mispricing to go ahead. Recurring post counts are
  // the exception: an account's posting history is solid evidence, so they cap at "medium".
  const cap: Confidence = liveData ? "high" : isRecurringCount(event) ? "medium" : "low";
  const estimates = decided.data.estimates.flatMap((estimate) => {
    const marketId = marketIdByRef.get(estimate.ref);
    if (!marketId) return [];
    return [{ marketId, probabilityOutcome1: estimate.p, confidence: minConfidence(estimate.c, cap) }];
  });

  return {
    summary: decided.data.summary,
    keyFactors: decided.data.factors.slice(0, 3),
    reading: liveData
      ? found.data.reading
      : /^none\.?$/i.test(found.data.reading.trim())
        ? "no live reading found"
        : `no live reading; history only: ${found.data.reading}`,
    liveData,
    facts,
    sources: dedupeSources(found.sources).slice(0, 4),
    estimates,
    usage,
    costUsd,
  };
};

const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
const minConfidence = (a: Confidence, b: Confidence) => (RANK[a] <= RANK[b] ? a : b);

const dedupeSources = (sources: Source[]) => {
  const seen = new Set<string>();
  return sources.filter((source) => !seen.has(source.url) && seen.add(source.url));
};
