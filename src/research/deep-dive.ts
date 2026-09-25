import { z } from "zod";
import { gatherEventData, isRecurringCount } from "@/data/index.ts";
import type { Confidence } from "@/db/bets.ts";
import { recordUsage } from "@/db/spend.ts";
import type { MarketEvent } from "@/exchanges/types.ts";
import { log } from "@/lib/logger.ts";
import { generate } from "@/llm/gemini.ts";
import type { Source, Usage } from "@/llm/types.ts";
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
  sources: Source[];
  estimates: Estimate[];
  usage: Usage;
  costUsd: number;
};

// Kept short on purpose: every token here is paid on every deep dive
const SYSTEM = `You are a calibrated forecaster for a Nigerian prediction market. These markets settle on measurable data.
First find the current state of the measured quantity inside the resolution window: the count or value so far, the latest chart figure, or the forecast for the resolution time. Use the Data lines if given, open the Data pages, and search (at most 4 searches). History and averages are only a fallback.
Reason from the numbers: how far the current value is from each threshold and how much it usually moves in the time left. Resolution rules and the named source decide the answer.
"reading": the current value you found, with its time and source, or "none" if you only found history. "live": true only if you found a current value or forecast for the resolution window.
Confidence: "high" only when a live reading settles it; "low" when you have no live reading.
Mutually exclusive markets: probabilities should sum to about 1 minus the unlisted long shots.
Be brief: summary max 60 words, reading max 25 words, max 3 factors of max 15 words each.`;

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["reading", "live", "summary", "factors", "estimates"],
  properties: {
    reading: { type: "string" },
    live: { type: "boolean" },
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
  reading: z.string(),
  live: z.boolean(),
  summary: z.string(),
  factors: z.array(z.string()),
  estimates: z.array(z.object({ ref: z.string(), p: z.number().min(0).max(1), c: z.enum(["low", "medium", "high"]) })),
});

export const deepDive = async (event: MarketEvent): Promise<DeepDive> => {
  const { text, marketIdByRef } = describeEvent(event);
  const data = await gatherEventData(event);
  const extra = [
    ...data.notes.map((note) => `Data: ${note}`),
    data.pages.length > 0 && `Data pages: ${data.pages.join(" ")}`,
  ].filter((line): line is string => typeof line === "string");

  const result = await generate({
    system: SYSTEM,
    prompt: [`Now ${nowUtc()}.`, text, ...extra].join("\n"),
    jsonSchema: schema,
    parse,
    webSearch: true,
    // includes thinking/reasoning tokens; only what's used is billed
    maxOutputTokens: 6000,
  });

  const costUsd = await recordUsage(result.usage);
  const liveData = data.hasLiveData || result.data.live;
  log.info("deep dive", { eventId: event.id, usage: result.usage, costUsd, liveData, reading: result.data.reading });

  // Without a live reading the estimate rests on history (e.g. "this artist has never done
  // 285k first-day streams") while the real number may already be close. Cap confidence at
  // "low", so the bet needs a much larger mispricing to go ahead. Recurring post counts are
  // the exception: an account's posting history is solid evidence, so they cap at "medium".
  const cap: Confidence = liveData ? "high" : isRecurringCount(event) ? "medium" : "low";
  const estimates = result.data.estimates.flatMap((estimate) => {
    const marketId = marketIdByRef.get(estimate.ref);
    if (!marketId) return [];
    return [{ marketId, probabilityOutcome1: estimate.p, confidence: minConfidence(estimate.c, cap) }];
  });

  return {
    summary: result.data.summary,
    keyFactors: result.data.factors.slice(0, 3),
    reading: liveData
      ? result.data.reading
      : /^none\.?$/i.test(result.data.reading.trim())
        ? "no live reading found"
        : `no live reading; history only: ${result.data.reading}`,
    liveData,
    sources: dedupeSources(result.sources).slice(0, 4),
    estimates,
    usage: result.usage,
    costUsd,
  };
};

const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
const minConfidence = (a: Confidence, b: Confidence) => (RANK[a] <= RANK[b] ? a : b);

const dedupeSources = (sources: Source[]) => {
  const seen = new Set<string>();
  return sources.filter((source) => !seen.has(source.url) && seen.add(source.url));
};
