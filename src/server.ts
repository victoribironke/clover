import { webhookCallback } from "grammy";
import { config } from "@/config.ts";
import { bayse, exchanges, getExchange, isExchangeName } from "@/exchanges/index.ts";
import { runScanAndReport } from "@/jobs/scan.ts";
import { runSpeedTest } from "@/jobs/speed.ts";
import { runDailySummary } from "@/jobs/summary.ts";
import { runTick } from "@/jobs/tick.ts";
import { errorMessage, log } from "@/lib/logger.ts";
import { rememberOrigin } from "@/lib/self.ts";
import { bot } from "@/telegram/bot.ts";

const authorizedCron = (request: Request) =>
  request.headers.get("authorization") === `Bearer ${config.APP_SECRET}`;

const telegramWebhook = config.onCloudRun
  ? // grammY's default is to fail after 10s, which makes Telegram resend the update. Give commands
    // 45s, and if even that runs out, answer "received" so Telegram stops resending.
    webhookCallback(bot, "std/http", {
      secretToken: config.APP_SECRET,
      timeoutMilliseconds: 45_000,
      onTimeout: "return",
    })
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

// The container's only entry point. Cloud Scheduler hits /jobs/*, Telegram hits /telegram.
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
        // ?exchange=kalshi picks the exchange (default Bayse, which the original scheduler job calls);
        // a list (?exchange=kalshi,polymarket) or "all" scans several side by side, in this one request.
        // ?manual=1 is a /scan from Telegram: run even when paused, and always report back.
        POST: (request) => {
          if (!authorizedCron(request)) return new Response("unauthorized", { status: 401 });
          const params = new URL(request.url).searchParams;
          const manual = params.get("manual") === "1";
          const name = params.get("exchange") ?? bayse.name;
          const options = { force: manual, announce: manual };
          const names =
            name === "all" ? exchanges.map((exchange) => exchange.name) : name.split(",");
          if (!names.every(isExchangeName))
            return new Response("unknown exchange", { status: 400 });
          if (names.length === 1) {
            return runJob(`scan ${name}`, () => runScanAndReport(getExchange(names[0]!), options));
          }
          // Weather providers rate-limit bursts. Run exchanges in order, while still reporting
          // each failure independently so one exchange never prevents the next from scanning.
          return runJob(`scan ${names.join(",")}`, async () => {
            const results: PromiseSettledResult<unknown>[] = [];
            for (const each of names) {
              try {
                results.push({
                  status: "fulfilled",
                  value: await runScanAndReport(getExchange(each), options),
                });
              } catch (reason) {
                results.push({ status: "rejected", reason });
              }
            }
            return results;
          });
        },
      },
      // the speed test, every minute (src/speed/record.ts)
      "/jobs/speed": {
        POST: (request) =>
          authorizedCron(request)
            ? runJob("speed test", runSpeedTest)
            : new Response("unauthorized", { status: 401 }),
      },
      "/jobs/summary": {
        POST: (request) =>
          authorizedCron(request)
            ? runJob("summary", () => runDailySummary(exchanges))
            : new Response("unauthorized", { status: 401 }),
      },
      "/jobs/tick": {
        POST: (request) =>
          authorizedCron(request)
            ? runJob("tick", async () => {
                const results = [];
                for (const exchange of exchanges) results.push(await runTick(exchange));
                return results;
              })
            : new Response("unauthorized", { status: 401 }),
      },
    },
    fetch: () => new Response("not found", { status: 404 }),
  });
