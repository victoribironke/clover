import { expect, test } from "bun:test";
import { resolvedOutcomeId, type RawMarket } from "./adapter.ts";

// Shapes as returned by GET /v1/pm/events/{id} for resolved markets (checked 2026-09-24)
const market = (overrides: Partial<RawMarket>): RawMarket => ({
  id: "m1",
  title: "Up",
  status: "resolved",
  outcome1Id: "up-id",
  outcome1Label: "Up",
  outcome1Price: 0,
  outcome2Id: "down-id",
  outcome2Label: "Down",
  outcome2Price: 0,
  ...overrides,
});

test("reads the winning outcome id", () => {
  expect(resolvedOutcomeId(market({ resolvedOutcomeId: "down-id", resolvedOutcome: "NO" }))).toBe("down-id");
});

test('maps "YES"/"NO" to outcome1/outcome2 whatever the labels are', () => {
  expect(resolvedOutcomeId(market({ resolvedOutcome: "YES" }))).toBe("up-id");
  expect(resolvedOutcomeId(market({ resolvedOutcome: "NO" }))).toBe("down-id");
});

test("unknown or missing resolution means not settled", () => {
  expect(resolvedOutcomeId(market({ status: "open" }))).toBeNull();
  expect(resolvedOutcomeId(market({ resolvedOutcomeId: "something-else" }))).toBeNull();
  expect(resolvedOutcomeId(market({ resolvedOutcome: "MAYBE" }))).toBeNull();
});
