import { ApiError, GoogleGenAI, ThinkingLevel } from "@google/genai";
import { config } from "@/config.ts";
import { settings } from "@/settings.ts";
import type { Source, Usage } from "./types.ts";

// The SDK only retries when retryOptions is set. It then retries 408/429/500/502/503/504
// with exponential backoff and jitter: here about 3s, 6s, 12s between the 4 attempts.
// Failed attempts aren't billed. Each attempt times out after 90s (a grounded search
// normally takes 10-40s), so one stuck request can't stall a scan.
const ai = new GoogleGenAI({
  apiKey: config.GEMINI_API_KEY,
  httpOptions: { timeout: 90_000, retryOptions: { attempts: 4, initialDelay: 3, maxDelay: 30 } },
});

// After retries: Gemini itself is down or out of quota, so there's no point trying the next event
export const isGeminiUnavailable = (error: unknown) =>
  error instanceof ApiError && [429, 500, 502, 503, 504].includes(error.status);

export type ResearchRequest = { system: string; prompt: string; maxOutputTokens: number };
export type ResearchResult = { text: string; sources: Source[]; usage: Usage };

// The search model: Google Search grounding plus URL reading. It gathers facts as plain text;
// the reasoning model (./openai.ts) makes the call. No JSON here: with search on, Gemini doesn't
// hold to a schema, and broken JSON (e.g. `"facts":.",`) lost the whole deep dive.
export const research = async (request: ResearchRequest): Promise<ResearchResult> => {
  const response = await ai.models.generateContent({
    model: settings.searchModel,
    contents: request.prompt,
    config: {
      systemInstruction: request.system,
      // URL context lets the model open data pages named in the prompt; their text is billed as input
      tools: [{ googleSearch: {} }, { urlContext: {} }],
      maxOutputTokens: request.maxOutputTokens,
      // LOW is the cheapest level gemini-3.8-flash accepts (MINIMAL is rejected with a 400)
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    },
  });

  const text = response.text;
  if (!text) throw new Error(`Gemini returned no text (finish: ${response.candidates?.[0]?.finishReason ?? "unknown"})`);

  const grounding = response.candidates?.[0]?.groundingMetadata;
  const sources: Source[] = (grounding?.groundingChunks ?? [])
    .map((chunk) => chunk.web)
    .filter((web) => web?.uri)
    .map((web) => ({ title: web!.title ?? web!.uri!, url: web!.uri! }));

  const meta = response.usageMetadata;
  return {
    text,
    sources,
    usage: {
      // search results fed back to the model show up as tool-use prompt tokens
      inputTokens: (meta?.promptTokenCount ?? 0) + (meta?.toolUsePromptTokenCount ?? 0),
      outputTokens: (meta?.candidatesTokenCount ?? 0) + (meta?.thoughtsTokenCount ?? 0),
      searches: grounding?.webSearchQueries?.length ?? 0,
    },
  };
};
