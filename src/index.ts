import { config } from "@/config.ts";
import { releaseHeldLocks } from "@/db/kv.ts";
import { exchange } from "@/exchanges/index.ts";
import { runScanAndReport } from "@/jobs/scan.ts";
import { runTick } from "@/jobs/tick.ts";
import { errorMessage, log } from "@/lib/logger.ts";
import { startServer } from "@/server.ts";
import { settings } from "@/settings.ts";
import { bot } from "@/telegram/bot.ts";
import { registerHandlers } from "@/telegram/handlers.ts";
import { notify } from "@/telegram/notify.ts";

const every = (minutes: number, name: string, job: () => Promise<unknown>) => {
  const run = () =>
    job()
      .then((result) => log.info(`${name} finished`, { result }))
      .catch((error) => log.error(`${name} failed`, { error: errorMessage(error) }));
  setInterval(run, minutes * 60_000);
  return run;
};

// Cloud Run sends SIGTERM (then ~10s grace) when it replaces or recycles an instance, e.g. on
// every deploy. Work in progress dies with the process, so hand back its locks and say so,
// instead of leaving a stale lock that blocks the next scan.
const shutdown = async (signal: string) => {
  log.warn("shutting down", { signal });
  try {
    const released = await releaseHeldLocks();
    if (released.includes("scan")) {
      await notify("⚠️ <b>Scan interrupted</b>\nThe server restarted (usually a new deploy). Send /scan to run it again.");
    }
  } finally {
    process.exit(0);
  }
};

const main = async () => {
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
  registerHandlers();
  const server = startServer();
  log.info("server listening", { port: server.port, cloudRun: config.onCloudRun, dryRun: settings.dryRun });

  await bot.api.setMyCommands([
    { command: "status", description: "Bankroll and profit" },
    { command: "bets", description: "Pending and open bets" },
    { command: "scan", description: "Run a scan now" },
    { command: "pause", description: "Stop scanning and placing" },
    { command: "resume", description: "Start again" },
  ]);

  // On Cloud Run the deploy workflow registers the Telegram webhook and Cloud Scheduler
  // drives /jobs/*. Locally: long polling (note: this removes the webhook while you test
  // with the production bot token; the next deploy sets it again) and in-process timers.
  if (!config.onCloudRun) {
    await bot.api.deleteWebhook();
    void bot.start({ onStart: (me) => log.info("telegram polling", { bot: me.username }) });
    every(settings.tickEveryMinutes, "tick", () => runTick(exchange))();
    every(settings.scanEveryMinutes, "scan", () => runScanAndReport(exchange))();
  }
};

await main();
