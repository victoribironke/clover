import { Bot } from "grammy";
import { config } from "@/config.ts";

export const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

// Only the owner's chat may drive the bot; everyone else is silently ignored
bot.use(async (ctx, next) => {
  if (ctx.chat?.id !== config.TELEGRAM_CHAT_ID) return;
  await next();
});
