import { describe, expect, test } from "bun:test";
import type { MarketEvent } from "@/exchanges/types.ts";
import {
  bandProbability,
  climateDay,
  finalValues,
  observedExtreme,
  parseTemperatureQuestion,
  sixHourGroups,
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

const exact = (value: number) => ({ min: value, max: value });

describe("finalValues", () => {
  test("the high so far is a floor for every run", () => {
    expect(
      finalValues({ kind: "high", observed: exact(78.4), runs: [[75, 77], [80, 79], [78.6]] }),
    ).toEqual([78, 80, 79]);
  });
  test("the low so far is a ceiling", () => {
    expect(finalValues({ kind: "low", observed: exact(61), runs: [[63], [59.6]] })).toEqual([
      61, 60,
    ]);
  });
  test("once the day is over the readings decide", () => {
    expect(new Set(finalValues({ kind: "high", observed: exact(81.2), runs: [] }))).toEqual(
      new Set([81]),
    );
  });
  test("a whole-°C reading spreads across the degrees it could be", () => {
    // 20°C = 68°F, really anywhere in 67.1-68.9°F
    const values = finalValues({ kind: "low", observed: { min: 67.1, max: 68.9 }, runs: [] });
    expect(new Set(values)).toEqual(new Set([67, 68, 69]));
    expect(values.filter((value) => value === 68).length).toBeGreaterThan(values.length / 2);
  });
});

describe("sixHourGroups", () => {
  test("reads the 6-hour max and min from a METAR's remarks", () => {
    const raw = "KLAX 301153Z 00000KT 10SM OVC011 20/18 A2982 RMK AO2 SLP072 T02000183 10222 20194 53004 $";
    expect(sixHourGroups(raw)).toEqual({ max6: 72, min6: 66.9 });
  });
  test("handles below-zero values and reports without the groups", () => {
    expect(sixHourGroups("KDEN 011153Z RMK AO2 T10061022 11006 21022")).toEqual({ max6: 30.9, min6: 28 });
    expect(sixHourGroups("KLAX 301512Z RMK AO2 T02110183 $")).toEqual({ max6: undefined, min6: undefined });
    expect(sixHourGroups("")).toEqual({});
  });
});

describe("observedExtreme", () => {
  const reading = (f: number, precise: boolean) => ({ at: 0, f, precise });
  test("precise readings pin the extreme", () => {
    expect(observedExtreme("high", [reading(70.2, true), reading(69.8, true)])).toEqual(exact(70.2));
  });
  test("a whole-°C reading leaves ±0.9°F", () => {
    // LA on 2026-09-30: 5-minute readings at 20°C (68°F), METARs a little higher
    expect(observedExtreme("low", [reading(68, false), reading(69.8, true)])).toEqual({
      min: 67.1,
      max: 68.9,
    });
  });
  test("a 6-hour group replaces the whole-°C readings it covers", () => {
    const at = (iso: string) => Date.parse(iso);
    const readings = [
      { at: at("2026-09-30T10:00:00Z"), f: 68, precise: false },
      { at: at("2026-09-30T11:53:00Z"), f: 68, precise: true, min6: 66.9 },
      // after the group's window: still counts, with its slack
      { at: at("2026-09-30T13:00:00Z"), f: 68, precise: false },
    ];
    expect(observedExtreme("low", readings, at("2026-09-30T08:00:00Z"))).toEqual(exact(66.9));
  });
  test("a group from well before the climate day is ignored", () => {
    const readings = [{ at: Date.parse("2026-09-30T05:53:00Z"), f: 70, precise: true, min6: 60 }];
    expect(observedExtreme("low", readings, Date.parse("2026-09-30T08:00:00Z"))).toEqual(exact(70));
  });
  test("a precise reading inside the range tightens it", () => {
    expect(observedExtreme("low", [reading(68, false), reading(68.4, true)])).toEqual({
      min: 67.1,
      max: 68.4,
    });
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
