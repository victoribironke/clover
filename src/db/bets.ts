import type { MarketKind } from "@/data/kind.ts";
import type { Currency, ExchangeName } from "@/exchanges/types.ts";
import { collection, firestore } from "./firestore.ts";

// pending  -> waiting out the cancel window
// placing  -> claimed by the executor (guards against double-placing)
// placed   -> order filled (or paper-filled when dryRun)
// won/lost/void -> settled
// cancelled/skipped/failed -> never placed
export type BetStatus =
  | "pending"
  | "placing"
  | "placed"
  | "won"
  | "lost"
  | "void"
  | "cancelled"
  | "skipped"
  | "failed";

export type Confidence = "low" | "medium" | "high";

export type Bet = {
  id: string;
  exchange: ExchangeName;
  currency: Currency;
  eventId: string;
  marketId: string;
  outcomeId: string;
  eventTitle: string;
  // the exchange's own category, e.g. "SOCIAL MEDIA" (optional: bets from before 2026-09-25 are backfilled)
  category?: string;
  // what the market measures, for comparing results by type
  kind?: MarketKind;
  marketTitle: string;
  outcomeLabel: string;
  analysisId: string | null;
  probability: number;
  marketPrice: number;
  quotedPrice: number;
  expectedReturn: number;
  confidence: Confidence;
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
  telegramMessageId: number | null;
  createdAt: string;
  updatedAt: string;
};

export type NewBet = Omit<
  Bet,
  "id" | "status" | "orderId" | "fillPrice" | "shares" | "pnl" | "error" | "telegramMessageId" | "createdAt" | "updatedAt"
>;

type BetPatch = Partial<
  Pick<
    Bet,
    | "status"
    | "executeAt"
    | "orderId"
    | "fillPrice"
    | "shares"
    | "pnl"
    | "error"
    | "telegramMessageId"
    | "stake"
    | "quotedPrice"
    | "expectedReturn"
    | "category"
    | "kind"
  >
>;

export const ALL_STATUSES: BetStatus[] = ["pending", "placing", "placed", "won", "lost", "void", "cancelled", "skipped", "failed"];

const LIVE: BetStatus[] = ["pending", "placing", "placed"];
const SETTLED: BetStatus[] = ["won", "lost", "void"];

const bets = () => collection("bets");

export const createBet = async (bet: NewBet) => {
  const ref = bets().doc();
  const now = new Date().toISOString();
  const created: Bet = {
    ...bet,
    id: ref.id,
    status: "pending",
    orderId: null,
    fillPrice: null,
    shares: null,
    pnl: null,
    error: null,
    telegramMessageId: null,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(created);
  return created;
};

export const getBet = async (id: string) => {
  const snapshot = await bets().doc(id).get();
  return snapshot.exists ? (snapshot.data() as Bet) : null;
};

// Filtering beyond `status in` and sorting happen here rather than in Firestore,
// so no composite indexes are needed. Bet volumes are small.
export const listBets = async (statuses: BetStatus[], limit = 50) => {
  const snapshot = await bets().where("status", "in", statuses).get();
  return snapshot.docs
    .map((doc) => doc.data() as Bet)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
};

export const dueBets = async (nowIso: string) => {
  const snapshot = await bets().where("status", "==", "pending").get();
  return snapshot.docs
    .map((doc) => doc.data() as Bet)
    .filter((bet) => bet.executeAt <= nowIso)
    .sort((a, b) => a.executeAt.localeCompare(b.executeAt));
};

// Event ids that already have a live bet, so a new scan doesn't stack another one on top
export const activeBetEventIds = async (exchange: ExchangeName) => {
  const live = await listBets(LIVE, 1000);
  return new Set(live.filter((bet) => bet.exchange === exchange).map((bet) => bet.eventId));
};

// Update a bet, optionally only if it is still in one of `fromStatuses`.
// Returns false when the guard didn't match (e.g. the bet was cancelled meanwhile).
export const updateBet = (id: string, patch: BetPatch, fromStatuses?: BetStatus[]) =>
  firestore.runTransaction(async (tx) => {
    const ref = bets().doc(id);
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return false;
    if (fromStatuses?.length && !fromStatuses.includes(snapshot.get("status") as BetStatus)) return false;
    tx.update(ref, { ...patch, updatedAt: new Date().toISOString() });
    return true;
  });

export type BetTotals = {
  // stakes in pending or unsettled bets
  exposure: number;
  realizedPnl: number;
  // live stakes not yet sent to the exchange (the wallet balance doesn't reflect them yet)
  unsent: number;
};

export const betTotals = async (exchange: ExchangeName, dryRun: boolean): Promise<BetTotals> => {
  const all = await listBets([...LIVE, ...SETTLED], 10_000);
  const mine = all.filter((bet) => bet.exchange === exchange && bet.dryRun === dryRun);
  const sum = (items: Bet[], pick: (bet: Bet) => number) => items.reduce((total, bet) => total + pick(bet), 0);
  return {
    exposure: sum(mine.filter((bet) => LIVE.includes(bet.status)), (bet) => bet.stake),
    realizedPnl: sum(mine.filter((bet) => SETTLED.includes(bet.status)), (bet) => bet.pnl ?? 0),
    unsent: sum(mine.filter((bet) => bet.status === "pending" || bet.status === "placing"), (bet) => bet.stake),
  };
};
