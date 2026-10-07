import { describe, expect, test } from "bun:test";
import type { MarketEvent } from "@/exchanges/types.ts";
import { anchorShift, parsePolymarketQuestion, shown } from "./polymarket-weather.ts";

const event = (overrides: Partial<MarketEvent>) =>
  ({
    exchange: "polymarket",
    slug: "highest-temperature-in-nyc-on-october-3-2026",
    title: "Highest temperature in NYC on October 3?",
    resolutionSource: "https://www.weather.gov/wrh/timeseries?site=klga",
    markets: [{ title: "70-71°F" }],
    ...overrides,
  }) as unknown as MarketEvent;

describe("parsePolymarketQuestion", () => {
  test("reads kind, station, day and unit", () => {
    expect(parsePolymarketQuestion(event({}))).toEqual({
      kind: "high",
      station: "KLGA",
      day: "2026-10-03",
      unit: "F",
    });
    expect(
      parsePolymarketQuestion(
        event({
          slug: "lowest-temperature-in-london-on-october-3-2026",
          title: "Lowest temperature in London on October 3?",
          resolutionSource: "https://www.weather.gov/wrh/timeseries?site=eglc",
          markets: [{ title: "12°C" }] as MarketEvent["markets"],
        }),
      ),
    ).toEqual({ kind: "low", station: "EGLC", day: "2026-10-03", unit: "C" });
  });
  test("ignores other exchanges", () => {
    expect(parsePolymarketQuestion(event({ exchange: "kalshi" }))).toBeNull();
  });
});

test("readings show as the resolution source does: whole degrees", () => {
  // KLGA's T01780111 = 17.8°C = 64.04°F
  expect(shown({ at: 0, c: 17.8, type: "METAR" }, "F")).toBe(64);
  expect(shown({ at: 0, c: 17, type: "METAR" }, "C")).toBe(17);
});

test("the forecast for the hours left is anchored to the latest reading", () => {
  const hour = 3_600_000;
  const ensemble = {
    hours: [0, hour, 2 * hour],
    runs: [
      [20, 21, 19],
      [22, 23, 21],
    ],
  };
  // at 1h the runs average 22; the station reads 20, so the rest of the day shifts down by 2
  expect(anchorShift(ensemble, { at: hour + 5 * 60_000, f: 20 })).toBe(-2);
  // nothing to compare with
  expect(anchorShift(ensemble, { at: 10 * hour, f: 20 })).toBe(0);
});
