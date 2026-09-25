// Tunable settings. These are code, not environment: change a value, push, and
// the deploy workflow ships it. Secrets live in src/config.ts.

export const settings = {
  // --- Money ---
  // false = paper trading: everything runs, but no real orders are sent.
  // Flip to false only after paper results look good.
  dryRun: true,
  // the bot only ever works with this much; anything above it is withdrawable profit
  capitalNgn: 10_000,
  // fraction of full Kelly to bet (0.25 = quarter Kelly)
  kellyFraction: 0.25,
  // hard cap on a single bet, as a fraction of capital
  maxBetFraction: 0.1,
  // minimum expected return after fees and price impact (0.05 = +5%)
  minEdge: 0.03,
  // minutes you have to cancel a bet on Telegram before it's placed
  cancelWindowMinutes: 30,
  maxSlippage: 0.02,

  // --- Research ---
  // one model for everything: screening and deep research (web search via Google)
  model: "gemini-3.8-flash",
  // hard cap on estimated Gemini spend per UTC day, in USD
  dailyResearchBudgetUsd: 0.25,
  maxDeepDivesPerScan: 4,
  // don't re-research an event within this window; prices and data move, so re-check daily
  researchCooldownHours: 24,
  // Only markets that settle on measurable public data (prices, rates, temperatures, counts,
  // charts, official statistics). Categories are a first cut: screening then drops any event
  // in them that's decided by a person's choice or performance. Sports, politics, awards,
  // reality TV, culture and tech deals are left out. Names are matched uppercase.
  categories: ["CRYPTO", "FINANCE", "ECONOMY", "ECONOMICS", "SOCIAL MEDIA", "ENTERTAINMENT", "OTHERS"],
  // only consider events that resolve within this many hours (7 days), so capital isn't tied up for long
  maxHoursToResolve: 168,
  // trading must stay open at least this long: the cancel window plus a margin to place the bet
  minMinutesBeforeClose: 60,

  // --- Schedule when running locally ---
  // (on Cloud Run, Cloud Scheduler drives these; see .github/workflows/deploy-cloudrun.yml)
  // 8 scans a day; the daily budget still caps spend
  scanEveryMinutes: 180,
  tickEveryMinutes: 1,

  bayseBaseUrl: "https://relay.bayse.markets",
} as const;
