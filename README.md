# Clover

A betting assistant for prediction markets. It scans [Bayse Markets](https://docs.bayse.markets/) for open markets and researches the promising ones with Claude and web search. When it finds an edge, it sends you the bet on Telegram. You have a window to cancel before it places the bet.

## How it works

```
every 2h   scan ─► filter ─► triage (1 Claude call) ─► deep dive (Claude + web search, per event)
                                                             │
                                             blend with market price, size with ¼ Kelly
                                                             │
                                          live quote (fees + price impact) ─► edge ≥ MIN_EDGE?
                                                             │
                                        Telegram: "New bet … places at 14:30 unless you cancel"
                                                     [❌ Cancel] [✅ Place now]
every 1–5m tick ─► place due bets (re-quote first) ─► settle resolved bets ─► P&L to Telegram
```

- **Research.** Claude never sees the market price, so it forms its own estimate. That estimate is then blended with the market price, weighted by the confidence Claude reports (low 25%, medium 50%, high 70%). The market is usually right, so the bot only bets when the blended number still beats it.
- **Sizing.** Quarter Kelly on the blended probability, capped at `MAX_BET_FRACTION` of capital, and only if the expected return after fees and price impact is at least `MIN_EDGE`. At most one bet per event.
- **Capital.** The bot only ever works with `CAPITAL_NGN` (₦10,000 by default). Anything above that is profit it won't touch, shown as *withdrawable* in `/status`. After losses, it keeps going with what's left.
- **Before placing,** it re-checks that the market is still open and re-quotes. If the edge is gone, it skips the bet and tells you.

## Setup

1. `bun install`
2. `cp .env.example .env`, then fill in:
   - **Bayse keys** from app.bayse.markets → Settings → API Keys
   - **`ANTHROPIC_API_KEY`**
   - **Telegram:** create a bot with @BotFather to get `TELEGRAM_BOT_TOKEN`, then message @userinfobot to get your `TELEGRAM_CHAT_ID`
3. Try it without Claude or Telegram: `bun run markets` lists open markets and what passes the filters.
4. Run it: `bun run dev`. Then send `/scan` to your bot on Telegram.

It starts in **paper-trading mode** (`DRY_RUN=true`). Everything runs, and bets are "filled" at the quoted price and settled when the market resolves. No real orders are sent. Let it build a track record, then set `DRY_RUN=false`.

### Telegram commands

| Command | What it does |
|---|---|
| `/status` | Capital, money in play, realized P&L, withdrawable profit |
| `/bets` | Pending and open bets |
| `/scan` | Run a scan now |
| `/pause` / `/resume` | Stop or start scanning and placing. Pending bets wait. |

## Deploying to Google Cloud Run

Cloud Run's disk is wiped between runs, so the database lives in [Turso](https://turso.tech) (hosted libSQL, same client as the local file):

```bash
turso db create clover
turso db show clover --url          # -> DATABASE_URL
turso db tokens create clover       # -> DATABASE_AUTH_TOKEN
```

Deploy. Keep secrets in Secret Manager in real use.

```bash
gcloud run deploy clover --source . --region europe-west1 \
  --max-instances 1 --no-cpu-throttling --timeout 3600 \
  --set-env-vars "PUBLIC_URL=https://<service-url>,DATABASE_URL=libsql://...,DRY_RUN=true,..." \
  --set-secrets "BAYSE_SECRET_KEY=bayse-secret:latest,ANTHROPIC_API_KEY=anthropic-key:latest,..."
```

`--no-cpu-throttling` lets a `/scan` started from Telegram keep running after the webhook replies. Then schedule the two jobs:

```bash
gcloud scheduler jobs create http clover-tick --schedule "*/5 * * * *" \
  --uri "https://<service-url>/jobs/tick" --http-method POST \
  --headers "Authorization=Bearer <CRON_SECRET>" --attempt-deadline 600s

gcloud scheduler jobs create http clover-scan --schedule "0 */2 * * *" \
  --uri "https://<service-url>/jobs/scan" --http-method POST \
  --headers "Authorization=Bearer <CRON_SECRET>" --attempt-deadline 1800s
```

## Layout

```
src/
  exchanges/        Exchange interface + Bayse adapter (HMAC signing, quotes, orders)
  research/         triage + deep dive (Claude, web search/fetch)
  strategy/         probability blending, Kelly sizing, bankroll rules, bet proposal
  jobs/             scan, execute, settle, tick
  telegram/         bot, commands, message formatting
  db/               libSQL schema and queries
  server.ts         /health, /telegram webhook, /jobs/* for Cloud Scheduler
  index.ts          entry point
  cli.ts            one-off commands: markets, scan, tick
```
