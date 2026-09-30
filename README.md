# Clover

A betting assistant for prediction markets. It scans [Bayse Markets](https://docs.bayse.markets/) for open markets and researches the promising ones: Gemini 3.8 Flash searches the web with Google Search and writes a fact brief, and OpenAI's gpt-6-luna makes the call from it. When it finds an edge, it sends you the bet on Telegram. You have a window to cancel before it places the bet.

It also paper-trades [Kalshi](https://kalshi.com) (USD): its 48 daily US high/low temperature markets, priced from data with no AI (see [Kalshi](#kalshi-paper) below).

## How it works

```
every 4h   Bayse scan ─► settle ─► filter ─► screen (1 luna call) ─► deep dive per event (Gemini + Google Search → fact brief → luna decides)
every 2h   Kalshi scan ─► settle ─► today's temperature markets ─► station readings + weather ensemble (no AI)
                                                             │
                                             blend with market price, size with ¼ Kelly
                                                             │
                                          live quote (fees + price impact) ─► edge ≥ minEdge?
                                                             │
                                        Telegram: "New bet … places at 14:30 unless you cancel"
                                                     [❌ Cancel] [✅ Place now]
23:30     daily summary ─► settle ─► one Telegram message with the day's bets, results and any problems
```

- **Data-settled markets only.** It only bets on markets that settle on measurable public data: prices, exchange rates, temperatures, post and stream counts, chart positions, official statistics, plus sports results and goals. Politics, awards, reality TV and anything else decided by people is left out, first by category (`categories` in `src/settings.ts`) and then by the screening step. Markets must resolve within 7 days (`maxHoursToResolve`).
- **No engagement markets.** Likes, views, reposts and follower counts are excluded (`excludedKinds` in `src/settings.ts`). Anyone who buys bots can move those numbers, and Bayse voids them more often.
- **Sports only with bookmaker odds.** Match stats (shots, passes, corners, cards) are skipped because bookmakers rarely price them. Results and goals markets are researched, but only bet on when the research finds current bookmaker odds for that line.
- **Late-price study.** Every 6 hours a job records how recently settled markets were priced in the final hour before their measurement time, plus voids. It makes no model calls and moves no money. `/study` shows whether late prices are systematically off, and for which market types, before we build a closing-window strategy on it.
- **Live data first.** Before research, the bot fetches hard data itself where it can: a 122-run weather-model ensemble for temperature markets, and public mirrors of the Spotify and Apple Music Nigeria charts. The research must report the current reading it based its estimate on, which is shown on every bet. Without a live reading, confidence is capped at low, so history alone rarely triggers a bet. Sports and post counts need one to be bet on at all (bookmaker odds for the line, or the count so far).
- **Research.** The model never sees the market price, so it forms its own estimate. That estimate is then blended with the market price, weighted by the model's confidence (low 25%, medium 50%, high 70%). The market is usually right, so the bot only bets when the blended number still beats it.
- **Sizing.** Quarter Kelly on the blended probability, capped at 10% of capital, and only if the expected return after fees and price impact is at least 5%. At most one bet per event.
- **Capital.** Each exchange has its own capital (`exchanges` in `src/settings.ts`): ₦10,000 on Bayse, $100 (paper) on Kalshi. The bot never works with more; anything above is profit it won't touch, shown as _withdrawable_ in `/status`. After losses, it keeps going with what's left.
- **Research cost.** Every model call (Gemini and OpenAI) is priced from its token and search counts. Scans stop for the day at the daily budget. `/status` and every bet message show the spend.
- **Before placing,** it re-checks that the market is still open and re-quotes. If the edge is gone, it skips the bet and tells you.

## Kalshi (paper)

Kalshi's market data is public, so this needs no account and no key. `canTrade` is false in the adapter ([`src/exchanges/kalshi/adapter.ts`](src/exchanges/kalshi/adapter.ts)): every Kalshi bet is paper.

- **Markets.** The daily high and low temperature series for 24 US cities (`kalshiSeries` in `src/settings.ts`). Each settles on one NWS station's reading for the day, midnight to midnight local standard time, in whole °F.
- **Pricing, no AI.** [`src/research/weather-model.ts`](src/research/weather-model.ts) takes the station's readings so far ([api.weather.gov](https://api.weather.gov)) and a ~120-run weather ensemble (ICON, GFS, ECMWF via [Open-Meteo](https://open-meteo.com)) for the rest of the day. Each run gives one possible final high or low. The share of runs in a band is its probability, with a degree of slack either side because public readings miss the official number by 1°F about a fifth of the time (checked on 192 settled days).
- **Bets only late in the day.** Forecasts alone don't beat these markets: on the first check they sat 2°F from the price in several cities, which is a whole band. So Kalshi bets need the station's readings after 4 PM local standard time, when the day's high has usually been set. Earlier in the day events are priced and reported, not bet on.
- **Quotes** walk Kalshi's live order book, whole contracts only, with Kalshi's fee included.

If the paper results hold up, the plan is to fund Kalshi and Polymarket with about $5 each and drop Bayse.

## Settings vs secrets

- **Settings** (capital, Kelly fraction, budget, model, schedule, paper vs live) are plain constants in [`src/settings.ts`](src/settings.ts). To change one, edit it and push.
- **Secrets** are the only environment variables. They go in GitHub secrets for Cloud Run and in `.env` for local runs:

| Secret                                 | Where to get it                                                                                                                                                                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `BAYSE_PUBLIC_KEY`, `BAYSE_SECRET_KEY` | app.bayse.markets → Settings → API Keys                                                                                                                                                                                                                |
| `GEMINI_API_KEY`                       | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) → _Create API key_ → pick the `fl-clover` project. Turn on billing for the key (_Set up billing_ in AI Studio) so you get paid-tier limits and your prompts aren't used for training. |
| `OPENAI_API_KEY`                       | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) → _Create new secret key_. Add credit under _Billing_; the reasoning model costs about $2 a month here.                                                                           |
| `TELEGRAM_BOT_TOKEN`                   | Message [@BotFather](https://t.me/BotFather) → `/newbot` → choose a name and a username ending in `bot`. It replies with the token. Then open your new bot and press _Start_, so it's allowed to message you.                                          |
| `TELEGRAM_CHAT_ID`                     | Message [@userinfobot](https://t.me/userinfobot). It replies with your numeric `Id`.                                                                                                                                                                   |
| `APP_SECRET`                           | Any random string of letters and digits, 32 or more characters. For example, run `openssl rand -hex 32` (works in Git Bash). It protects the Telegram webhook and the scheduled job endpoints.                                                         |
| `GCP_SA_KEY`                           | The JSON key of the `github-deployer` service account (see below). GitHub only.                                                                                                                                                                        |

The bot starts in **paper-trading mode** (`dryRun: true`). Everything runs, and bets are "filled" at the quoted price and settled when the market resolves. No real orders are sent. Once the paper results look good, set `dryRun: false` and push.

## Google Cloud setup (one time, project `fl-clover`)

1. **Billing:** make sure billing is enabled for `fl-clover`.
2. **APIs:** in _APIs & Services → Library_, enable **Cloud Run Admin API**, **Artifact Registry API**, **Cloud Scheduler API** and **Cloud Firestore API**.
3. **Firestore:** open _Firestore → Create database_. Choose **Native mode**, keep the ID `(default)`, and pick location `europe-west9` (or `eur3` if it isn't offered). No indexes are needed.
4. **Artifact Registry:** nothing to do. The workflow creates the `clover` Docker repository in europe-west9 on its first run.
5. **Service accounts:** in _IAM & Admin → Service Accounts_, create two:
   - **`clover-runtime`**, which the app runs as. Give it the role **Cloud Datastore User**.
   - **`github-deployer`**, which GitHub Actions uses. Give it these roles:
     - **Cloud Run Admin**
     - **Artifact Registry Administrator** (so the workflow can create the repository)
     - **Cloud Scheduler Admin**
     - **Service Account User**

     Then open it → _Keys → Add key → Create new key → JSON_. Paste the whole downloaded file into the GitHub secret `GCP_SA_KEY`, then delete the file.

6. **GitHub:** in _Settings → Secrets and variables → Actions_, add the seven secrets above.

Push to `main`, or run the workflow by hand from the Actions tab. [`.github/workflows/deploy-cloudrun.yml`](.github/workflows/deploy-cloudrun.yml) then:

1. typechecks and tests
2. builds and pushes the image
3. deploys the service
4. registers the Telegram webhook
5. creates or updates the Cloud Scheduler jobs:
   - daily summary at 23:30 WAT (the 5-minute tick was retired; scans settle and place bets themselves)
   - Bayse scan every 4 hours (00:00, 04:00, 08:00, 12:00, 16:00, 20:00 WAT)
   - Kalshi scan every 2 hours at :15 (`/jobs/scan?exchange=kalshi`)
   - late-price study every 6 hours (no model calls, no money)

Send `/status` to your bot to check it's alive.

### Production

Service URL: **https://clover-uhkg4fo2na-od.a.run.app** (Cloud Run `clover`, europe-west9, project `fl-clover`)

- **Health check:** open [`/health`](https://clover-uhkg4fo2na-od.a.run.app/health). It returns `{"ok":true}`.
- **Run a job by hand**, the way Cloud Scheduler does. Anything without the secret gets `401`:
  ```bash
  curl -X POST -d '' -H "Authorization: Bearer $APP_SECRET" https://clover-uhkg4fo2na-od.a.run.app/jobs/tick
  ```
  Use `/jobs/scan` in place of `/jobs/tick` to run a Bayse scan, or `/jobs/scan?exchange=kalshi` for Kalshi. Sending `/scan` in Telegram runs both.
- **Logs:** Cloud Run → `clover` → _Logs_. Every line is JSON with `message` and `severity`, so filter on `severity>=WARNING` to see problems.
- **Scheduled jobs:** Cloud Scheduler (europe-west1) → `clover-scan`, `clover-scan-kalshi`, `clover-summary` and `clover-study`. _Force run_ triggers one immediately.

## Running locally

1. `bun install`
2. `cp .env.example .env` and fill in the secrets.
3. Firestore access, once:
   ```bash
   gcloud auth application-default login
   gcloud config set project fl-clover
   ```
   Local runs use `dev_*` collections, so they never touch production data.
4. `bun run markets` lists open Bayse markets and what passes the filters; `bun src/cli.ts markets kalshi` does the same for Kalshi. Neither makes model calls or moves money.
5. `bun run dev` starts the bot with long polling and in-process timers.

Running locally with the production bot token switches Telegram from the webhook to polling. The next deploy switches it back. To avoid that, create a second bot for local testing.

### Telegram commands

| Command              | What it does                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| `/status`            | Per exchange: capital, money in play, realized P&L, withdrawable profit, wallet, research spend |
| `/summary`           | The last 24 hours per exchange: bets placed, results, open bets, research spend, problems       |
| `/bets`              | Pending and open bets                                                                           |
| `/scan`              | Run a scan now, on every exchange                                                               |
| `/study`             | Late-price study: are prices fair near the end, void rates by market type                       |
| `/pause` / `/resume` | Stop or start scanning and placing. Pending bets wait.                                          |

## Web panel

A read-only admin panel (results, bankroll curve, bets) lives in [`web/`](web/README.md). It runs in the same container as the bot, at https://clover-uhkg4fo2na-od.a.run.app.

## Layout

```
src/
  settings.ts       all tunable values
  config.ts         secrets (env) + local/Cloud Run detection
  exchanges/        Exchange interface; Bayse adapter (HMAC signing, quotes, orders); Kalshi adapter (public data, paper)
  llm/              Gemini (search) and OpenAI (reasoning) clients, pricing
  research/         screening + deep dive prompts and schemas; weather-model.ts prices Kalshi without AI
  data/             hard data fetched before research: weather ensembles, charts, NWS station readings
  strategy/         probability blending, Kelly sizing, bankroll rules, bet proposal
  jobs/             scan, execute, settle, tick
  telegram/         bot, commands, message formatting
  db/               Firestore collections: bets, analyses, kv (locks, pause, spend)
  server.ts         /health, /telegram webhook, /jobs/* for Cloud Scheduler
  index.ts          entry point
  cli.ts            one-off commands: markets, scan, tick
```
