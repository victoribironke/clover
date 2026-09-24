import type { ExchangeName } from "@/exchanges/types.ts";
import type { DeepDive } from "@/research/deep-dive.ts";
import type { NearMiss } from "@/strategy/propose.ts";
import { collection } from "./firestore.ts";

export const saveAnalysis = async (
  exchange: ExchangeName,
  eventId: string,
  eventTitle: string,
  model: string,
  deepDive: DeepDive,
  verdict: { proposed: boolean; nearMiss: NearMiss | null },
) => {
  const ref = await collection("analyses").add({
    exchange,
    eventId,
    eventTitle,
    model,
    ...deepDive,
    ...verdict,
    createdAt: new Date().toISOString(),
  });
  return ref.id;
};

// Event ids researched since `sinceIso`, so a scan doesn't pay for the same deep dive twice.
// Single-field range query only, so Firestore needs no composite index.
export const recentlyAnalyzedEventIds = async (exchange: ExchangeName, sinceIso: string) => {
  const snapshot = await collection("analyses").where("createdAt", ">=", sinceIso).select("exchange", "eventId").get();
  return new Set(snapshot.docs.filter((doc) => doc.get("exchange") === exchange).map((doc) => doc.get("eventId") as string));
};
