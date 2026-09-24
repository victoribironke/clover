import type { Bet } from "@/db/bets.ts";
import type { ScanReport } from "@/jobs/scan.ts";
import { describeError } from "@/lib/errors.ts";
import type { DeepDive } from "@/research/deep-dive.ts";
import type { Bankroll } from "@/strategy/bankroll.ts";

export const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const naira = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });
export const money = (amount: number) => naira.format(amount);

export const usd = (amount: number) => `$${amount.toFixed(amount < 1 ? 3 : 2)}`;

export const pct =(value: number, signed = false) => {
  const text = `${(value * 100).toFixed(1)}%`;
  return signed && value > 0 ? `+${text}` : text;
};

export const lagosTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    timeZone: "Africa/Lagos",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    day: "numeric",
    month: "short",
  });

const tag = (bet: Pick<Bet, "dryRun">) => (bet.dryRun ? " <i>(paper)</i>" : "");

export const proposalMessage = (bet: Bet, research: DeepDive) => {
  const sources = research.sources
    .slice(0, 4)
    .map((source) => `• <a href="${escapeHtml(source.url)}">${escapeHtml(source.title)}</a>`)
    .join("\n");
  const factors = research.keyFactors
    .slice(0, 5)
    .map((factor) => `• ${escapeHtml(factor)}`)
    .join("\n");

  return [
    `🎯 <b>New bet</b>${tag(bet)}`,
    `<b>${escapeHtml(bet.eventTitle)}</b>`,
    bet.marketTitle !== bet.eventTitle ? `Market: ${escapeHtml(bet.marketTitle)}` : null,
    `Pick: <b>${escapeHtml(bet.outcomeLabel)}</b>`,
    "",
    `Stake: <b>${money(bet.stake)}</b> at ${pct(bet.quotedPrice)} (market shows ${pct(bet.marketPrice)})`,
    `Our probability: <b>${pct(bet.probability)}</b> · confidence ${bet.confidence}`,
    `Expected return: <b>${pct(bet.expectedReturn, true)}</b> (≈ ${money(bet.stake * bet.expectedReturn)})`,
    `Pays ${money(bet.stake / bet.quotedPrice)} if it wins`,
    "",
    `<b>Why</b>\n${escapeHtml(research.summary)}`,
    factors ? `\n<b>Key factors</b>\n${factors}` : null,
    sources ? `\n<b>Sources</b>\n${sources}` : null,
    "",
    `<i>Research cost ${usd(research.costUsd)} · ${research.usage.searches} searches</i>`,
    `⏳ Places ${lagosTime(bet.executeAt)} WAT unless you cancel.`,
  ]
    .filter((line) => line !== null)
    .join("\n");
};

// ⚠️ Scan failed
// Gemini · 400 INVALID_ARGUMENT
// Thinking level MINIMAL is not supported for this model.
export const failureMessage = (title: string, error: unknown) => {
  const { source, code, message } = describeError(error);
  return `⚠️ <b>${escapeHtml(title)}</b>\n${escapeHtml(source)}${code ? ` · <code>${escapeHtml(code)}</code>` : ""}\n<i>${escapeHtml(message.slice(0, 500))}</i>`;
};

const oneLineError = (error: unknown) => {
  const { source, code, message } = describeError(error);
  return `${escapeHtml(source)}${code ? ` ${escapeHtml(code)}` : ""}: ${escapeHtml(message.slice(0, 160))}`;
};

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// ➖ Portugal vs Wales: Total Goals
// Portugal have scored in 9 straight home games…
// Closest: Over 2.5 goals → Yes · Gemini 58% (medium) vs market 49%
// counted as 53.5%, costs 52.1% → +2.7% · fees and price impact eat the edge
const reviewedLines = ({ title, summary, proposed, nearMiss }: ScanReport["reviewed"][number]) => {
  const lines = [`${proposed ? "✅" : "➖"} <b>${escapeHtml(title)}</b>`, `<i>${escapeHtml(clip(summary, 180))}</i>`];
  if (proposed) {
    lines.push("Bet proposed, see above.");
  } else if (nearMiss) {
    const pick = nearMiss.marketTitle === title ? nearMiss.outcomeLabel : `${nearMiss.marketTitle} → ${nearMiss.outcomeLabel}`;
    lines.push(
      `Closest: ${escapeHtml(pick)} · Gemini ${pct(nearMiss.modelProbability)} (${nearMiss.confidence}) vs market ${pct(nearMiss.marketPrice)}`,
      `counted as ${pct(nearMiss.probability)}, costs ${pct(nearMiss.price)} → ${pct(nearMiss.expectedReturn, true)} · ${escapeHtml(nearMiss.reason)}`,
    );
  } else {
    lines.push("No market in a tradeable price range.");
  }
  return lines.join("\n");
};

export const scanReportMessage = (report: ScanReport) => {
  if (report.skippedReason) return `⏸ <b>Scan skipped</b>\n${escapeHtml(report.skippedReason)}`;
  const lines = [
    `🔎 <b>Scan done</b>`,
    `${report.open} open · ${report.eligible} eligible · ${report.researched} researched · <b>${report.proposed} proposed</b>`,
  ];
  if (report.reviewed.length > 0) lines.push("", "📋 <b>Researched</b>");
  for (const item of report.reviewed) lines.push("", reviewedLines(item));
  if (report.failed.length > 0) {
    lines.push("", `⚠️ <b>${report.failed.length} failed</b>`);
    for (const { title, error } of report.failed.slice(0, 5)) {
      lines.push(`• ${escapeHtml(title)}\n  <i>${oneLineError(error)}</i>`);
    }
  }
  return lines.join("\n");
};

export const statusLine = (bet: Bet) => {
  const icon: Record<Bet["status"], string> = {
    pending: "⏳",
    placing: "🔄",
    placed: "✅",
    won: "🏆",
    lost: "❌",
    void: "↩️",
    cancelled: "🚫",
    skipped: "⏭️",
    failed: "⚠️",
  };
  const pnl = bet.pnl !== null ? ` · P&L ${money(bet.pnl)}` : "";
  return `${icon[bet.status]} ${escapeHtml(bet.eventTitle)} → <b>${escapeHtml(bet.outcomeLabel)}</b> · ${money(bet.stake)} · ${bet.status}${pnl}${tag(bet)}`;
};

export type Spend = { today: number; month: number; dailyBudget: number };

export const bankrollMessage = (bankroll: Bankroll, paused: boolean, spend: Spend) =>
  [
    `<b>Clover</b> ${bankroll.dryRun ? "📝 paper trading" : "💸 live"}${paused ? " · ⏸ paused" : ""}`,
    `Capital: ${money(bankroll.capital)}`,
    `Working bankroll: ${money(bankroll.bankroll)}`,
    `In play: ${money(bankroll.exposure)}`,
    `Free to bet: ${money(bankroll.deployable)}`,
    `Realized P&L: ${money(bankroll.realizedPnl)}`,
    `Withdrawable profit: <b>${money(bankroll.withdrawable)}</b>`,
    `Research spend: ${usd(spend.today)} today (budget ${usd(spend.dailyBudget)}) · ${usd(spend.month)} this month`,
  ].join("\n");
