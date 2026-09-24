# Clover

A betting assistant for prediction markets. It scans [Bayse Markets](https://docs.bayse.markets/) for open markets and researches the promising ones with Gemini 3.8 Flash and Google Search. When it finds an edge, it sends you the bet on Telegram. You have a window to cancel before it places the bet.

## How it works

```
every 6h   scan ─► filter ─► screen (1 Gemini call) ─► deep dive (Gemini + Google Search, per event)
                                                             │
                                             blend with market price, size with ¼ Kelly
                                                             │
                                          live quote (fees + price impact) ─► edge ≥ minEdge?
                                                             │
                                        Telegram: "New bet … places at 14:30 unless you cancel"
                                                     [❌ Cancel] [✅ Place now]
every 5m   tick ─► place due bets (re-quote first) ─► settle resolved bets ─► P&L to Telegram
```

- **Research.** The model never sees the market price, so it forms its own estimate. That estimate is then blended with the market price, weighted by the model's confidence (low 25%, medium 50%, high 70%). The market is usually right, so the bot only bets when the blended number still beats it.
- **Sizing.** Quarter Kelly on the blended probability, capped at 10% of capital, and only if the expected return after fees and price impact is at least 5%. At most one bet per event.
- **Capital.** The bot only ever works with ₦10,000. Anything above that is profit it won't touch, shown as _withdrawable_ in `/status`. After losses, it keeps going with what's left.
- **Research cost.** Every Gemini call is priced from its token and search counts. Scans stop for the day at the daily budget. `/status` and every bet message show the spend.
- **Before placing,** it re-checks that the market is still open and re-quotes. If the edge is gone, it skips the bet and tells you.

## Settings vs secrets

- **Settings** (capital, Kelly fraction, budget, model, schedule, paper vs live) are plain constants in [`src/settings.ts`](src/settings.ts). To change one, edit it and push.
- **Secrets** are the only environment variables. They go in GitHub secrets for Cloud Run and in `.env` for local runs:

| Secret                                 | Where to get it                                                                                                                                                                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `BAYSE_PUBLIC_KEY`, `BAYSE_SECRET_KEY` | app.bayse.markets → Settings → API Keys                                                                                                                                                                                                                |
| `GEMINI_API_KEY`                       | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) → _Create API key_ → pick the `fl-clover` project. Turn on billing for the key (_Set up billing_ in AI Studio) so you get paid-tier limits and your prompts aren't used for training. |
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
   - tick every 5 minutes
   - scan every 6 hours

Send `/status` to your bot to check it's alive.

## Running locally

1. `bun install`
2. `cp .env.example .env` and fill in the secrets.
3. Firestore access, once:
   ```bash
   gcloud auth application-default login
   gcloud config set project fl-clover
   ```
   Local runs use `dev_*` collections, so they never touch production data.
4. `bun run markets` lists open markets and what passes the filters. It makes no Gemini calls and moves no money.
5. `bun run dev` starts the bot with long polling and in-process timers.

Running locally with the production bot token switches Telegram from the webhook to polling. The next deploy switches it back. To avoid that, create a second bot for local testing.

### Telegram commands

| Command              | What it does                                                              |
| -------------------- | ------------------------------------------------------------------------- |
| `/status`            | Capital, money in play, realized P&L, withdrawable profit, research spend |
| `/bets`              | Pending and open bets                                                     |
| `/scan`              | Run a scan now                                                            |
| `/pause` / `/resume` | Stop or start scanning and placing. Pending bets wait.                    |

## Layout

```
src/
  settings.ts       all tunable values
  config.ts         secrets (env) + local/Cloud Run detection
  exchanges/        Exchange interface + Bayse adapter (HMAC signing, quotes, orders)
  llm/              Gemini client and pricing
  research/         screening + deep dive prompts and schemas
  strategy/         probability blending, Kelly sizing, bankroll rules, bet proposal
  jobs/             scan, execute, settle, tick
  telegram/         bot, commands, message formatting
  db/               Firestore collections: bets, analyses, kv (locks, pause, spend)
  server.ts         /health, /telegram webhook, /jobs/* for Cloud Scheduler
  index.ts          entry point
  cli.ts            one-off commands: markets, scan, tick
```
