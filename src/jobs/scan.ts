import { marketKind } from "@/data/kind.ts";
import { recentlyAnalyzedEventIds, saveAnalysis } from "@/db/analyses.ts";
import { activeBetEventIds, createBet, updateBet } from "@/db/bets.ts";
import { isPaused, releaseLock, tryLock } from "@/db/kv.ts";
import { spendToday } from "@/db/spend.ts";
import type { Exchange, ExchangeName } from "@/exchanges/types.ts";
import { errorMessage, log } from "@/lib/logger.ts";
import { isGeminiUnavailable } from "@/llm/gemini.ts";
import { isOpenAiUnavailable } from "@/llm/openai.ts";
import { deepDive } from "@/research/deep-dive.ts";
import { triageEvents } from "@/research/triage.ts";
import { settings } from "@/settings.ts";
import { getBankroll } from "@/strategy/bankroll.ts";
import { eligibleEvents } from "@/strategy/eligibility.ts";
import { proposeBet, type NearMiss } from "@/strategy/propose.ts";
import { failureMessage, lagosTime, proposalMessage, scanReportMessage } from "@/telegram/format.ts";
import { betKeyboard, notify } from "@/telegram/notify.ts";
import { runExecute } from "./execute.ts";
import { runHousekeeping } from "./housekeeping.ts";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
// No new deep dives start after this; with the models' timeouts and retries, a scan always ends
// well inside the lock's lifetime, so a crashed scan blocks the next one for 30 minutes at most.
const SCAN_DEADLINE = 15 * MINUTE;
const SCAN_LOCK_TTL = 30 * MINUTE;

export type ScanReport = {
  open: number;
  eligible: number;
  researched: number;
  proposed: number;
  // bets this scan sent for placing (its own, plus any whose cancel window ended since the last one)
  placed: number;
  // what each deep dive concluded, bet or not
  reviewed: {
    exchange: ExchangeName;
    eventId: string;
    title: string;
    summary: string;
    reading: string;
    proposed: boolean;
    nearMiss: NearMiss | null;
  }[];
  // events whose research or pricing threw; the scan carries on without them
  failed: { title: string; error: unknown }[];
  skippedReason?: string;
};

const skipped = (skippedReason: string): ScanReport => ({
  open: 0,
  eligible: 0,
  researched: 0,
  proposed: 0,
  placed: 0,
  reviewed: [],
  failed: [],
  skippedReason,
});

// The research half of a scan: pick events, deep-dive them, propose bets. Early exits (no free
// capital, budget spent) only skip research; the scan still does its bookkeeping and placing.
const researchAndPropose = async (exchange: Exchange, startedAt: number): Promise<ScanReport> => {
  const bankroll = await getBankroll(exchange);
  if (bankroll.deployable <= 0) {
    return skipped("no free capital");
  }
  if ((await spendToday()) >= settings.dailyResearchBudgetUsd) {
    return skipped("daily research budget reached");
  }

  const cooldownSince = new Date(Date.now() - settings.researchCooldownHours * HOUR).toISOString();
  const [events, recent, active] = await Promise.all([
    exchange.listOpenEvents(),
    recentlyAnalyzedEventIds(exchange.name, cooldownSince),
    activeBetEventIds(exchange.name),
  ]);
  const eligible = eligibleEvents(events, new Set([...recent, ...active]));
  const picked = await triageEvents(eligible, settings.maxDeepDivesPerScan);
  log.info("scan", { open: events.length, eligible: eligible.length, picked: picked.length });

  let researched = 0;
  const failed: ScanReport["failed"] = [];
  const reviewed: ScanReport["reviewed"] = [];
  let proposed = 0;
  for (const eventId of picked) {
    if (Date.now() - startedAt > SCAN_DEADLINE) {
      log.warn("scan deadline reached", { researched });
      break;
    }
    if ((await spendToday()) >= settings.dailyResearchBudgetUsd) {
      log.warn("daily research budget reached", { budget: settings.dailyResearchBudgetUsd });
      break;
    }
    // earlier proposals in this scan may have used up the capital; don't pay for research we can't bet on
    if ((await getBankroll(exchange)).deployable <= 0) break;
    const event = eligible.find((item) => item.id === eventId)!;
    try {
      const research = await deepDive(event);
      researched++;
      const current = await getBankroll(exchange);

      // re-read prices: research can take minutes and the market may have moved
      const fresh = await exchange.getEvent(event.id);
      const { proposal, nearMiss } = await proposeBet(exchange, fresh, research.estimates, current);
      const analysisId = await saveAnalysis(exchange.name, event, `${settings.reasoningModel} + ${settings.searchModel}`, research, {
        proposed: Boolean(proposal),
        nearMiss,
      });
      reviewed.push({
        exchange: exchange.name,
        eventId: event.id,
        title: event.title,
        summary: research.summary,
        reading: research.reading,
        proposed: Boolean(proposal),
        nearMiss,
      });
      if (!proposal) {
        log.info("no edge", { eventId: event.id, title: event.title, nearMiss });
        continue;
      }

      const bet = await createBet({
        exchange: exchange.name,
        currency: exchange.currency,
        eventId: fresh.id,
        marketId: proposal.market.id,
        outcomeId: proposal.outcome.id,
        eventTitle: fresh.title,
        category: fresh.category,
        kind: marketKind(fresh),
        marketTitle: proposal.market.title,
        outcomeLabel: proposal.outcome.label,
        analysisId,
        probability: proposal.probability,
        marketPrice: proposal.outcome.price,
        quotedPrice: proposal.quotedPrice,
        expectedReturn: proposal.expectedReturn,
        confidence: proposal.confidence,
        stake: proposal.stake,
        rationale: research.summary,
        dryRun: settings.dryRun,
        executeAt: new Date(Date.now() + settings.cancelWindowMinutes * 60_000).toISOString(),
      });
      const messageId = await notify(proposalMessage(bet, research), { keyboard: betKeyboard(bet.id) });
      if (messageId) await updateBet(bet.id, { telegramMessageId: messageId });
      proposed++;
    } catch (error) {
      log.error("event research failed", { eventId: event.id, error: errorMessage(error) });
      failed.push({ title: event.title, error });
      // Unresearched events aren't recorded, so the next scan picks them up again
      if (isGeminiUnavailable(error) || isOpenAiUnavailable(error)) break;
    }
  }

  return { open: events.length, eligible: eligible.length, researched, proposed, placed: 0, reviewed, failed };
};

export const runScan = async (exchange: Exchange, { force = false } = {}): Promise<ScanReport> => {
  if (!force && (await isPaused())) return skipped("paused");
  const lock = await tryLock("scan", SCAN_LOCK_TTL);
  if (!lock.acquired) {
    return skipped(`a scan is already running (started ${lagosTime(new Date(lock.startedAt).toISOString())}, lock clears ${lagosTime(new Date(lock.until).toISOString())} WAT)`);
  }
  const startedAt = Date.now();

  try {
    // settle finished bets first, so their stakes are free again for this scan's research
    await runHousekeeping(exchange).catch((error) => log.error("housekeeping failed", { error: errorMessage(error) }));
    const report = await researchAndPropose(exchange, startedAt);
    // place bets whose cancel window is over; with cancelWindowMinutes 0 that's this scan's own
    const placed = await runExecute(exchange);
    return { ...report, placed };
  } finally {
    await releaseLock("scan");
  }
};

// Runs a scan and reports it on Telegram: always when `announce` (a manual /scan),
// otherwise only if something failed, so scheduled scans stay quiet when all is well.
export const runScanAndReport = async (exchange: Exchange, { force = false, announce = false } = {}) => {
  try {
    const report = await runScan(exchange, { force });
    // a /scan you asked for always answers; a scheduled scan only speaks up about failures
    if (announce || report.failed.length > 0) await notify(scanReportMessage(report), { level: announce ? "always" : "alert" });
    return report;
  } catch (error) {
    await notify(failureMessage("Scan failed", error), { level: announce ? "always" : "alert" });
    throw error;
  }
};
