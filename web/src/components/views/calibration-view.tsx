"use client";

import { useMemo } from "react";
import CalibrationChart from "@/components/calibration-chart";
import PageHeader from "@/components/page-header";
import { usePanel } from "@/components/panel-provider";
import StatCard from "@/components/stat-card";
import { calibration, type Calibration } from "@/lib/analytics";
import { pct } from "@/lib/format";

const BucketTable = ({ result, predictedLabel }: { result: Calibration; predictedLabel: string }) => (
  <table className="w-full text-sm">
    <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
      <tr>
        <th className="py-2 font-medium">{predictedLabel}</th>
        <th className="py-2 text-right font-medium">Bets</th>
        <th className="py-2 text-right font-medium">Average</th>
        <th className="py-2 text-right font-medium">Actually won</th>
      </tr>
    </thead>
    <tbody className="divide-y divide-border">
      {result.buckets
        .filter((bucket) => bucket.n > 0)
        .map((bucket) => (
          <tr key={bucket.label}>
            <td className="py-2">{bucket.label}</td>
            <td className="py-2 text-right tabular-nums">{bucket.n}</td>
            <td className="py-2 text-right tabular-nums">{pct(bucket.predicted)}</td>
            <td className={`py-2 text-right font-medium tabular-nums ${bucket.actual >= bucket.predicted ? "text-gain" : "text-loss"}`}>
              {pct(bucket.actual)}
            </td>
          </tr>
        ))}
    </tbody>
  </table>
);

const CalibrationView = () => {
  const { bets, mode } = usePanel();
  const botView = useMemo(() => calibration(bets, mode, "probability"), [bets, mode]);
  const marketView = useMemo(() => calibration(bets, mode, "quotedPrice"), [bets, mode]);

  // Research earns its cost only if the bot's probabilities beat the prices it paid
  const verdict =
    botView.brier === null || marketView.brier === null
      ? null
      : botView.brier < marketView.brier
        ? "The bot's probabilities have been closer to the results than the market's prices: so far, the research is adding something."
        : "The market's prices have been at least as accurate as the bot's probabilities: so far, the research isn't beating the crowd.";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Calibration"
        subtitle="When the bot said 70%, did it win about 70% of the time? And was it more accurate than the price it paid?"
        withMode
      />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Decided bets" value={String(botView.n)} hint="won or lost; voids left out" />
        <StatCard label="Bot's Brier score" value={botView.brier === null ? "–" : botView.brier.toFixed(3)} hint="0 = perfect, 0.25 = coin flip" />
        <StatCard label="Market's Brier score" value={marketView.brier === null ? "–" : marketView.brier.toFixed(3)} hint="the prices it paid, as probabilities" />
      </section>
      {verdict && <p className="rounded-lg border border-border bg-card px-4 py-3 text-sm">{verdict}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-medium">The bot&apos;s probability</h2>
          <p className="mb-2 text-xs text-muted">The blend of research and market it bet on. Dots above the dashed line won more often than claimed.</p>
          <CalibrationChart points={botView.buckets} xLabel="bot said" />
          <BucketTable result={botView} predictedLabel="Bot said" />
        </section>
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-medium">The price it paid</h2>
          <p className="mb-2 text-xs text-muted">What the market implied, after fees and price impact.</p>
          <CalibrationChart points={marketView.buckets} xLabel="price paid" />
          <BucketTable result={marketView} predictedLabel="Price paid" />
        </section>
      </div>
      <p className="text-xs text-muted">Calibration needs dozens of bets per bucket before it means much; early numbers will jump around.</p>
    </div>
  );
};

export default CalibrationView;
