import { FieldValue } from "@google-cloud/firestore";
import { estimateCost } from "@/llm/pricing.ts";
import type { Usage } from "@/llm/types.ts";
import { collection } from "./firestore.ts";

// LLM spend (estimated USD) per UTC day in kv/spend-YYYY-MM-DD,
// web searches per month in kv/searches-YYYY-MM (for free search allowances)
const today = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => today().slice(0, 7);
const dayRef = (day: string) => collection("kv").doc(`spend-${day}`);
const searchesRef = () => collection("kv").doc(`searches-${thisMonth()}`);

// Price a call, record it, and return its estimated USD cost
export const recordUsage = async (usage: Usage) => {
  const searchesThisMonth = ((await searchesRef().get()).get("count") as number | undefined) ?? 0;
  const costUsd = estimateCost(usage, searchesThisMonth);
  await Promise.all([
    dayRef(today()).set({ usd: FieldValue.increment(costUsd), day: today() }, { merge: true }),
    usage.searches > 0 ? searchesRef().set({ count: FieldValue.increment(usage.searches) }, { merge: true }) : null,
  ]);
  return costUsd;
};

export const spendToday = async () => ((await dayRef(today()).get()).get("usd") as number | undefined) ?? 0;

export const spendThisMonth = async () => {
  const month = thisMonth();
  const snapshot = await collection("kv")
    .where("day", ">=", `${month}-01`)
    .where("day", "<=", `${month}-31`)
    .get();
  return snapshot.docs.reduce((total, doc) => total + ((doc.get("usd") as number | undefined) ?? 0), 0);
};
