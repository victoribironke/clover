import type { Bet } from "@/db/bets.ts";
import { eventUrl } from "@/exchanges/links.ts";
import {
  EXCHANGE_LABELS,
  type Currency,
  type ExchangeName,
  type Wallet,
} from "@/exchanges/types.ts";
import type { ScanReport } from "@/jobs/scan.ts";
import { describeError } from "@/lib/errors.ts";
import type { DeepDive } from "@/research/deep-dive.ts";
import type { StudySummary } from "@/study/stats.ts";
import type { Bankroll } from "@/strategy/bankroll.ts";

export const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const FORMATS: Record<Currency, Intl.NumberFormat> = {
  NGN: new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }),
  USD: new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }),
};
// ₦1,234 on Bayse, $12.34 on Kalshi
export const money = (amount: number, currency: Currency = "NGN") =>
  FORMATS[currency].format(amount);

export const usd = (amount: number) => `$${amount.toFixed(amount < 1 ? 3 : 2)}`;

export const pct = (value: number, signed = false) => {
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

// Bold event title that opens the market on the exchange
export const eventLink = (exchange: ExchangeName, eventId: string, title: string) =>
  `<a href="${escapeHtml(eventUrl(exchange, eventId))}"><b>${escapeHtml(title)}</b></a>`;

export const betLink = (bet: Pick<Bet, "exchange" | "eventId" | "eventTitle">) =>
  eventLink(bet.exchange, bet.eventId, bet.eventTitle);

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
    betLink(bet),
    bet.marketTitle !== bet.eventTitle ? `Market: ${escapeHtml(bet.marketTitle)}` : null,
    `Pick: <b>${escapeHtml(bet.outcomeLabel)}</b>`,
    "",
    `Stake: <b>${money(bet.stake, bet.currency)}</b> at ${pct(bet.quotedPrice)} (market shows ${pct(bet.marketPrice)})`,
    `Our probability: <b>${pct(bet.probability)}</b> · confidence ${bet.confidence}`,
    `Expected return: <b>${pct(bet.expectedReturn, true)}</b> (≈ ${money(bet.stake * bet.expectedReturn, bet.currency)})`,
    `Pays ${money(bet.stake / bet.quotedPrice, bet.currency)} if it wins`,
    "",
    `<b>Latest data</b>\n📏 ${escapeHtml(research.reading)}`,
    "",
    `<b>Why</b>\n${escapeHtml(research.summary)}`,
    factors ? `\n<b>Key factors</b>\n${factors}` : null,
    sources ? `\n<b>Sources</b>\n${sources}` : null,
    "",
    research.costUsd > 0
      ? `<i>Research cost ${usd(research.costUsd)} · ${research.usage.searches} searches</i>`
      : `<i>Priced from data, no AI cost</i>`,
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

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

// ➖ Portugal vs Wales: Total Goals
// Portugal have scored in 9 straight home games…
// Closest: Over 2.5 goals → Yes · model 58% (medium) vs market 49%
// counted as 53.5%, costs 52.1% → +2.7% · fees and price impact eat the edge
const reviewedLines = ({
  exchange,
  eventId,
  title,
  summary,
  reading,
  proposed,
  nearMiss,
}: ScanReport["reviewed"][number]) => {
  const lines = [
    `${proposed ? "✅" : "➖"} ${eventLink(exchange, eventId, title)}`,
    `<i>${escapeHtml(clip(summary, 180))}</i>`,
    `📏 ${escapeHtml(clip(reading, 140))}`,
  ];
  if (proposed) {
    lines.push("Bet proposed, see above.");
  } else if (nearMiss) {
    const pick =
      nearMiss.marketTitle === title
        ? nearMiss.outcomeLabel
        : `${nearMiss.marketTitle} → ${nearMiss.outcomeLabel}`;
    lines.push(
      `Closest: ${escapeHtml(pick)} · model ${pct(nearMiss.modelProbability)} (${nearMiss.confidence}) vs market ${pct(nearMiss.marketPrice)}`,
      `counted as ${pct(nearMiss.probability)}, costs ${pct(nearMiss.price)} → ${pct(nearMiss.expectedReturn, true)} · ${escapeHtml(nearMiss.reason)}`,
    );
  } else {
    lines.push("No market in a tradeable price range.");
  }
  return lines.join("\n");
};

// Telegram messages stop at 4,096 characters, and a Kalshi scan checks ~100 events: list the
// bets and the closest misses, and count the rest
const MAX_REVIEWED = 8;

export const scanReportMessage = (report: ScanReport) => {
  const name = EXCHANGE_LABELS[report.exchange];
  if (report.skippedReason)
    return `⏸ <b>${name} scan skipped</b>\n${escapeHtml(report.skippedReason)}`;
  const lines = [
    `🔎 <b>${name} scan done</b>`,
    `${report.open} open · ${report.eligible} eligible · ${report.researched} researched · <b>${report.proposed} proposed</b>${report.placed ? ` · ${report.placed} placed` : ""}`,
  ];
  const ranked = [...report.reviewed].sort(
    (a, b) =>
      Number(b.proposed) - Number(a.proposed) ||
      (b.nearMiss?.expectedReturn ?? -Infinity) - (a.nearMiss?.expectedReturn ?? -Infinity),
  );
  const shown = ranked.slice(0, MAX_REVIEWED);
  if (shown.length > 0) lines.push("", "📋 <b>Researched</b>");
  for (const item of shown) lines.push("", reviewedLines(item));
  if (ranked.length > shown.length) {
    lines.push("", `<i>…and ${ranked.length - shown.length} more with less edge</i>`);
  }
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
  const pnl = bet.pnl !== null ? ` · P&L ${money(bet.pnl, bet.currency)}` : "";
  return `${icon[bet.status]} ${betLink(bet)} → <b>${escapeHtml(bet.outcomeLabel)}</b> · ${money(bet.stake, bet.currency)} · ${bet.status}${pnl}${tag(bet)}`;
};

// 📊 Late-price study: are prices near the end fair, which kinds void, and does trading after
// the measurement time pay?
export const studyMessage = (summary: StudySummary) => {
  if (summary.events === 0)
    return "📊 <b>Late-price study</b>\nNo data yet. The study job records settled markets every 6 hours.";
  const signed = (value: number) => `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)} pts`;
  const lines = [
    `📊 <b>Late-price study</b> · ${summary.events} markets since ${summary.since ? lagosTime(summary.since) : "?"}`,
    "",
    "<b>10 min before measurement: price → how often YES won</b>",
    ...summary.at10
      .filter((bucket) => bucket.n > 0)
      .map(
        (bucket) =>
          `${bucket.label}: ${bucket.n} · priced ${pct(bucket.avgPrice)} → won ${pct(bucket.winRate)}`,
      ),
    "<i>Won rate well above the price = late underpricing (the edge you spotted).</i>",
    "",
    "<b>By type</b> (voids · late gap)",
    ...summary.byKind.map(
      (row) =>
        `${escapeHtml(row.kind)}: ${row.voids}/${row.events} voided (${pct(row.events ? row.voids / row.events : 0)})` +
        (row.lateGap === null ? "" : ` · ${signed(row.lateGap)} over ${row.markets} mkts`),
    ),
  ];
  if (summary.lateOpen.n > 0) {
    lines.push(
      "",
      "<b>Still trading 15 min after measurement</b> (price 10-90%)",
      `${summary.lateOpen.n} markets · priced ${pct(summary.lateOpen.avgPrice)} → won ${pct(summary.lateOpen.winRate)}`,
    );
  }
  lines.push("", "<i>Needs a few hundred markets before it means much.</i>");
  return lines.join("\n");
};

export type DailySummary = {
  placed: Bet[];
  settled: Bet[];
  open: Bet[];
  bankroll: Bankroll;
  wallet: Wallet | null;
  spentUsd: number;
  deepDives: number;
  alerts: { at: string; text: string }[];
  // research spend and problems are shared by all exchanges: shown in the first summary only
  shared?: boolean;
};

const LIST_LIMIT = 8;
const more = (total: number) =>
  total > LIST_LIMIT ? [`<i>…and ${total - LIST_LIMIT} more</i>`] : [];
const sum = (bets: Bet[], pick: (bet: Bet) => number) =>
  bets.reduce((total, bet) => total + pick(bet), 0);
const signedMoney = (amount: number, currency: Currency) =>
  `${amount > 0 ? "+" : ""}${money(amount, currency)}`;

// 📒 The last 24 hours in one message, for quiet mode
export const dailySummaryMessage = ({
  placed,
  settled,
  open,
  bankroll,
  wallet,
  spentUsd,
  deepDives,
  alerts,
  shared = true,
}: DailySummary) => {
  const won = settled.filter((bet) => bet.status === "won");
  const lost = settled.filter((bet) => bet.status === "lost");
  const voided = settled.filter((bet) => bet.status === "void");
  const dayPnl = sum(settled, (bet) => bet.pnl ?? 0);
  const c = bankroll.currency;
  const icon = (bet: Bet) => (bet.status === "won" ? "🏆" : bet.status === "lost" ? "❌" : "↩️");

  const lines = [
    `📒 <b>${EXCHANGE_LABELS[bankroll.exchange]} daily summary</b> · last 24 hours${bankroll.dryRun ? " <i>(paper)</i>" : ""}`,
    "",
  ];

  lines.push(
    `<b>Placed:</b> ${placed.length} bets · ${money(
      sum(placed, (bet) => bet.stake),
      c,
    )} staked`,
  );
  for (const bet of placed.slice(0, LIST_LIMIT)) {
    lines.push(
      `• ${betLink(bet)} → ${escapeHtml(bet.outcomeLabel)} · ${money(bet.stake, c)} at ${pct(bet.fillPrice ?? bet.quotedPrice)}`,
    );
  }
  lines.push(...more(placed.length), "");

  lines.push(
    `<b>Settled:</b> ${won.length} won · ${lost.length} lost · ${voided.length} void · P&L <b>${signedMoney(dayPnl, c)}</b>`,
  );
  for (const bet of settled.slice(0, LIST_LIMIT)) {
    lines.push(
      `${icon(bet)} ${betLink(bet)} → ${escapeHtml(bet.outcomeLabel)} · ${bet.status === "void" ? "refunded" : signedMoney(bet.pnl ?? 0, c)}`,
    );
  }
  lines.push(...more(settled.length), "");

  lines.push(
    `<b>Open:</b> ${open.length} bets · ${money(
      sum(open, (bet) => bet.stake),
      c,
    )} in play`,
    `<b>Realized P&L:</b> ${signedMoney(bankroll.realizedPnl, c)} · withdrawable <b>${money(bankroll.withdrawable, c)}</b>`,
    wallet
      ? `<b>${EXCHANGE_LABELS[bankroll.exchange]} wallet:</b> ${money(wallet.available, c)}`
      : bankroll.exchange !== "bayse"
        ? `<b>${EXCHANGE_LABELS[bankroll.exchange]} wallet:</b> <i>no account connected (paper only)</i>`
        : "<b>Bayse wallet:</b> <i>couldn't read it</i>",
  );
  if (shared) lines.push(`<b>Research:</b> ${deepDives} AI deep dives · ${usd(spentUsd)} today`);

  if (alerts.length > 0) {
    lines.push("", `⚠️ <b>${alerts.length} problem${alerts.length === 1 ? "" : "s"}</b>`);
    for (const alert of alerts.slice(0, LIST_LIMIT)) lines.push(`• ${escapeHtml(alert.text)}`);
    lines.push(...more(alerts.length));
  }
  return lines.join("\n");
};

export type Spend = { today: number; month: number; dailyBudget: number };

// The real exchange wallet, next to the bot's own numbers. Capital is a ceiling, not the balance:
// the bot never works with more than capital, whatever the wallet holds.
const walletLines = (wallet: Wallet | null, bankroll: Bankroll) => {
  const name = EXCHANGE_LABELS[bankroll.exchange];
  if (!wallet)
    return [
      bankroll.exchange !== "bayse"
        ? `${name} wallet: <i>no account connected (paper only)</i>`
        : `${name} wallet: <i>couldn't read it right now</i>`,
    ];
  const pending =
    wallet.pending > 0 ? ` (+${money(wallet.pending, bankroll.currency)} pending)` : "";
  const lines = [`${name} wallet: <b>${money(wallet.available, bankroll.currency)}</b>${pending}`];
  if (bankroll.dryRun) {
    lines.push("<i>Real money, untouched while paper trading.</i>");
  } else if (wallet.available + bankroll.exposure < bankroll.capital) {
    lines.push(
      `⚠️ Wallet plus money in play is below the ${money(bankroll.capital, bankroll.currency)} capital: the bot works with what's there.`,
    );
  } else {
    lines.push(
      `${money(Math.max(0, wallet.available + bankroll.exposure - bankroll.capital), bankroll.currency)} of it sits outside the bot's capital.`,
    );
  }
  return lines;
};

export const bankrollMessage = (
  bankroll: Bankroll,
  paused: boolean,
  spend: Spend,
  wallet: Wallet | null,
) =>
  [
    `<b>${EXCHANGE_LABELS[bankroll.exchange]}</b> ${bankroll.dryRun ? "📝 paper trading" : "💸 live"}${paused ? " · ⏸ paused" : ""}`,
    `Capital (ceiling): ${money(bankroll.capital, bankroll.currency)}`,
    `Working bankroll: ${money(bankroll.bankroll, bankroll.currency)}`,
    `In play: ${money(bankroll.exposure, bankroll.currency)}`,
    `Free to bet: ${money(bankroll.deployable, bankroll.currency)}`,
    `Realized P&L: ${money(bankroll.realizedPnl, bankroll.currency)}`,
    `Withdrawable profit: <b>${money(bankroll.withdrawable, bankroll.currency)}</b>`,
    "",
    ...walletLines(wallet, bankroll),
    "",
    `Research spend: ${usd(spend.today)} today (budget ${usd(spend.dailyBudget)}) · ${usd(spend.month)} this month`,
  ].join("\n");
