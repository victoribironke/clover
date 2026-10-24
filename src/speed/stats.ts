import type { Report, Snapshot } from "./record.ts";

// A report as stored by the speed test (Firestore `speed/{station}-{obsTime}`)
export type SpeedDoc = Report & {
  series: string;
  seenAt: number;
  baseline: Snapshot | null;
  snapshots: (Snapshot & { minute: number })[];
};

// a move this size, by 15 minutes after we saw the report, counts as the market reacting
const REACTION = 0.1;

const mid = (quote: Snapshot["markets"][number]) =>
  quote.b > 0 && quote.a > 0 ? (quote.b + quote.a) / 2 : quote.l;

// The largest change in any band's mid price between the baseline and a snapshot
export const largestMove = (baseline: Snapshot, snapshot: Snapshot) => {
  const before = new Map(baseline.markets.map((quote) => [quote.t, mid(quote)]));
  return snapshot.markets.reduce((largest, quote) => {
    const was = before.get(quote.t);
    return was === undefined ? largest : Math.max(largest, Math.abs(mid(quote) - was));
  }, 0);
};

const median = (values: number[]) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};

export type Timing = "before" | "between" | "after";

// For a report the market reacted to: how much of the move (by +15 minutes) had already happened
// when we first saw it. Null when it didn't react, or the snapshots are missing.
export const reactionTiming = (doc: SpeedDoc): Timing | null => {
  const first = doc.snapshots.find((snapshot) => snapshot.minute === 0);
  const last = doc.snapshots.find((snapshot) => snapshot.minute === 15);
  if (!doc.baseline || !first || !last) return null;
  const total = largestMove(doc.baseline, last);
  if (total < REACTION) return null;
  const share = largestMove(doc.baseline, first) / total;
  return share >= 0.8 ? "before" : share <= 0.2 ? "after" : "between";
};

const cents = (value: number | null) => (value === null ? "?" : `${Math.round(value * 100)}¢`);
const minutes = (ms: number | null) => (ms === null ? "?" : `${(ms / 60_000).toFixed(1)} min`);

export const speedMessage = (docs: SpeedDoc[], until: string) => {
  if (docs.length === 0)
    return "⏱ <b>Speed test</b>\nNo reports logged yet. It checks every minute and runs until " +
      `${until.slice(0, 10)}.`;
  const stations = new Set(docs.map((doc) => doc.station));
  const since = new Date(Math.min(...docs.map((doc) => doc.seenAt))).toISOString().slice(0, 16);
  const toReceipt = median(
    docs.flatMap((doc) => (doc.receiptAt ? [doc.receiptAt - doc.obsAt] : [])),
  );
  const toSeen = median(
    docs.flatMap((doc) => (doc.receiptAt ? [doc.seenAt - doc.receiptAt] : [])),
  );
  const timings = docs.map(reactionTiming).filter((timing): timing is Timing => timing !== null);
  const count = (timing: Timing) => timings.filter((each) => each === timing).length;
  const moveAt = (minute: number) =>
    median(
      docs.flatMap((doc) => {
        const snapshot = doc.snapshots.find((each) => each.minute === minute);
        return doc.baseline && snapshot && reactionTiming(doc) !== null
          ? [largestMove(doc.baseline, snapshot)]
          : [];
      }),
    );
  return [
    `⏱ <b>Speed test</b> · ${docs.length} reports from ${stations.size} stations since ${since} UTC`,
    `Observed → received by NWS: ${minutes(toReceipt)} · NWS → seen by us: ${minutes(toSeen)} (medians)`,
    "",
    `<b>Reports the market reacted to</b> (a band moved ${cents(REACTION)}+ by 15 min): ${timings.length}`,
    `Already moved when we saw it: ${count("before")}`,
    `Partly moved: ${count("between")}`,
    `Moved after we saw it: ${count("after")}`,
    `Typical move: when seen ${cents(moveAt(0))}, +2 min ${cents(moveAt(2))}, +5 min ${cents(moveAt(5))}, +15 min ${cents(moveAt(15))}`,
    "",
    "<i>A gap worth trading means most reactions land in “moved after we saw it”. Runs until " +
      `${until.slice(0, 10)}.</i>`,
  ].join("\n");
};
