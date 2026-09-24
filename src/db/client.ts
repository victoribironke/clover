import { createClient, type InValue } from "@libsql/client";
import { config } from "@/config.ts";

export const db = createClient({
  url: config.DATABASE_URL,
  authToken: config.DATABASE_AUTH_TOKEN,
});

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    exchange TEXT NOT NULL,
    event_id TEXT NOT NULL,
    event_title TEXT NOT NULL,
    model TEXT NOT NULL,
    summary TEXT NOT NULL,
    key_factors_json TEXT NOT NULL,
    sources_json TEXT NOT NULL,
    estimates_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS analyses_event ON analyses (exchange, event_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS bets (
    id TEXT PRIMARY KEY,
    exchange TEXT NOT NULL,
    currency TEXT NOT NULL,
    event_id TEXT NOT NULL,
    market_id TEXT NOT NULL,
    outcome_id TEXT NOT NULL,
    event_title TEXT NOT NULL,
    market_title TEXT NOT NULL,
    outcome_label TEXT NOT NULL,
    analysis_id INTEGER,
    probability REAL NOT NULL,
    market_price REAL NOT NULL,
    quoted_price REAL NOT NULL,
    expected_return REAL NOT NULL,
    confidence TEXT NOT NULL,
    stake REAL NOT NULL,
    rationale TEXT NOT NULL,
    status TEXT NOT NULL,
    dry_run INTEGER NOT NULL,
    execute_at TEXT NOT NULL,
    order_id TEXT,
    fill_price REAL,
    shares REAL,
    pnl REAL,
    error TEXT,
    telegram_message_id INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS bets_status ON bets (status, execute_at)`,
  `CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
];

export const migrate = async () => {
  await db.batch(MIGRATIONS, "write");
};

export type Row = Record<string, InValue>;
