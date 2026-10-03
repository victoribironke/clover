// Tunable settings. These are code, not environment: change a value, push, and
// the deploy workflow ships it. Secrets live in src/config.ts.

export const settings = {
  // --- Exchanges ---
  // Each exchange has its own capital, in its own currency: the bot only ever works with that
  // much, and anything above it is withdrawable profit. dryRun true = paper trading: everything
  // runs, but no real orders are sent. Flip to false only after paper results look good.
  // `kinds`: the only market kinds (src/data/kind.ts) researched there; null = everything the
  // filters below allow. Weather only everywhere from 2026-10-03: Kalshi weather went 9 of 14
  // (+$73 on $100 paper) while everything else on Bayse lost.
  // `maxBetFraction` / `minimumStakeFraction` override the defaults below. A $5 bankroll needs
  // bigger fractions to place anything: Kalshi's smallest order is 1 contract (up to $0.99),
  // Polymarket's is 5 shares ($2.50 at 50¢).
  exchanges: {
    // NGN. Researched with AI (Gemini search + gpt-6-luna), plus the weather ensemble Data line.
    bayse: { enabled: true, dryRun: true, capital: 10_000, research: "ai", kinds: ["weather"] },
    // USD, paper only for now: no account is connected, it reads Kalshi's public market data
    // (from 2026-09-30). Daily US high/low temperature markets, priced from a weather-model
    // ensemble plus the settlement station's own readings, with no AI calls
    // (src/research/weather-model.ts). Capital $100 until 2026-10-03, then $5.
    kalshi: {
      enabled: true,
      dryRun: true,
      capital: 5,
      research: "weather-model",
      kinds: ["weather"],
      maxBetFraction: 0.2,
      minimumStakeFraction: 0.2,
    },
    // USD, paper only for now (from 2026-10-03): public market data, no wallet connected. Daily
    // high/low temperature markets in ~50 cities, settled on an airport's hourly reports
    // (src/research/weather-model.ts). Its 5-share minimum means a $5 bankroll can only buy
    // outcomes priced up to 20¢ at these fractions ($1 a bet).
    polymarket: {
      enabled: true,
      dryRun: true,
      capital: 5,
      research: "weather-model",
      kinds: ["weather"],
      maxBetFraction: 0.2,
      minimumStakeFraction: 0.2,
    },
  },
  // Muted: no per-bet Telegram messages. Problems are saved and everything is reported in one
  // daily summary (23:30 WAT). Your own /scan still answers. Set false to hear about every bet.
  quiet: false,
  // fraction of full Kelly to bet (0.25 = quarter Kelly)
  kellyFraction: 0.25,
  // hard cap on a single bet, as a fraction of capital
  maxBetFraction: 0.1,
  // Small edges often size below a market's minimum order (₦100-₦500 on Bayse, $1 on Kalshi).
  // Bet the minimum instead, if it's at most this fraction of the bankroll (0.05 = ₦500 of
  // ₦10,000). 0 turns it off.
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
  // Bayse categories (Kalshi only lists the series below, so it has no category filter).
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
  // were guesses (from 2026-09-28). Prices (crypto/stock up-or-down, thresholds, "best performing
  // stock") are close to coin flips with no data edge: 0 of 2 settled, -₦1,551 (from 2026-09-30).
  excludedKinds: ["engagement", "match-stats", "price"],
  // Kinds that are only bet on with a live reading. For sports that means current bookmaker odds
  // for the line: without them the model is guessing from averages (from 2026-09-28). Post counts
  // need the count so far: on posting history alone the bot overrated "X or more" and won 5 of
  // 27 (-₦3,029, from 2026-09-30). Weather: Bayse's always has one (the ensemble for its reading
  // hour); on Kalshi it means the station's readings after the day's peak (src/research/weather-model.ts).
  liveReadingRequiredKinds: ["sports", "post-count", "weather"],
  // Never buy an outcome priced below this: long shots like "0-0 draw" at 5% were ₦100 lottery
  // tickets let through by minimum-stake rounding (from 2026-09-30)
  minOutcomePrice: 0.1,
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

  // Kalshi scans run every 2 hours (clover-scan-kalshi): no AI cost, and same-day station
  // readings change the picture through the day
  kalshiScanEveryMinutes: 120,
  // Polymarket scans with Kalshi (clover-scan-weather, every 2 hours)
  polymarketScanEveryMinutes: 120,

  bayseBaseUrl: "https://relay.bayse.markets",
  kalshiBaseUrl: "https://external-api.kalshi.com/trade-api/v2",
  // Polymarket: Gamma lists events, the CLOB serves order books (both public)
  polymarketGammaUrl: "https://gamma-api.polymarket.com",
  polymarketClobUrl: "https://clob.polymarket.com",
  // Kalshi's daily US temperature series (checked 2026-09-30: all have open events every day).
  // Each settles on one NWS climate station, named in the rules as "(CLIxxx)".
  kalshiSeries: [
    // daily highs
    "KXHIGHNY",
    "KXHIGHCHI",
    "KXHIGHMIA",
    "KXHIGHLAX",
    "KXHIGHDEN",
    "KXHIGHAUS",
    "KXHIGHPHIL",
    "KXHIGHTATL",
    "KXHIGHTBOS",
    "KXHIGHTDAL",
    "KXHIGHTDC",
    "KXHIGHTEWR",
    "KXHIGHTHOU",
    "KXHIGHTLV",
    "KXHIGHTMIN",
    "KXHIGHTNOLA",
    "KXHIGHTOKC",
    "KXHIGHTPHX",
    "KXHIGHTSAN",
    "KXHIGHTSATX",
    "KXHIGHTSDF",
    "KXHIGHTSEA",
    "KXHIGHTSFO",
    "KXHIGHTTTN",
    // daily lows
    "KXLOWTNYC",
    "KXLOWTCHI",
    "KXLOWTMIA",
    "KXLOWTLAX",
    "KXLOWTDEN",
    "KXLOWTAUS",
    "KXLOWTPHIL",
    "KXLOWTATL",
    "KXLOWTBOS",
    "KXLOWTDAL",
    "KXLOWTDC",
    "KXLOWTEWR",
    "KXLOWTHOU",
    "KXLOWTLV",
    "KXLOWTMIN",
    "KXLOWTNOLA",
    "KXLOWTOKC",
    "KXLOWTPHX",
    "KXLOWTSAN",
    "KXLOWTSATX",
    "KXLOWTSDF",
    "KXLOWTSEA",
    "KXLOWTSFO",
    "KXLOWTTTN",
  ],
} as const;

export type ExchangeSettings = (typeof settings.exchanges)[keyof typeof settings.exchanges];
