import { db } from "./client.ts";

export const getKv = async (key: string) => {
  const result = await db.execute({ sql: "SELECT value FROM kv WHERE key = ?", args: [key] });
  return (result.rows[0]?.value as string | undefined) ?? null;
};

export const setKv = async (key: string, value: string) => {
  await db.execute({
    sql: "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    args: [key, value],
  });
};

export const deleteKv = async (key: string) => {
  await db.execute({ sql: "DELETE FROM kv WHERE key = ?", args: [key] });
};

export const isPaused = async () => (await getKv("paused")) === "true";
export const setPaused = (paused: boolean) => setKv("paused", String(paused));

// Cross-instance lock so overlapping Cloud Scheduler calls (or a manual /scan)
// don't run the same job twice. Stale locks expire after `ttlMs`.
export const tryLock = async (name: string, ttlMs: number) => {
  const key = `lock:${name}`;
  const now = Date.now();
  const result = await db.execute({
    sql: `INSERT INTO kv (key, value) VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
          WHERE CAST(kv.value AS INTEGER) < ?`,
    args: [key, String(now + ttlMs), now],
  });
  return result.rowsAffected > 0;
};

export const releaseLock = (name: string) => deleteKv(`lock:${name}`);
