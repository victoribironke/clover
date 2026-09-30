import { InlineKeyboard } from "grammy";
import { config } from "@/config.ts";
import { recordAlert } from "@/db/alerts.ts";
import { errorMessage, log } from "@/lib/logger.ts";
import { settings } from "@/settings.ts";
import { bot } from "./bot.ts";
import { splitMessage } from "./split.ts";

export const betKeyboard = (betId: string) =>
  new InlineKeyboard().text("❌ Cancel", `cancel:${betId}`).text("✅ Place now", `now:${betId}`);

// info:   routine news (new bet, placed, settled). Dropped in quiet mode; the daily summary covers it.
// alert:  something went wrong (failed scan or order, interrupted work). Saved for the daily summary
//         in quiet mode, sent at once otherwise.
// always: sent even in quiet mode (your own /scan, the daily summary).
export type NotifyLevel = "info" | "alert" | "always";

type NotifyOptions = { level?: NotifyLevel; keyboard?: InlineKeyboard };

// Returns the first message's id (the one with the buttons)
const send = async (html: string, keyboard?: InlineKeyboard) => {
  let firstId: number | null = null;
  for (const [index, part] of splitMessage(html).entries()) {
    try {
      const message = await bot.api.sendMessage(config.TELEGRAM_CHAT_ID, part, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        reply_markup: index === 0 ? keyboard : undefined,
      });
      firstId ??= message.message_id;
    } catch (error) {
      log.error("telegram send failed", { error: errorMessage(error), part: index });
    }
  }
  return firstId;
};

// Returns the Telegram message id when a message was actually sent
export const notify = async (html: string, { level = "info", keyboard }: NotifyOptions = {}) => {
  if (!settings.quiet || level === "always") return send(html, keyboard);
  if (level === "alert") {
    await recordAlert(html).catch((error) =>
      log.error("couldn't save alert for the summary", { error: errorMessage(error) }),
    );
  }
  return null;
};

// Drop the Cancel/Place buttons once a bet is no longer pending
export const clearButtons = async (messageId: number | null) => {
  if (!messageId) return;
  try {
    await bot.api.editMessageReplyMarkup(config.TELEGRAM_CHAT_ID, messageId, {
      reply_markup: undefined,
    });
  } catch {
    // message too old or already edited; nothing to do
  }
};
