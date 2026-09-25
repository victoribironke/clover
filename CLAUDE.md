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
