import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { config } from "@/config.ts";
import { settings } from "@/settings.ts";
import type { Source, StructuredRequest, StructuredResult } from "./types.ts";

const ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });

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
      thinkingConfig: { thinkingLevel: request.webSearch ? ThinkingLevel.LOW : ThinkingLevel.MINIMAL },
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
