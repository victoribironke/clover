import type {
  Currency,
  EventStatus,
  Exchange,
  Market,
  MarketEvent,
  Outcome,
  PlacedOrder,
  Quote,
} from "@/exchanges/types.ts";
import { createBayseHttp, type BayseHttpOptions } from "./http.ts";

// Raw API shapes: only the fields we read. See https://docs.bayse.markets/api-reference/pm/list-events
export type RawMarket = {
  id: string;
  title: string;
  status: string;
  rules?: string;
  outcome1Id: string;
  outcome1Label: string;
  outcome1Price: number;
  outcome2Id: string;
  outcome2Label: string;
  outcome2Price: number;
  minimumOrderAmount?: number;
  feePercentage?: number;
  resolvedOutcomeId?: string | null;
  resolvedOutcome?: string | null;
};

type RawEvent = {
  id: string;
  slug: string;
  title: string;
  description?: string;
  additionalContext?: string;
  resolutionSource?: string;
  category: string;
  type: string;
  engine: "AMM" | "CLOB";
  status: string;
  closingDate?: string | null;
  resolutionDate?: string | null;
  resolvedAt?: string | null;
  openingDate?: string | null;
  liquidity?: number;
  totalVolume?: number;
  supportedCurrencies?: string[];
  markets: RawMarket[];
};

type RawEventsPage = {
  events: RawEvent[];
  pagination: { page: number; lastPage: number };
};

type RawQuote = {
  price: number;
  amount: number;
  quantity: number;
  currencyBaseMultiplier?: number;
  fee?: number;
  priceImpactAbsolute?: number;
  completeFill?: boolean;
};

type RawOrder = {
  id: string;
  status: string;
  amount: number;
  price?: number;
  avgFillPrice?: number;
  quantity?: number;
  createdAt?: string;
};

type RawOrderResponse = {
  engine: "AMM" | "CLOB";
  order: RawOrder;
};

type RawOrdersPage = {
  orders: RawOrder[];
};

const toPlacedOrder = (order: RawOrder): PlacedOrder => ({
  id: order.id,
  status: order.status,
  amount: order.amount,
  avgPrice: order.avgFillPrice || order.price || 0,
  shares: order.quantity ?? 0,
});

// orders in these states never bought anything
const DEAD_ORDER_STATUSES = new Set(["rejected", "cancelled", "expired"]);

type RawAssets = {
  assets: { symbol: string; availableBalance: number }[];
};

const CURRENCY: Currency = "NGN";
const PAGE_SIZE = 20;

const normalizeStatus = (status: string): EventStatus => status.toLowerCase() as EventStatus;

// The API has returned both "combined"/"single" and "COMBINED_MARKETS"/"SINGLE_MARKET"
const normalizeType = (type: string): MarketEvent["type"] => {
  const lower = type.toLowerCase();
  if (lower.startsWith("combined")) return "combined";
  if (lower.startsWith("grouped")) return "grouped";
  return "single";
};

// Resolved markets (checked against live data 2026-09-24) carry `resolvedOutcomeId`, the
// winning outcome's id, and `resolvedOutcome`: "YES" when outcome1 won, "NO" when outcome2
// won, whatever the labels are (e.g. Up/Down). Anything unrecognised returns null, so the
// bet stays open instead of being settled on a guess.
export const resolvedOutcomeId = (market: RawMarket) => {
  if (market.resolvedOutcomeId === market.outcome1Id) return market.outcome1Id;
  if (market.resolvedOutcomeId === market.outcome2Id) return market.outcome2Id;
  const side = market.resolvedOutcome?.toUpperCase();
  if (side === "YES") return market.outcome1Id;
  if (side === "NO") return market.outcome2Id;
  return null;
};

const toMarket = (market: RawMarket): Market => {
  const outcome1: Outcome = { id: market.outcome1Id, label: market.outcome1Label, price: market.outcome1Price };
  const outcome2: Outcome = { id: market.outcome2Id, label: market.outcome2Label, price: market.outcome2Price };
  return {
    id: market.id,
    title: market.title,
    rules: market.rules ?? "",
    status: normalizeStatus(market.status),
    outcomes: [outcome1, outcome2],
    minOrderAmount: market.minimumOrderAmount ?? 100,
    feePercentage: market.feePercentage ?? 0,
    resolvedOutcomeId: resolvedOutcomeId(market),
  };
};

const toEvent = (event: RawEvent): MarketEvent => ({
  exchange: "bayse",
  id: event.id,
  slug: event.slug,
  title: event.title.trim(),
  description: event.description ?? "",
  additionalContext: event.additionalContext ?? "",
  resolutionSource: event.resolutionSource ?? "",
  category: event.category.toUpperCase(),
  type: normalizeType(event.type),
  engine: event.engine,
  status: normalizeStatus(event.status),
  closingDate: event.closingDate || null,
  resolutionDate: event.resolutionDate || null,
  resolvedAt: event.resolvedAt || null,
  openingDate: event.openingDate || null,
  liquidity: event.liquidity ?? 0,
  totalVolume: event.totalVolume ?? 0,
  supportedCurrencies: (event.supportedCurrencies ?? ["USD"]) as Currency[],
  markets: event.markets.map(toMarket),
});

export const createBayseExchange = (options: BayseHttpOptions): Exchange => {
  const http = createBayseHttp(options);

  const listOpenEvents = async () => {
    const events: MarketEvent[] = [];
    for (let page = 1; ; page++) {
      const result = await http.request<RawEventsPage>("GET", "/v1/pm/events", {
        auth: "read",
        query: { status: "open", currency: CURRENCY, page, size: PAGE_SIZE },
      });
      events.push(...result.events.map(toEvent));
      if (page >= result.pagination.lastPage || result.events.length === 0) break;
    }
    return events;
  };

  const getEvent = async (eventId: string) =>
    toEvent(
      await http.request<RawEvent>("GET", `/v1/pm/events/${eventId}`, {
        auth: "read",
        query: { currency: CURRENCY },
      }),
    );

  const quote: Exchange["quote"] = async ({ eventId, marketId, outcomeId, amount }) => {
    const raw = await http.request<RawQuote>("POST", `/v1/pm/events/${eventId}/markets/${marketId}/quote`, {
      auth: "read",
      body: { side: "BUY", outcomeId, amount, currency: CURRENCY },
    });
    // Derive the price actually paid from shares received. On CLOB buys the fee is
    // taken out of the shares, so `raw.price` alone understates the real cost.
    const multiplier = raw.currencyBaseMultiplier ?? 100;
    const result: Quote = {
      avgPrice: raw.quantity > 0 ? raw.amount / (raw.quantity * multiplier) : Number.POSITIVE_INFINITY,
      amount: raw.amount,
      shares: raw.quantity,
      fee: raw.fee ?? 0,
      priceImpact: raw.priceImpactAbsolute ?? 0,
      completeFill: raw.completeFill ?? true,
    };
    return result;
  };

  const placeOrder: Exchange["placeOrder"] = async ({ eventId, marketId, outcomeId, amount, maxSlippage }) => {
    const { order } = await http.request<RawOrderResponse>(
      "POST",
      `/v1/pm/events/${eventId}/markets/${marketId}/orders`,
      {
        auth: "write",
        body: { side: "BUY", outcomeId, amount, type: "MARKET", currency: CURRENCY, maxSlippage },
      },
    );
    return toPlacedOrder(order);
  };

  // https://docs.bayse.markets/api-reference/pm/list-orders
  const findOrders: Exchange["findOrders"] = async ({ eventId, marketId, outcomeId, sinceIso }) => {
    const { orders } = await http.request<RawOrdersPage>("GET", "/v1/pm/orders", {
      auth: "read",
      query: { side: "BUY", eventId, marketId, outcomeId, currency: CURRENCY, size: 50 },
    });
    return orders
      .filter((order) => !DEAD_ORDER_STATUSES.has(order.status.toLowerCase()))
      .filter((order) => !order.createdAt || Date.parse(order.createdAt) >= Date.parse(sinceIso))
      .map(toPlacedOrder);
  };

  // Bayse lists settled events roughly newest first (checked 2026-09-25), so page until a whole
  // page is older than `since`; a page cap guards against that ordering ever changing.
  const listSettledEvents: Exchange["listSettledEvents"] = async (status, since) => {
    const events: MarketEvent[] = [];
    const cutoff = since.getTime();
    const settledAt = (event: MarketEvent) => Date.parse(event.resolvedAt ?? event.resolutionDate ?? event.closingDate ?? "") || 0;
    for (let page = 1; page <= 100; page++) {
      const result = await http.request<RawEventsPage>("GET", "/v1/pm/events", {
        auth: "read",
        query: { status, currency: CURRENCY, page, size: PAGE_SIZE },
      });
      const batch = result.events.map(toEvent);
      events.push(...batch.filter((event) => settledAt(event) >= cutoff));
      if (batch.every((event) => settledAt(event) < cutoff) || page >= result.pagination.lastPage) break;
    }
    return events;
  };

  // The live response is { markets: [{ marketId, priceHistory: [{ e: epochMs, p: price }] }] },
  // not the map shown in the docs. 12H gives 1-minute points.
  const priceHistory: Exchange["priceHistory"] = async (eventId) => {
    const result = await http.request<{ markets?: { marketId: string; priceHistory?: { e: number; p: number }[] }[] }>(
      "GET",
      `/v1/pm/events/${eventId}/price-history`,
      { auth: "read", query: { timePeriod: "12H" } },
    );
    return Object.fromEntries(
      (result.markets ?? []).map((market) => [
        market.marketId,
        (market.priceHistory ?? [])
          // order-book markets with no trades report p = 0 ("no last trade"), not a real 0% price
          .filter((point) => point.p > 0 && point.p < 1)
          .map((point) => ({ t: point.e, p: point.p }))
          .sort((a, b) => a.t - b.t),
      ]),
    );
  };

  const getAvailableBalance = async () => {
    const { assets } = await http.request<RawAssets>("GET", "/v1/wallet/assets", { auth: "read" });
    return assets.find((asset) => asset.symbol === CURRENCY)?.availableBalance ?? 0;
  };

  return {
    name: "bayse",
    currency: CURRENCY,
    payoutPerShare: 100,
    listOpenEvents,
    getEvent,
    quote,
    placeOrder,
    findOrders,
    getAvailableBalance,
    listSettledEvents,
    priceHistory,
  };
};
