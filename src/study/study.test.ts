import { describe, expect, test } from "bun:test";
import type { MarketEvent } from "@/exchanges/types.ts";
import { anchorFor, buildStudy, priceAt } from "./build.ts";
import { measurementTime } from "./measurement.ts";
import { summarize, type Study } from "./stats.ts";

const MINUTE = 60_000;

const event = (overrides: Partial<MarketEvent>): MarketEvent => ({
  exchange: "bayse",
  id: "e1",
  slug: "e1",
  title: "Pop Base's Number of X Posts by 1PM Today?",
  description: "",
  additionalContext: "",
  resolutionSource: "",
  category: "SOCIAL MEDIA",
  type: "single",
  engine: "AMM",
  status: "resolved",
  closingDate: null,
  resolutionDate: "2026-09-25T22:59:00Z",
  resolvedAt: "2026-09-25T23:10:00Z",
  openingDate: null,
  liquidity: 0,
  totalVolume: 0,
  supportedCurrencies: ["NGN"],
  markets: [
    {
      id: "m1",
      title: "Less than 16",
      rules: "",
      status: "resolved",
      outcomes: [
        { id: "yes", label: "Yes", price: 0 },
        { id: "no", label: "No", price: 0 },
      ],
      minOrderAmount: 100,
      feePercentage: 10,
      resolvedOutcomeId: "yes",
    },
  ],
  ...overrides,
});

describe("measurementTime", () => {
  test("reads 'by 1PM' as 1 PM WAT on the resolution day", () => {
    expect(measurementTime(event({}))?.toISOString()).toBe("2026-09-25T12:00:00.000Z");
  });
  test("reads weather times", () => {
    const weather = event({ title: "Will the Temperature in Lagos, Nigeria be  above 28°C by 5:00 PM WAT on Sept 26?", resolutionDate: "2026-09-26T22:59:00Z" });
    expect(measurementTime(weather)?.toISOString()).toBe("2026-09-26T16:00:00.000Z");
  });
  test("respects GMT in the title", () => {
    const fx = event({ title: "Will EUR/GBP be higher than £0.86019 by 6:00 PM GMT?", resolutionDate: "2026-09-25T18:05:00Z" });
    expect(measurementTime(fx)?.toISOString()).toBe("2026-09-25T18:00:00.000Z");
  });
  test("respects US Eastern time", () => {
    const elon = event({ title: "Elon posts by 12 PM ET?", resolutionDate: "2026-09-29T16:00:00Z" });
    expect(measurementTime(elon)?.toISOString()).toBe("2026-09-29T16:00:00.000Z");
  });
  test("null when the title names no time", () => {
    expect(measurementTime(event({ title: "Elon Musk's Number of Posts September 22 - September 29, 2026?" }))).toBeNull();
  });
});

describe("anchorFor", () => {
  test("uses the measurement time when it comes before the close", () => {
    expect(anchorFor(event({}))).toMatchObject({ anchorIsMeasurement: true, anchorAt: Date.parse("2026-09-25T12:00:00Z") });
  });
  test("falls back to the close", () => {
    const e = event({ title: "Elon Musk's Number of Posts September 22 - September 29, 2026?", closingDate: "2026-09-29T15:59:00Z" });
    expect(anchorFor(e)).toMatchObject({ anchorIsMeasurement: false, anchorAt: Date.parse("2026-09-29T15:59:00Z") });
  });
});

describe("priceAt", () => {
  const series = [
    { t: 1000, p: 0.3 },
    { t: 2000, p: 0.5 },
  ];
  test("returns the last price at or before the time", () => {
    expect(priceAt(series, 1500)).toBe(0.3);
    expect(priceAt(series, 2000)).toBe(0.5);
  });
  test("null before the series starts", () => {
    expect(priceAt(series, 500)).toBeNull();
  });
});

describe("buildStudy", () => {
  const anchor = Date.parse("2026-09-25T12:00:00Z");
  // price climbs from 30% to 90% over the last hour, then sits at 96% after 1 PM
  const history = {
    m1: [
      { t: anchor - 90 * MINUTE, p: 0.3 },
      { t: anchor - 45 * MINUTE, p: 0.5 },
      { t: anchor - 20 * MINUTE, p: 0.7 },
      { t: anchor - 5 * MINUTE, p: 0.9 },
      { t: anchor + 10 * MINUTE, p: 0.96 },
    ],
  };
  const study = buildStudy(event({}), "resolved", history, Date.parse("2026-09-25T23:30:00Z"));

  test("records prices before the measurement time and the result", () => {
    expect(study.markets[0]).toMatchObject({ won: true, at60: 0.3, at30: 0.5, at10: 0.7, after15: 0.96 });
    expect(study.kind).toBe("post-count");
  });
  test("keeps a 5-minute path over the final hours", () => {
    expect(study.markets[0]!.path.at(-1)).toEqual([0, 0.9]);
  });
  test("voided events have no winner", () => {
    expect(buildStudy(event({}), "cancelled", {}).markets[0]!.won).toBeNull();
  });
});

describe("summarize", () => {
  const study = (kind: Study["kind"], status: Study["status"], markets: { at10: number; won: boolean }[]): Study => ({
    eventId: Math.random().toString(),
    title: "",
    category: "",
    kind,
    status,
    anchorAt: null,
    anchorIsMeasurement: true,
    closeAt: null,
    resolvedAt: null,
    markets: markets.map((market, index) => ({
      marketId: String(index),
      title: "",
      won: status === "resolved" ? market.won : null,
      at60: null,
      at30: null,
      at10: market.at10,
      after15: null,
      path: [],
    })),
    recordedAt: "2026-09-25T00:00:00Z",
  });

  test("buckets late prices against how often they won", () => {
    const summary = summarize([
      study("weather", "resolved", [
        { at10: 0.3, won: true },
        { at10: 0.3, won: true },
        { at10: 0.35, won: false },
      ]),
    ]);
    const bucket = summary.at10.find((b) => b.label === "20-40%")!;
    expect(bucket.n).toBe(3);
    expect(bucket.winRate).toBeCloseTo(2 / 3);
  });

  test("counts voids per kind", () => {
    const summary = summarize([
      study("engagement", "cancelled", [{ at10: 0.5, won: false }]),
      study("engagement", "resolved", [{ at10: 0.5, won: true }]),
      study("weather", "resolved", [{ at10: 0.5, won: true }]),
    ]);
    expect(summary.byKind.find((row) => row.kind === "engagement")).toMatchObject({ events: 2, voids: 1 });
    expect(summary.byKind.find((row) => row.kind === "weather")).toMatchObject({ events: 1, voids: 0 });
  });
});
