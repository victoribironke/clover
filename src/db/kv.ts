import { collection, firestore } from "./firestore.ts";

const kv = () => collection("kv");

export const isPaused = async () => (await kv().doc("paused").get()).get("value") === true;
export const setPaused = (paused: boolean) => kv().doc("paused").set({ value: paused });

// Cross-instance lock so overlapping Cloud Scheduler calls (or a manual /scan)
// don't run the same job twice. Stale locks expire after `ttlMs`.
export const tryLock = (name: string, ttlMs: number) =>
  firestore.runTransaction(async (tx) => {
    const ref = kv().doc(`lock-${name}`);
    const now = Date.now();
    const until = (await tx.get(ref)).get("until") as number | undefined;
    if (until && until > now) return false;
    tx.set(ref, { until: now + ttlMs });
    return true;
  });

export const releaseLock = async (name: string) => {
  await kv().doc(`lock-${name}`).delete();
};
