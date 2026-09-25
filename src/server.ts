import { webhookCallback } from "grammy";
import { config } from "@/config.ts";
import { exchange } from "@/exchanges/index.ts";
import { runScanAndReport } from "@/jobs/scan.ts";
import { runStudy } from "@/jobs/study.ts";
import { runTick } from "@/jobs/tick.ts";
import { errorMessage, log } from "@/lib/logger.ts";
import { proxyToPanel } from "@/lib/panel-proxy.ts";
import { rememberOrigin } from "@/lib/self.ts";
import { bot } from "@/telegram/bot.ts";

const authorizedCron = (request: Request) =>
  request.headers.get("authorization") === `Bearer ${config.APP_SECRET}`;

const telegramWebhook =
  config.onCloudRun
    ? webhookCallback(bot, "std/http", { secretToken: config.APP_SECRET })
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

// The container's only public entry point. Cloud Scheduler hits /jobs/*, Telegram hits /telegram,
// and every other path is passed through to the web panel (src/lib/panel-proxy.ts).
export const startServer = () =>
  Bun.serve({
    port: config.port,
    // scans run deep research and can take many minutes
    idleTimeout: 0,
    routes: {
      "/health": () => Response.json({ ok: true }),
      "/telegram": {
        POST: (request) => {
          if (!telegramWebhook) return new Response("polling mode", { status: 404 });
          rememberOrigin(request);
          return telegramWebhook(request);
        },
      },
      "/jobs/scan": {
        // ?manual=1 is a /scan from Telegram: run even when paused, and always report back
        POST: (request) => {
          if (!authorizedCron(request)) return new Response("unauthorized", { status: 401 });
          const manual = new URL(request.url).searchParams.get("manual") === "1";
          return runJob("scan", () => runScanAndReport(exchange, { force: manual, announce: manual }));
        },
      },
      "/jobs/study": {
        POST: (request) =>
          authorizedCron(request) ? runJob("study", () => runStudy(exchange)) : new Response("unauthorized", { status: 401 }),
      },
      "/jobs/tick": {
        POST: (request) =>
          authorizedCron(request) ? runJob("tick", () => runTick(exchange)) : new Response("unauthorized", { status: 401 }),
      },
    },
    // everything else is the web panel, running next to the bot in the same container
    fetch: (request) => proxyToPanel(request, config.onCloudRun ? "https" : "http"),
  });
