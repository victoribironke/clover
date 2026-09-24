import type { Confidence } from "@/db/bets.ts";

// How much we trust the model's estimate over the market price. The market
// already aggregates a lot of information, so even a "high" confidence
// estimate is only partially believed. Shrinking toward the market is the
// main defence against an overconfident research run draining the bankroll.
export const CONFIDENCE_WEIGHT: Record<Confidence, number> = {
  low: 0.25,
  medium: 0.5,
  high: 0.7,
};

export const blendProbability = (modelProbability: number, marketPrice: number, confidence: Confidence) => {
  const weight = CONFIDENCE_WEIGHT[confidence];
  return weight * modelProbability + (1 - weight) * marketPrice;
};

// Expected return per unit staked when buying at `price` a share that pays 1 with probability `probability`
export const expectedReturn = (probability: number, price: number) => probability / price - 1;

// Full-Kelly fraction of bankroll for a binary bet bought at `price`
export const kellyFraction = (probability: number, price: number) => {
  if (price <= 0 || price >= 1) return 0;
  return Math.max(0, (probability - price) / (1 - price));
};

export type SizingInput = {
  probability: number;
  price: number;
  bankroll: number;
  deployable: number;
  minOrderAmount: number;
  kellyMultiplier: number;
  maxBetFraction: number;
};

// Stake in currency units, rounded down to a whole unit; 0 means "don't bet"
export const stakeFor = ({
  probability,
  price,
  bankroll,
  deployable,
  minOrderAmount,
  kellyMultiplier,
  maxBetFraction,
}: SizingInput) => {
  const kelly = kellyFraction(probability, price) * kellyMultiplier;
  const raw = Math.min(kelly * bankroll, maxBetFraction * bankroll, deployable);
  // epsilon keeps float noise (499.9999…) from rounding a whole stake down
  const stake = Math.floor(raw + 1e-9);
  return stake >= minOrderAmount ? stake : 0;
};
