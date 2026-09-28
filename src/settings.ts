// Tunable settings. These are code, not environment: change a value, push, and
// the deploy workflow ships it. Secrets live in src/config.ts.

export const settings = {
  // --- Money ---
  // false = paper trading: everything runs, but no real orders are sent.
  // Flip to false only after paper results look good.
  dryRun: true,
  // Muted: no per-bet Telegram messages. Problems are saved and everything is reported in one
  // daily summary (23:30 WAT). Your own /scan still answers. Set false to hear about every bet.
  quiet: false,
  // the bot only ever works with this much; anything above it is withdrawable profit
  capitalNgn: 10_000,
  // fraction of full Kelly to bet (0.25 = quarter Kelly)
  kellyFraction: 0.25,
  // hard cap on a single bet, as a fraction of capital
  maxBetFraction: 0.1,
  // Small edges often size below a market's minimum order (₦100-₦500). Bet the minimum instead,
  // if it's at most this fraction of the bankroll (0.05 = ₦500 of ₦10,000). 0 turns it off.
  minimumStakeFraction: 0.05,
  // minimum expected return after fees and price impact (0.05 = +5%)
  minEdge: 0.02,
  // minutes you have to cancel a bet on Telegram before it's placed. 0 = place it within the scan
  // that found it (use with `quiet`: nobody is watching to cancel). Set back to 30 when un-muting.
  cancelWindowMinutes: 0,
  maxSlippage: 0.02,

  // --- Research ---
  // Gemini searches the web (Google Search, 5,000 free a month) and writes a fact brief;
  // the OpenAI model screens markets and makes the betting call from that brief.
  // Prices for both live in src/llm/pricing.ts.
  searchModel: "gemini-3.8-flash",
  reasoningModel: "gpt-6-luna",
  // hard cap on estimated research spend (both models) per UTC day, in USD
  dailyResearchBudgetUsd: 0.6,
  maxDeepDivesPerScan: 10,
  // don't re-research an event within this window; prices and data move, so re-check a few times a day
  researchCooldownHours: 8,
  // Markets that settle on measurable public data (prices, rates, temperatures, counts, charts,
  // official statistics), plus sports matches (back in from 2026-09-26; bookmaker odds are the
  // evidence there). Categories are a first cut: screening then drops anything decided by a
  // person's choice (awards, evictions, elections). Player-stat markets, politics, awards,
  // reality TV, culture and tech deals are left out. Names are matched uppercase.
  categories: [
    "CRYPTO",
    "FINANCE",
    "ECONOMY",
    "ECONOMICS",
    "SOCIAL MEDIA",
    "ENTERTAINMENT",
    "OTHERS",
    "SPORTS",
  ],
  // Market kinds (src/data/kind.ts) never researched or bet on. Likes/views/reposts/followers can
  // be pushed by anyone who buys bots, and Bayse voids them more often for manipulation. Match
  // stats (shots, passes, corners) have no bookmaker lines to check against, so bets on them
  // were guesses (from 2026-09-28).
  excludedKinds: ["engagement", "match-stats"],
  // Kinds that are only bet on with a live reading. For sports that means current bookmaker odds
  // for the line: without them the model is guessing from averages (from 2026-09-28).
  liveReadingRequiredKinds: ["sports"],
  // only consider events that resolve within this many hours (7 days), so capital isn't tied up for long
  maxHoursToResolve: 168,
  // trading must stay open at least this long: the cancel window plus a margin to place the bet
  minMinutesBeforeClose: 60,

  // --- Schedule when running locally ---
  // (on Cloud Run, Cloud Scheduler drives these; see .github/workflows/deploy-cloudrun.yml)
  // 6 scans a day (every 4h from 00:00 WAT): about 3,200 Google searches a month, safely inside
  // the 5,000 free (8 a day would run close); the daily budget still caps spend
  scanEveryMinutes: 240,
  tickEveryMinutes: 1,
  // late-price study: records settled markets (no Gemini); must stay under 11 hours (see src/jobs/study.ts)
  studyEveryMinutes: 360,

  bayseBaseUrl: "https://relay.bayse.markets",
} as const;
