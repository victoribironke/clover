import { config } from "@/config.ts";
import { createBayseExchange } from "./bayse/adapter.ts";

export const exchange = createBayseExchange({
  baseUrl: config.BAYSE_BASE_URL,
  publicKey: config.BAYSE_PUBLIC_KEY,
  secretKey: config.BAYSE_SECRET_KEY,
});
