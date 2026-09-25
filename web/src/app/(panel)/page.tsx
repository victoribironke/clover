import Link from "next/link";
import BankrollChart from "@/components/bankroll-chart";
import StatCard from "@/components/stat-card";
import { loadBets, loadBotSettings, loadSpend } from "@/lib/data";
import { bayseEventUrl, lagosDateTime, money, pct, signedMoney, usd } from "@/lib/format";
import { buildOverview } from "@/lib/overview";

const RESULT_STYLE: Record<string, string> = { won: "text-gain", lost: "text-loss", void: "text-muted" };

const OverviewPage = async ({ searchParams }: PageProps<"/">) => {
  const [bets, botSettings, spend] = await Promise.all([loadBets(), loadBotSettings(), loadSpend()]);
  const { mode: requested } = await searchParams;
  // default to what the bot is doing now; ?mode= switches between the paper and live records
  const mode = requested === "live" || requested === "paper" ? requested : botSettings.dryRun ? "paper" : "live";
  const overview = buildOverview(bets, botSettings, spend, mode);

  const recent = bets
    .filter((bet) => bet.dryRun === (mode === "paper") && ["won", "lost", "void"].includes(bet.status))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 10);

  const tone = (value: number) => (value > 0 ? "gain" : value < 0 ? "loss" : "neutral");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Overview</h1>
          <p className="text-sm text-muted">
            The bot is {botSettings.dryRun ? "📝 paper trading" : "💸 live"}. Showing the {mode} record.
          </p>
        </div>
        <div className="flex rounded-lg border border-border bg-card p-1 text-sm">
          {(["paper", "live"] as const).map((option) => (
            <Link
              key={option}
              href={`/?mode=${option}`}
              className={`rounded-md px-3 py-1 capitalize ${option === mode ? "bg-foreground text-background" : "text-muted"}`}
            >
              {option}
            </Link>
          ))}
        </div>
      </div>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Realized P&L" value={signedMoney(overview.realizedPnl)} tone={tone(overview.realizedPnl)} hint={`on ${money(overview.staked)} staked`} />
        <StatCard label="Withdrawable" value={money(overview.withdrawable)} hint={`capital ${money(overview.capital)}`} />
        <StatCard label="Win rate" value={pct(overview.winRate)} hint={`${overview.won} won · ${overview.lost} lost · ${overview.voided} void`} />
        <StatCard label="Return on stakes" value={pct(overview.roi)} tone={tone(overview.roi ?? 0)} hint="P&L ÷ amount staked" />
        <StatCard label="Working bankroll" value={money(overview.workingBankroll)} hint="capital, or less after losses" />
        <StatCard label="In play" value={money(overview.inPlay)} hint={`${overview.openBets} open bets`} />
        <StatCard label="Research this month" value={usd(overview.researchSpendMonthUsd)} hint={`${usd(overview.researchSpendUsd)} all time`} />
        <StatCard label="Settled bets" value={String(overview.settledBets)} />
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
                  <a href={bayseEventUrl(bet.eventId)} target="_blank" rel="noreferrer" className="block truncate font-medium hover:underline">
                    {bet.eventTitle}
                  </a>
                  <p className="truncate text-xs text-muted">
                    {bet.marketTitle !== bet.eventTitle ? `${bet.marketTitle} → ` : ""}
                    {bet.outcomeLabel} · {money(bet.stake)} at {pct(bet.quotedPrice)} · {bet.kind ?? "unclassified"} · {lagosDateTime(bet.updatedAt)}
                  </p>
                </div>
                <span className={`shrink-0 font-medium tabular-nums ${RESULT_STYLE[bet.status] ?? ""}`}>
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

export default OverviewPage;
