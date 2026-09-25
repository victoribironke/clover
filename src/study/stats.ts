import type { MarketKind } from "@/data/kind.ts";

// One settled event as recorded by the study job (Firestore `studies/{eventId}`)
export type StudyMarket = {
  marketId: string;
  title: string;
  // did outcome1 ("YES") win; null when voided
  won: boolean | null;
  // outcome1 price N minutes before the anchor (measurement time, or close when unknown)
  at60: number | null;
  at30: number | null;
  at10: number | null;
  // price 15 minutes after the measurement time, if the market was still trading then
  after15: number | null;
  // [minutes before anchor, price] every 5 minutes over the final 6 hours
  path: [number, number][];
};

export type Study = {
  eventId: string;
  title: string;
  category: string;
  kind: MarketKind;
  status: "resolved" | "cancelled";
  anchorAt: string | null;
  anchorIsMeasurement: boolean;
  closeAt: string | null;
  resolvedAt: string | null;
  markets: StudyMarket[];
  recordedAt: string;
};

export type Bucket = { label: string; n: number; avgPrice: number; winRate: number };
export type KindRow = { kind: MarketKind; events: number; voids: number; markets: number; lateGap: number | null };
export type StudySummary = {
  events: number;
  since: string | null;
  // is a price 10 minutes out a fair probability? (winRate ≈ avgPrice means yes)
  at10: Bucket[];
  byKind: KindRow[];
  // markets still trading 15 minutes after measurement, not yet at 0-10% / 90-100%
  lateOpen: { n: number; avgPrice: number; winRate: number };
};

const BUCKETS: [number, number, string][] = [
  [0, 0.2, "0-20%"],
  [0.2, 0.4, "20-40%"],
  [0.4, 0.6, "40-60%"],
  [0.6, 0.8, "60-80%"],
  [0.8, 1.01, "80-100%"],
];

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

export const summarize = (studies: Study[]): StudySummary => {
  const settled = studies.flatMap((study) =>
    study.status === "resolved" ? study.markets.filter((market) => market.won !== null).map((market) => ({ study, market })) : [],
  );

  const priced = settled.filter(({ market }) => market.at10 !== null);
  const at10 = BUCKETS.map(([low, high, label]) => {
    const inBucket = priced.filter(({ market }) => market.at10! >= low && market.at10! < high);
    return {
      label,
      n: inBucket.length,
      avgPrice: mean(inBucket.map(({ market }) => market.at10!)),
      winRate: mean(inBucket.map(({ market }) => (market.won ? 1 : 0))),
    };
  });

  const kinds = [...new Set(studies.map((study) => study.kind))];
  const byKind = kinds
    .map((kind) => {
      const ofKind = studies.filter((study) => study.kind === kind);
      const markets = priced.filter(({ study }) => study.kind === kind);
      return {
        kind,
        events: ofKind.length,
        voids: ofKind.filter((study) => study.status === "cancelled").length,
        markets: markets.length,
        // positive: YES won more often than its price 10 minutes out implied (late underpricing)
        lateGap: markets.length ? mean(markets.map(({ market }) => (market.won ? 1 : 0) - market.at10!)) : null,
      };
    })
    .sort((a, b) => b.events - a.events);

  const late = settled.filter(({ market }) => market.after15 !== null && market.after15 > 0.1 && market.after15 < 0.9);
  const since = studies.map((study) => study.recordedAt).sort()[0] ?? null;

  return {
    events: studies.length,
    since,
    at10,
    byKind,
    lateOpen: {
      n: late.length,
      avgPrice: mean(late.map(({ market }) => market.after15!)),
      winRate: mean(late.map(({ market }) => (market.won ? 1 : 0))),
    },
  };
};
