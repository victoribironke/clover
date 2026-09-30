import { settings } from "@/settings.ts";
import type { Exchange } from "./types.ts";

// Paper unless the exchange is set live (settings.exchanges) and has an account connected
export const isDryRun = (exchange: Pick<Exchange, "name" | "canTrade">) =>
  settings.exchanges[exchange.name].dryRun || !exchange.canTrade;
