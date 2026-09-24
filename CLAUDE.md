# Clover

Prediction-market betting bot. Scans Bayse (NGN), researches events with Claude + web search, sizes bets with fractional Kelly, announces each bet on Telegram with a cancel window, then places it. Polymarket and Kalshi (USD) are planned: add them as new adapters implementing `Exchange` in `src/exchanges/types.ts`.

## Conventions

- Bun, never npm. `bun test`, `bun run typecheck`.
- Arrow functions everywhere. Only exception: generators (`function*`).
- Kebab-case file and directory names.
- Never commit, push, or rewrite git history. Leave changes in the working tree for review. Don't create or switch branches.

## Safety invariants

- `DRY_RUN=true` is the default: no real orders are sent.
- Size bets from live quotes. Use `Quote.avgPrice`, which is amount / (shares × payout), because CLOB fees are taken out of the shares you receive.
- Never auto-retry order placement (`auth: "write"` requests are not retried).
- The bot only works with `CAPITAL_NGN`. Profit above it is left for withdrawal.
