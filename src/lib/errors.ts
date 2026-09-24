import { ApiError as GeminiApiError } from "@google/genai";
import { GrammyError } from "grammy";
import { z } from "zod";
import { BayseApiError } from "@/exchanges/bayse/http.ts";

export type ErrorInfo = {
  // which service failed, e.g. "Gemini", "Bayse"
  source: string;
  // HTTP status and/or API status text, when known
  code: string | null;
  // the human-readable part, without JSON wrapping
  message: string;
};

// Gemini and Bayse both wrap the useful text in JSON:
// {"error":{"code":400,"message":"…","status":"INVALID_ARGUMENT"}} or {"error":"…","message":"…"}
const JsonError = z.object({
  error: z.union([
    z.object({ message: z.string(), status: z.string().optional(), code: z.number().optional() }),
    z.string(),
  ]),
  message: z.string().optional(),
});

const unwrapJson = (text: string) => {
  const start = text.indexOf("{");
  if (start === -1) return null;
  try {
    const parsed = JsonError.safeParse(JSON.parse(text.slice(start)));
    if (!parsed.success) return null;
    const { error, message } = parsed.data;
    return typeof error === "string"
      ? { message: message ?? error, status: error }
      : { message: error.message, status: error.status };
  } catch {
    return null;
  }
};

const code = (...parts: (string | number | undefined)[]) => parts.filter((part) => part !== undefined).join(" ") || null;

export const describeError = (error: unknown): ErrorInfo => {
  if (error instanceof GeminiApiError) {
    const inner = unwrapJson(error.message);
    return { source: "Gemini", code: code(error.status, inner?.status), message: inner?.message ?? error.message };
  }
  if (error instanceof BayseApiError) {
    const inner = unwrapJson(error.body);
    return {
      source: "Bayse",
      code: code(error.status, inner?.status),
      message: inner?.message ?? (error.body.slice(0, 300) || `request to ${error.path} failed`),
    };
  }
  if (error instanceof GrammyError) {
    return { source: "Telegram", code: String(error.error_code), message: error.description };
  }
  if (error instanceof z.ZodError) {
    return { source: "Validation", code: null, message: error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") };
  }
  const message = error instanceof Error ? error.message : String(error);
  const inner = unwrapJson(message);
  return { source: "Clover", code: inner?.status ?? null, message: inner?.message ?? message };
};
