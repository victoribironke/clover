import { expect, test } from "bun:test";
import { lowInReach } from "./weather-model.ts";

test("a low is in reach once the temperature is back within 8°F of it", () => {
  // Austin, 2026-10-09: low so far 63°F, 78.8°F at 7:25 PM, and it fell to 59°F by midnight
  expect(lowInReach(63, 78.8)).toBe(false);
  expect(lowInReach(63, 71)).toBe(false);
  expect(lowInReach(63, 70.9)).toBe(true);
  // already at the low
  expect(lowInReach(52.7, 53.6)).toBe(true);
});
