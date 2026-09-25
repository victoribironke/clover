"use client";

import Link from "next/link";
import { useMemo } from "react";
import BankrollChart from "@/components/bankroll-chart";
import PageHeader from "@/components/page-header";
import { usePanel } from "@/components/panel-provider";
import StatCard from "@/components/stat-card";
import { lagosDateTime, money, pct, signedMoney, usd } from "@/lib/format";
import { STATUS_STYLE } from "@/lib/labels";
import { buildOverview } from "@/lib/overview";

const tone = (value: number) => (value > 0 ? "gain" : value < 0 ? "loss" : "neutral");

const OverviewView = () => {
  const { bets, botSettings, spend, wallet, mode, fetchedAt } = usePanel();
  const overview = useMemo(() => buildOverview(bets, botSettings, spend, mode, new Date(fetchedAt)), [bets, botSettings, spend, mode, fetchedAt]);

  const recent = useMemo(
    () =>
      bets
        .filter((bet) => bet.dryRun === (mode === "paper") && ["won", "lost", "void"].includes(bet.status))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 10),
    [bets, mode],
  );

  // the real Bayse wallet; capital is only the ceiling the bot works within
  const walletHint = !wallet
    ? "not recorded yet"
    : botSettings.dryRun
      ? "real money, untouched while paper trading"
      : wallet.available + overview.inPlay < overview.capital
        ? `⚠️ below the ${money(overview.capital)} capital`
        : `${money(Math.max(0, wallet.available + overview.inPlay - overview.capital))} outside the bot's capital`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        subtitle={`The bot is ${botSettings.dryRun ? "📝 paper trading" : "💸 live"}. Showing the ${mode} record.`}
        withMode
      />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Realized P&L" value={signedMoney(overview.realizedPnl)} tone={tone(overview.realizedPnl)} hint={`on ${money(overview.staked)} staked`} />
        <StatCard label="Withdrawable" value={money(overview.withdrawable)} hint={`capital ${money(overview.capital)}`} />
        <StatCard label="Win rate" value={pct(overview.winRate)} hint={`${overview.won} won · ${overview.lost} lost · ${overview.voided} void`} />
        <StatCard label="Return on stakes" value={pct(overview.roi)} tone={tone(overview.roi ?? 0)} hint="P&L ÷ amount staked" />
        <StatCard label="Working bankroll" value={money(overview.workingBankroll)} hint="capital, or less after losses" />
        <StatCard label="In play" value={money(overview.inPlay)} hint={`${overview.openBets} open bets`} />
        <StatCard label="Research this month" value={usd(overview.researchSpendMonthUsd)} hint={`${usd(overview.researchSpendUsd)} all time`} />
        <StatCard label="Bayse wallet" value={wallet ? money(wallet.available) : "–"} hint={walletHint} tone={walletHint.startsWith("⚠️") ? "loss" : "neutral"} />
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-2 text-sm font-medium">Bankroll</h2>
        <BankrollChart points={overview.curve} capital={overview.capital} />
      </section>

      <section className="rounded-xl border border-border bg-card">
        <h2 className="border-b border-border px-4 py-3 text-sm font-medium">Recent results</h2>
        {recent.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">No settled {mode} bets yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {recent.map((bet) => (
              <li key={bet.id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <Link href={`/bets/${bet.id}`} className="block truncate font-medium hover:underline">
                    {bet.eventTitle}
                  </Link>
                  <p className="truncate text-xs text-muted">
                    {bet.marketTitle !== bet.eventTitle ? `${bet.marketTitle} → ` : ""}
                    {bet.outcomeLabel} · {money(bet.stake)} at {pct(bet.quotedPrice)} · {bet.kind ?? "unclassified"} · {lagosDateTime(bet.updatedAt)}
                  </p>
                </div>
                <span className={`shrink-0 font-medium tabular-nums ${STATUS_STYLE[bet.status] ?? ""}`}>
                  {bet.status === "void" ? "void" : signedMoney(bet.pnl ?? 0)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

export default OverviewView;
