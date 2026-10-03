# Clover

Prediction-market betting bot. Scans Bayse (NGN), researches events in two steps (`src/llm`, `src/research/deep-dive.ts`): Gemini 3.8 Flash + Google Search writes a fact brief, then OpenAI gpt-6-luna screens markets and makes the betting call from it, stores state in Firestore, sizes bets with fractional Kelly, announces each bet on Telegram with a cancel window, then places it. Kalshi (USD) runs alongside, paper only (`src/exchanges/kalshi/`): daily US temperature markets, priced without AI (`src/research/weather-model.ts`). Polymarket (USD) runs the same way, paper only (`src/exchanges/polymarket/`, `src/research/polymarket-weather.ts`). From 2026-10-03 every exchange trades temperature markets only (`kinds` in `settings.exchanges`).

## Conventions

- Bun, never npm. `bun test`, `bun run typecheck`.
- Arrow functions everywhere. Only exception: generators (`function*`).
- Kebab-case file and directory names.
- Never commit, push, or rewrite git history. Leave changes in the working tree for review. Don't create or switch branches.

## Safety invariants

- Telegram is the only interface (the web panel was removed on 2026-10-03). Don't add a UI; add a command or a message instead.

- Tunable values are constants in `src/settings.ts`, not env vars. Env holds secrets only (`src/config.ts`).
- `settings.dryRun = true` is the default: no real orders are sent.
- Size bets from live quotes. Use `Quote.avgPrice`, which is amount / (shares × payout), because CLOB fees are taken out of the shares you receive.
- Never auto-retry order placement (`auth: "write"` requests are not retried). Bets left in `placing` by a crash are resolved in `src/jobs/recover.ts`: paper bets are re-queued; for live bets, look the order up on Bayse and never re-send it.
- Each exchange has its own capital and paper/live switch (`settings.exchanges`), in its own currency. The bot only works with that capital; profit above it is left for withdrawal. Bets carry `exchange` and `currency`: filter by exchange before summing money, and format with `money(amount, currency)`.
- An exchange with `canTrade: false` (Kalshi: public market data, no account) is always paper (`isDryRun` in `src/exchanges/mode.ts`); its account calls throw.
- Jobs run per exchange: scans (`/jobs/scan?exchange=`, one lock each), settle, recover and execute only touch that exchange's bets. The late-price study and the wallet snapshot are Bayse only.
- Kalshi weather: settles on an NWS station, midnight to midnight local STANDARD time, whole °F. Forecast-stage model/market gaps were model error (2°F+, checked 2026-09-30), so bets need the station's readings after 4 PM LST (`liveData` in `weather-model.ts`, enforced by `liveReadingRequiredKinds`). Don't loosen that without paper results that back it. NWS 5-minute readings are whole °C (±0.9°F); only METARs have tenths, and their 6-hour max/min remark groups (`1snTTT`/`2snTTT`) give the true extremes the market trades on (`observedExtreme`, `sixHourGroups` in `src/data/station-weather.ts`).
- Kalshi's public API rate-limits fast: list series one at a time, and retry reads on 429 (reads only).
- Polymarket temperature markets settle on NOAA's listed airport reports for the local calendar day (DST included), whole degrees (US: hourly METARs only, °F; elsewhere °C), so readings so far are the answer so far. Only events whose `resolutionSource` is `weather.gov/wrh/timeseries?site=` are traded. Highs bet after 4 PM local, lows after 10 PM. Reports come from aviationweather.gov (global); the time zone from Open-Meteo. Gamma's `endDate` is noon UTC on the day but trading runs until resolution, so `closingDate` is noon UTC the next day.
- Sizing is per exchange (`sizingFor` in `src/exchanges/mode.ts`); dollar stakes step in cents. A market's `minShares` (Kalshi 1, Polymarket 5) sets the smallest stake at its price.
- Research spend is capped by `settings.dailyResearchBudgetUsd`. Both models are priced in `src/llm/pricing.ts` (`MODEL_PRICES`); a model without a price throws. If `settings.searchModel` or `settings.reasoningModel` changes, update it.
- Web search stays on Gemini (5,000 free Google searches a month; OpenAI bills every search). The reasoning model gets no web tools: it only sees the event, our Data lines and Gemini's brief, so anything it needs must be in the brief.
- Keep LLM prompts and JSON schemas terse. Use short refs (`e1`, `m1`), not UUIDs. Take sources from search metadata, not from model output.
- Research reasons from the current number, not history. `src/data/` fetches hard data before the model runs (Open-Meteo ensemble for weather, public chart mirrors for streams). The model must report a live `reading`; without one, confidence is capped at "low" in `src/research/deep-dive.ts`.
- Engagement markets (likes/views/reposts/followers) are never bet on (`settings.excludedKinds`): they're manipulable and void often. Neither are match stats (shots, passes, corners, cards: kind `match-stats`): bookmakers rarely price them, so bets were guesses.
- Sports and post-count bets need a live reading, i.e. bookmaker odds for the line or the count so far (`settings.liveReadingRequiredKinds`, checked in `src/strategy/propose.ts`). Without one it's a near miss, not a bet.
- Gemini's brief is plain text (`READING:` / `LIVE:` / `- fact` lines, parsed leniently in `src/research/brief.ts`), not JSON: with search on, Gemini breaks JSON schemas. Keep structured output on the OpenAI side only.
- The late-price study (`src/jobs/study.ts`, `src/study/`) is research only. It never places bets. Bayse's price history reports `p = 0` for untraded order-book markets; those points are dropped as "no price".
- Cloud Run uses request-based billing (`--cpu-throttling`): the instance only gets CPU while handling a request. Never leave work running after a response. Long work started from Telegram must go through our own `/jobs/*` endpoint (see `src/lib/self.ts`). `--no-cpu-throttling` would bill 24/7, about $44/month.
- Quiet mode (`settings.quiet`) mutes routine messages. `notify()` takes a level: `info` is dropped when quiet, `alert` is saved (`src/db/alerts.ts`) for the 23:30 daily summary (`src/jobs/summary.ts`), and `always` is sent regardless. Give new failure messages the `alert` level so they're never silently lost.
- There's no 5-minute tick in production. Each scan runs housekeeping first (recover, settle), then research, then places due bets (`src/jobs/housekeeping.ts`). With `cancelWindowMinutes: 0`, a scan places its own bets; if the window goes back above 0, bets wait for the next scan unless the tick is restored.
