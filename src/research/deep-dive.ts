import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { config } from "@/config.ts";
import type { MarketEvent } from "@/exchanges/types.ts";
import { log } from "@/lib/logger.ts";
import { anthropic } from "./anthropic.ts";
import { describeEvent } from "./describe-event.ts";

const EstimateSchema = z.object({
  market_id: z.string(),
  probability_outcome1: z.number().min(0).max(1),
  confidence: z.enum(["low", "medium", "high"]),
  reasoning: z.string(),
});

const SubmissionSchema = z.object({
  summary: z.string(),
  key_factors: z.array(z.string()),
  sources: z.array(z.object({ title: z.string(), url: z.string() })),
  estimates: z.array(EstimateSchema),
});

export type Estimate = {
  marketId: string;
  probabilityOutcome1: number;
  confidence: "low" | "medium" | "high";
  reasoning: string;
};

export type DeepDive = {
  summary: string;
  keyFactors: string[];
  sources: { title: string; url: string }[];
  estimates: Estimate[];
};

const SUBMIT_TOOL: Anthropic.Beta.BetaTool = {
  name: "submit_research",
  description:
    "Submit your final research findings and probability estimates. Call this exactly once, after you have finished researching.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["summary", "key_factors", "sources", "estimates"],
    properties: {
      summary: { type: "string", description: "3-6 sentence summary of what the evidence says." },
      key_factors: { type: "array", items: { type: "string" }, description: "The few facts that drive the estimate." },
      sources: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "url"],
          properties: { title: { type: "string" }, url: { type: "string" } },
        },
      },
      estimates: {
        type: "array",
        description: "One entry per market_id listed in the event.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["market_id", "probability_outcome1", "confidence", "reasoning"],
          properties: {
            market_id: { type: "string" },
            probability_outcome1: { type: "number", description: "Probability (0-1) that outcome1 wins." },
            confidence: {
              type: "string",
              enum: ["low", "medium", "high"],
              description: "How much hard evidence backs this number.",
            },
            reasoning: { type: "string", description: "One or two sentences." },
          },
        },
      },
    },
  },
};

const TOOLS: Anthropic.Beta.BetaToolUnion[] = [
  { type: "web_search_20260209", name: "web_search", max_uses: 12 },
  { type: "web_fetch_20260209", name: "web_fetch", max_uses: 8 },
  SUBMIT_TOOL,
];

const SYSTEM = `You are a forecasting analyst researching prediction markets on Bayse, a Nigerian prediction market.
Your job is to estimate, as accurately and honestly as you can, the probability of each outcome.

How to work:
- Search the web for the most recent, relevant evidence: statistics, form, polls, official schedules, expert and bookmaker odds, news.
- Read each market's resolution rules carefully; the question resolves on the rules, not the headline.
- Start from a base rate, then adjust for specific evidence. Bookmaker or other exchange odds, when you find them, are strong evidence.
- Be calibrated. If evidence is thin, stay near the base rate and mark confidence "low". Use "high" only when hard, recent evidence pins the answer down.
- For mutually exclusive markets, your outcome1 probabilities should sum to about 1.
- Nigerian context matters: local news, Nollywood/music industry, NPFL, state politics, and so on.

When done, call submit_research exactly once with an estimate for every market_id.`;

const MAX_TURNS = 8;

const isSubmitCall = (block: Anthropic.Beta.BetaContentBlock): block is Anthropic.Beta.BetaToolUseBlock =>
  block.type === "tool_use" && block.name === SUBMIT_TOOL.name;

export const deepDive = async (event: MarketEvent): Promise<DeepDive> => {
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content: `Today is ${new Date().toISOString().slice(0, 10)}. Research this event and estimate the probabilities.\n\n${describeEvent(event)}`,
    },
  ];

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    const stream = anthropic.beta.messages.stream({
      model: config.RESEARCH_MODEL,
      max_tokens: 64000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      tools: TOOLS,
      messages,
    });
    const response = await stream.finalMessage();

    log.info("deep dive turn", {
      eventId: event.id,
      turn,
      stopReason: response.stop_reason,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });

    if (response.stop_reason === "refusal") {
      throw new Error(`Research refused for ${event.id}: ${response.stop_details?.explanation ?? "no details"}`);
    }

    const submission = response.content.find(isSubmitCall);
    if (submission) {
      const parsed = SubmissionSchema.parse(submission.input);
      const known = new Set(event.markets.map((market) => market.id));
      return {
        summary: parsed.summary,
        keyFactors: parsed.key_factors,
        sources: parsed.sources,
        estimates: parsed.estimates
          .filter((estimate) => known.has(estimate.market_id))
          .map((estimate) => ({
            marketId: estimate.market_id,
            probabilityOutcome1: estimate.probability_outcome1,
            confidence: estimate.confidence,
            reasoning: estimate.reasoning,
          })),
      };
    }

    if (response.stop_reason === "max_tokens") {
      throw new Error(`Research for ${event.id} ran out of output tokens`);
    }

    messages.push({ role: "assistant", content: response.content });
    // pause_turn: the server-side search loop hit its iteration cap; resending resumes it.
    // end_turn without a submission: nudge the model to submit.
    if (response.stop_reason !== "pause_turn") {
      messages.push({ role: "user", content: "Please call submit_research now with your final estimates." });
    }
  }

  throw new Error(`Research for ${event.id} did not submit after ${MAX_TURNS} turns`);
};
