import { describe, expect, test } from "bun:test";
import {
  baselineDue,
  dueMinute,
  newReports,
  stationOf,
  toReport,
  windowDone,
  type Report,
  type Snapshot,
} from "./record.ts";
import { largestMove, reactionTiming, speedMessage, type SpeedDoc } from "./stats.ts";

const MINUTE = 60_000;
const report = (station: string, obsAt: number): Report => ({
  station,
  obsAt,
  receiptAt: obsAt + 3 * MINUTE,
  tempC: 10,
  type: "METAR",
  raw: "",
});

describe("newReports", () => {
  test("only reports newer than the last one handled, and first sightings just set the marker", () => {
    const { fresh, markers } = newReports(
      [report("KNYC", 2000), report("KNYC", 1000), report("KMDW", 500), report("KLAX", 900)],
      { KNYC: 1000, KMDW: 500 },
    );
    expect(fresh.map((each) => each.station)).toEqual(["KNYC"]);
    expect(markers).toEqual({ KNYC: 2000, KMDW: 500, KLAX: 900 });
  });
});

test("toReport reads aviationweather.gov's fields", () => {
  expect(
    toReport({
      icaoId: "KNYC",
      obsTime: 1792828260,
      receiptTime: "2026-10-24T07:54:05.728Z",
      temp: 8.9,
      metarType: "METAR",
      rawOb: "METAR KNYC 240751Z",
    }),
  ).toEqual({
    station: "KNYC",
    obsAt: 1792828260000,
    receiptAt: Date.parse("2026-10-24T07:54:05.728Z"),
    tempC: 8.9,
    type: "METAR",
    raw: "METAR KNYC 240751Z",
  });
});

describe("snapshot schedule", () => {
  const window = { id: "x", series: "S", seenAt: 0, taken: [0] };
  test("takes each minute as it comes, and skips a missed one rather than taking it late", () => {
    expect(dueMinute(window, 30_000)).toBeNull();
    expect(dueMinute(window, 1 * MINUTE)).toBe(1);
    expect(dueMinute({ ...window, taken: [0, 1] }, 4.2 * MINUTE)).toBe(3);
    expect(dueMinute({ ...window, taken: [0, 1, 3] }, 4.2 * MINUTE)).toBeNull();
    expect(dueMinute({ ...window, taken: [0, 1, 2, 3, 5] }, 15 * MINUTE)).toBe(15);
  });
  test("a window closes after the last snapshot", () => {
    expect(windowDone(window, 16 * MINUTE)).toBe(false);
    expect(windowDone(window, 18 * MINUTE)).toBe(true);
  });
  test("baselines once an hour, in minutes 44-50", () => {
    const at = (minute: number) => Date.UTC(2026, 9, 24, 7, minute);
    expect(baselineDue(at(43), undefined)).toBe(false);
    expect(baselineDue(at(45), undefined)).toBe(true);
    expect(baselineDue(at(46), { at: at(45), markets: [] })).toBe(false);
    expect(baselineDue(at(45), { at: at(45) - 60 * MINUTE, markets: [] })).toBe(true);
  });
});

test("stationOf reads the climate station from the rules", () => {
  expect(stationOf("the minimum temperature recorded at New York City (CLINYC) for")).toBe("KNYC");
  expect(stationOf("no station")).toBeNull();
});

const snap = (at: number, mids: Record<string, number>): Snapshot => ({
  at,
  markets: Object.entries(mids).map(([t, m]) => ({ t, e: "E", b: m - 0.01, a: m + 0.01, l: m, v: 0 })),
});

describe("reaction timing", () => {
  const doc = (atSeen: number, at15: number): SpeedDoc => ({
    ...report("KNYC", 0),
    series: "KXLOWTNYC",
    seenAt: 4 * MINUTE,
    baseline: snap(-10 * MINUTE, { A: 0.5, B: 0.5 }),
    snapshots: [
      { minute: 0, ...snap(4 * MINUTE, { A: atSeen, B: 0.5 }) },
      { minute: 15, ...snap(19 * MINUTE, { A: at15, B: 0.5 }) },
    ],
  });
  test("largest band move", () => {
    expect(largestMove(snap(0, { A: 0.5, B: 0.2 }), snap(1, { A: 0.55, B: 0.05 }))).toBeCloseTo(0.15);
  });
  test("before, after, in between, or no reaction", () => {
    expect(reactionTiming(doc(0.85, 0.9))).toBe("before");
    expect(reactionTiming(doc(0.52, 0.9))).toBe("after");
    expect(reactionTiming(doc(0.7, 0.9))).toBe("between");
    expect(reactionTiming(doc(0.5, 0.55))).toBeNull();
  });
  test("the message counts them", () => {
    const text = speedMessage([doc(0.85, 0.9), doc(0.52, 0.9), doc(0.5, 0.52)], "2026-11-01T00:00:00Z");
    expect(text).toContain("3 reports from 1 stations");
    expect(text).toContain("Already moved when we saw it: 1");
    expect(text).toContain("Moved after we saw it: 1");
  });
});
