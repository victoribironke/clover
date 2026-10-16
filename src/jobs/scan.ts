import { marketKind } from "@/data/kind.ts";
import { recentlyAnalyzedEventIds, saveAnalysis } from "@/db/analyses.ts";
import { activeBetEventIds, createBet, updateBet } from "@/db/bets.ts";
import { isPaused, releaseLock, tryLock } from "@/db/kv.ts";
import { spendToday } from "@/db/spend.ts";
import { isDryRun } from "@/exchanges/mode.ts";
import {
  EXCHANGE_LABELS,
  type Exchange,
  type ExchangeName,
  type MarketEvent,
} from "@/exchanges/types.ts";
import { errorMessage, log } from "@/lib/logger.ts";
import { isGeminiUnavailable } from "@/llm/gemini.ts";
import { isOpenAiUnavailable } from "@/llm/openai.ts";
import { deepDive, type DeepDive } from "@/research/deep-dive.ts";
import { triageEvents } from "@/research/triage.ts";
import { multiSourceWeather } from "@/research/multi-source-weather.ts";
import { reviewWeatherBet } from "@/research/weather-review.ts";
import { weatherModel } from "@/research/weather-model.ts";
import { settings } from "@/settings.ts";
import { getBankroll, reserveBankroll } from "@/strategy/bankroll.ts";
import { eligibleEvents } from "@/strategy/eligibility.ts";
import { proposeBet, type NearMiss, type Proposal } from "@/strategy/propose.ts";
import {
  failureMessage,
  lagosTime,
  proposalMessage,
  scanReportMessage,
} from "@/telegram/format.ts";
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
  exchange: ExchangeName;
  open: number;
  eligible: number;
  researched: number;
  // weather markets skipped because it's too early in their local day to bet
  waiting?: number;
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

const skipped = (exchange: ExchangeName, skippedReason: string): ScanReport => ({
  exchange,
  open: 0,
  eligible: 0,
  researched: 0,
  proposed: 0,
  placed: 0,
  reviewed: [],
  failed: [],
  skippedReason,
});

// How an exchange's events are researched (settings.exchanges[name].research):
// "ai" = screen with gpt-6-luna, then a Gemini + luna deep dive per event (costs money, capped);
// "weather-model" = price every event from data (free, so all of them, every scan)
// "multi-source" = the same, from four forecasts that must agree, plus an AI check on each bet
type Researcher = {
  pick: (eligible: MarketEvent[]) => Promise<string[]>;
  // "waiting": nothing to bet on yet (weather markets before the late-day readings), skipped
  research: (event: MarketEvent, now: number) => Promise<DeepDive | "waiting">;
  // AI research is budgeted and re-checked at most every researchCooldownHours
  paid: boolean;
  // a last check on a proposed bet: null to go ahead, or why not
  review?: (event: MarketEvent, research: DeepDive, proposal: Proposal) => Promise<string | null>;
};

// Only today's markets: bets wait for the station's readings late in the day, so tomorrow's
// can't be bet on yet. 36 hours, because Polymarket's "close" is noon UTC the day after (when
// every time zone's day is over). Soonest first.
const todaysEvents = async (eligible: MarketEvent[]) =>
  eligible
    .filter((event) => Date.parse(event.closingDate ?? "") - Date.now() < 36 * HOUR)
    .sort((a, b) => (a.closingDate ?? "").localeCompare(b.closingDate ?? ""))
    .map((event) => event.id);

// The AI check on a multi-source bet. It fails closed: no check (budget spent, OpenAI down, no
// forecast discussion), no bet.
const reviewOrVeto: NonNullable<Researcher["review"]> = async (event, research, proposal) => {
  if ((await spendToday()) >= settings.dailyResearchBudgetUsd)
    return "daily research budget reached, so it couldn't be checked";
  try {
    return await reviewWeatherBet(event, research, proposal);
  } catch (error) {
    log.warn("weather review failed", { eventId: event.id, error: errorMessage(error) });
    return `the check failed (${errorMessage(error)})`;
  }
};

const RESEARCHERS: Record<"ai" | "weather-model" | "multi-source", Researcher> = {
  ai: {
    pick: (eligible) => triageEvents(eligible, settings.maxDeepDivesPerScan),
    research: (event) => deepDive(event),
    paid: true,
  },
  "weather-model": {
    pick: todaysEvents,
    research: async (event, now) => {
      const research = await weatherModel(event, now);
      if (!research) throw new Error("Not a temperature market the weather model can read");
      return research;
    },
    paid: false,
  },
  "multi-source": {
    pick: todaysEvents,
    research: async (event, now) => {
      const research = await multiSourceWeather(event, now);
      if (!research) throw new Error("Not a temperature market the multi-source model can read");
      return research;
    },
    // the forecasts are free; only the check on each proposed bet costs (a fraction of a cent)
    paid: false,
    review: reviewOrVeto,
  },
};

// A vetoed proposal, as the scan report's near miss
const vetoed = (proposal: Proposal, reason: string): NearMiss => ({
  marketTitle: proposal.market.title,
  outcomeLabel: proposal.outcome.label,
  modelProbability: proposal.modelProbability,
  marketPrice: proposal.outcome.price,
  probability: proposal.probability,
  confidence: proposal.confidence,
  price: proposal.quotedPrice,
  expectedReturn: proposal.expectedReturn,
  reason: `AI check: ${reason}`,
});

// A vetoed bet is kept as "skipped" (never placed, never announced), so whether the AI check was
// right can be scored against the result later
const recordVeto = async (
  exchange: Exchange,
  event: MarketEvent,
  proposal: Proposal,
  research: DeepDive,
  reason: string,
) => {
  const bet = await createBet({
    exchange: exchange.name,
    currency: exchange.currency,
    eventId: event.id,
    marketId: proposal.market.id,
    outcomeId: proposal.outcome.id,
    eventTitle: event.title,
    category: event.category,
    kind: marketKind(event),
    marketTitle: proposal.market.title,
    outcomeLabel: proposal.outcome.label,
    analysisId: null,
    probability: proposal.probability,
    marketPrice: proposal.outcome.price,
    quotedPrice: proposal.quotedPrice,
    expectedReturn: proposal.expectedReturn,
    confidence: proposal.confidence,
    stake: proposal.stake,
    rationale: research.summary,
    dryRun: isDryRun(exchange),
    executeAt: new Date().toISOString(),
  });
  await updateBet(bet.id, { status: "skipped", error: `AI check: ${reason}` }, ["pending"]);
};

// The research half of a scan: pick events, research them, propose bets. Early exits (no free
// capital, budget spent) only skip research; the scan still does its bookkeeping and placing.
const researchAndPropose = async (exchange: Exchange, startedAt: number): Promise<ScanReport> => {
  const researcher = RESEARCHERS[settings.exchanges[exchange.name].research];
  let bankroll = await getBankroll(exchange);
  if (bankroll.deployable <= 0) {
    return skipped(exchange.name, "no free capital");
  }
  if (researcher.paid && (await spendToday()) >= settings.dailyResearchBudgetUsd) {
    return skipped(exchange.name, "daily research budget reached");
  }

  const cooldownSince = new Date(Date.now() - settings.researchCooldownHours * HOUR).toISOString();
  const [events, recent, active] = await Promise.all([
    exchange.listOpenEvents(),
    researcher.paid
      ? recentlyAnalyzedEventIds(exchange.name, cooldownSince)
      : Promise.resolve(new Set<string>()),
    activeBetEventIds(exchange.name),
  ]);
  const eligible = eligibleEvents(events, new Set([...recent, ...active]));
  const picked = await researcher.pick(eligible);
  log.info("scan", {
    exchange: exchange.name,
    open: events.length,
    eligible: eligible.length,
    picked: picked.length,
  });

  let researched = 0;
  let waiting = 0;
  const failed: ScanReport["failed"] = [];
  const reviewed: ScanReport["reviewed"] = [];
  let proposed = 0;
  const eventById = new Map(eligible.map((event) => [event.id, event]));
  type ResearchAttempt = { ok: true; value: DeepDive | "waiting" } | { ok: false; error: unknown };
  const prefetched = new Map<string, Promise<ResearchAttempt>>();
  const researchAt = Date.now();
  const startWeatherResearch = (index: number) => {
    if (researcher.paid || index >= picked.length) return;
    const eventId = picked[index]!;
    const event = eventById.get(eventId)!;
    if (prefetched.has(eventId)) return;
    prefetched.set(
      eventId,
      researcher
        .research(event, researchAt)
        .then((value): ResearchAttempt => ({ ok: true, value }))
        .catch((error): ResearchAttempt => ({ ok: false, error })),
    );
  };
  // Two requests overlap, enough to hide latency without recreating the provider bursts that
  // caused 429s. Research and proposal processing then run as a small pipeline.
  startWeatherResearch(0);
  startWeatherResearch(1);

  for (const [index, eventId] of picked.entries()) {
    if (Date.now() - startedAt > SCAN_DEADLINE) {
      log.warn("scan deadline reached", { researched });
      break;
    }
    if (researcher.paid && (await spendToday()) >= settings.dailyResearchBudgetUsd) {
      log.warn("daily research budget reached", { budget: settings.dailyResearchBudgetUsd });
      break;
    }
    // Earlier proposals in this same locked scan reserve their stake in this snapshot. A concurrent
    // cancellation may free money, but staying conservative is cheaper than rereading all history.
    if (bankroll.deployable <= 0) break;
    const event = eventById.get(eventId)!;
    try {
      const attempt = researcher.paid
        ? await researcher
            .research(event, researchAt)
            .then((value): ResearchAttempt => ({ ok: true, value }))
            .catch((error): ResearchAttempt => ({ ok: false, error }))
        : await prefetched.get(eventId)!;
      startWeatherResearch(index + 2);
      if (!attempt.ok) throw attempt.error;
      const research = attempt.value;
      if (research === "waiting") {
        waiting++;
        continue;
      }
      researched++;
      // re-read prices: research can take minutes and the market may have moved
      const fresh = await exchange.getEvent(event.id);
      const verdict = await proposeBet(
        exchange,
        fresh,
        research.estimates,
        bankroll,
        research.liveData,
      );
      const veto =
        verdict.proposal && researcher.review
          ? await researcher.review(fresh, research, verdict.proposal)
          : null;
      const proposal = veto ? null : verdict.proposal;
      const nearMiss = veto ? vetoed(verdict.proposal!, veto) : verdict.nearMiss;
      if (veto) await recordVeto(exchange, fresh, verdict.proposal!, research, veto);
      // free research checks every event on every scan: only keep the ones that led to a bet
      const analysisId =
        researcher.paid || proposal
          ? await saveAnalysis(
              exchange.name,
              event,
              researcher.paid
                ? `${settings.reasoningModel} + ${settings.searchModel}`
                : "weather model",
              research,
              { proposed: Boolean(proposal), nearMiss },
            )
          : null;
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
        dryRun: isDryRun(exchange),
        executeAt: new Date(Date.now() + settings.cancelWindowMinutes * 60_000).toISOString(),
      });
      bankroll = reserveBankroll(bankroll, bet.stake);
      const messageId = await notify(proposalMessage(bet, research), {
        keyboard: betKeyboard(bet.id),
      });
      if (messageId) await updateBet(bet.id, { telegramMessageId: messageId });
      proposed++;
    } catch (error) {
      log.error("event research failed", { eventId: event.id, error: errorMessage(error) });
      failed.push({ title: event.title, error });
      // Unresearched events aren't recorded, so the next scan picks them up again
      if (isGeminiUnavailable(error) || isOpenAiUnavailable(error)) break;
    }
  }

  // If a deadline or exhausted bankroll stopped the proposal loop, keep the request alive until
  // the at-most-two already-started reads finish; Cloud Run must not leave background work behind.
  await Promise.all(prefetched.values());

  return {
    exchange: exchange.name,
    open: events.length,
    eligible: eligible.length,
    researched,
    waiting,
    proposed,
    placed: 0,
    reviewed,
    failed,
  };
};

export const runScan = async (exchange: Exchange, { force = false } = {}): Promise<ScanReport> => {
  if (!force && (await isPaused())) return skipped(exchange.name, "paused");
  // one lock per exchange: Bayse and Kalshi scans may run side by side
  const lock = await tryLock(`scan-${exchange.name}`, SCAN_LOCK_TTL);
  if (!lock.acquired) {
    return skipped(
      exchange.name,
      `a scan is already running (started ${lagosTime(new Date(lock.startedAt).toISOString())}, lock clears ${lagosTime(new Date(lock.until).toISOString())} WAT)`,
    );
  }
  const startedAt = Date.now();

  try {
    // settle finished bets first, so their stakes are free again for this scan's research
    await runHousekeeping(exchange).catch((error) =>
      log.error("housekeeping failed", { error: errorMessage(error) }),
    );
    const report = await researchAndPropose(exchange, startedAt);
    // place bets whose cancel window is over; with cancelWindowMinutes 0 that's this scan's own
    const placed = await runExecute(exchange);
    return { ...report, placed };
  } finally {
    await releaseLock(`scan-${exchange.name}`);
  }
};

// Runs a scan and reports it on Telegram: always when `announce` (a manual /scan),
// otherwise only if something failed, so scheduled scans stay quiet when all is well.
export const runScanAndReport = async (
  exchange: Exchange,
  { force = false, announce = false } = {},
) => {
  try {
    const report = await runScan(exchange, { force });
    // a /scan you asked for always answers; a scheduled scan only speaks up about failures
    if (announce || report.failed.length > 0)
      await notify(scanReportMessage(report), { level: announce ? "always" : "alert" });
    return report;
  } catch (error) {
    await notify(failureMessage(`${EXCHANGE_LABELS[exchange.name]} scan failed`, error), {
      level: announce ? "always" : "alert",
    });
    throw error;
  }
};
