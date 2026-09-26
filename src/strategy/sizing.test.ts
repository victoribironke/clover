import { describe, expect, test } from "bun:test";
import { blendProbability, expectedReturn, kellyFraction, stakeFor } from "./sizing.ts";

describe("expectedReturn", () => {
  test("fair price has zero edge", () => {
    expect(expectedReturn(0.5, 0.5)).toBeCloseTo(0);
  });
  test("buying 60% at 50% returns +20%", () => {
    expect(expectedReturn(0.6, 0.5)).toBeCloseTo(0.2);
  });
});

describe("kellyFraction", () => {
  test("no edge means no bet", () => {
    expect(kellyFraction(0.4, 0.5)).toBe(0);
  });
  test("60% at 50% is a 20% Kelly bet", () => {
    expect(kellyFraction(0.6, 0.5)).toBeCloseTo(0.2);
  });
  test("degenerate prices bet nothing", () => {
    expect(kellyFraction(0.9, 1)).toBe(0);
    expect(kellyFraction(0.9, 0)).toBe(0);
  });
});

describe("blendProbability", () => {
  test("shrinks toward the market by confidence", () => {
    expect(blendProbability(0.8, 0.5, "low")).toBeCloseTo(0.575);
    expect(blendProbability(0.8, 0.5, "medium")).toBeCloseTo(0.65);
    expect(blendProbability(0.8, 0.5, "high")).toBeCloseTo(0.71);
  });
});

describe("stakeFor", () => {
  const base = {
    bankroll: 10_000,
    deployable: 10_000,
    minOrderAmount: 100,
    kellyMultiplier: 0.25,
    maxBetFraction: 0.1,
    minimumStakeFraction: 0,
  };

  test("quarter Kelly on a 20% edge", () => {
    expect(stakeFor({ ...base, probability: 0.6, price: 0.5 })).toBe(500);
  });
  test("capped at max bet fraction", () => {
    expect(stakeFor({ ...base, probability: 0.95, price: 0.3 })).toBe(1000);
  });
  test("capped by deployable capital", () => {
    expect(stakeFor({ ...base, deployable: 250, probability: 0.6, price: 0.5 })).toBe(250);
  });
  test("below the market minimum means no bet", () => {
    expect(stakeFor({ ...base, probability: 0.51, price: 0.5 })).toBe(0);
  });

  // The Solana case from a real scan: 43.8% vs 38.5% sizes to ₦215, under the ₦500 minimum
  const solana = { ...base, probability: 0.438, price: 0.385, minOrderAmount: 500, minimumStakeFraction: 0.05 };

  test("rounds a small edge up to the market minimum when it's at most 5% of bankroll", () => {
    expect(stakeFor(solana)).toBe(500);
  });
  test("not when the minimum is a bigger share of the bankroll", () => {
    expect(stakeFor({ ...solana, bankroll: 5_000 })).toBe(0);
  });
  test("not when there's no free capital for it", () => {
    expect(stakeFor({ ...solana, deployable: 300 })).toBe(0);
  });
  test("never for a bet with no edge", () => {
    expect(stakeFor({ ...solana, probability: 0.38 })).toBe(0);
  });
});
