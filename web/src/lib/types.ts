// Read-only views of the documents the bot writes to Firestore. The bot owns these shapes:
// Bet mirrors src/db/bets.ts, BotSettings mirrors src/settings.ts. Keep them in step when those change.

export type BetStatus = "pending" | "placing" | "placed" | "won" | "lost" | "void" | "cancelled" | "skipped" | "failed";

export type MarketKind = "weather" | "post-count" | "engagement" | "streams" | "chart" | "price" | "economy" | "sports" | "other";

export type Bet = {
  id: string;
  exchange: "bayse";
  currency: "NGN" | "USD";
  eventId: string;
  marketId: string;
  outcomeId: string;
  eventTitle: string;
  // missing on bets older than 2026-09-25 until the bot's backfill has run
  category?: string;
  kind?: MarketKind;
  marketTitle: string;
  outcomeLabel: string;
  analysisId: string | null;
  probability: number;
  marketPrice: number;
  quotedPrice: number;
  expectedReturn: number;
  confidence: "low" | "medium" | "high";
  stake: number;
  rationale: string;
  status: BetStatus;
  dryRun: boolean;
  executeAt: string;
  orderId: string | null;
  fillPrice: number | null;
  shares: number | null;
  pnl: number | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

// Published by the bot on every start (kv/settings); only the fields the panel uses
export type BotSettings = {
  dryRun: boolean;
  capitalNgn: number;
  dailyResearchBudgetUsd: number;
  publishedAt?: string;
};

// kv/spend-YYYY-MM-DD
export type SpendDay = { day: string; usd: number };

// kv/wallet: the real Bayse wallet, recorded by the bot every tick (paper mode too)
export type WalletSnapshot = { available: number; pending: number; publishedAt: string };

// Mirrors src/strategy/propose.ts NearMiss: the best bet that didn't make it, and why
export type NearMiss = {
  marketTitle: string;
  outcomeLabel: string;
  modelProbability: number;
  marketPrice: number;
  probability: number;
  confidence: "low" | "medium" | "high";
  price: number;
  expectedReturn: number;
  reason: string;
};

// Mirrors what src/db/analyses.ts saves: one deep dive and its verdict
export type Analysis = {
  id: string;
  exchange: "bayse";
  eventId: string;
  eventTitle: string;
  category?: string;
  kind?: MarketKind;
  model: string;
  summary: string;
  keyFactors: string[];
  // added 2026-09-25; older analyses don't have them
  reading?: string;
  liveData?: boolean;
  sources: { title: string; url: string }[];
  estimates: { marketId: string; probabilityOutcome1: number; confidence: "low" | "medium" | "high" }[];
  usage?: { inputTokens: number; outputTokens: number; searches: number };
  costUsd?: number;
  proposed?: boolean;
  nearMiss?: NearMiss | null;
  createdAt: string;
};

// kv/study-summary: mirrors src/study/stats.ts StudySummary, published by the study job
export type StudyBucket = { label: string; n: number; avgPrice: number; winRate: number };
export type StudySummary = {
  events: number;
  since: string | null;
  at10: StudyBucket[];
  byKind: { kind: MarketKind; events: number; voids: number; markets: number; lateGap: number | null }[];
  lateOpen: { n: number; avgPrice: number; winRate: number };
  publishedAt?: string;
};
