import { config } from "@/config.ts";
import { migrate } from "@/db/client.ts";
import { exchange } from "@/exchanges/index.ts";
import { runScan } from "@/jobs/scan.ts";
import { runTick } from "@/jobs/tick.ts";
import { errorMessage, log } from "@/lib/logger.ts";
import { startServer } from "@/server.ts";
import { bot } from "@/telegram/bot.ts";
import { registerHandlers } from "@/telegram/handlers.ts";

const every = (minutes: number, name: string, job: () => Promise<unknown>) => {
  const run = () =>
    job()
      .then((result) => log.info(`${name} finished`, { result }))
      .catch((error) => log.error(`${name} failed`, { error: errorMessage(error) }));
  setInterval(run, minutes * 60_000);
  return run;
};

const main = async () => {
  await migrate();
  registerHandlers();
  const server = startServer();
  log.info("server listening", { port: server.port, mode: config.RUN_MODE, dryRun: config.DRY_RUN });

  await bot.api.setMyCommands([
    { command: "status", description: "Bankroll and profit" },
    { command: "bets", description: "Pending and open bets" },
    { command: "scan", description: "Run a scan now" },
    { command: "pause", description: "Stop scanning and placing" },
    { command: "resume", description: "Start again" },
  ]);

  if (config.TELEGRAM_MODE === "webhook") {
    if (!config.PUBLIC_URL) throw new Error("PUBLIC_URL is required when TELEGRAM_MODE=webhook");
    await bot.api.setWebhook(`${config.PUBLIC_URL}/telegram`, { secret_token: config.TELEGRAM_WEBHOOK_SECRET });
  } else {
    await bot.api.deleteWebhook();
    void bot.start({ onStart: (me) => log.info("telegram polling", { bot: me.username }) });
  }

  // In the cloud, Cloud Scheduler drives these through /jobs/*
  if (config.RUN_MODE === "local") {
    every(config.TICK_INTERVAL_MINUTES, "tick", () => runTick(exchange))();
    every(config.SCAN_INTERVAL_MINUTES, "scan", () => runScan(exchange))();
  }
};

await main();
