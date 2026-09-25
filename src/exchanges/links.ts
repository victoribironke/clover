import type { ExchangeName } from "./types.ts";

// Public page for an event on its exchange. Bayse's pattern comes from its sitemap
// (https://www.bayse.markets/sitemap.xml): app.bayse.markets/market/{eventId}.
const EVENT_URL: Record<ExchangeName, (eventId: string) => string> = {
  bayse: (eventId) => `https://app.bayse.markets/market/${encodeURIComponent(eventId)}`,
};

export const eventUrl = (exchange: ExchangeName, eventId: string) => EVENT_URL[exchange](eventId);
