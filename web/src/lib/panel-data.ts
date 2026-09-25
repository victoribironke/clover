import "server-only";
import { loadAnalysesByIds, loadAnalyses, loadBets, loadBotSettings, loadSpend, loadStudySummary, loadWallet } from "./data";
import type { Analysis, Bet, BotSettings, SpendDay, StudySummary, WalletSnapshot } from "./types";

// Everything the panel shows, loaded once by the panel layout. Pages read it from context, so
// switching paper/live, filtering and moving between pages never fetch again. Only the Refresh
// button (router.refresh) or a browser reload loads it anew.
export type PanelData = {
  bets: Bet[];
  // latest research, plus any older analysis a bet points at (for bet detail pages)
  analyses: Analysis[];
  botSettings: BotSettings;
  spend: SpendDay[];
  wallet: WalletSnapshot | null;
  study: StudySummary | null;
  fetchedAt: string;
};

export const loadPanelData = async (): Promise<PanelData> => {
  const [bets, recent, botSettings, spend, wallet, study] = await Promise.all([
    loadBets(),
    loadAnalyses(200),
    loadBotSettings(),
    loadSpend(),
    loadWallet(),
    loadStudySummary(),
  ]);
  const have = new Set(recent.map((analysis) => analysis.id));
  const missing = [...new Set(bets.map((bet) => bet.analysisId).filter((id): id is string => Boolean(id) && !have.has(id!)))];
  const older = await loadAnalysesByIds(missing);

  return { bets, analyses: [...recent, ...older], botSettings, spend, wallet, study, fetchedAt: new Date().toISOString() };
};
