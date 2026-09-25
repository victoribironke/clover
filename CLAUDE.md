# Clover

Prediction-market betting bot. Scans Bayse (NGN), researches events with Gemini 3.8 Flash + Google Search (`src/llm`), stores state in Firestore, sizes bets with fractional Kelly, announces each bet on Telegram with a cancel window, then places it. Polymarket and Kalshi (USD) are planned: add them as new adapters implementing `Exchange` in `src/exchanges/types.ts`.

## Conventions

- Bun, never npm. `bun test`, `bun run typecheck`.
- Arrow functions everywhere. Only exception: generators (`function*`).
- Kebab-case file and directory names.
- Never commit, push, or rewrite git history. Leave changes in the working tree for review. Don't create or switch branches.

## Safety invariants

- Tunable values are constants in `src/settings.ts`, not env vars. Env holds secrets only (`src/config.ts`).
- `settings.dryRun = true` is the default: no real orders are sent.
- Size bets from live quotes. Use `Quote.avgPrice`, which is amount / (shares × payout), because CLOB fees are taken out of the shares you receive.
- Never auto-retry order placement (`auth: "write"` requests are not retried). Bets left in `placing` by a crash are resolved in `src/jobs/recover.ts`: paper bets are re-queued; for live bets, look the order up on Bayse and never re-send it.
- The bot only works with `settings.capitalNgn`. Profit above it is left for withdrawal.
- Research spend is capped by `settings.dailyResearchBudgetUsd`. If the model changes, update `src/llm/pricing.ts`.
- Keep LLM prompts and JSON schemas terse. Use short refs (`e1`, `m1`), not UUIDs. Take sources from search metadata, not from model output.
- Research reasons from the current number, not history. `src/data/` fetches hard data before the model runs (Open-Meteo ensemble for weather, public chart mirrors for streams). The model must report a live `reading`; without one, confidence is capped at "low" ("medium" for recurring post counts) in `src/research/deep-dive.ts`.
- Engagement markets (likes/views/reposts/followers) are never bet on (`settings.excludedKinds`): they're manipulable and void often.
- The late-price study (`src/jobs/study.ts`, `src/study/`) is research only. It never places bets. Bayse's price history reports `p = 0` for untraded order-book markets; those points are dropped as "no price".
- Cloud Run uses request-based billing (`--cpu-throttling`): the instance only gets CPU while handling a request. Never leave work running after a response. Long work started from Telegram must go through our own `/jobs/*` endpoint (see `src/lib/self.ts`). `--no-cpu-throttling` would bill 24/7, about $44/month.

## Web panel (`web/`)

- A Next.js 16 app with its own `package.json`. Same conventions as the bot: bun, arrow functions, kebab-case.
- It ships in the same container and Cloud Run service as the bot. `start.sh` runs both processes. The bot is the only public entry point and passes every path it doesn't handle to the panel on `127.0.0.1:3000` (`src/lib/panel-proxy.ts`). Keep the bot in front: scans hold requests open far longer than a proxy inside Next.js allows. Don't add bot routes that collide with panel paths.
- Next's standalone server sees its internal address in `request.nextUrl`, so the Auth.js route rebuilds the request on the forwarded public host (`app/api/auth/[...nextauth]/route.ts`); without that, Google gets a localhost `redirect_uri`.
- Read-only admin view; Telegram stays the control surface. Firestore is read on the server only (`import "server-only"`).
- Sign-in: Auth.js + Google, limited to `allowedEmails` in `web/src/settings.ts`. `src/proxy.ts` is only an early redirect; `app/(panel)/layout.tsx` does the real check before any data is read.
- `web/src/lib/types.ts` mirrors the bot's Firestore shapes: update it when `src/db/bets.ts` etc. change. Capital and paper/live mode come from `kv/settings`, which the bot publishes on start.
- Root `bunfig.toml` limits the bot's `bun test` to `src/`; run the panel's tests with `bun run test` in `web/`.
