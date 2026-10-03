import { describe, expect, test } from "bun:test";
import {
  bandRange,
  isStationTemperature,
  slugDay,
  toEvent,
  walkAsks,
  type RawPolymarketMarket,
} from "./adapter.ts";

// Shapes as Gamma returned them on 2026-10-03 (highest-temperature-in-london-on-october-3-2026)
const market = (overrides: Partial<RawPolymarketMarket>): RawPolymarketMarket => ({
  id: "m20",
  question: "Will the highest temperature in London be 20°C on October 3?",
  groupItemTitle: "20°C",
  outcomes: '["Yes", "No"]',
  outcomePrices: '["0.445", "0.555"]',
  clobTokenIds: '["yes-token", "no-token"]',
  bestBid: 0.43,
  bestAsk: 0.46,
  closed: false,
  active: true,
  acceptingOrders: true,
  orderMinSize: 5,
  feeSchedule: { rate: 0.05 },
  ...overrides,
});

describe("bands and days", () => {
  test("reads every band style as an inclusive range", () => {
    expect(bandRange("16°C or below")).toEqual({ min: null, max: 16 });
    expect(bandRange("17°C")).toEqual({ min: 17, max: 17 });
    expect(bandRange("62-63°F")).toEqual({ min: 62, max: 63 });
    expect(bandRange("80°F or higher")).toEqual({ min: 80, max: null });
    expect(bandRange("-2°C")).toEqual({ min: -2, max: -2 });
  });
  test("reads the day from the slug", () => {
    expect(slugDay("highest-temperature-in-london-on-october-3-2026")).toBe("2026-10-03");
    expect(slugDay("measles-cases-in-us-in-2026")).toBeNull();
  });
});

describe("toEvent", () => {
  const raw = {
    id: "1",
    slug: "highest-temperature-in-london-on-october-3-2026",
    title: "Highest temperature in London on October 3?",
    resolutionSource: "https://www.weather.gov/wrh/timeseries?site=eglc",
    negRisk: true,
    markets: [market({})],
  };

  test("maps tokens, prices and the band", () => {
    const event = toEvent(raw);
    expect(event.id).toBe(raw.slug);
    expect(event.type).toBe("combined");
    const [first] = event.markets;
    expect(first!.outcomes.map((outcome) => outcome.id)).toEqual(["yes-token", "no-token"]);
    expect(first!.outcomes[0].price).toBe(0.46);
    // NO costs 1 minus the best YES bid
    expect(first!.outcomes[1].price).toBeCloseTo(0.57);
    expect(first!.minShares).toBe(5);
    expect(first!.range).toEqual({ min: 20, max: 20 });
    // trading counts as open until noon UTC the next day
    expect(event.closingDate).toBe("2026-10-04T12:00:00.000Z");
  });

  test("a closed market at 1/0 is resolved", () => {
    const event = toEvent({
      ...raw,
      markets: [market({ closed: true, outcomePrices: '["0", "1"]' })],
    });
    expect(event.status).toBe("resolved");
    expect(event.markets[0]!.resolvedOutcomeId).toBe("no-token");
  });

  test("only NOAA-settled temperature events are taken", () => {
    expect(isStationTemperature(raw)).toBe(true);
    expect(
      isStationTemperature({
        ...raw,
        title: "Highest temperature in Hong Kong on October 3?",
        resolutionSource: "",
      }),
    ).toBe(false);
  });
});

describe("walkAsks", () => {
  // asks come highest first
  const asks = [
    { price: "0.50", size: "100" },
    { price: "0.40", size: "4" },
  ];

  test("buys the cheapest asks first, fee included", () => {
    const quote = walkAsks(asks, 3, 0.05, 5);
    // 4 at 0.40 (fee 0.05×4×0.4×0.6 = 0.048), then the rest at 0.50
    expect(quote.shares).toBeGreaterThan(5);
    expect(quote.amount).toBeLessThanOrEqual(3);
    expect(quote.avgPrice).toBeGreaterThan(0.4);
    expect(quote.avgPrice).toBeLessThan(0.52);
    expect(quote.completeFill).toBe(true);
  });

  test("under the 5-share minimum nothing fills", () => {
    const quote = walkAsks(asks, 1.5, 0.05, 5);
    expect(quote.shares).toBe(0);
    expect(quote.completeFill).toBe(false);
  });
});
