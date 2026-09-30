import OpenAI, { APIError } from "openai";
import { config } from "@/config.ts";
import { settings } from "@/settings.ts";
import { parseModelJson } from "./json.ts";
import type { StructuredRequest, StructuredResult } from "./types.ts";

// The reasoning model: triage and the betting decision. No web search here (Gemini does that,
// and its searches are free up to 5,000 a month). The SDK retries 408/409/429/5xx and
// connection errors with backoff; each attempt times out after 90s.
const client = new OpenAI({ apiKey: config.OPENAI_API_KEY, timeout: 90_000, maxRetries: 3 });

export type Effort = "none" | "low" | "medium" | "high";

// After retries: OpenAI is down or out of quota, so there's no point trying the next event
export const isOpenAiUnavailable = (error: unknown) =>
  error instanceof APIError &&
  (error.status === undefined || [429, 500, 502, 503, 504].includes(error.status));

export const reason = async <T>(
  request: StructuredRequest<T> & { effort: Effort },
): Promise<StructuredResult<T>> => {
  const response = await client.responses.create({
    model: settings.reasoningModel,
    instructions: request.system,
    input: request.prompt,
    // strict: the reply always matches the schema (every property required, no extras)
    text: {
      format: { type: "json_schema", name: "reply", schema: request.jsonSchema, strict: true },
    },
    reasoning: { effort: request.effort },
    // includes reasoning tokens; only what's used is billed
    max_output_tokens: request.maxOutputTokens,
    store: false,
  });

  if (response.status === "incomplete") {
    throw new Error(`OpenAI reply cut off (${response.incomplete_details?.reason ?? "unknown"})`);
  }
  const text = response.output_text;
  if (!text) throw new Error("OpenAI returned no text");

  return {
    data: request.parse.parse(parseModelJson(text)),
    sources: [],
    usage: {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      searches: 0,
    },
  };
};
