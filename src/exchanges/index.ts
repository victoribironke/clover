import { config } from "@/config.ts";
import { settings } from "@/settings.ts";
import { createBayseExchange } from "./bayse/adapter.ts";
import { createKalshiExchange } from "./kalshi/adapter.ts";
import type { Exchange, ExchangeName } from "./types.ts";

export { isDryRun } from "./mode.ts";

export const bayse = createBayseExchange({
  baseUrl: settings.bayseBaseUrl,
  publicKey: config.BAYSE_PUBLIC_KEY,
  secretKey: config.BAYSE_SECRET_KEY,
});

export const kalshi = createKalshiExchange({
  baseUrl: settings.kalshiBaseUrl,
  series: settings.kalshiSeries,
});

const ALL: Record<ExchangeName, Exchange> = { bayse, kalshi };

// the exchanges turned on in settings.exchanges, Bayse first
export const exchanges = Object.values(ALL).filter(
  (exchange) => settings.exchanges[exchange.name].enabled,
);

export const getExchange = (name: ExchangeName) => ALL[name];

export const isExchangeName = (name: string | null): name is ExchangeName =>
  name !== null && name in ALL;
