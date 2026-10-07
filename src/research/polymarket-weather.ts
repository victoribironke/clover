import { metars, metarStation, offsetMinutesAt, timeZoneAt, type Metar } from "@/data/metar.ts";
import {
  bandProbability,
  ensembleHours,
  extremeBias,
  runsBetween,
  type Ensemble,
} from "@/data/station-weather.ts";
import type { MarketEvent } from "@/exchanges/types.ts";
import { slugDay } from "@/exchanges/polymarket/adapter.ts";
import type { DeepDive } from "./deep-dive.ts";

// Polymarket's daily temperature markets ("Highest temperature in London on October 3?") settle on
// the highest (or lowest) "Temp" reading NOAA lists for one airport on that local day, in whole
// degrees: the station's routine METARs (US: hourly ones only, °F from tenths of °C; elsewhere
// whole °C). So, unlike Kalshi's official climate report, the readings so far ARE the answer so
// far, exactly; only the reports still to come can move it.

const DAY = 24 * 3_600_000;
// When the readings, not the forecast, decide. Highs: 4 PM local, once the day's peak has usually
// passed (as on Kalshi). Lows: 10 PM. A low is usually set before dawn, but the evening can still
// undercut it, and that's forecast territory: on 2026-10-03 at 5 PM in Guangzhou the model gave the
// low so far 57% where the market said 97%.
const LATE_HOUR = { high: 16, low: 22 };
// half of the models' recent miss at this station, as on Kalshi
const BIAS_SHARE = 0.5;
// the readings decide exactly once reported, so only a little slack for odd reports
const NEIGHBOUR_WEIGHT = 0.03;

export type PolymarketQuestion = {
  kind: "high" | "low";
  station: string;
  // the station's local day, "2026-10-03"
  day: string;
  unit: "C" | "F";
};

export const parsePolymarketQuestion = (event: MarketEvent): PolymarketQuestion | null => {
  if (event.exchange !== "polymarket") return null;
  const kind = /^highest/i.test(event.title) ? "high" : /^lowest/i.test(event.title) ? "low" : null;
  const station = event.resolutionSource
    .match(/timeseries\?site=([a-z0-9]{4})/i)?.[1]
    ?.toUpperCase();
  const day = slugDay(event.slug);
  const unit = event.markets.some((market) => /°F/.test(market.title)) ? "F" : "C";
  if (!kind || !station || !day) return null;
  return { kind, station, day, unit };
};

// A reading as the resolution source shows it: whole degrees in the market's unit
export const shown = (metar: Metar, unit: "C" | "F") =>
  unit === "F" ? Math.round((metar.c * 9) / 5 + 32) : Math.round(metar.c);

// The reports that count: US markets resolve on the hourly data, so specials are left out there
const counted = (all: Metar[], unit: "C" | "F") =>
  unit === "F" ? all.filter((metar) => metar.type === "METAR") : all;

// The latest reading minus what the runs (on average) had for that hour: added to the hours left,
// it carries the station's real current temperature into the rest of the day
export const anchorShift = (ensemble: Ensemble, reading: { at: number; f: number }) => {
  if (ensemble.hours.length === 0 || ensemble.runs.length === 0) return 0;
  let index = 0;
  for (const [i, hour] of ensemble.hours.entries()) {
    if (Math.abs(hour - reading.at) < Math.abs(ensemble.hours[index]! - reading.at)) index = i;
  }
  // too far from any forecast hour to compare
  if (Math.abs(ensemble.hours[index]! - reading.at) > 90 * 60_000) return 0;
  const modelled =
    ensemble.runs.reduce((total, run) => total + run[index]!, 0) / ensemble.runs.length;
  return reading.f - modelled;
};

const quantile = (sorted: number[], q: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;

const localTime = (at: number, timeZone: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(at);

// "waiting": too early in the local day to bet, so nothing is fetched beyond the time zone
export const polymarketWeather = async (
  event: MarketEvent,
  now = Date.now(),
): Promise<DeepDive | "waiting" | null> => {
  const question = parsePolymarketQuestion(event);
  if (!question) return null;
  const { kind, unit } = question;
  const station = await metarStation(question.station);
  if (!station) throw new Error(`No recent reports from ${question.station}`);
  const timeZone = await timeZoneAt(station.latitude, station.longitude);

  // the local calendar day, midnight to midnight (daylight saving included)
  const midnight = Date.parse(`${question.day}T00:00:00Z`);
  const start = midnight - offsetMinutesAt(timeZone, midnight + 12 * 3_600_000) * 60_000;
  const end = start + DAY;
  if ((now - start) / 3_600_000 < LATE_HOUR[kind]) return "waiting";
  const recentDays = [1, 2, 3]
    .map((back) => ({ start: start - back * DAY, end: start - (back - 1) * DAY }))
    .filter((day) => day.end <= now)
    .slice(0, 2);
  const historyFrom = Math.min(start, ...recentDays.map((day) => day.start));

  const [reports, ensemble] = await Promise.all([
    metars(question.station, historyFrom, Math.min(now, end)).then((all) => counted(all, unit)),
    ensembleHours(
      station.latitude,
      station.longitude,
      historyFrom,
      end,
      unit === "F" ? "fahrenheit" : "celsius",
    ),
  ]);
  const readings = reports.map((metar) => ({ at: metar.at, f: shown(metar, unit), precise: true }));
  const bias = BIAS_SHARE * extremeBias(kind, readings, ensemble, recentDays);

  const pick = kind === "high" ? Math.max : Math.min;
  const today = readings.filter((reading) => reading.at >= start);
  const observed = today.length > 0 ? pick(...today.map((reading) => reading.f)) : null;
  const from = today.length > 0 ? Math.max(start, now) : start;
  // How far to shift the forecast for the hours left. Before any reading: the models' recent miss
  // on the day's extreme (bias). Once readings exist: anchor to the latest one, so the evening
  // continues from where the station actually is. The extreme's bias is a daytime-peak error;
  // added to evening hours it pushed them past the high so far and made settled bands look open
  // (London 21°C, Toronto 14°C on 2026-10-06: the market was 86-90% sure, the bot bet against).
  const latestReading = today.at(-1);
  const shift = latestReading ? anchorShift(ensemble, latestReading) : bias;
  const runs = runsBetween(ensemble, from, end).map((run) =>
    run.map((value) => Math.round(value + shift)),
  );
  const values = (
    runs.length > 0
      ? runs.map((run) => (observed === null ? pick(...run) : pick(observed, ...run)))
      : observed !== null
        ? [observed]
        : []
  ).sort((a, b) => a - b);
  if (values.length === 0)
    throw new Error(`No reports or forecast for ${question.station} on ${question.day}`);

  const hoursIntoDay = (now - start) / 3_600_000;
  const late = observed !== null && hoursIntoDay >= LATE_HOUR[kind];
  const confidence: DeepDive["estimates"][number]["confidence"] = late
    ? "high"
    : observed !== null
      ? "medium"
      : "low";
  const estimates = event.markets
    .filter((market) => market.range)
    .map((market) => ({
      marketId: market.id,
      probabilityOutcome1: bandProbability(values, market.range!, NEIGHBOUR_WEIGHT),
      confidence,
    }));

  const word = kind === "high" ? "high" : "low";
  const latest = today.at(-1);
  const median = quantile(values, 0.5);
  const spread = `${quantile(values, 0.1)}-${quantile(values, 0.9)}°${unit}`;
  const soFar =
    observed !== null && latest
      ? `${station.name}: ${word} so far ${observed}°${unit}, latest ${latest.f}°${unit} at ${localTime(latest.at, timeZone)}`
      : null;
  const forecast = `${runs.length} ensemble runs (ICON, GFS, ECMWF): final ${word} median ${median}°${unit}, 10-90% range ${spread}`;
  const correction =
    recentDays.length > 0
      ? `Models corrected by ${bias >= 0 ? "+" : ""}${bias.toFixed(1)}°${unit}: half their miss here over the last ${recentDays.length} days`
      : "No finished days to correct the models with";

  return {
    summary: [
      soFar ? `${soFar}.` : "Forecast only (the day hasn't started).",
      `${forecast}.`,
      late
        ? ""
        : `No bet before ${LATE_HOUR[kind] - 12} PM local time: forecasts alone don't beat this market.`,
    ]
      .filter(Boolean)
      .join(" "),
    keyFactors: [
      soFar ?? `No reports yet for ${question.day}`,
      `Final ${word}: median ${median}°${unit}, 10-90% ${spread}`,
      correction,
    ],
    reading: soFar ?? `Forecast: final ${word} median ${median}°${unit} (${spread})`,
    liveData: late,
    facts: [soFar, forecast, correction].filter((fact): fact is string => fact !== null),
    sources: [
      {
        title: `NOAA observations, ${question.station}`,
        url: `https://www.weather.gov/wrh/timeseries?site=${question.station.toLowerCase()}`,
      },
      { title: "Open-Meteo ensemble", url: "https://open-meteo.com/en/docs/ensemble-api" },
    ],
    estimates,
    usage: { inputTokens: 0, outputTokens: 0, searches: 0 },
    costUsd: 0,
  };
};
