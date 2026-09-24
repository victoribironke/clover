import type { Currency, ExchangeName } from "@/exchanges/types.ts";
import { db } from "./client.ts";

// pending  -> waiting out the cancel window
// placing  -> claimed by the executor (guards against double-placing)
// placed   -> order filled (or paper-filled when dry_run)
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
  marketTitle: string;
  outcomeLabel: string;
  analysisId: number | null;
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

const fromRow = (row: Record<string, unknown>): Bet => ({
  id: row.id as string,
  exchange: row.exchange as ExchangeName,
  currency: row.currency as Currency,
  eventId: row.event_id as string,
  marketId: row.market_id as string,
  outcomeId: row.outcome_id as string,
  eventTitle: row.event_title as string,
  marketTitle: row.market_title as string,
  outcomeLabel: row.outcome_label as string,
  analysisId: (row.analysis_id as number | null) ?? null,
  probability: row.probability as number,
  marketPrice: row.market_price as number,
  quotedPrice: row.quoted_price as number,
  expectedReturn: row.expected_return as number,
  confidence: row.confidence as Confidence,
  stake: row.stake as number,
  rationale: row.rationale as string,
  status: row.status as BetStatus,
  dryRun: Boolean(row.dry_run),
  executeAt: row.execute_at as string,
  orderId: (row.order_id as string | null) ?? null,
  fillPrice: (row.fill_price as number | null) ?? null,
  shares: (row.shares as number | null) ?? null,
  pnl: (row.pnl as number | null) ?? null,
  error: (row.error as string | null) ?? null,
  telegramMessageId: (row.telegram_message_id as number | null) ?? null,
  createdAt: row.created_at as string,
  updatedAt: row.updated_at as string,
});

export const createBet = async (bet: NewBet) => {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO bets (id, exchange, currency, event_id, market_id, outcome_id, event_title, market_title, outcome_label,
            analysis_id, probability, market_price, quoted_price, expected_return, confidence, stake, rationale,
            status, dry_run, execute_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
    args: [
      id,
      bet.exchange,
      bet.currency,
      bet.eventId,
      bet.marketId,
      bet.outcomeId,
      bet.eventTitle,
      bet.marketTitle,
      bet.outcomeLabel,
      bet.analysisId,
      bet.probability,
      bet.marketPrice,
      bet.quotedPrice,
      bet.expectedReturn,
      bet.confidence,
      bet.stake,
      bet.rationale,
      bet.dryRun ? 1 : 0,
      bet.executeAt,
      now,
      now,
    ],
  });
  return (await getBet(id))!;
};

export const getBet = async (id: string) => {
  const result = await db.execute({ sql: "SELECT * FROM bets WHERE id = ?", args: [id] });
  const row = result.rows[0];
  return row ? fromRow(row) : null;
};

export const listBets = async (statuses: BetStatus[], limit = 50) => {
  const placeholders = statuses.map(() => "?").join(", ");
  const result = await db.execute({
    sql: `SELECT * FROM bets WHERE status IN (${placeholders}) ORDER BY created_at DESC LIMIT ?`,
    args: [...statuses, limit],
  });
  return result.rows.map(fromRow);
};

export const dueBets = async (nowIso: string) => {
  const result = await db.execute({
    sql: "SELECT * FROM bets WHERE status = 'pending' AND execute_at <= ? ORDER BY execute_at",
    args: [nowIso],
  });
  return result.rows.map(fromRow);
};

// Event ids that already have a live bet, so a new scan doesn't stack another one on top
export const activeBetEventIds = async (exchange: ExchangeName) => {
  const result = await db.execute({
    sql: "SELECT DISTINCT event_id FROM bets WHERE exchange = ? AND status IN ('pending', 'placing', 'placed')",
    args: [exchange],
  });
  return new Set(result.rows.map((row) => row.event_id as string));
};

type BetPatch = Partial<
  Pick<Bet, "status" | "executeAt" | "orderId" | "fillPrice" | "shares" | "pnl" | "error" | "telegramMessageId" | "stake" | "quotedPrice" | "expectedReturn">
>;

const COLUMN: Record<keyof BetPatch, string> = {
  status: "status",
  executeAt: "execute_at",
  orderId: "order_id",
  fillPrice: "fill_price",
  shares: "shares",
  pnl: "pnl",
  error: "error",
  telegramMessageId: "telegram_message_id",
  stake: "stake",
  quotedPrice: "quoted_price",
  expectedReturn: "expected_return",
};

// Update a bet, optionally only if it is still in one of `fromStatuses`.
// Returns false when the guard didn't match (e.g. the bet was cancelled meanwhile).
export const updateBet = async (id: string, patch: BetPatch, fromStatuses?: BetStatus[]) => {
  const entries = Object.entries(patch) as [keyof BetPatch, BetPatch[keyof BetPatch]][];
  const sets = entries.map(([key]) => `${COLUMN[key]} = ?`);
  const args = entries.map(([, value]) => value ?? null);
  let sql = `UPDATE bets SET ${[...sets, "updated_at = ?"].join(", ")} WHERE id = ?`;
  args.push(new Date().toISOString(), id);
  if (fromStatuses?.length) {
    sql += ` AND status IN (${fromStatuses.map(() => "?").join(", ")})`;
    args.push(...fromStatuses);
  }
  const result = await db.execute({ sql, args });
  return result.rowsAffected > 0;
};

export type BetTotals = { exposure: number; realizedPnl: number };

export const betTotals = async (exchange: ExchangeName, dryRun: boolean): Promise<BetTotals> => {
  const result = await db.execute({
    sql: `SELECT
            COALESCE(SUM(CASE WHEN status IN ('pending', 'placing', 'placed') THEN stake END), 0) AS exposure,
            COALESCE(SUM(CASE WHEN status IN ('won', 'lost', 'void') THEN pnl END), 0) AS realized_pnl
          FROM bets WHERE exchange = ? AND dry_run = ?`,
    args: [exchange, dryRun ? 1 : 0],
  });
  const row = result.rows[0]!;
  return { exposure: Number(row.exposure), realizedPnl: Number(row.realized_pnl) };
};

// Live stakes not yet sent to the exchange (the wallet balance doesn't reflect them yet)
export const unsentLiveStakes = async (exchange: ExchangeName) => {
  const result = await db.execute({
    sql: "SELECT COALESCE(SUM(stake), 0) AS total FROM bets WHERE exchange = ? AND dry_run = 0 AND status IN ('pending', 'placing')",
    args: [exchange],
  });
  return Number(result.rows[0]!.total);
};
