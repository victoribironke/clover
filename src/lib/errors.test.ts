import { expect, test } from "bun:test";
import { ApiError as GeminiApiError } from "@google/genai";
import { BayseApiError } from "@/exchanges/bayse/http.ts";
import { describeError } from "./errors.ts";

test("unwraps a Gemini API error", () => {
  const error = new GeminiApiError({
    status: 400,
    message:
      '{"error":{"code":400,"message":"Thinking level MINIMAL is not supported for this model. Please retry with other thinking level.","status":"INVALID_ARGUMENT"}}',
  });
  expect(describeError(error)).toEqual({
    source: "Gemini",
    code: "400 INVALID_ARGUMENT",
    message: "Thinking level MINIMAL is not supported for this model. Please retry with other thinking level.",
  });
});

test("unwraps a Bayse API error", () => {
  const error = new BayseApiError(
    401,
    '{"error":"invalid_signature","message":"The provided signature does not match the expected signature"}',
    "/v1/pm/events/e/markets/m/orders",
  );
  expect(describeError(error)).toEqual({
    source: "Bayse",
    code: "401 invalid_signature",
    message: "The provided signature does not match the expected signature",
  });
});

test("falls back to the plain message", () => {
  expect(describeError(new Error("Research for x ran out of output tokens"))).toEqual({
    source: "Clover",
    code: null,
    message: "Research for x ran out of output tokens",
  });
});
