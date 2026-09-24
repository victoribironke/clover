// One-off commands for local testing:
//   bun run markets  - list what's open on Bayse and what passes the filters (no Claude calls, no money)
//   bun run scan     - run one full scan (Claude research + proposals to Telegram)
//   bun run tick     - place due bets and settle resolved ones
import { migrate } from "@/db/client.ts";
import { exchange } from "@/exchanges/index.ts";
import { eligibleEvents, runScan } from "@/jobs/scan.ts";
import { runTick } from "@/jobs/tick.ts";
import { getBankroll } from "@/strategy/bankroll.ts";

const commands: Record<string, () => Promise<unknown>> = {
  markets: async () => {
    const events = await exchange.listOpenEvents();
    const eligible = eligibleEvents(events, new Set());
    for (const event of eligible) {
      const top = event.markets[0]!;
      console.log(
        `${event.category.padEnd(14)} ${(event.closingDate ?? "no close").slice(0, 10)}  ${event.engine}  ${event.title}  (${event.markets.length} mkts, ${top.outcomes[0].label} ${Math.round(top.outcomes[0].price * 100)}%)`,
      );
    }
    return { open: events.length, eligible: eligible.length, bankroll: await getBankroll(exchange) };
  },
  scan: () => runScan(exchange, { force: true }),
  tick: () => runTick(exchange),
};

const name = process.argv[2] ?? "";
const command = commands[name];
if (!command) {
  console.error(`usage: bun src/cli.ts <${Object.keys(commands).join("|")}>`);
  process.exit(1);
}

await migrate();
console.log(await command());
process.exit(0);
