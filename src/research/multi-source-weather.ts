import {
  bandProbability,
  climateDay,
  ensembleHours,
  finalValues,
  getJson,
  NWS_HEADERS,
  observedExtreme,
  parseTemperatureQuestion,
  standardOffsetMinutes,
  stationInfo,
  stationReadings,
  type Observed,
} from "@/data/station-weather.ts";
import type { MarketEvent } from "@/exchanges/types.ts";
import type { DeepDive } from "./deep-dive.ts";

// The multi-source model for Kalshi's daily temperature markets. The old one (weather-model.ts)
// read the station right but took the rest of the day from global ensembles (25-50 km, a few runs
// a day), and the market beat it: 42 bets from 2026-10-10 to 10-16 won 19 and lost $43. On 10-11
// it bet that highs in Philadelphia, DC, Trenton and Newark would still rise 3-5°F at 5 PM while
// the station was already cooling; all four stayed where the reading was. So here:
//   - four forecasts for the hours left: HRRR (3 km, rerun hourly), the National Blend of Models,
//     the NWS's own hourly forecast for the spot, and the ICON/GFS/ECMWF ensemble
//   - each anchored to the latest reading: shifted by however far it is off the station right now
//   - bets only when they agree on the final high/low (within AGREE_F), so a reading/forecast split
//     like 10-11 is a near miss, not a bet
// Each bet is then checked by the reasoning model against the NWS forecast discussion
// (./weather-review.ts).

const HOUR = 3_600_000;
// 4 PM local standard time, as in weather-model.ts: before that the day's high is still forecast
const LATE_HOUR = 16;
// largest spread between the sources' final values that still counts as agreement, in °F
const AGREE_F = 2;
// at least this many of the four sources must answer
const MIN_SOURCES = 3;
// a deterministic forecast (HRRR, NBM, NWS) becomes this many runs, spread by a normal error
const PSEUDO_RUNS = 101;
// that error's standard deviation, °F: the ensemble's spread, held inside these bounds
const MIN_SD = 1;
const MAX_SD = 4;

export type Source = {
  name: string;
  hours: number[];
  // one run for a deterministic forecast, many for an ensemble; aligned with `hours`
  runs: number[][];
};

// A run's value at `at`, linear between its hours; null when `at` is more than 90 minutes from any
export const valueAt = (hours: number[], run: number[], at: number) => {
  let after = hours.findIndex((hour) => hour >= at);
  if (after === -1) after = hours.length;
  const previous = after - 1;
  if (after < hours.length && hours[after] === at) return run[after]!;
  if (previous >= 0 && after < hours.length) {
    const share = (at - hours[previous]!) / (hours[after]! - hours[previous]!);
    if (hours[after]! - hours[previous]! > 3 * HOUR) return null;
    return run[previous]! + share * (run[after]! - run[previous]!);
  }
  const nearest = previous >= 0 ? previous : after;
  if (nearest >= hours.length || Math.abs(hours[nearest]! - at) > 1.5 * HOUR) return null;
  return run[nearest]!;
};

// The runs' values for the hours in [from, end), shifted so the runs' average at the latest
// reading equals that reading. Null when the source has nothing for the reading's time.
export const anchoredRuns = (
  source: Source,
  latest: { at: number; f: number } | null,
  from: number,
  end: number,
) => {
  let shift = 0;
  if (latest) {
    const now = source.runs.map((run) => valueAt(source.hours, run, latest.at));
    if (now.some((value) => value === null)) return null;
    shift = latest.f - (now as number[]).reduce((total, value) => total + value, 0) / now.length;
  }
  const keep = source.hours.flatMap((hour, index) => (hour >= from && hour < end ? [index] : []));
  return { shift, runs: source.runs.map((run) => keep.map((index) => run[index]! + shift)) };
};

// Acklam's approximation of the standard normal quantile
export const normalQuantile = (p: number) => {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const tail = (q: number) =>
    (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
    ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  if (p < 0.02425) return tail(Math.sqrt(-2 * Math.log(p)));
  if (p > 1 - 0.02425) return -tail(Math.sqrt(-2 * Math.log(1 - p)));
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
  );
};

const standardDeviation = (values: number[]) => {
  if (values.length < 2) return 0;
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  return Math.sqrt(
    values.reduce((total, value) => total + (value - mean) ** 2, 0) / (values.length - 1),
  );
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};

export type SourceFinal = { name: string; final: number; shift: number };

// Every source's final high/low and the combined values for bandProbability, each source weighted
// equally. The ensemble's runs keep their own spread; a deterministic forecast is spread by a normal
// error as wide as the ensemble's. Sources that can't be anchored are left out.
export const combineSources = ({
  kind,
  observed,
  latest,
  sources,
  from,
  end,
}: {
  kind: "high" | "low";
  observed: Observed | null;
  latest: { at: number; f: number } | null;
  sources: Source[];
  from: number;
  end: number;
}) => {
  const pick = kind === "high" ? Math.max : Math.min;
  const middle = observed ? (observed.min + observed.max) / 2 : null;
  const anchored = sources.flatMap((source) => {
    const result = anchoredRuns(source, latest, from, end);
    return result ? [{ source, ...result }] : [];
  });
  const extremes = (runs: number[][]) =>
    runs.filter((run) => run.length > 0).map((run) => pick(...run));
  const ensembleSpread = standardDeviation(
    anchored.filter((each) => each.runs.length > 1).flatMap((each) => extremes(each.runs)),
  );
  const sd = Math.min(MAX_SD, Math.max(MIN_SD, ensembleSpread));
  const errors = Array.from({ length: PSEUDO_RUNS }, (_, index) =>
    normalQuantile((index + 0.5) / PSEUDO_RUNS),
  );

  const finals: SourceFinal[] = [];
  const perSource: number[][] = [];
  for (const { source, runs, shift } of anchored) {
    const finalsOfRuns = runs.map((run) => {
      const all = middle === null ? run : [middle, ...run];
      return all.length ? Math.round(pick(...all)) : null;
    });
    const known = finalsOfRuns.filter((value): value is number => value !== null);
    if (known.length === 0) continue;
    finals.push({ name: source.name, final: median(known), shift });
    const spreadRuns =
      runs.length > 1
        ? runs
        : errors.map((error) => runs[0]!.map((value) => value + error * sd));
    perSource.push(finalValues({ kind, observed, runs: spreadRuns }));
  }

  // equal weight per source: repeat each source's values up to the same count
  const size = Math.max(0, ...perSource.map((values) => values.length));
  const values = perSource
    .flatMap((each) => Array.from({ length: size }, (_, index) => each[index % each.length]!))
    .sort((a, b) => a - b);
  const all = finals.map((each) => each.final);
  return {
    values,
    finals,
    spread: all.length ? Math.max(...all) - Math.min(...all) : Number.POSITIVE_INFINITY,
    sd,
  };
};

// --- sources ---

type Point = { forecastHourly: string; office: string };
const points = new Map<string, Point>();

// The NWS grid point for the station: its hourly forecast URL and forecast office
export const nwsPoint = async (latitude: number, longitude: number): Promise<Point> => {
  const key = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
  const cached = points.get(key);
  if (cached) return cached;
  const data = await getJson<{ properties: { forecastHourly: string; cwa: string } }>(
    `https://api.weather.gov/points/${key}`,
    NWS_HEADERS,
  );
  const point = { forecastHourly: data.properties.forecastHourly, office: data.properties.cwa };
  points.set(key, point);
  return point;
};

const nwsHourly = async (latitude: number, longitude: number): Promise<Source> => {
  const point = await nwsPoint(latitude, longitude);
  const data = await getJson<{
    properties: { periods: { startTime: string; temperature: number; temperatureUnit: string }[] };
  }>(point.forecastHourly, NWS_HEADERS);
  const periods = data.properties.periods.filter((period) => typeof period.temperature === "number");
  return {
    name: "NWS",
    hours: periods.map((period) => Date.parse(period.startTime)),
    runs: [
      periods.map((period) =>
        period.temperatureUnit === "C" ? (period.temperature * 9) / 5 + 32 : period.temperature,
      ),
    ],
  };
};

// HRRR and the National Blend of Models, from Open-Meteo, as two deterministic sources
const highResolution = async (
  latitude: number,
  longitude: number,
  from: number,
  end: number,
): Promise<Source[]> => {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
    `&hourly=temperature_2m&temperature_unit=fahrenheit&models=gfs_hrrr,ncep_nbm_conus&timezone=GMT` +
    `&start_date=${new Date(from).toISOString().slice(0, 10)}&end_date=${new Date(end - 1).toISOString().slice(0, 10)}`;
  const data = await getJson<{ hourly?: Record<string, (number | null)[]> & { time: string[] } }>(
    url,
  );
  if (!data.hourly) return [];
  const hours = data.hourly.time.map((time) => Date.parse(`${time}:00Z`));
  return (
    [
      ["HRRR", "temperature_2m_gfs_hrrr"],
      ["NBM", "temperature_2m_ncep_nbm_conus"],
    ] as const
  ).flatMap(([name, key]) => {
    const series = data.hourly![key] ?? [];
    // HRRR stops 18-48 hours out: keep the hours it has
    const kept = hours.flatMap((hour, index) =>
      typeof series[index] === "number" ? [{ hour, value: series[index] as number }] : [],
    );
    return kept.length
      ? [{ name, hours: kept.map((each) => each.hour), runs: [kept.map((each) => each.value)] }]
      : [];
  });
};

const localTime = (at: number, timeZone: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(at);

const range = ({ min, max }: Observed) =>
  max - min < 0.3 ? `${max.toFixed(1)}°F` : `${min.toFixed(1)}-${max.toFixed(1)}°F`;

const signed = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;

export const multiSourceWeather = async (
  event: MarketEvent,
  now = Date.now(),
): Promise<DeepDive | "waiting" | null> => {
  const question = parseTemperatureQuestion(event);
  if (!question) return null;
  const station = await stationInfo(question.station);
  const offset = standardOffsetMinutes(station.timeZone, Number(question.day.slice(0, 4)));
  const { start, end } = climateDay(question.day, offset);
  if ((now - start) / HOUR < LATE_HOUR) return "waiting";

  const { latitude, longitude } = station;
  // a source that fails is left out; MIN_SOURCES decides whether what's left is enough
  const [readings, ensemble, fine, nws] = await Promise.all([
    stationReadings(question.station, start, Math.min(now, end)).catch(() => []),
    ensembleHours(latitude, longitude, start, end)
      .then((data): Source[] => (data.runs.length ? [{ name: "ensemble", ...data }] : []))
      .catch((): Source[] => []),
    highResolution(latitude, longitude, start, end).catch((): Source[] => []),
    nwsHourly(latitude, longitude)
      .then((source) => [source])
      .catch((): Source[] => []),
  ]);
  const sources = [...fine, ...nws, ...ensemble];
  const observed = observedExtreme(question.kind, readings, start);
  // Anchor to the latest hourly report (tenths of a degree) unless it's over an hour older than the
  // latest reading: the 5-minute readings are whole °C, so anchoring to them adds up to ±0.9°F
  const newest = readings.at(-1) ?? null;
  const precise = readings.findLast((reading) => reading.precise);
  const latest =
    newest && precise && newest.at - precise.at <= 75 * 60_000 ? precise : newest;
  const from = readings.length > 0 ? Math.max(start, now) : start;
  const combined = combineSources({
    kind: question.kind,
    observed,
    latest,
    sources,
    from,
    end,
  });
  if (combined.values.length === 0)
    throw new Error(`No readings or forecast for ${question.station} on ${question.day}`);

  const enough = combined.finals.length >= MIN_SOURCES;
  const agree = enough && combined.spread <= AGREE_F;
  const live = observed !== null && agree;
  const confidence: DeepDive["estimates"][number]["confidence"] = live
    ? "high"
    : observed !== null
      ? "medium"
      : "low";
  const estimates = event.markets
    .filter((market) => market.range)
    .map((market) => ({
      marketId: market.id,
      probabilityOutcome1: bandProbability(combined.values, market.range!),
      confidence,
    }));

  const word = question.kind;
  const soFar =
    observed !== null && latest
      ? `${station.name}: ${word} so far ${range(observed)}, latest ${latest.f}°F at ${localTime(latest.at, station.timeZone)}`
      : null;
  const finals = combined.finals
    .map((each) => `${each.name} ${each.final}°F (${signed(each.shift)})`)
    .join(", ");
  const forecast = `Final ${word} by source, anchored to the latest reading (shift in brackets): ${finals}`;
  const verdict = !enough
    ? `Only ${combined.finals.length} of 4 sources answered: no bet.`
    : agree
      ? `Sources agree within ${combined.spread}°F.`
      : `Sources disagree by ${combined.spread}°F: no bet.`;

  return {
    summary: [soFar ? `${soFar}.` : "No readings yet.", `${forecast}.`, verdict].join(" "),
    keyFactors: [soFar ?? `No readings yet for ${question.day}`, forecast, verdict],
    reading: soFar ?? `Forecast only: ${finals}`,
    liveData: live,
    facts: [soFar, forecast, verdict].filter((fact): fact is string => fact !== null),
    sources: [
      {
        title: `NWS observations, ${station.name}`,
        url: `https://forecast.weather.gov/data/obhistory/${question.station}.html`,
      },
      { title: "Open-Meteo (HRRR, NBM)", url: "https://open-meteo.com/en/docs/gfs-api" },
      { title: "NWS hourly forecast", url: "https://www.weather.gov/documentation/services-web-api" },
      { title: "Open-Meteo ensemble", url: "https://open-meteo.com/en/docs/ensemble-api" },
    ],
    estimates,
    usage: { inputTokens: 0, outputTokens: 0, searches: 0 },
    costUsd: 0,
  };
};
