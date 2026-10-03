import {
  bandProbability,
  climateDay,
  ensembleHours,
  extremeBias,
  observedExtreme,
  finalValues,
  parseTemperatureQuestion,
  runsBetween,
  standardOffsetMinutes,
  stationInfo,
  stationReadings,
} from "@/data/station-weather.ts";
import type { MarketEvent } from "@/exchanges/types.ts";
import type { DeepDive } from "./deep-dive.ts";
import { polymarketWeather } from "./polymarket-weather.ts";

const DAY = 24 * 3_600_000;
// 4 PM local standard time (5 PM during daylight saving): the day's high has usually been set
const LATE_HOUR = 16;
// The last two days' model misses swing from day to day (LA -2.2°F and Philadelphia +3.3°F on
// 2026-09-30, both moving the model further from the market), so only part of the miss is applied
const BIAS_SHARE = 0.5;

const quantile = (sorted: number[], q: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;

const localTime = (at: number, timeZone: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(at);

// "68°F", or "67.1-68.9°F" when only whole-°C readings say where it is
const range = ({ min, max }: { min: number; max: number }) =>
  max - min < 0.3 ? `${max.toFixed(1)}°F` : `${min.toFixed(1)}-${max.toFixed(1)}°F`;

const signed = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;

// Research without AI for Kalshi's daily temperature markets: every band priced from the station's
// readings so far plus the weather-model ensemble for the rest of the day, corrected by how far the
// models missed this station on the last two finished days (src/data/station-weather.ts).
// Free, so every open event can be checked on every scan. Returns null for anything else.
const kalshiWeather = async (event: MarketEvent, now = Date.now()): Promise<DeepDive | null> => {
  const question = parseTemperatureQuestion(event);
  if (!question) return null;

  const station = await stationInfo(question.station);
  const offset = standardOffsetMinutes(station.timeZone, Number(question.day.slice(0, 4)));
  const { start, end } = climateDay(question.day, offset);
  // the last two finished climate days, for the bias
  const recentDays = [1, 2, 3]
    .map((back) => ({ start: start - back * DAY, end: start - (back - 1) * DAY }))
    .filter((day) => day.end <= now)
    .slice(0, 2);
  const historyFrom = Math.min(start, ...recentDays.map((day) => day.start));

  const [readings, ensemble] = await Promise.all([
    stationReadings(question.station, historyFrom, Math.min(now, end)).catch(() => []),
    ensembleHours(station.latitude, station.longitude, historyFrom, end),
  ]);
  const bias = BIAS_SHARE * extremeBias(question.kind, readings, ensemble, recentDays);

  // today's readings so far; without them the models cover the whole day
  const today = readings.filter((reading) => reading.at >= start);
  const observed = observedExtreme(question.kind, today, start);
  const from = today.length > 0 ? Math.max(start, now) : start;
  const runs = runsBetween(ensemble, from, end).map((run) => run.map((value) => value + bias));

  const values = finalValues({ kind: question.kind, observed, runs }).sort((a, b) => a - b);
  if (values.length === 0)
    throw new Error(`No readings or forecast for ${question.station} on ${question.day}`);

  // Forecasts alone don't beat Kalshi: on 2026-09-30 the models (even bias-corrected) sat 2°F+ away
  // from liquid markets in LA, Boston and Philadelphia, which is a whole band. What we do have is the
  // station's own readings, and they settle the question once the day's peak has passed. So only
  // late in the climate day do we count as having a live reading (bets need one: weather is in
  // settings.liveReadingRequiredKinds); before that the event is priced and reported, not bet on.
  const hoursIntoDay = (now - start) / 3_600_000;
  const late = observed !== null && hoursIntoDay >= LATE_HOUR;
  const confidence: DeepDive["estimates"][number]["confidence"] = late
    ? "high"
    : observed !== null
      ? "medium"
      : "low";
  const estimates = event.markets
    .filter((market) => market.range)
    .map((market) => ({
      marketId: market.id,
      probabilityOutcome1: bandProbability(values, market.range!),
      confidence,
    }));

  const word = question.kind === "high" ? "high" : "low";
  const latest = today.at(-1);
  const median = quantile(values, 0.5);
  const spread = `${quantile(values, 0.1)}-${quantile(values, 0.9)}°F`;
  const soFar =
    observed !== null && latest
      ? `${station.name}: ${word} so far ${range(observed)}, latest ${latest.f}°F at ${localTime(latest.at, station.timeZone)}`
      : null;
  const forecast = `${runs.length} ensemble runs (ICON, GFS, ECMWF): final ${word} median ${median}°F, 10-90% range ${spread}`;
  const correction =
    recentDays.length > 0
      ? `Models corrected by ${signed(bias)}°F: half their miss on this station's ${word} over the last ${recentDays.length} days`
      : "No finished days to correct the models with";

  return {
    summary: [
      soFar ? `${soFar}.` : "Forecast only (the day hasn't started).",
      `${forecast}.`,
      late ? "" : "No bet before 4 PM local standard time: forecasts alone don't beat this market.",
    ]
      .filter(Boolean)
      .join(" "),
    keyFactors: [
      soFar ?? `No readings yet for ${question.day}`,
      `Final ${word}: median ${median}°F, 10-90% ${spread}`,
      correction,
    ],
    reading: soFar ?? `Forecast: final ${word} median ${median}°F (${spread})`,
    liveData: late,
    facts: [soFar, forecast, correction].filter((fact): fact is string => fact !== null),
    sources: [
      {
        title: `NWS observations, ${station.name}`,
        url: `https://forecast.weather.gov/data/obhistory/${question.station}.html`,
      },
      { title: "Open-Meteo ensemble", url: "https://open-meteo.com/en/docs/ensemble-api" },
    ],
    estimates,
    usage: { inputTokens: 0, outputTokens: 0, searches: 0 },
    costUsd: 0,
  };
};

// Each exchange settles its temperature markets differently: Kalshi on the official climate report
// (above), Polymarket on the hourly airport reports (./polymarket-weather.ts)
export const weatherModel = (event: MarketEvent, now = Date.now()) =>
  event.exchange === "polymarket" ? polymarketWeather(event, now) : kalshiWeather(event, now);
