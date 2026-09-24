import { config } from "@/config.ts";
import { recentlyAnalyzedEventIds, saveAnalysis } from "@/db/analyses.ts";
import { activeBetEventIds, createBet, updateBet } from "@/db/bets.ts";
import { isPaused, releaseLock, tryLock } from "@/db/kv.ts";
import type { Exchange, MarketEvent } from "@/exchanges/types.ts";
import { errorMessage, log } from "@/lib/logger.ts";
import { deepDive } from "@/research/deep-dive.ts";
import { triageEvents } from "@/research/triage.ts";
import { getBankroll } from "@/strategy/bankroll.ts";
import { proposeBet } from "@/strategy/propose.ts";
import { proposalMessage } from "@/telegram/format.ts";
import { betKeyboard, notify } from "@/telegram/notify.ts";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export type ScanReport = {
  open: number;
  eligible: number;
  researched: number;
  proposed: number;
  skippedReason?: string;
};

// Cheap, deterministic filters before any money is spent on research
export const eligibleEvents = (events: MarketEvent[], exclude: Set<string>, now = Date.now()) =>
  events.filter((event) => {
    if (event.status !== "open" || exclude.has(event.id)) return false;
    if (!event.supportedCurrencies.includes("NGN")) return false;
    if (!event.markets.some((market) => market.status === "open")) return false;
    // no closing date: long-running markets like "who wins the 2027 election"; keep them
    if (!event.closingDate) return true;
    const untilClose = new Date(event.closingDate).getTime() - now;
    return untilClose >= config.MIN_HOURS_TO_CLOSE * HOUR && untilClose <= config.MAX_DAYS_TO_CLOSE * DAY;
  });

export const runScan = async (exchange: Exchange, { force = false } = {}): Promise<ScanReport> => {
  if (!force && (await isPaused())) return { open: 0, eligible: 0, researched: 0, proposed: 0, skippedReason: "paused" };
  if (!(await tryLock("scan", 2 * HOUR))) {
    return { open: 0, eligible: 0, researched: 0, proposed: 0, skippedReason: "a scan is already running" };
  }

  try {
    const bankroll = await getBankroll(exchange);
    if (bankroll.deployable <= 0) {
      return { open: 0, eligible: 0, researched: 0, proposed: 0, skippedReason: "no free capital" };
    }

    const cooldownSince = new Date(Date.now() - config.RESEARCH_COOLDOWN_HOURS * HOUR).toISOString();
    const [events, recent, active] = await Promise.all([
      exchange.listOpenEvents(),
      recentlyAnalyzedEventIds(exchange.name, cooldownSince),
      activeBetEventIds(exchange.name),
    ]);
    const eligible = eligibleEvents(events, new Set([...recent, ...active]));
    const picked = await triageEvents(eligible, config.MAX_DEEP_DIVES_PER_SCAN);
    log.info("scan", { open: events.length, eligible: eligible.length, picked: picked.length });

    let researched = 0;
    let proposed = 0;
    for (const eventId of picked) {
      const event = eligible.find((item) => item.id === eventId)!;
      try {
        const research = await deepDive(event);
        researched++;
        const analysisId = await saveAnalysis(exchange.name, event.id, event.title, config.RESEARCH_MODEL, research);

        // refresh: earlier proposals in this scan used up capital
        const current = await getBankroll(exchange);
        if (current.deployable <= 0) break;

        // re-read prices: research can take minutes and the market may have moved
        const fresh = await exchange.getEvent(event.id);
        const proposal = await proposeBet(exchange, fresh, research.estimates, current);
        if (!proposal) {
          log.info("no edge", { eventId: event.id, title: event.title });
          continue;
        }

        const bet = await createBet({
          exchange: exchange.name,
          currency: exchange.currency,
          eventId: fresh.id,
          marketId: proposal.market.id,
          outcomeId: proposal.outcome.id,
          eventTitle: fresh.title,
          marketTitle: proposal.market.title,
          outcomeLabel: proposal.outcome.label,
          analysisId,
          probability: proposal.probability,
          marketPrice: proposal.outcome.price,
          quotedPrice: proposal.quotedPrice,
          expectedReturn: proposal.expectedReturn,
          confidence: proposal.confidence,
          stake: proposal.stake,
          rationale: proposal.reasoning,
          dryRun: config.DRY_RUN,
          executeAt: new Date(Date.now() + config.CANCEL_WINDOW_MINUTES * 60_000).toISOString(),
        });
        const messageId = await notify(proposalMessage(bet, research), betKeyboard(bet.id));
        if (messageId) await updateBet(bet.id, { telegramMessageId: messageId });
        proposed++;
      } catch (error) {
        log.error("event research failed", { eventId: event.id, error: errorMessage(error) });
      }
    }

    return { open: events.length, eligible: eligible.length, researched, proposed };
  } finally {
    await releaseLock("scan");
  }
};
