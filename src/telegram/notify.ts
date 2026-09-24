import { InlineKeyboard } from "grammy";
import { config } from "@/config.ts";
import { errorMessage, log } from "@/lib/logger.ts";
import { bot } from "./bot.ts";

export const betKeyboard = (betId: string) =>
  new InlineKeyboard().text("❌ Cancel", `cancel:${betId}`).text("✅ Place now", `now:${betId}`);

export const notify = async (html: string, keyboard?: InlineKeyboard) => {
  try {
    const message = await bot.api.sendMessage(config.TELEGRAM_CHAT_ID, html, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: keyboard,
    });
    return message.message_id;
  } catch (error) {
    log.error("telegram send failed", { error: errorMessage(error) });
    return null;
  }
};

// Drop the Cancel/Place buttons once a bet is no longer pending
export const clearButtons = async (messageId: number | null) => {
  if (!messageId) return;
  try {
    await bot.api.editMessageReplyMarkup(config.TELEGRAM_CHAT_ID, messageId, { reply_markup: undefined });
  } catch {
    // message too old or already edited; nothing to do
  }
};
