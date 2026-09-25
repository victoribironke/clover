"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { usePanel } from "@/components/panel-provider";
import { kindOf } from "@/lib/analytics";
import { bayseEventUrl, lagosDateTime, money, pct, signedMoney, usd } from "@/lib/format";
import { MARKET_KIND_LABELS, STATUS_STYLE } from "@/lib/labels";

const Row = ({ label, value }: { label: string; value: ReactNode }) => (
  <div className="flex justify-between gap-4 py-1.5 text-sm">
    <dt className="text-muted">{label}</dt>
    <dd className="text-right tabular-nums">{value}</dd>
  </div>
);

const BetView = ({ id }: { id: string }) => {
  const { bets, analyses } = usePanel();
  const bet = bets.find((item) => item.id === id);

  if (!bet) {
    return (
      <div className="space-y-3">
        <Link href="/bets" className="text-sm text-muted hover:text-foreground">
          ← All bets
        </Link>
        <p className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted">
          No bet with this id. If it was just placed, press Refresh.
        </p>
      </div>
    );
  }

  const analysis = bet.analysisId ? analyses.find((item) => item.id === bet.analysisId) : undefined;

  return (
    <div className="space-y-5">
      <div>
        <Link href="/bets" className="text-sm text-muted hover:text-foreground">
          ← All bets
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">
          <a href={bayseEventUrl(bet.eventId)} target="_blank" rel="noreferrer" className="hover:underline">
            {bet.eventTitle} ↗
          </a>
        </h1>
        <p className="text-sm text-muted">
          {bet.marketTitle !== bet.eventTitle ? `${bet.marketTitle} → ` : ""}
          <span className="font-medium text-foreground">{bet.outcomeLabel}</span> · {MARKET_KIND_LABELS[kindOf(bet)] ?? kindOf(bet)} ·{" "}
          {bet.dryRun ? "paper" : "live"}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-medium">The bet</h2>
          <dl className="divide-y divide-border">
            <Row label="Status" value={<span className={`capitalize ${STATUS_STYLE[bet.status] ?? ""}`}>{bet.status}</span>} />
            <Row label="P&L" value={bet.pnl === null ? "–" : <span className={STATUS_STYLE[bet.status] ?? ""}>{signedMoney(bet.pnl)}</span>} />
            <Row label="Stake" value={money(bet.stake)} />
            <Row label="Price paid (fees + impact)" value={pct(bet.fillPrice ?? bet.quotedPrice)} />
            <Row label="Market price when proposed" value={pct(bet.marketPrice)} />
            <Row label="Bot's probability" value={`${pct(bet.probability)} · ${bet.confidence} confidence`} />
            <Row label="Expected return" value={pct(bet.expectedReturn)} />
            <Row label="Pays if it wins" value={money(bet.stake / (bet.fillPrice ?? bet.quotedPrice))} />
            {bet.shares !== null && <Row label="Shares" value={bet.shares.toFixed(2)} />}
          </dl>
        </section>

        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-medium">Timeline</h2>
          <dl className="divide-y divide-border">
            <Row label="Proposed" value={lagosDateTime(bet.createdAt)} />
            <Row label="Placed (after cancel window)" value={lagosDateTime(bet.executeAt)} />
            <Row label="Last update" value={lagosDateTime(bet.updatedAt)} />
            {bet.orderId && <Row label="Order" value={<code className="text-xs">{bet.orderId}</code>} />}
          </dl>
          {bet.error && <p className="mt-3 rounded-lg bg-loss/10 px-3 py-2 text-sm text-loss">{bet.error}</p>}
        </section>
      </div>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Research</h2>
          {analysis && (
            <p className="text-xs text-muted">
              {analysis.model} · {lagosDateTime(analysis.createdAt)}
              {analysis.costUsd !== undefined && ` · ${usd(analysis.costUsd)}`}
              {analysis.usage && ` · ${analysis.usage.searches} searches`}
            </p>
          )}
        </div>
        {!analysis && <p className="text-sm">{bet.rationale || "No research record for this bet."}</p>}
        {analysis && (
          <>
            {analysis.reading && (
              <p className={`rounded-lg px-3 py-2 text-sm ${analysis.liveData ? "bg-gain/10" : "bg-background"}`}>
                📏 {analysis.reading}
                <span className="ml-2 text-xs text-muted">{analysis.liveData ? "live data" : "history only"}</span>
              </p>
            )}
            <p className="text-sm leading-relaxed">{analysis.summary}</p>
            {analysis.keyFactors.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {analysis.keyFactors.map((factor) => (
                  <li key={factor}>{factor}</li>
                ))}
              </ul>
            )}
            {analysis.sources.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Sources</p>
                <ul className="space-y-1 text-sm">
                  {analysis.sources.map((source) => (
                    <li key={source.url} className="truncate">
                      <a href={source.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                        {source.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
};

export default BetView;
