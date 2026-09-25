"use client";

import { useMemo, useState } from "react";
import Chips from "@/components/chips";
import PageHeader from "@/components/page-header";
import { usePanel } from "@/components/panel-provider";
import { bayseEventUrl, lagosDateTime, pct, usd } from "@/lib/format";
import { MARKET_KIND_LABELS } from "@/lib/labels";

type Verdict = "all" | "bet" | "passed";

const VERDICTS: { value: Verdict; label: string }[] = [
  { value: "all", label: "All" },
  { value: "bet", label: "Bet placed" },
  { value: "passed", label: "Passed" },
];

// Every deep dive the bot paid for, bet or not: what it found and why it passed
const ResearchView = () => {
  const { analyses } = usePanel();
  const [verdict, setVerdict] = useState<Verdict>("all");

  // the loaded set also holds older analyses that bets point at; the log shows newest first
  const sorted = useMemo(() => [...analyses].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [analyses]);
  const shown = useMemo(
    () => sorted.filter((analysis) => (verdict === "bet" ? analysis.proposed === true : verdict === "passed" ? analysis.proposed !== true : true)),
    [sorted, verdict],
  );
  const spent = sorted.reduce((total, analysis) => total + (analysis.costUsd ?? 0), 0);
  const betRate = sorted.length ? sorted.filter((analysis) => analysis.proposed).length / sorted.length : null;

  return (
    <div className="space-y-5">
      <PageHeader title="Research log" subtitle={`${sorted.length} deep dives · ${usd(spent)} spent · ${pct(betRate, 0)} became bets`} />
      <Chips current={verdict} onChange={setVerdict} options={VERDICTS} />

      <ul className="space-y-3">
        {shown.length === 0 && <li className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted">Nothing here yet.</li>}
        {shown.map((analysis) => (
          <li key={analysis.id} className="space-y-2 rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <a href={bayseEventUrl(analysis.eventId)} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                {analysis.proposed ? "✅ " : "➖ "}
                {analysis.eventTitle}
              </a>
              <span className="text-xs text-muted">
                {MARKET_KIND_LABELS[analysis.kind ?? "unclassified"] ?? analysis.kind} · {lagosDateTime(analysis.createdAt)}
                {analysis.costUsd !== undefined && ` · ${usd(analysis.costUsd)}`}
              </span>
            </div>
            {analysis.reading && (
              <p className="text-sm">
                📏 {analysis.reading}
                <span className="ml-2 text-xs text-muted">{analysis.liveData ? "live data" : "history only"}</span>
              </p>
            )}
            <p className="text-sm text-muted">{analysis.summary}</p>
            {!analysis.proposed && analysis.nearMiss && (
              <p className="rounded-lg bg-background px-3 py-2 text-xs">
                Closest: {analysis.nearMiss.marketTitle === analysis.eventTitle ? "" : `${analysis.nearMiss.marketTitle} → `}
                {analysis.nearMiss.outcomeLabel} · research {pct(analysis.nearMiss.modelProbability)} ({analysis.nearMiss.confidence}) vs market{" "}
                {pct(analysis.nearMiss.marketPrice)} · cost {pct(analysis.nearMiss.price)} → {pct(analysis.nearMiss.expectedReturn)} ·{" "}
                <span className="text-muted">{analysis.nearMiss.reason}</span>
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default ResearchView;
