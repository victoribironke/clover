import { describe, expect, test } from "bun:test";
import type { MarketEvent } from "@/exchanges/types.ts";
import { isRecurringCount } from "./index.ts";

const event = (title: string) => ({ title }) as unknown as MarketEvent;

describe("isRecurringCount", () => {
  test("matches post-count markets", () => {
    for (const title of [
      "Pop Base’s Number of X Posts Today, September 25, 2026?",
      "Fabrizio's Number of X Posts by 1PM Today?",
      "Elon Musk's Number of Posts September 22 - September 29, 2026?",
    ]) {
      expect(isRecurringCount(event(title))).toBe(true);
    }
  });
  test("doesn't match one-off releases or weather", () => {
    expect(isRecurringCount(event("How Many First-Day Streams For New Ayo Maff ft Zinoleesky?"))).toBe(false);
    expect(isRecurringCount(event("Will the Temperature in Lagos, Nigeria be  above 28°C by 5:00 PM WAT on Sept 26?"))).toBe(false);
  });
});
