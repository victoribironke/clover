"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { Mode } from "@/lib/analytics";
import type { PanelData } from "@/lib/panel-data";

type PanelContext = PanelData & { mode: Mode; setMode: (mode: Mode) => void };

const Context = createContext<PanelContext | null>(null);

type PanelProviderProps = { data: PanelData; children: ReactNode };

// Holds the panel's data and the paper/live switch. The layout passes fresh data after a Refresh;
// the switch lives in state here, so it survives both page changes and refreshes.
export const PanelProvider = ({ data, children }: PanelProviderProps) => {
  // default to whatever the bot is doing when the panel is first opened
  const [mode, setMode] = useState<Mode>(data.botSettings.dryRun ? "paper" : "live");
  return <Context.Provider value={{ ...data, mode, setMode }}>{children}</Context.Provider>;
};

export const usePanel = () => {
  const context = useContext(Context);
  if (!context) throw new Error("usePanel must be used inside PanelProvider");
  return context;
};
