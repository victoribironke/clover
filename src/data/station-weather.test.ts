import { describe, expect, test } from "bun:test";
import type { MarketEvent } from "@/exchanges/types.ts";
import {
  bandProbability,
  climateDay,
  finalValues,
  parseTemperatureQuestion,
  standardOffsetMinutes,
} from "./station-weather.ts";

const event = (id: string, rules: string) =>
  ({
    exchange: "kalshi",
    id,
    title: "Highest temperature in New York City on Oct 1, 2026?",
    markets: [{ rules }],
  }) as unknown as MarketEvent;

describe("parseTemperatureQuestion", () => {
  test("reads the kind, station and day from a Kalshi event", () => {
    expect(
      parseTemperatureQuestion(
        event(
          "KXHIGHNY-26OCT01",
          "If the maximum temperature recorded at New York City (CLINYC) for Oct 1, 2026, is between 75-76°…",
        ),
      ),
    ).toEqual({ kind: "high", station: "KNYC", day: "2026-10-01" });
    expect(
      parseTemperatureQuestion(
        event(
          "KXLOWTCHI-26SEP30",
          "If the minimum temperature recorded at Chicago (CLIMDW) for Sep 30, 2026, is…",
        ),
      ),
    ).toEqual({ kind: "low", station: "KMDW", day: "2026-09-30" });
  });

  test("ignores anything else", () => {
    expect(parseTemperatureQuestion(event("KXCPI-26OCT", "CPI…"))).toBeNull();
  });
});

describe("climate day", () => {
  test("runs midnight to midnight local standard time, even during daylight saving", () => {
    const offset = standardOffsetMinutes("America/New_York", 2026);
    expect(offset).toBe(-300);
    const { start, end } = climateDay("2026-10-01", offset);
    // 00:00 EST = 05:00 UTC (01:00 EDT on the clock)
    expect(new Date(start).toISOString()).toBe("2026-10-01T05:00:00.000Z");
    expect(end - start).toBe(24 * 3_600_000);
  });
});

describe("finalValues", () => {
  test("the high so far is a floor for every run", () => {
    expect(
      finalValues({ kind: "high", observed: 78.4, runs: [[75, 77], [80, 79], [78.6]] }),
    ).toEqual([78, 80, 79]);
  });
  test("the low so far is a ceiling", () => {
    expect(finalValues({ kind: "low", observed: 61, runs: [[63], [59.6]] })).toEqual([61, 60]);
  });
  test("once the day is over the readings decide", () => {
    expect(finalValues({ kind: "high", observed: 81.2, runs: [] })).toEqual([81]);
  });
});

test("bandProbability counts runs in the band, never exactly 0 or 1", () => {
  const values = [74, 75, 76, 76, 77, 80];
  // 75 and 76 count 0.8 each plus 0.1 for a neighbour inside; 74 and 77 lend 0.1 from outside:
  // 0.1 + 0.9 + 0.9 + 0.9 + 0.1 = 2.9 of 6 runs
  expect(bandProbability(values, { min: 75, max: 76 })).toBeCloseTo(3.4 / 7);
  expect(bandProbability(values, { min: 83, max: null })).toBeCloseTo(0.5 / 7);
  expect(bandProbability(values, { min: null, max: 90 })).toBeCloseTo(6.5 / 7);
});
