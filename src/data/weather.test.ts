import { describe, expect, test } from "bun:test";
import type { MarketEvent } from "@/exchanges/types.ts";
import { parseWeatherQuestion } from "./weather.ts";

const event = (title: string) =>
  ({ title, resolutionDate: "2026-09-26T22:59:00Z", closingDate: null }) as unknown as MarketEvent;

describe("parseWeatherQuestion", () => {
  test("reads a live Bayse weather title (double space and all)", () => {
    expect(parseWeatherQuestion(event("Will the Temperature in Lagos, Nigeria be  above 28°C by 5:00 PM WAT on Sept 26?"))).toEqual({
      city: "Lagos",
      country: "Nigeria",
      direction: "above",
      thresholdC: 28,
      // 5:00 PM WAT is 16:00 UTC
      at: new Date("2026-09-26T16:00:00Z"),
    });
  });

  test("handles morning times, 'below', decimals and other month spellings", () => {
    const question = parseWeatherQuestion(event("Will the temperature in Abuja be below 22.5°C at 7:30 AM WAT on Oct. 3?"));
    expect(question).toMatchObject({ city: "Abuja", country: null, direction: "below", thresholdC: 22.5 });
    expect(question?.at.toISOString()).toBe("2026-10-03T06:30:00.000Z");
  });

  test("ignores markets that aren't temperature thresholds", () => {
    expect(parseWeatherQuestion(event("Pop Base’s Number of X Posts Today, September 25, 2026?"))).toBeNull();
  });
});
