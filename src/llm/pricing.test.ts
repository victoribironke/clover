import { expect, test } from "bun:test";
import { estimateCost } from "./pricing.ts";

const usage = { inputTokens: 10_000, outputTokens: 2_000, searches: 4 };

test("searches are free while under the monthly allowance", () => {
  // 10k × $0.75/M + 2k × $3.75/M
  expect(estimateCost("gemini-3.8-flash", usage, 0)).toBeCloseTo(0.015);
});

test("searches past the allowance are billed at $14/1k", () => {
  // 2 of the 4 searches fall past 5,000
  expect(estimateCost("gemini-3.8-flash", usage, 4_998)).toBeCloseTo(0.015 + 2 * 0.014);
});

test("prices the reasoning model at its own rates", () => {
  // 10k × $0.10/M + 2k × $0.50/M
  expect(estimateCost("gpt-6-luna", { ...usage, searches: 0 }, 0)).toBeCloseTo(0.002);
});

test("refuses a model without a price", () => {
  expect(() => estimateCost("mystery-model", usage, 0)).toThrow(/No price/);
});
