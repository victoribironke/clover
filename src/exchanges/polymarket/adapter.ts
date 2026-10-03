import type {
  EventStatus,
  Exchange,
  Market,
  MarketEvent,
  Outcome,
  Quote,
} from "@/exchanges/types.ts";

// Polymarket, read-only: Gamma (events and markets) and the CLOB's order books are public, so
// paper trading needs no wallet. Placing orders needs a funded wallet and signed orders, which
// isn't connected. https://docs.polymarket.com

// Raw Gamma shapes: only the fields we read. Several fields are JSON inside strings.
export type RawPolymarketMarket = {
  id: string;
  question: string;
  groupItemTitle?: string;
  description?: string;
  // '["Yes", "No"]', '["0.445", "0.555"]', '["<yes token>", "<no token>"]'
  outcomes?: string;
  outcomePrices?: string;
  clobTokenIds?: string;
  bestBid?: number;
  bestAsk?: number;
  closed?: boolean;
  active?: boolean;
  acceptingOrders?: boolean;
  orderMinSize?: number;
  volumeNum?: number;
  feeSchedule?: { rate?: number } | null;
};

export type RawPolymarketEvent = {
  id: string;
  slug: string;
  title: string;
  description?: string;
  resolutionSource?: string;
  endDate?: string;
  negRisk?: boolean;
  markets?: RawPolymarketMarket[];
};

// Bids lowest first, asks highest first: the best of each is the last entry
export type RawBook = {
  bids?: { price: string; size: string }[];
  asks?: { price: string; size: string }[];
};

type FetchJson = <T>(url: string) => Promise<T>;

export type PolymarketOptions = {
  gammaUrl: string;
  clobUrl: string;
  fetchJson?: FetchJson;
};

const json = <T>(text: string | undefined, fallback: T): T => {
  try {
    return text ? (JSON.parse(text) as T) : fallback;
  } catch {
    return fallback;
  }
};

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

// "highest-temperature-in-london-on-october-3-2026" -> "2026-10-03"
export const slugDay = (slug: string) => {
  const match = slug.match(/-on-([a-z]+)-(\d{1,2})-(\d{4})$/);
  const month = match ? MONTHS.indexOf(match[1]!) : -1;
  if (!match || month === -1) return null;
  return `${match[3]}-${String(month + 1).padStart(2, "0")}-${match[2]!.padStart(2, "0")}`;
};

// "16°C or below", "17°C", "62-63°F", "80°F or higher" -> inclusive whole-degree range
export const bandRange = (title: string): Market["range"] => {
  const below = title.match(/^(-?\d+)\s*°[CF]\s+or\s+(below|lower)/i);
  if (below) return { min: null, max: Number(below[1]) };
  const above = title.match(/^(-?\d+)\s*°[CF]\s+or\s+(higher|above)/i);
  if (above) return { min: Number(above[1]), max: null };
  const between = title.match(/^(-?\d+)\s*-\s*(-?\d+)\s*°[CF]/);
  if (between) return { min: Number(between[1]), max: Number(between[2]) };
  const single = title.match(/^(-?\d+)\s*°[CF]$/);
  if (single) return { min: Number(single[1]), max: Number(single[1]) };
  return undefined;
};

const price = (value: number | undefined) =>
  value !== undefined && Number.isFinite(value) && value > 0 && value < 1 ? value : 1;

const marketStatus = (market: RawPolymarketMarket, prices: number[]): EventStatus => {
  if (market.closed) {
    if (prices[0] === 1 || prices[1] === 1) return "resolved";
    // closed at 50/50: refunded
    if (prices[0] === 0.5 && prices[1] === 0.5) return "cancelled";
    return "closed";
  }
  if (market.active === false) return "draft";
  return market.acceptingOrders === false ? "paused" : "open";
};

export const toMarket = (market: RawPolymarketMarket): Market => {
  const [yesToken, noToken] = json<string[]>(market.clobTokenIds, []);
  const prices = json<string[]>(market.outcomePrices, []).map(Number);
  const yes: Outcome = {
    id: yesToken ?? `${market.id}:yes`,
    label: "Yes",
    price: price(market.bestAsk),
  };
  // a NO bought here is the other side of the YES bids: it costs 1 minus the best YES bid
  const no: Outcome = {
    id: noToken ?? `${market.id}:no`,
    label: "No",
    price: market.bestBid ? price(1 - market.bestBid) : 1,
  };
  const status = marketStatus(market, prices);
  const title = market.groupItemTitle || market.question;
  return {
    id: market.id,
    title,
    rules: market.question,
    status,
    outcomes: [yes, no],
    // Polymarket's floor is in shares (minShares); any dollar amount above it is fine
    minOrderAmount: 0.01,
    minShares: market.orderMinSize ?? 5,
    // the fee depends on the price, so quotes include it
    feePercentage: 0,
    resolvedOutcomeId: status === "resolved" ? (prices[0] === 1 ? yes.id : no.id) : null,
    range: bandRange(title),
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

export const toEvent = (event: RawPolymarketEvent): MarketEvent => {
  const markets = (event.markets ?? []).map(toMarket);
  const day = slugDay(event.slug);
  // Gamma's endDate is noon UTC on the day, but trading runs until the result is in. The day ends
  // by noon UTC the next day everywhere on Earth, so that's when we treat trading as closing.
  const closes = day
    ? new Date(Date.parse(`${day}T12:00:00Z`) + 24 * 3_600_000).toISOString()
    : (event.endDate ?? null);
  return {
    exchange: "polymarket",
    // the slug: Gamma looks events up by it, and it's readable in links and logs
    id: event.slug,
    slug: event.slug,
    title: event.title.trim(),
    description: event.description ?? "",
    additionalContext: "",
    resolutionSource: event.resolutionSource ?? "",
    category: "WEATHER",
    type: event.negRisk ? "combined" : "grouped",
    engine: "CLOB",
    status: eventStatus(markets),
    closingDate: closes,
    resolutionDate: closes,
    openingDate: null,
    resolvedAt: null,
    liquidity: 0,
    totalVolume: (event.markets ?? []).reduce(
      (total, market) => total + (market.volumeNum ?? 0),
      0,
    ),
    supportedCurrencies: ["USD"],
    markets,
  };
};

// Daily temperature markets settled on NOAA's hourly airport reports, the only ones the weather
// model can price (a few settle on other sources, e.g. the Hong Kong Observatory: skipped)
export const isStationTemperature = (event: RawPolymarketEvent) =>
  /^(highest|lowest) temperature in /i.test(event.title) &&
  /weather\.gov\/wrh\/timeseries\?site=/i.test(event.resolutionSource ?? "");

const round2 = (value: number) => Math.round(value * 100) / 100;

// Spend up to `amount` dollars buying a token from its asks, in 0.01-share steps, fee included
// (fee = rate × shares × price × (1 - price), charged to takers). Below `minShares` nothing fills.
export const walkAsks = (
  asks: RawBook["asks"],
  amount: number,
  feeRate: number,
  minShares: number,
): Quote => {
  const offers = (asks ?? [])
    .map(({ price: p, size }) => ({ price: Number(p), size: Number(size) }))
    .filter((offer) => offer.price > 0 && offer.price < 1 && offer.size > 0)
    .sort((a, b) => a.price - b.price);

  let left = amount;
  let shares = 0;
  let spent = 0;
  let fee = 0;
  let budgetRanOut = false;
  for (const offer of offers) {
    const perShare = offer.price * (1 + feeRate * (1 - offer.price));
    const affordable = Math.min(offer.size, Math.floor((left / perShare) * 100 + 1e-9) / 100);
    if (affordable > 0) {
      const levelFee = feeRate * affordable * offer.price * (1 - offer.price);
      shares = round2(shares + affordable);
      spent += affordable * offer.price + levelFee;
      fee += levelFee;
      left -= affordable * offer.price + levelFee;
    }
    if (affordable < offer.size) {
      budgetRanOut = true;
      break;
    }
  }

  const bestPrice = offers[0]?.price ?? 1;
  if (shares < minShares) {
    return {
      avgPrice: Number.POSITIVE_INFINITY,
      amount: 0,
      shares: 0,
      fee: 0,
      priceImpact: 0,
      completeFill: false,
    };
  }
  return {
    avgPrice: spent / shares,
    amount: round2(spent),
    shares,
    fee,
    priceImpact: spent / shares - bestPrice,
    completeFill: budgetRanOut,
  };
};

const paperOnly = () =>
  Promise.reject(new Error("Polymarket is paper-only: no wallet is connected"));

export const createPolymarketExchange = ({
  gammaUrl,
  clobUrl,
  fetchJson,
}: PolymarketOptions): Exchange => {
  // reads only, so retrying is safe
  const get: FetchJson =
    fetchJson ??
    (async <T>(url: string) => {
      for (let attempt = 0; ; attempt++) {
        const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
        if (response.ok) return (await response.json()) as T;
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable || attempt >= 3) {
          throw new Error(
            `Polymarket ${response.status} on ${url}: ${(await response.text()).slice(0, 200)}`,
          );
        }
        await Bun.sleep(1000 * 2 ** attempt);
      }
    });

  // what a quote needs per token but the request doesn't carry
  const tokens = new Map<string, { minShares: number; feeRate: number }>();
  const remember = (event: RawPolymarketEvent) => {
    for (const market of event.markets ?? []) {
      for (const token of json<string[]>(market.clobTokenIds, [])) {
        tokens.set(token, {
          minShares: market.orderMinSize ?? 5,
          feeRate: market.feeSchedule?.rate ?? 0.05,
        });
      }
    }
  };

  const listOpenEvents = async () => {
    // today's and tomorrow's markets: Gamma's endDate is noon UTC on the market's day
    const from = new Date(Date.now() - 36 * 3_600_000).toISOString();
    const to = new Date(Date.now() + 48 * 3_600_000).toISOString();
    const events: RawPolymarketEvent[] = [];
    for (let offset = 0; offset < 2000; offset += 500) {
      const page = await get<RawPolymarketEvent[]>(
        `${gammaUrl}/events?closed=false&tag_slug=weather&end_date_min=${from}&end_date_max=${to}&limit=500&offset=${offset}`,
      );
      events.push(...page);
      if (page.length < 500) break;
    }
    const temperature = events.filter(isStationTemperature);
    temperature.forEach(remember);
    return temperature.map(toEvent);
  };

  const getEvent = async (eventId: string) => {
    const [event] = await get<RawPolymarketEvent[]>(
      `${gammaUrl}/events?slug=${encodeURIComponent(eventId)}`,
    );
    if (!event) throw new Error(`Polymarket has no event ${eventId}`);
    remember(event);
    return toEvent(event);
  };

  const quote: Exchange["quote"] = async ({ outcomeId, amount }) => {
    const book = await get<RawBook>(`${clobUrl}/book?token_id=${encodeURIComponent(outcomeId)}`);
    const token = tokens.get(outcomeId) ?? { minShares: 5, feeRate: 0.05 };
    return walkAsks(book.asks, amount, token.feeRate, token.minShares);
  };

  const unsupported = () =>
    Promise.reject(new Error("Polymarket: the late-price study only runs on Bayse"));

  return {
    name: "polymarket",
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
