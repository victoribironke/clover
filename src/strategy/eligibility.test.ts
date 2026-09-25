import { describe, expect, test } from "bun:test";
import type { MarketEvent } from "@/exchanges/types.ts";
import { eligibleEvents } from "./eligibility.ts";

const NOW = Date.parse("2026-09-24T12:00:00Z");
const inHours = (hours: number) => new Date(NOW + hours * 3_600_000).toISOString();

const event = (overrides: Partial<MarketEvent>): MarketEvent => ({
  exchange: "bayse",
  id: "e1",
  slug: "e1",
  title: "Test",
  description: "",
  additionalContext: "",
  resolutionSource: "",
  category: "FINANCE",
  type: "single",
  engine: "AMM",
  status: "open",
  closingDate: null,
  resolutionDate: null,
  resolvedAt: null,
  openingDate: null,
  liquidity: 0,
  totalVolume: 0,
  supportedCurrencies: ["USD", "NGN"],
  markets: [
    {
      id: "m1",
      title: "Test",
      rules: "",
      status: "open",
      outcomes: [
        { id: "o1", label: "Yes", price: 0.5 },
        { id: "o2", label: "No", price: 0.5 },
      ],
      minOrderAmount: 100,
      feePercentage: 0,
      resolvedOutcomeId: null,
    },
  ],
  ...overrides,
});

const passes = (overrides: Partial<MarketEvent>) => eligibleEvents([event(overrides)], new Set(), NOW).length === 1;

describe("eligibleEvents", () => {
  test("keeps an event that resolves tonight", () => {
    expect(passes({ closingDate: inHours(6), resolutionDate: inHours(7) })).toBe(true);
  });
  test("drops an event that resolves in months, even if trading closes soon", () => {
    expect(passes({ closingDate: inHours(6), resolutionDate: inHours(24 * 90) })).toBe(false);
  });
  test("drops an event whose trading closes before the cancel window ends", () => {
    expect(passes({ closingDate: inHours(0.5), resolutionDate: inHours(2) })).toBe(false);
  });
  test("uses whichever date exists", () => {
    expect(passes({ resolutionDate: inHours(10) })).toBe(true);
    expect(passes({ closingDate: inHours(10) })).toBe(true);
  });
  test("drops long-running events with no dates", () => {
    expect(passes({})).toBe(false);
  });
  test("keeps an event that resolves within the week", () => {
    expect(passes({ resolutionDate: inHours(24 * 5) })).toBe(true);
  });
  test("drops categories decided by people rather than data", () => {
    for (const category of ["SPORTS", "PLAYER STATS", "POLITICS", "HEADIES", "BB NAIJA"]) {
      expect(passes({ category, resolutionDate: inHours(5) })).toBe(false);
    }
  });
  test("keeps data-driven categories", () => {
    for (const category of ["CRYPTO", "FINANCE", "ECONOMY", "SOCIAL MEDIA", "ENTERTAINMENT", "OTHERS"]) {
      expect(passes({ category, resolutionDate: inHours(5) })).toBe(true);
    }
  });
  test("drops events without NGN trading", () => {
    expect(passes({ resolutionDate: inHours(5), supportedCurrencies: ["USD"] })).toBe(false);
  });
});

describe("excluded kinds", () => {
  test("drops engagement markets even in allowed categories", () => {
    expect(passes({ category: "SOCIAL MEDIA", title: "How Many Likes Will Taylor Swift's Latest Post Get?", resolutionDate: inHours(5) })).toBe(false);
  });
  test("keeps post counts in the same category", () => {
    expect(passes({ category: "SOCIAL MEDIA", title: "Pop Base’s Number of X Posts Today, September 25, 2026?", resolutionDate: inHours(5) })).toBe(true);
  });
});
