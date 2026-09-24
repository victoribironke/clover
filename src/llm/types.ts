import type { z } from "zod";

export type Source = { title: string; url: string };

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  searches: number;
};

export type StructuredRequest<T> = {
  system: string;
  prompt: string;
  // JSON schema sent to Gemini so the reply has a fixed, compact shape
  jsonSchema: Record<string, unknown>;
  // validates the parsed reply on our side
  parse: z.ZodType<T>;
  webSearch: boolean;
  maxOutputTokens: number;
};

export type StructuredResult<T> = {
  data: T;
  // pulled from search metadata, so the model doesn't spend output tokens listing them
  sources: Source[];
  usage: Usage;
};
