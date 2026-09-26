// Tunable settings. These are code, not environment: change a value, push, and
// the deploy workflow ships it. Secrets live in src/config.ts.

export const settings = {
  // --- Money ---
  // false = paper trading: everything runs, but no real orders are sent.
  // Flip to false only after paper results look good.
  dryRun: true,
  // Muted: no per-bet Telegram messages. Problems are saved and everything is reported in one
  // daily summary (23:30 WAT). Your own /scan still answers. Set false to hear about every bet.
  quiet: true,
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
  // one model for everything: screening and deep research (web search via Google)
  model: "gemini-3.8-flash",
  // hard cap on estimated Gemini spend per UTC day, in USD
  dailyResearchBudgetUsd: 1,
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
  // Market kinds (src/data/kind.ts) never bet on. Likes/views/reposts/followers can be pushed
  // by anyone who buys bots, and Bayse voids them more often for manipulation.
  excludedKinds: ["engagement"],
  // only consider events that resolve within this many hours (7 days), so capital isn't tied up for long
  maxHoursToResolve: 168,
  // trading must stay open at least this long: the cancel window plus a margin to place the bet
  minMinutesBeforeClose: 60,

  // --- Schedule when running locally ---
  // (on Cloud Run, Cloud Scheduler drives these; see .github/workflows/deploy-cloudrun.yml)
  // 4 scans a day (00:00, 06:00, 12:00, 18:00 WAT); the daily budget still caps spend
  scanEveryMinutes: 360,
  tickEveryMinutes: 1,
  // late-price study: records settled markets (no Gemini); must stay under 11 hours (see src/jobs/study.ts)
  studyEveryMinutes: 360,

  bayseBaseUrl: "https://relay.bayse.markets",
} as const;
