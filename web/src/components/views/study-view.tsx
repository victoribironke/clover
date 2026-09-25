"use client";

import CalibrationChart from "@/components/calibration-chart";
import PageHeader from "@/components/page-header";
import { usePanel } from "@/components/panel-provider";
import StatCard from "@/components/stat-card";
import { lagosDateTime, pct } from "@/lib/format";
import { MARKET_KIND_LABELS } from "@/lib/labels";

const signedPoints = (value: number) => `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)} pts`;

// The late-price study (src/jobs/study.ts): how settled markets were priced near the end.
// The bot publishes this summary to kv/study-summary every 6 hours.
const StudyView = () => {
  const { study: summary } = usePanel();

  if (!summary || summary.events === 0) {
    return (
      <div className="space-y-5">
        <PageHeader title="Late-price study" />
        <p className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted">
          No study data yet. The study job records settled markets every 6 hours.
        </p>
      </div>
    );
  }

  const points = summary.at10.map((bucket) => ({ label: bucket.label, predicted: bucket.avgPrice, actual: bucket.winRate, n: bucket.n }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Late-price study"
        subtitle={`Are prices fair 10 minutes before the measurement? ${summary.events} markets since ${summary.since ? lagosDateTime(summary.since) : "?"}${summary.publishedAt ? ` · updated ${lagosDateTime(summary.publishedAt)}` : ""}`}
      />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Markets studied" value={String(summary.events)} />
        <StatCard
          label="Still trading after measurement"
          value={String(summary.lateOpen.n)}
          hint={summary.lateOpen.n ? `priced ${pct(summary.lateOpen.avgPrice)} → won ${pct(summary.lateOpen.winRate)}` : "none priced 10-90% yet"}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-medium">Price 10 minutes out vs how often YES won</h2>
          <p className="mb-2 text-xs text-muted">Dots above the dashed line: the market underpriced YES late on (the edge you spotted).</p>
          <CalibrationChart points={points} xLabel="price 10 min before" />
        </section>
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-medium">By market type</h2>
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="py-2 font-medium">Type</th>
                <th className="py-2 text-right font-medium">Markets</th>
                <th className="py-2 text-right font-medium">Voided</th>
                <th className="py-2 text-right font-medium">Late gap</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {summary.byKind.map((row) => (
                <tr key={row.kind}>
                  <td className="py-2">{MARKET_KIND_LABELS[row.kind] ?? row.kind}</td>
                  <td className="py-2 text-right tabular-nums">{row.events}</td>
                  <td className="py-2 text-right tabular-nums">
                    {row.voids} ({pct(row.events ? row.voids / row.events : 0, 0)})
                  </td>
                  <td className={`py-2 text-right tabular-nums ${row.lateGap === null ? "" : row.lateGap > 0 ? "text-gain" : "text-loss"}`}>
                    {row.lateGap === null ? "–" : signedPoints(row.lateGap)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted">Late gap: how much more often YES won than its price 10 minutes out implied.</p>
        </section>
      </div>
      <p className="text-xs text-muted">Needs a few hundred markets before it means much.</p>
    </div>
  );
};

export default StudyView;
