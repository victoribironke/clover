import { FieldValue } from "@google-cloud/firestore";
import { collection } from "./firestore.ts";

// Alerts held back in quiet mode, per UTC day (kv/alerts-YYYY-MM-DD), for the daily summary
export type StoredAlert = { at: string; text: string };

const dayRef = (day: string) => collection("kv").doc(`alerts-${day}`);

const toPlainText = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);

export const recordAlert = async (html: string) => {
  const at = new Date().toISOString();
  await dayRef(at.slice(0, 10)).set({ alerts: FieldValue.arrayUnion({ at, text: toPlainText(html) }) }, { merge: true });
};

// Alerts from `since` until now (reads today's and yesterday's UTC buckets)
export const alertsSince = async (since: Date) => {
  const days = [...new Set([since.toISOString().slice(0, 10), new Date().toISOString().slice(0, 10)])];
  const docs = await Promise.all(days.map((day) => dayRef(day).get()));
  return docs
    .flatMap((doc) => (doc.get("alerts") as StoredAlert[] | undefined) ?? [])
    .filter((alert) => alert.at >= since.toISOString())
    .sort((a, b) => a.at.localeCompare(b.at));
};
