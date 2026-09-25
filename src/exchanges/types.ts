// Exchange-agnostic shapes. Bayse is the first adapter; Polymarket and Kalshi
// should map onto the same types so the research/sizing/execution pipeline
// never needs to know which venue it is talking to.

export type ExchangeName = "bayse";
export type Currency = "NGN" | "USD";
export type EventStatus = "open" | "paused" | "closed" | "resolved" | "cancelled" | "draft";

export type Outcome = {
  id: string;
  label: string;
  // displayed probability price, 0..1
  price: number;
};

export type Market = {
  id: string;
  title: string;
  rules: string;
  status: EventStatus;
  // every market on these venues is binary: [outcome1, outcome2]
  outcomes: [Outcome, Outcome];
  minOrderAmount: number;
  feePercentage: number;
  resolvedOutcomeId: string | null;
};

export type MarketEvent = {
  exchange: ExchangeName;
  id: string;
  slug: string;
  title: string;
  description: string;
  additionalContext: string;
  resolutionSource: string;
  category: string;
  // single = one market; combined = mutually exclusive markets; grouped = independent markets
  type: "single" | "combined" | "grouped";
  engine: "AMM" | "CLOB";
  status: EventStatus;
  closingDate: string | null;
  resolutionDate: string | null;
  // when trading opened; set on time-boxed events (e.g. hourly FX/crypto series)
  openingDate: string | null;
  // when the exchange actually settled it (resolved/cancelled events only)
  resolvedAt: string | null;
  liquidity: number;
  totalVolume: number;
  supportedCurrencies: Currency[];
  markets: Market[];
};

export type QuoteRequest = {
  eventId: string;
  marketId: string;
  outcomeId: string;
  // amount to spend, in the exchange currency
  amount: number;
};

export type Quote = {
  // average price per share including fees and price impact, 0..1
  avgPrice: number;
  amount: number;
  shares: number;
  fee: number;
  priceImpact: number;
  completeFill: boolean;
};

export type OrderRequest = QuoteRequest & { maxSlippage: number };

export type PlacedOrder = {
  id: string;
  status: string;
  amount: number;
  avgPrice: number;
  shares: number;
};

export type OrderQuery = {
  eventId: string;
  marketId: string;
  outcomeId: string;
  // only orders created at or after this time
  sinceIso: string;
};

export type Wallet = { available: number; pending: number };

// outcome1 ("YES") price over time, per market id; t is epoch ms
export type PriceHistory = Record<string, { t: number; p: number }[]>;

export type Exchange = {
  name: ExchangeName;
  currency: Currency;
  // what one winning share pays out, in `currency` (₦100 on Bayse NGN, $1 on USD venues)
  payoutPerShare: number;
  listOpenEvents: () => Promise<MarketEvent[]>;
  getEvent: (eventId: string) => Promise<MarketEvent>;
  quote: (request: QuoteRequest) => Promise<Quote>;
  placeOrder: (request: OrderRequest) => Promise<PlacedOrder>;
  // our BUY orders that actually bought something (filled, partly filled, or resting on the book)
  findOrders: (query: OrderQuery) => Promise<PlacedOrder[]>;
  getAvailableBalance: () => Promise<number>;
  // the real wallet, in `currency`: available to trade, and pending (e.g. deposits clearing)
  getWallet: () => Promise<Wallet>;
  // newest first, stopping once events settled before `since`
  listSettledEvents: (status: "resolved" | "cancelled", since: Date) => Promise<MarketEvent[]>;
  // recent price paths; Bayse keeps 1-minute points for the last 12 hours
  priceHistory: (eventId: string) => Promise<PriceHistory>;
};
