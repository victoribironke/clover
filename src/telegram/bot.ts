import { Bot } from "grammy";
import { config } from "@/config.ts";

export const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

// Telegram resends an update until the webhook answers in time. On 2026-10-09 a slow Bayse
// wallet read made /status miss grammY's limit, and each resend ran the command again: the reply
// came 15 times over 20 minutes. Each update is now handled once. There's one instance
// (--max-instances=1), so memory is enough; a restart only forgets the last few minutes.
const seen = new Set<number>();
const SEEN_LIMIT = 1000;

export const firstDelivery = (updateId: number) => {
  if (seen.has(updateId)) return false;
  seen.add(updateId);
  if (seen.size > SEEN_LIMIT) seen.delete(seen.values().next().value!);
  return true;
};

bot.use(async (ctx, next) => {
  if (!firstDelivery(ctx.update.update_id)) return;
  await next();
});

// Only the owner's chat may drive the bot; everyone else is silently ignored
bot.use(async (ctx, next) => {
  if (ctx.chat?.id !== config.TELEGRAM_CHAT_ID) return;
  await next();
});
