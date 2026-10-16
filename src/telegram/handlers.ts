import { config } from "@/config.ts";
import { ALL_STATUSES, betTotalsFromBets, getBet, listBets, updateBet } from "@/db/bets.ts";
import { isPaused, setPaused } from "@/db/kv.ts";
import { spendThisMonth, spendToday } from "@/db/spend.ts";
import { exchanges, getExchange, isDryRun } from "@/exchanges/index.ts";
import { EXCHANGE_LABELS } from "@/exchanges/types.ts";
import { executeBet } from "@/jobs/execute.ts";
import { runScanAndReport } from "@/jobs/scan.ts";
import { loadStudies } from "@/jobs/study.ts";
import { buildDailySummaries } from "@/jobs/summary.ts";
import { errorMessage, log } from "@/lib/logger.ts";
import { selfOrigin } from "@/lib/self.ts";
import { within } from "@/lib/within.ts";
import { settings } from "@/settings.ts";
import { getBankroll } from "@/strategy/bankroll.ts";
import { summarize } from "@/study/stats.ts";
import { bot } from "./bot.ts";
import { bankrollMessage, failureMessage, statusLine, studyMessage } from "./format.ts";
import { notify } from "./notify.ts";
import { resultsMessage } from "./results.ts";

const labels = exchanges.map((exchange) => EXCHANGE_LABELS[exchange.name]);
const HELP = `<b>Clover</b> trades daily temperature markets on ${labels.slice(0, -1).join(", ")}${labels.length > 1 ? " and " : ""}${labels.at(-1) ?? ""}, betting where the data gives it an edge.
${
  settings.quiet
    ? "🔕 Muted: bets are placed without messages, and a summary arrives daily at 23:30."
    : `Every bet is announced first. You have ${settings.cancelWindowMinutes} minutes to cancel it before it's placed.`
}

/status: bankroll and profit, per exchange
/summary: the last 24 hours (also sent daily at 23:30)
/results: all-time results by market type, and how accurate the bot's odds are
/bets: pending and open bets
/scan: run a scan now, on every exchange
/study: how Bayse prices behave near the end, and void rates by type
/pause: stop scanning and placing
/resume: start again`;

// a live wallet read may take this long before /status answers without it (Bayse was slow on
// 2026-10-09 and held the whole reply up)
const WALLET_WAIT_MS = 5_000;

export const registerHandlers = () => {
  bot.command(["start", "help"], (ctx) => ctx.reply(HELP, { parse_mode: "HTML" }));

  // One reply with a section per exchange, each in its own currency.
  bot.command("status", async (ctx) => {
    const [paused, today, month, bets] = await Promise.all([
      isPaused(),
      spendToday(),
      spendThisMonth(),
      listBets(ALL_STATUSES, 10_000),
    ]);
    const spend = { today, month, dailyBudget: settings.dailyResearchBudgetUsd };
    const messages = await Promise.all(
      exchanges.map(async (exchange) => {
        const [bankroll, wallet] = await Promise.all([
          getBankroll(exchange, betTotalsFromBets(bets, exchange.name, isDryRun(exchange))),
          // read live; an exchange hiccup shouldn't stop /status from answering
          exchange.canTrade ? within(exchange.getWallet(), WALLET_WAIT_MS, null) : Promise.resolve(null),
        ]);
        return bankrollMessage(bankroll, paused, spend, wallet);
      }),
    );
    await ctx.reply(messages.join("\n\n"), { parse_mode: "HTML" });
  });

  bot.command("summary", async (ctx) => {
    for (const message of await buildDailySummaries(exchanges)) {
      await ctx.reply(message, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      });
    }
  });

  // one message per exchange: the record it's running now (paper while dryRun, live after)
  bot.command("results", async (ctx) => {
    const bets = await listBets(ALL_STATUSES, 10_000);
    for (const exchange of exchanges) {
      await ctx.reply(resultsMessage(exchange.name, exchange.currency, isDryRun(exchange), bets), {
        parse_mode: "HTML",
      });
    }
  });

  bot.command("study", async (ctx) => {
    // the late-price study only covers Bayse
    await ctx.reply(studyMessage(summarize(await loadStudies())), { parse_mode: "HTML" });
  });

  bot.command("bets", async (ctx) => {
    const bets = await listBets(["pending", "placing", "placed"], 30);
    const text = bets.length ? bets.map(statusLine).join("\n") : "No open bets.";
    // one tappable link per bet; previews would just show the first market
    await ctx.reply(text, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  });

  bot.command("pause", async (ctx) => {
    await setPaused(true);
    await ctx.reply("⏸ Paused. No scans, and pending bets won't be placed until you /resume.");
  });

  bot.command("resume", async (ctx) => {
    await setPaused(false);
    await ctx.reply("▶️ Resumed.");
  });

  bot.command("scan", async (ctx) => {
    await ctx.reply("🔎 Scanning. I'll message you with anything worth betting on.");
    // A scan takes minutes and the webhook must answer quickly, so it's not awaited here.
    // On Cloud Run it goes through our own /jobs/scan: CPU is only on during a request, and that
    // request stays open for the whole scan. One request runs every exchange side by side
    // (?exchange=all), and each exchange reports its own result.
    const origin = selfOrigin();
    if (config.onCloudRun && origin) {
      void fetch(`${origin}/jobs/scan?manual=1&exchange=all`, {
        method: "POST",
        headers: { authorization: `Bearer ${config.APP_SECRET}` },
      }).catch((error) =>
        notify(failureMessage("Couldn't start the scan", error), { level: "always" }),
      );
    } else {
      for (const exchange of exchanges) {
        void runScanAndReport(exchange, { force: true, announce: true }).catch(() => {});
      }
    }
  });

  bot.callbackQuery(/^cancel:(.+)$/, async (ctx) => {
    const betId = ctx.match[1]!;
    const cancelled = await updateBet(betId, { status: "cancelled" }, ["pending"]);
    await ctx.answerCallbackQuery(cancelled ? "Cancelled" : "Too late, it's no longer pending");
    if (cancelled) {
      await ctx.editMessageReplyMarkup({ reply_markup: undefined });
      await ctx.reply("🚫 Bet cancelled.", {
        reply_parameters: { message_id: ctx.callbackQuery.message!.message_id },
      });
    }
  });

  bot.callbackQuery(/^now:(.+)$/, async (ctx) => {
    const bet = await getBet(ctx.match[1]!);
    if (bet?.status !== "pending") {
      await ctx.answerCallbackQuery("It's no longer pending");
      return;
    }
    await ctx.answerCallbackQuery("Placing…");
    await executeBet(getExchange(bet.exchange), bet);
  });

  bot.catch((error) => log.error("telegram handler failed", { error: errorMessage(error.error) }));
};
