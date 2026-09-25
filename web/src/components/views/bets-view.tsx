"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import Chips from "@/components/chips";
import PageHeader from "@/components/page-header";
import { usePanel } from "@/components/panel-provider";
import { filterBets, kindOf, STATUS_GROUPS, type StatusGroup } from "@/lib/analytics";
import { lagosDateTime, money, pct, signedMoney } from "@/lib/format";
import { MARKET_KIND_LABELS, STATUS_STYLE } from "@/lib/labels";

const STATUS_LABELS: Record<StatusGroup, string> = {
  all: "All",
  open: "Open",
  won: "Won",
  lost: "Lost",
  void: "Void",
  "not-placed": "Not placed",
};

const BetsView = () => {
  const { bets, mode } = usePanel();
  const [status, setStatus] = useState<StatusGroup>("all");
  const [kind, setKind] = useState("all");

  const shown = useMemo(() => filterBets(bets, { mode, status, kind }), [bets, mode, status, kind]);
  const kinds = useMemo(() => [...new Set(bets.map(kindOf))].sort(), [bets]);

  return (
    <div className="space-y-5">
      <PageHeader title="Bets" subtitle={`${shown.length} ${mode} bets`} withMode />

      <div className="space-y-2">
        <Chips current={status} onChange={setStatus} options={STATUS_GROUPS.map((value) => ({ value, label: STATUS_LABELS[value] }))} />
        <Chips
          current={kind}
          onChange={setKind}
          options={[{ value: "all", label: "All types" }, ...kinds.map((value) => ({ value, label: MARKET_KIND_LABELS[value] ?? value }))]}
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Bet</th>
              <th className="px-4 py-2 font-medium">Type</th>
              <th className="px-4 py-2 text-right font-medium">Stake</th>
              <th className="px-4 py-2 text-right font-medium">Price</th>
              <th className="px-4 py-2 text-right font-medium">Bot said</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 text-right font-medium">P&amp;L</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {shown.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted">
                  No bets match these filters.
                </td>
              </tr>
            )}
            {shown.map((bet) => (
              <tr key={bet.id} className="hover:bg-background">
                <td className="max-w-md px-4 py-2.5">
                  <Link href={`/bets/${bet.id}`} className="block truncate font-medium hover:underline">
                    {bet.eventTitle}
                  </Link>
                  <p className="truncate text-xs text-muted">
                    {bet.marketTitle !== bet.eventTitle ? `${bet.marketTitle} → ` : ""}
                    {bet.outcomeLabel} · {lagosDateTime(bet.createdAt)}
                  </p>
                </td>
                <td className="px-4 py-2.5 text-muted">{MARKET_KIND_LABELS[kindOf(bet)] ?? kindOf(bet)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{money(bet.stake)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{pct(bet.quotedPrice)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{pct(bet.probability)}</td>
                <td className={`px-4 py-2.5 capitalize ${STATUS_STYLE[bet.status] ?? ""}`}>{bet.status}</td>
                <td className={`px-4 py-2.5 text-right tabular-nums ${STATUS_STYLE[bet.status] ?? ""}`}>
                  {bet.pnl === null ? "–" : signedMoney(bet.pnl)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default BetsView;
