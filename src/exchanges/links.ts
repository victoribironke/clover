import type { ExchangeName } from "./types.ts";

// Public page for an event on its exchange. Bayse's pattern comes from its sitemap
// (https://www.bayse.markets/sitemap.xml): app.bayse.markets/market/{eventId}. Kalshi's pages are
// per series: kalshi.com/markets/{series}, and the series is the event ticker's first part.
const EVENT_URL: Record<ExchangeName, (eventId: string) => string> = {
  bayse: (eventId) => `https://app.bayse.markets/market/${encodeURIComponent(eventId)}`,
  kalshi: (eventId) =>
    `https://kalshi.com/markets/${encodeURIComponent(eventId.split("-")[0]!.toLowerCase())}`,
  // Polymarket event ids are their slugs
  polymarket: (eventId) => `https://polymarket.com/event/${encodeURIComponent(eventId)}`,
};

export const eventUrl = (exchange: ExchangeName, eventId: string) => EVENT_URL[exchange](eventId);
