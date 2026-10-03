import { settings } from "@/settings.ts";
import type { Exchange, ExchangeName } from "./types.ts";

type ExchangeOverrides = {
  kinds?: readonly string[] | null;
  maxBetFraction?: number;
  minimumStakeFraction?: number;
};

const overrides = (name: ExchangeName) => settings.exchanges[name] as ExchangeOverrides;

// Paper unless the exchange is set live (settings.exchanges) and has an account connected
export const isDryRun = (exchange: Pick<Exchange, "name" | "canTrade">) =>
  settings.exchanges[exchange.name].dryRun || !exchange.canTrade;

// The market kinds an exchange researches, or null for every kind the global filters allow
export const allowedKinds = (name: ExchangeName) => overrides(name).kinds ?? null;

// Bet-size limits for an exchange: its own overrides, else the defaults in settings
export const sizingFor = (name: ExchangeName) => ({
  maxBetFraction: overrides(name).maxBetFraction ?? settings.maxBetFraction,
  minimumStakeFraction: overrides(name).minimumStakeFraction ?? settings.minimumStakeFraction,
});
