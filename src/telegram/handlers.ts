import { config } from "@/config.ts";
import { getBet, listBets, updateBet } from "@/db/bets.ts";
import { isPaused, setPaused } from "@/db/kv.ts";
import { spendThisMonth, spendToday } from "@/db/spend.ts";
import { exchange } from "@/exchanges/index.ts";
import { executeBet } from "@/jobs/execute.ts";
import { runScan } from "@/jobs/scan.ts";
import { errorMessage, log } from "@/lib/logger.ts";
import { settings } from "@/settings.ts";
import { getBankroll } from "@/strategy/bankroll.ts";
import { bot } from "./bot.ts";
import { bankrollMessage, escapeHtml, statusLine } from "./format.ts";
import { notify } from "./notify.ts";

const HELP = `<b>Clover</b> scans Bayse for open markets, researches them, and bets where it finds an edge.
Every bet is announced first. You have ${settings.cancelWindowMinutes} minutes to cancel it before it's placed.

/status: bankroll and profit
/bets: pending and open bets
/scan: run a scan now
/pause: stop scanning and placing
/resume: start again`;

export const registerHandlers = () => {
  bot.command(["start", "help"], (ctx) => ctx.reply(HELP, { parse_mode: "HTML" }));

  bot.command("status", async (ctx) => {
    const [bankroll, paused, today, month] = await Promise.all([
      getBankroll(exchange),
      isPaused(),
      spendToday(),
      spendThisMonth(),
    ]);
    const spend = { today, month, dailyBudget: settings.dailyResearchBudgetUsd };
    await ctx.reply(bankrollMessage(bankroll, paused, spend), { parse_mode: "HTML" });
  });

  bot.command("bets", async (ctx) => {
    const bets = await listBets(["pending", "placing", "placed"], 30);
    const text = bets.length ? bets.map(statusLine).join("\n") : "No open bets.";
    await ctx.reply(text, { parse_mode: "HTML" });
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
    // not awaited: a scan takes minutes and the webhook must answer quickly
    void runScan(exchange, { force: true })
      .then((report) =>
        notify(
          report.skippedReason
            ? `Scan skipped: ${escapeHtml(report.skippedReason)}`
            : `Scan done: ${report.open} open, ${report.eligible} eligible, ${report.researched} researched, ${report.proposed} proposed.`,
        ),
      )
      .catch((error) => notify(`⚠️ Scan failed: ${escapeHtml(errorMessage(error))}`));
  });

  bot.callbackQuery(/^cancel:(.+)$/, async (ctx) => {
    const betId = ctx.match[1]!;
    const cancelled = await updateBet(betId, { status: "cancelled" }, ["pending"]);
    await ctx.answerCallbackQuery(cancelled ? "Cancelled" : "Too late, it's no longer pending");
    if (cancelled) {
      await ctx.editMessageReplyMarkup({ reply_markup: undefined });
      await ctx.reply("🚫 Bet cancelled.", { reply_parameters: { message_id: ctx.callbackQuery.message!.message_id } });
    }
  });

  bot.callbackQuery(/^now:(.+)$/, async (ctx) => {
    const bet = await getBet(ctx.match[1]!);
    if (bet?.status !== "pending") {
      await ctx.answerCallbackQuery("It's no longer pending");
      return;
    }
    await ctx.answerCallbackQuery("Placing…");
    await executeBet(exchange, bet);
  });

  bot.catch((error) => log.error("telegram handler failed", { error: errorMessage(error.error) }));
};
