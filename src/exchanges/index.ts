import { config } from "@/config.ts";
import { settings } from "@/settings.ts";
import { createBayseExchange } from "./bayse/adapter.ts";

export const exchange = createBayseExchange({
  baseUrl: settings.bayseBaseUrl,
  publicKey: config.BAYSE_PUBLIC_KEY,
  secretKey: config.BAYSE_SECRET_KEY,
});
