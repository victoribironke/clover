import type {
  EventStatus,
  Exchange,
  Market,
  MarketEvent,
  Outcome,
  Quote,
} from "@/exchanges/types.ts";

// Kalshi, read-only: its market data is public (no key, no account). Paper trading works fully:
// quotes walk the live order book and include Kalshi's fee. Placing orders needs an account and
// is not connected. https://docs.kalshi.com/api-reference

// Raw API shapes: only the fields we read. Prices are fixed-point dollar strings ("0.3700").
export type RawKalshiMarket = {
  ticker: string;
  event_ticker: string;
  status: string;
  yes_sub_title?: string;
  rules_primary?: string;
  yes_ask_dollars?: string;
  no_ask_dollars?: string;
  result?: string;
  close_time?: string;
  expected_expiration_time?: string;
  strike_type?: string;
  floor_strike?: number;
  cap_strike?: number;
  volume_fp?: string;
};

export type RawKalshiEvent = {
  event_ticker: string;
  series_ticker: string;
  title: string;
  sub_title?: string;
  category?: string;
  mutually_exclusive?: boolean;
  settlement_sources?: { name: string; url: string }[];
  markets?: RawKalshiMarket[];
};

// Bids per side: [price, contracts] as dollar strings, lowest price first
export type RawOrderbook = {
  orderbook_fp?: { yes_dollars?: [string, string][]; no_dollars?: [string, string][] };
};

type FetchJson = <T>(path: string) => Promise<T>;

export type KalshiOptions = {
  baseUrl: string;
  // series tickers to scan, e.g. "KXHIGHNY"
  series: readonly string[];
  // quadratic taker fee: ceil(rate × contracts × price × (1 - price)) to the cent (0.07 for these series)
  feeRate?: number;
  fetchJson?: FetchJson;
};

const num = (value: string | undefined) => (value === undefined ? NaN : Number(value));

// An ask of 0 or 1 means nobody is offering that side: price it at 1 so it's never bought
const askPrice = (value: string | undefined) => {
  const price = num(value);
  return Number.isFinite(price) && price > 0 && price < 1 ? price : 1;
};

// active -> open; determined/settled/finalized -> resolved once there's a result
const marketStatus = (market: RawKalshiMarket): EventStatus => {
  const status = market.status.toLowerCase();
  if (status === "active" || status === "open") return "open";
  if (status === "initialized" || status === "unopened") return "draft";
  if (status === "voided") return "cancelled";
  if (market.result === "yes" || market.result === "no") return "resolved";
  return "closed";
};

// Kalshi temperature strikes are whole degrees. "greater 82" = 83 or above; "less 75" = 74 or
// below; "between 75 76" = 75 or 76.
export const strikeRange = (market: RawKalshiMarket): Market["range"] => {
  const floor = market.floor_strike ?? null;
  const cap = market.cap_strike ?? null;
  switch (market.strike_type) {
    case "greater":
      return floor === null ? undefined : { min: Math.floor(floor) + 1, max: null };
    case "greater_or_equal":
      return floor === null ? undefined : { min: Math.ceil(floor), max: null };
    case "less":
      return cap === null ? undefined : { min: null, max: Math.ceil(cap) - 1 };
    case "less_or_equal":
      return cap === null ? undefined : { min: null, max: Math.floor(cap) };
    case "between":
      return floor === null || cap === null ? undefined : { min: floor, max: cap };
    default:
      return undefined;
  }
};

export const toMarket = (market: RawKalshiMarket): Market => {
  const yes: Outcome = {
    id: `${market.ticker}:yes`,
    label: "Yes",
    price: askPrice(market.yes_ask_dollars),
  };
  const no: Outcome = {
    id: `${market.ticker}:no`,
    label: "No",
    price: askPrice(market.no_ask_dollars),
  };
  return {
    id: market.ticker,
    title: market.yes_sub_title || market.ticker,
    rules: market.rules_primary ?? "",
    status: marketStatus(market),
    outcomes: [yes, no],
    // the floor is one contract (under $1); any amount that buys one is fine
    minOrderAmount: 0.01,
    minShares: 1,
    // Kalshi's fee is charged per trade and included in quotes
    feePercentage: 0,
    resolvedOutcomeId: market.result === "yes" ? yes.id : market.result === "no" ? no.id : null,
    range: strikeRange(market),
  };
};

const eventStatus = (markets: Market[]): EventStatus => {
  if (markets.some((market) => market.status === "open")) return "open";
  if (markets.length > 0 && markets.every((market) => market.status === "cancelled"))
    return "cancelled";
  if (
    markets.length > 0 &&
    markets.every((market) => market.status === "resolved" || market.status === "cancelled")
  )
    return "resolved";
  return "closed";
};

export const toEvent = (event: RawKalshiEvent, rawMarkets: RawKalshiMarket[]): MarketEvent => {
  const markets = rawMarkets.map(toMarket);
  const first = rawMarkets[0];
  return {
    exchange: "kalshi",
    id: event.event_ticker,
    // the series ticker: Kalshi's public pages are per series
    slug: event.series_ticker,
    title: event.title.trim(),
    description: event.sub_title ?? "",
    additionalContext: "",
    resolutionSource: event.settlement_sources?.map((source) => source.name).join(", ") ?? "",
    category: (event.category ?? "").toUpperCase(),
    type: event.mutually_exclusive ? "combined" : "grouped",
    engine: "CLOB",
    status: eventStatus(markets),
    closingDate: first?.close_time ?? null,
    resolutionDate: first?.expected_expiration_time ?? first?.close_time ?? null,
    openingDate: null,
    resolvedAt: null,
    liquidity: 0,
    totalVolume: rawMarkets.reduce((total, market) => total + (num(market.volume_fp) || 0), 0),
    supportedCurrencies: ["USD"],
    markets,
  };
};

const cents = (dollars: number) => Math.ceil(dollars * 100 - 1e-9) / 100;

// Spend up to `amount` dollars buying one side, whole contracts only. Buying YES takes the NO
// bids (a NO bid at 0.30 is a YES offer at 0.70), and vice versa. The fee is charged per fill.
export const walkBook = (bids: [string, string][], amount: number, feeRate: number): Quote => {
  const offers = bids
    .map(([price, size]) => ({ price: cents(1 - Number(price)), size: Math.floor(Number(size)) }))
    .filter((offer) => offer.price > 0 && offer.price < 1 && offer.size > 0)
    .sort((a, b) => a.price - b.price);

  let left = amount;
  let shares = 0;
  let spent = 0;
  let fee = 0;
  let budgetRanOut = false;
  for (const offer of offers) {
    const feeFor = (contracts: number) =>
      cents(feeRate * contracts * offer.price * (1 - offer.price));
    const perContract = offer.price + feeRate * offer.price * (1 - offer.price);
    let affordable = Math.min(offer.size, Math.floor(left / perContract + 1e-9));
    // the fee rounds up to the cent, so the estimate can be one contract too many
    while (affordable > 0 && affordable * offer.price + feeFor(affordable) > left + 1e-9)
      affordable--;
    if (affordable > 0) {
      const levelFee = feeFor(affordable);
      const cost = affordable * offer.price + levelFee;
      shares += affordable;
      spent += cost;
      fee += levelFee;
      left -= cost;
    }
    if (affordable < offer.size) {
      budgetRanOut = true;
      break;
    }
  }

  const bestPrice = offers[0]?.price ?? 1;
  return {
    avgPrice: shares > 0 ? spent / shares : Number.POSITIVE_INFINITY,
    amount: Math.round(spent * 100) / 100,
    shares,
    fee,
    priceImpact: shares > 0 ? spent / shares - bestPrice : 0,
    // filled when we stopped for lack of money, not for lack of offers
    completeFill: shares > 0 && budgetRanOut,
  };
};

const paperOnly = () => Promise.reject(new Error("Kalshi is paper-only: no account is connected"));

export const createKalshiExchange = ({
  baseUrl,
  series,
  feeRate = 0.07,
  fetchJson,
}: KalshiOptions): Exchange => {
  // Reads only, so retrying is safe: Kalshi rate-limits anonymous callers (429) quickly
  const get: FetchJson =
    fetchJson ??
    (async <T>(path: string) => {
      for (let attempt = 0; ; attempt++) {
        const response = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(20_000) });
        if (response.ok) return (await response.json()) as T;
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable || attempt >= 4) {
          throw new Error(
            `Kalshi ${response.status} on ${path}: ${(await response.text()).slice(0, 200)}`,
          );
        }
        await Bun.sleep(1000 * 2 ** attempt);
      }
    });

  const listOpenEvents = async () => {
    const events: MarketEvent[] = [];
    // one series at a time, paced: 48 calls in ~15s stays inside the anonymous rate limit
    for (const ticker of series) {
      const page = await get<{ events?: RawKalshiEvent[] }>(
        `/events?series_ticker=${encodeURIComponent(ticker)}&status=open&with_nested_markets=true&limit=10`,
      );
      for (const event of page.events ?? []) events.push(toEvent(event, event.markets ?? []));
      await Bun.sleep(250);
    }
    return events;
  };

  const getEvent = async (eventId: string) => {
    // without with_nested_markets the markets come alongside the event (with it, the top-level
    // list is empty and they're nested instead)
    const result = await get<{ event: RawKalshiEvent; markets?: RawKalshiMarket[] }>(
      `/events/${encodeURIComponent(eventId)}`,
    );
    const markets = result.markets?.length ? result.markets : (result.event.markets ?? []);
    return toEvent(result.event, markets);
  };

  const quote: Exchange["quote"] = async ({ marketId, outcomeId, amount }) => {
    const { orderbook_fp: book } = await get<RawOrderbook>(
      `/markets/${encodeURIComponent(marketId)}/orderbook`,
    );
    const buyingYes = outcomeId.endsWith(":yes");
    return walkBook((buyingYes ? book?.no_dollars : book?.yes_dollars) ?? [], amount, feeRate);
  };

  const unsupported = () =>
    Promise.reject(new Error("Kalshi: the late-price study only runs on Bayse"));

  return {
    name: "kalshi",
    canTrade: false,
    currency: "USD",
    payoutPerShare: 1,
    listOpenEvents,
    getEvent,
    quote,
    placeOrder: paperOnly,
    findOrders: paperOnly,
    getAvailableBalance: paperOnly,
    getWallet: paperOnly,
    listSettledEvents: unsupported,
    priceHistory: unsupported,
  };
};
