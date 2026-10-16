import { describe, expect, test } from "bun:test";
import {
  anchoredRuns,
  combineSources,
  normalQuantile,
  valueAt,
  type Source,
} from "./multi-source-weather.ts";

const HOUR = 3_600_000;
const hours = (count: number) => Array.from({ length: count }, (_, index) => index * HOUR);

describe("valueAt", () => {
  test("interpolates between hours, and refuses times far from any", () => {
    expect(valueAt([0, HOUR], [60, 64], HOUR / 2)).toBe(62);
    expect(valueAt([0, HOUR], [60, 64], HOUR)).toBe(64);
    expect(valueAt([0, HOUR], [60, 64], HOUR + 30 * 60_000)).toBe(64);
    expect(valueAt([0, HOUR], [60, 64], 4 * HOUR)).toBeNull();
  });
});

describe("anchoredRuns", () => {
  test("shifts the hours left by how far the source is off the latest reading", () => {
    const source: Source = { name: "HRRR", hours: hours(6), runs: [[70, 71, 72, 70, 68, 66]] };
    // the station reads 67 at hour 2, where HRRR had 72: everything after drops 5
    const result = anchoredRuns(source, { at: 2 * HOUR, f: 67 }, 3 * HOUR, 6 * HOUR)!;
    expect(result.shift).toBe(-5);
    expect(result.runs).toEqual([[65, 63, 61]]);
  });

  test("a source with nothing near the reading's time is left out", () => {
    const source: Source = { name: "NWS", hours: [10 * HOUR, 11 * HOUR], runs: [[60, 61]] };
    expect(anchoredRuns(source, { at: 2 * HOUR, f: 67 }, 3 * HOUR, 12 * HOUR)).toBeNull();
  });
});

test("normalQuantile", () => {
  expect(normalQuantile(0.5)).toBeCloseTo(0, 6);
  expect(normalQuantile(0.975)).toBeCloseTo(1.96, 2);
  expect(normalQuantile(0.01)).toBeCloseTo(-2.326, 2);
});

describe("combineSources", () => {
  // Philadelphia on 2026-10-11: high so far ~65°F, 64.4°F at 5 PM and falling. A forecast that
  // still had 68°F for that hour is 3.6°F warm; anchored, it no longer says the high will rise.
  const latest = { at: 17 * HOUR, f: 64.4 };
  const observed = { min: 64.9, max: 65.8 };
  const day = hours(24);
  const warm: Source = {
    name: "ensemble",
    hours: day,
    runs: [0, 1, 2].map((offset) =>
      day.map((hour) => (hour <= 17 * HOUR ? 68 : 68 - (hour / HOUR - 17)) + offset - 1),
    ),
  };
  const flat = (name: string, at5pm: number): Source => ({
    name,
    hours: day,
    runs: [day.map((hour) => (hour <= 17 * HOUR ? at5pm : at5pm - (hour / HOUR - 17)))],
  });

  test("anchored sources keep the high where the reading has it, and agree", () => {
    const result = combineSources({
      kind: "high",
      observed,
      latest,
      sources: [warm, flat("HRRR", 64), flat("NBM", 66), flat("NWS", 65)],
      from: 18 * HOUR,
      end: 24 * HOUR,
    });
    expect(result.finals.map((each) => each.final)).toEqual([65, 65, 65, 65]);
    expect(result.spread).toBe(0);
    // each source weighs the same
    expect(result.values.length).toBe(4 * 101);
  });

  test("a source that forecasts a late rise makes them disagree", () => {
    const rising: Source = {
      name: "HRRR",
      hours: day,
      runs: [day.map((hour) => (hour <= 17 * HOUR ? 64 : 64 + (hour / HOUR - 17)))],
    };
    const result = combineSources({
      kind: "high",
      observed,
      latest,
      sources: [rising, flat("NBM", 66), flat("NWS", 65)],
      from: 18 * HOUR,
      end: 24 * HOUR,
    });
    expect(result.spread).toBeGreaterThan(2);
  });

  test("a low still falling: the forecasts' evening value counts", () => {
    const cooling = (name: string, at5pm: number): Source => ({
      name,
      hours: day,
      runs: [day.map((hour) => (hour <= 17 * HOUR ? at5pm : at5pm - 2 * (hour / HOUR - 17)))],
    });
    const result = combineSources({
      kind: "low",
      observed: { min: 63, max: 63 },
      latest: { at: 17 * HOUR, f: 72 },
      sources: [cooling("HRRR", 74), cooling("NBM", 72), cooling("NWS", 71)],
      from: 18 * HOUR,
      end: 24 * HOUR,
    });
    // 72 at 5 PM, 2°F an hour down to 23:00: 60
    expect(result.finals.map((each) => each.final)).toEqual([60, 60, 60]);
  });
});
