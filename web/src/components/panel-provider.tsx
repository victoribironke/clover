"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { Mode } from "@/lib/analytics";
import { money, signedMoney } from "@/lib/format";
import type { PanelData } from "@/lib/panel-data";
import type { Analysis, Bet, Venue } from "@/lib/types";

type PanelContext = PanelData & {
  // every bet, whichever exchange (bet pages look bets up by id)
  allBets: Bet[];
  allAnalyses: Analysis[];
  mode: Mode;
  setMode: (mode: Mode) => void;
  venue: Venue;
  setVenue: (venue: Venue) => void;
  // the selected exchange's capital and paper/live setting
  capital: number;
  botDryRun: boolean;
  // amounts in the selected exchange's currency (₦ on Bayse, $ on Kalshi)
  money: (amount: number) => string;
  signedMoney: (amount: number) => string;
};

const Context = createContext<PanelContext | null>(null);

type PanelProviderProps = { data: PanelData; children: ReactNode };

// Kalshi's paper capital until the bot publishes its settings with it
const FALLBACK_CAPITAL: Record<Venue, number> = { bayse: 10_000, kalshi: 100 };

// Holds the panel's data and the exchange and paper/live switches. The layout passes fresh data
// after a Refresh; the switches live in state here, so they survive page changes and refreshes.
// `bets` is only the selected exchange's: every view that sums money stays in one currency.
export const PanelProvider = ({ data, children }: PanelProviderProps) => {
  const [venue, setVenue] = useState<Venue>("bayse");
  const settings = data.botSettings.exchanges?.[venue];
  const botDryRun = settings?.dryRun ?? (venue === "bayse" ? data.botSettings.dryRun : true);
  // default to whatever the bot is doing on Bayse when the panel is first opened
  const [mode, setMode] = useState<Mode>(data.botSettings.dryRun ? "paper" : "live");

  const value = useMemo<PanelContext>(() => {
    const currency = venue === "kalshi" ? "USD" : "NGN";
    return {
      ...data,
      allBets: data.bets,
      allAnalyses: data.analyses,
      bets: data.bets.filter((bet) => (bet.exchange ?? "bayse") === venue),
      analyses: data.analyses.filter((analysis) => (analysis.exchange ?? "bayse") === venue),
      mode,
      setMode,
      venue,
      setVenue,
      capital:
        settings?.capital ??
        (venue === "bayse" ? data.botSettings.capitalNgn : FALLBACK_CAPITAL[venue]),
      botDryRun,
      money: (amount) => money(amount, currency),
      signedMoney: (amount) => signedMoney(amount, currency),
    };
  }, [data, mode, venue, settings, botDryRun]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
};

export const usePanel = () => {
  const context = useContext(Context);
  if (!context) throw new Error("usePanel must be used inside PanelProvider");
  return context;
};
