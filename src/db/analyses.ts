import type { ExchangeName } from "@/exchanges/types.ts";
import type { DeepDive } from "@/research/deep-dive.ts";
import { db } from "./client.ts";

export const saveAnalysis = async (
  exchange: ExchangeName,
  eventId: string,
  eventTitle: string,
  model: string,
  deepDive: DeepDive,
) => {
  const result = await db.execute({
    sql: `INSERT INTO analyses (exchange, event_id, event_title, model, summary, key_factors_json, sources_json, estimates_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      exchange,
      eventId,
      eventTitle,
      model,
      deepDive.summary,
      JSON.stringify(deepDive.keyFactors),
      JSON.stringify(deepDive.sources),
      JSON.stringify(deepDive.estimates),
      new Date().toISOString(),
    ],
  });
  return Number(result.lastInsertRowid);
};

// Event ids researched since `sinceIso`, so a scan doesn't pay for the same deep dive twice
export const recentlyAnalyzedEventIds = async (exchange: ExchangeName, sinceIso: string) => {
  const result = await db.execute({
    sql: "SELECT DISTINCT event_id FROM analyses WHERE exchange = ? AND created_at >= ?",
    args: [exchange, sinceIso],
  });
  return new Set(result.rows.map((row) => row.event_id as string));
};
