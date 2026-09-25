"use client";

import Link from "next/link";
import { useMemo } from "react";
import PageHeader from "@/components/page-header";
import { usePanel } from "@/components/panel-provider";
import { resultsByKind } from "@/lib/analytics";
import { money, pct, signedMoney } from "@/lib/format";
import { MARKET_KIND_LABELS } from "@/lib/labels";

const tone = (value: number | null) => (value === null || value === 0 ? "" : value > 0 ? "text-gain" : "text-loss");

const KindsView = () => {
  const { bets, mode } = usePanel();
  const rows = useMemo(() => resultsByKind(bets, mode), [bets, mode]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Market types"
        subtitle="Which kinds of market make money? Return on stakes is the number to watch; win rate alone hides the odds."
        withMode
      />

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Type</th>
              <th className="px-4 py-2 text-right font-medium">Bets</th>
              <th className="px-4 py-2 text-right font-medium">Won · lost</th>
              <th className="px-4 py-2 text-right font-medium">Win rate</th>
              <th className="px-4 py-2 text-right font-medium">Void rate</th>
              <th className="px-4 py-2 text-right font-medium">Staked</th>
              <th className="px-4 py-2 text-right font-medium">P&amp;L</th>
              <th className="px-4 py-2 text-right font-medium">Return</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted">
                  No {mode} bets yet.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.kind} className="hover:bg-background">
                <td className="px-4 py-2.5 font-medium">{MARKET_KIND_LABELS[row.kind] ?? row.kind}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {row.bets}
                  {row.open > 0 && <span className="text-muted"> ({row.open} open)</span>}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {row.won} · {row.lost}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{pct(row.winRate)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{pct(row.voidRate)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{money(row.staked)}</td>
                <td className={`px-4 py-2.5 text-right tabular-nums ${tone(row.pnl)}`}>{signedMoney(row.pnl)}</td>
                <td className={`px-4 py-2.5 text-right font-medium tabular-nums ${tone(row.roi)}`}>{pct(row.roi)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">
        A handful of bets per type proves little: one long shot can swing a small sample. Look for types that stay profitable as the count grows.{" "}
        <Link href="/bets" className="underline">
          See the bets
        </Link>
        .
      </p>
    </div>
  );
};

export default KindsView;
