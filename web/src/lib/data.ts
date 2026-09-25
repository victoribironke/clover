import "server-only";
import { settings } from "@/settings";
import { collection } from "./firestore";
import type { Bet, BotSettings, SpendDay } from "./types";

export const loadBets = async () => (await collection("bets").get()).docs.map((doc) => doc.data() as Bet);

export const loadBotSettings = async (): Promise<BotSettings> => {
  const published = (await collection("kv").doc("settings").get()).data() as Partial<BotSettings> | undefined;
  return { ...settings.fallbackBotSettings, ...published };
};

// kv/spend-YYYY-MM-DD documents carry a `day` field; locks, flags and settings don't
export const loadSpend = async () =>
  (await collection("kv").where("day", ">=", "2000-01-01").get()).docs.map((doc) => doc.data() as SpendDay);
