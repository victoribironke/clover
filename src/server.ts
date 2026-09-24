import { webhookCallback } from "grammy";
import { config } from "@/config.ts";
import { exchange } from "@/exchanges/index.ts";
import { runScan } from "@/jobs/scan.ts";
import { runTick } from "@/jobs/tick.ts";
import { errorMessage, log } from "@/lib/logger.ts";
import { bot } from "@/telegram/bot.ts";

const authorizedCron = (request: Request) =>
  request.headers.get("authorization") === `Bearer ${config.CRON_SECRET}`;

const telegramWebhook =
  config.TELEGRAM_MODE === "webhook"
    ? webhookCallback(bot, "std/http", { secretToken: config.TELEGRAM_WEBHOOK_SECRET })
    : null;

const runJob = async (name: string, job: () => Promise<unknown>) => {
  try {
    const result = await job();
    log.info(`${name} finished`, { result });
    return Response.json(result);
  } catch (error) {
    log.error(`${name} failed`, { error: errorMessage(error) });
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
};

// Cloud Scheduler hits /jobs/scan and /jobs/tick; Telegram hits /telegram in webhook mode
export const startServer = () =>
  Bun.serve({
    port: config.PORT,
    // scans run deep research and can take many minutes
    idleTimeout: 0,
    routes: {
      "/health": () => Response.json({ ok: true }),
      "/telegram": {
        POST: (request) => (telegramWebhook ? telegramWebhook(request) : new Response("polling mode", { status: 404 })),
      },
      "/jobs/scan": {
        POST: (request) =>
          authorizedCron(request) ? runJob("scan", () => runScan(exchange)) : new Response("unauthorized", { status: 401 }),
      },
      "/jobs/tick": {
        POST: (request) =>
          authorizedCron(request) ? runJob("tick", () => runTick(exchange)) : new Response("unauthorized", { status: 401 }),
      },
    },
    fetch: () => new Response("not found", { status: 404 }),
  });
