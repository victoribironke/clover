import "server-only";
import { settings } from "@/settings";
import { collection, firestore } from "./firestore";
import type { Analysis, Bet, BotSettings, SpendDay, StudySummary, WalletSnapshot } from "./types";

export const loadBets = async () => (await collection("bets").get()).docs.map((doc) => doc.data() as Bet);

export const loadBotSettings = async (): Promise<BotSettings> => {
  const published = (await collection("kv").doc("settings").get()).data() as Partial<BotSettings> | undefined;
  return { ...settings.fallbackBotSettings, ...published };
};

// kv/spend-YYYY-MM-DD documents carry a `day` field; locks, flags and settings don't
export const loadSpend = async () =>
  (await collection("kv").where("day", ">=", "2000-01-01").get()).docs.map((doc) => doc.data() as SpendDay);

export const loadWallet = async () =>
  ((await collection("kv").doc("wallet").get()).data() as WalletSnapshot | undefined) ?? null;

export const loadStudySummary = async () =>
  ((await collection("kv").doc("study-summary").get()).data() as StudySummary | undefined) ?? null;

// newest first; createdAt is an ISO string, so it sorts correctly (single-field index, no setup)
export const loadAnalyses = async (limit = 200) =>
  (await collection("analyses").orderBy("createdAt", "desc").limit(limit).get()).docs.map(
    (doc) => ({ ...doc.data(), id: doc.id }) as Analysis,
  );

export const loadAnalysesByIds = async (ids: string[]) => {
  if (ids.length === 0) return [];
  const snapshots = await firestore.getAll(...ids.map((id) => collection("analyses").doc(id)));
  return snapshots.filter((snapshot) => snapshot.exists).map((snapshot) => ({ ...snapshot.data(), id: snapshot.id }) as Analysis);
};
