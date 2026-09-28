# Clover

Prediction-market betting bot. Scans Bayse (NGN), researches events in two steps (`src/llm`, `src/research/deep-dive.ts`): Gemini 3.8 Flash + Google Search writes a fact brief, then OpenAI gpt-6-luna screens markets and makes the betting call from it, stores state in Firestore, sizes bets with fractional Kelly, announces each bet on Telegram with a cancel window, then places it. Polymarket and Kalshi (USD) are planned: add them as new adapters implementing `Exchange` in `src/exchanges/types.ts`.

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
- Research spend is capped by `settings.dailyResearchBudgetUsd`. Both models are priced in `src/llm/pricing.ts` (`MODEL_PRICES`); a model without a price throws. If `settings.searchModel` or `settings.reasoningModel` changes, update it.
- Web search stays on Gemini (5,000 free Google searches a month; OpenAI bills every search). The reasoning model gets no web tools: it only sees the event, our Data lines and Gemini's brief, so anything it needs must be in the brief.
- Keep LLM prompts and JSON schemas terse. Use short refs (`e1`, `m1`), not UUIDs. Take sources from search metadata, not from model output.
- Research reasons from the current number, not history. `src/data/` fetches hard data before the model runs (Open-Meteo ensemble for weather, public chart mirrors for streams). The model must report a live `reading`; without one, confidence is capped at "low" ("medium" for recurring post counts) in `src/research/deep-dive.ts`.
- Engagement markets (likes/views/reposts/followers) are never bet on (`settings.excludedKinds`): they're manipulable and void often. Neither are match stats (shots, passes, corners, cards: kind `match-stats`): bookmakers rarely price them, so bets were guesses.
- Sports bets need a live reading, i.e. bookmaker odds for the line (`settings.liveReadingRequiredKinds`, checked in `src/strategy/propose.ts`). Without one it's a near miss, not a bet.
- Gemini's brief is plain text (`READING:` / `LIVE:` / `- fact` lines, parsed leniently in `src/research/brief.ts`), not JSON: with search on, Gemini breaks JSON schemas. Keep structured output on the OpenAI side only.
- The late-price study (`src/jobs/study.ts`, `src/study/`) is research only. It never places bets. Bayse's price history reports `p = 0` for untraded order-book markets; those points are dropped as "no price".
- Cloud Run uses request-based billing (`--cpu-throttling`): the instance only gets CPU while handling a request. Never leave work running after a response. Long work started from Telegram must go through our own `/jobs/*` endpoint (see `src/lib/self.ts`). `--no-cpu-throttling` would bill 24/7, about $44/month.

## Web panel (`web/`)

- A Next.js 16 app with its own `package.json`. Same conventions as the bot: bun, arrow functions, kebab-case.
- It ships in the same container and Cloud Run service as the bot. `start.sh` runs both processes. The bot is the only public entry point and passes every path it doesn't handle to the panel on `127.0.0.1:3000` (`src/lib/panel-proxy.ts`). Keep the bot in front: scans hold requests open far longer than a proxy inside Next.js allows. Don't add bot routes that collide with panel paths.
- Next's standalone server sees its internal address in `request.nextUrl`, so the Auth.js route rebuilds the request on the forwarded public host (`app/api/auth/[...nextauth]/route.ts`); without that, Google gets a localhost `redirect_uri`.
- Read-only admin view; Telegram stays the control surface. Firestore is read on the server only (`import "server-only"`).
- Sign-in: Auth.js + Google, limited to `allowedEmails` in `web/src/settings.ts`. `src/proxy.ts` is only an early redirect; `app/(panel)/layout.tsx` does the real check before any data is read.
- `web/src/lib/types.ts` mirrors the bot's Firestore shapes: update it when `src/db/bets.ts`, `src/db/analyses.ts` or `src/study/stats.ts` change. The bot publishes snapshots for the panel with `publish()` in `src/db/kv.ts`: `kv/settings` (on start), `kv/wallet` (every tick, the real Bayse balance) and `kv/study-summary` (after each study run). The panel reads them and never calls Bayse itself.
- Root `bunfig.toml` limits the bot's `bun test` to `src/`; run the panel's tests with `bun run test` in `web/`.
- Panel data is loaded once, in `app/(panel)/layout.tsx` (`loadPanelData`), and shared through `components/panel-provider.tsx`. Pages are thin wrappers around client views in `components/views/` that read `usePanel()`. The paper/live switch and filters are client state and never fetch. Only the Refresh button (`router.refresh()`) or a browser reload loads data again. Don't add per-page Firestore reads or URL-driven filters that re-fetch.
- Format dates and amounts with `web/src/lib/format.ts` (hand-written, no `Intl`/`toLocaleString`), so the server and browser render identical text.
- Quiet mode (`settings.quiet`) mutes routine messages. `notify()` takes a level: `info` is dropped when quiet, `alert` is saved (`src/db/alerts.ts`) for the 23:30 daily summary (`src/jobs/summary.ts`), and `always` is sent regardless. Give new failure messages the `alert` level so they're never silently lost.
- There's no 5-minute tick in production. Each scan runs housekeeping first (recover, settle, wallet), then research, then places due bets (`src/jobs/housekeeping.ts`). With `cancelWindowMinutes: 0`, a scan places its own bets; if the window goes back above 0, bets wait for the next scan unless the tick is restored.
