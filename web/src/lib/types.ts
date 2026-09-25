// Read-only views of the documents the bot writes to Firestore. The bot owns these shapes:
// Bet mirrors src/db/bets.ts, BotSettings mirrors src/settings.ts. Keep them in step when those change.

export type BetStatus = "pending" | "placing" | "placed" | "won" | "lost" | "void" | "cancelled" | "skipped" | "failed";

export type MarketKind = "weather" | "post-count" | "engagement" | "streams" | "chart" | "price" | "economy" | "other";

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
