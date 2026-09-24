import { ApiError, GoogleGenAI, ThinkingLevel } from "@google/genai";
import { config } from "@/config.ts";
import { settings } from "@/settings.ts";
import type { Source, StructuredRequest, StructuredResult } from "./types.ts";

// The SDK only retries when retryOptions is set. It then retries 408/429/500/502/503/504
// with exponential backoff and jitter: here about 3s, 6s, 12s between the 4 attempts.
// Failed attempts aren't billed. Each attempt times out after 90s (a grounded deep dive
// normally takes 10-40s), so one stuck request can't stall a scan.
const ai = new GoogleGenAI({
  apiKey: config.GEMINI_API_KEY,
  httpOptions: { timeout: 90_000, retryOptions: { attempts: 4, initialDelay: 3, maxDelay: 30 } },
});

// After retries: Gemini itself is down or out of quota, so there's no point trying the next event
export const isGeminiUnavailable = (error: unknown) =>
  error instanceof ApiError && [429, 500, 502, 503, 504].includes(error.status);

export const generate = async <T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> => {
  const response = await ai.models.generateContent({
    model: settings.model,
    contents: request.prompt,
    config: {
      systemInstruction: request.system,
      // Gemini 3 allows search grounding and a JSON schema in the same call
      tools: request.webSearch ? [{ googleSearch: {} }] : undefined,
      responseMimeType: "application/json",
      responseJsonSchema: request.jsonSchema,
      maxOutputTokens: request.maxOutputTokens,
      // LOW is the cheapest level gemini-3.8-flash accepts (MINIMAL is rejected with a 400)
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    },
  });

  const text = response.text;
  if (!text) throw new Error(`Gemini returned no text (finish: ${response.candidates?.[0]?.finishReason ?? "unknown"})`);
  const data = request.parse.parse(JSON.parse(text));

  const grounding = response.candidates?.[0]?.groundingMetadata;
  const sources: Source[] = (grounding?.groundingChunks ?? [])
    .map((chunk) => chunk.web)
    .filter((web) => web?.uri)
    .map((web) => ({ title: web!.title ?? web!.uri!, url: web!.uri! }));

  const meta = response.usageMetadata;
  return {
    data,
    sources,
    usage: {
      // search results fed back to the model show up as tool-use prompt tokens
      inputTokens: (meta?.promptTokenCount ?? 0) + (meta?.toolUsePromptTokenCount ?? 0),
      outputTokens: (meta?.candidatesTokenCount ?? 0) + (meta?.thoughtsTokenCount ?? 0),
      searches: grounding?.webSearchQueries?.length ?? 0,
    },
  };
};
