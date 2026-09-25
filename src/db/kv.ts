import { collection, firestore } from "./firestore.ts";

const kv = () => collection("kv");

export const isPaused = async () => (await kv().doc("paused").get()).get("value") === true;
export const setPaused = (paused: boolean) => kv().doc("paused").set({ value: paused });

// A copy of src/settings.ts that the web panel reads, so capital, paper/live mode and the rest
// have one source of truth. Written on every start, i.e. on every deploy.
export const publishSettings = (settings: Record<string, unknown>) => publish("settings", settings);

// Snapshots the bot writes for the web panel to read (kv/<name>), stamped with when
export const publish = (name: "settings" | "wallet" | "study-summary", data: Record<string, unknown>) =>
  kv().doc(name).set({ ...data, publishedAt: new Date().toISOString() });

// One-off markers, e.g. "this migration has run"
export const hasFlag = async (name: string) => (await kv().doc(`flag-${name}`).get()).exists;
export const setFlag = (name: string) => kv().doc(`flag-${name}`).set({ at: new Date().toISOString() });

export type LockResult = { acquired: true } | { acquired: false; startedAt: number; until: number };

// locks this process holds, so a shutdown can hand them back (see releaseHeldLocks)
const held = new Set<string>();

// Cross-instance lock so overlapping Cloud Scheduler calls (or a manual /scan)
// don't run the same job twice. If the holder dies without releasing it, the
// lock expires after `ttlMs`.
export const tryLock = (name: string, ttlMs: number) =>
  firestore
    .runTransaction(async (tx): Promise<LockResult> => {
      const ref = kv().doc(`lock-${name}`);
      const now = Date.now();
      const snapshot = await tx.get(ref);
      const until = snapshot.get("until") as number | undefined;
      if (until && until > now) {
        return { acquired: false, until, startedAt: (snapshot.get("startedAt") as number | undefined) ?? until - ttlMs };
      }
      tx.set(ref, { until: now + ttlMs, startedAt: now });
      return { acquired: true };
    })
    .then((result) => {
      if (result.acquired) held.add(name);
      return result;
    });

export const releaseLock = async (name: string) => {
  held.delete(name);
  await kv().doc(`lock-${name}`).delete();
};

// Called on SIGTERM: returns the names that were held, after releasing them
export const releaseHeldLocks = async () => {
  const names = [...held];
  await Promise.all(names.map(releaseLock));
  return names;
};
