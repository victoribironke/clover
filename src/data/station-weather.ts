import type { Market, MarketEvent } from "@/exchanges/types.ts";

// Kalshi's daily temperature markets ("Highest temperature in New York City on Oct 1, 2026?")
// settle on one NWS climate station's daily high or low, in whole °F, over the local
// "climate day": midnight to midnight local STANDARD time (so 1am-1am during daylight saving).
// We price them from two free, keyless sources:
//   - the station's own observations so far today (api.weather.gov): a hard floor for the high
//     (ceiling for the low) once the day is under way
//   - Open-Meteo's ensemble (ICON, GFS, ECMWF: ~120 runs) for the hours still to come
// Each run gives one possible final high/low; the share of runs inside a band is its probability.

export type TemperatureQuestion = {
  kind: "high" | "low";
  // ICAO id, e.g. "KNYC" for Central Park (CLINYC in Kalshi's rules)
  station: string;
  // the climate day, "2026-10-01"
  day: string;
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DATE = /\b([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s*(\d{4})\b/;

export const parseTemperatureQuestion = (event: MarketEvent): TemperatureQuestion | null => {
  if (event.exchange !== "kalshi") return null;
  const kind = /^KXHIGH/i.test(event.id) ? "high" : /^KXLOW/i.test(event.id) ? "low" : null;
  const rules = event.markets[0]?.rules ?? "";
  const station = rules.match(/\(CLI([A-Z]{3})\)/)?.[1];
  const date = rules.match(DATE) ?? event.title.match(DATE);
  if (!kind || !station || !date) return null;
  const month = MONTHS.indexOf(date[1]!.toLowerCase());
  if (month === -1) return null;
  const day = `${date[3]}-${String(month + 1).padStart(2, "0")}-${date[2]!.padStart(2, "0")}`;
  return { kind, station: `K${station}`, day };
};

// UTC offset of the zone's standard time, in minutes (e.g. -300 for New York)
export const standardOffsetMinutes = (timeZone: string, year: number) => {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(new Date(Date.UTC(year, 0, 15)))
    .find((part) => part.type === "timeZoneName")?.value;
  const match = name?.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!match) return 0;
  return (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]));
};

// The climate day in UTC: [start, end)
export const climateDay = (day: string, offsetMinutes: number) => {
  const start = Date.parse(`${day}T00:00:00Z`) - offsetMinutes * 60_000;
  return { start, end: start + 24 * 3_600_000 };
};

const round = (value: number) => Math.round(value);

// One final value per ensemble run: the observed extreme so far, pushed further by whatever
// the run forecasts for the hours still to come. Whole degrees, like the climate report.
export const finalValues = ({
  kind,
  observed,
  runs,
}: {
  kind: "high" | "low";
  // extreme of the readings so far, or null before the day starts / without readings
  observed: number | null;
  // per run, its forecast values for the rest of the day
  runs: number[][];
}) => {
  const pick = kind === "high" ? Math.max : Math.min;
  const values = runs
    .map((future) => {
      const all = observed === null ? future : [observed, ...future];
      return all.length ? round(pick(...all)) : null;
    })
    .filter((value): value is number => value !== null);
  // day over (or no forecast hours left): the readings decide
  if (values.length === 0 && observed !== null) return [round(observed)];
  return values;
};

// Our readings aren't the official report: checked against 192 settled Kalshi days (2026-09-30),
// the extreme of the station's public readings landed in the settled band 79% of the time for
// highs and 83% for lows, and the misses were a degree off. So each value also counts a little
// toward its neighbours.
const NEIGHBOUR_WEIGHT = 0.1;

const inRange = (value: number, range: NonNullable<Market["range"]>) =>
  (range.min === null || value >= range.min) && (range.max === null || value <= range.max);

// Share of runs inside the band (with the measurement spread above), pulled slightly off 0 and 1:
// a model this coarse is never certain
export const bandProbability = (values: number[], range: NonNullable<Market["range"]>) => {
  const inside = values.reduce(
    (total, value) =>
      total +
      (1 - 2 * NEIGHBOUR_WEIGHT) * Number(inRange(value, range)) +
      NEIGHBOUR_WEIGHT * (Number(inRange(value - 1, range)) + Number(inRange(value + 1, range))),
    0,
  );
  return (inside + 0.5) / (values.length + 1);
};

export type Ensemble = { hours: number[]; runs: number[][] };

// Each run's values for the hours in [from, end)
export const runsBetween = ({ hours, runs }: Ensemble, from: number, end: number) =>
  runs
    .map((run) => run.filter((_, index) => hours[index]! >= from && hours[index]! < end))
    .filter((run) => run.length > 0);

// How far the models missed the station's actual extreme on recent, finished climate days
// (observed minus the runs' average extreme), averaged. The grid cell isn't the station: a city
// park or airport can run a few degrees off, and this carries that over to the day being priced.
export const extremeBias = (
  kind: "high" | "low",
  readings: Reading[],
  ensemble: Ensemble,
  days: { start: number; end: number }[],
) => {
  const pick = kind === "high" ? Math.max : Math.min;
  const misses = days.flatMap(({ start, end }) => {
    const observed = readings
      .filter((reading) => reading.at >= start && reading.at < end)
      .map((reading) => reading.f);
    const runs = runsBetween(ensemble, start, end);
    // need most of the day covered on both sides
    if (observed.length < 12 || runs.length === 0 || runs[0]!.length < 20) return [];
    const modelled = runs.reduce((total, run) => total + pick(...run), 0) / runs.length;
    return [pick(...observed) - modelled];
  });
  if (misses.length === 0) return 0;
  const bias = misses.reduce((total, miss) => total + miss, 0) / misses.length;
  return Math.max(-6, Math.min(6, bias));
};

// --- fetching ---

const NWS_HEADERS = {
  "User-Agent": "clover-bot (prediction market research)",
  Accept: "application/geo+json",
};

type Station = { name: string; latitude: number; longitude: number; timeZone: string };
const stations = new Map<string, Station>();

// A scan prices a city's high and low from the same readings and forecast: fetch each once
const CACHE_MS = 10 * 60_000;
const cache = new Map<string, { at: number; data: Promise<unknown> }>();

const getJson = <T>(url: string, headers?: Record<string, string>): Promise<T> => {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data as Promise<T>;
  const data = (async () => {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`${response.status} from ${new URL(url).host}`);
    return (await response.json()) as T;
  })();
  // failures aren't kept: the next caller tries again
  data.catch(() => cache.delete(url));
  cache.set(url, { at: Date.now(), data });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return data;
};

export const stationInfo = async (icao: string) => {
  const cached = stations.get(icao);
  if (cached) return cached;
  const data = await getJson<{
    geometry: { coordinates: [number, number] };
    properties: { name: string; timeZone: string };
  }>(`https://api.weather.gov/stations/${icao}`, NWS_HEADERS);
  const station = {
    name: data.properties.name,
    longitude: data.geometry.coordinates[0],
    latitude: data.geometry.coordinates[1],
    timeZone: data.properties.timeZone,
  };
  stations.set(icao, station);
  return station;
};

export type Reading = { at: number; f: number };

type ObservationsPage = {
  features?: { properties: { timestamp: string; temperature?: { value: number | null } } }[];
  pagination?: { next?: string };
};

// The station's readings (°F) inside [start, end). Pages come newest first, 500 at a time
// (some stations report every 5 minutes, so a few days take several pages).
export const stationReadings = async (
  icao: string,
  start: number,
  end: number,
): Promise<Reading[]> => {
  let url: string | undefined =
    `https://api.weather.gov/stations/${icao}/observations?start=${new Date(start).toISOString()}&end=${new Date(end).toISOString()}`;
  const readings: Reading[] = [];
  for (let page = 0; url && page < 8; page++) {
    const data: ObservationsPage = await getJson<ObservationsPage>(url, NWS_HEADERS);
    const batch = (data.features ?? [])
      .map((feature) => ({
        at: Date.parse(feature.properties.timestamp),
        c: feature.properties.temperature?.value,
      }))
      .filter((reading): reading is { at: number; c: number } => typeof reading.c === "number");
    readings.push(
      ...batch.map(({ at, c }) => ({ at, f: Math.round(((c * 9) / 5) * 10 + 320) / 10 })),
    );
    if (batch.length === 0 || batch.some((reading) => reading.at < start)) break;
    url = data.pagination?.next;
  }
  return readings
    .filter((reading) => reading.at >= start && reading.at < end)
    .sort((a, b) => a.at - b.at);
};

// Hourly °F per ensemble run, covering [from, end)
export const ensembleHours = async (
  latitude: number,
  longitude: number,
  from: number,
  end: number,
): Promise<Ensemble> => {
  const startDate = new Date(from).toISOString().slice(0, 10);
  const endDate = new Date(end - 1).toISOString().slice(0, 10);
  const url =
    `https://ensemble-api.open-meteo.com/v1/ensemble?latitude=${latitude}&longitude=${longitude}` +
    `&hourly=temperature_2m&temperature_unit=fahrenheit&models=icon_seamless,gfs_seamless,ecmwf_ifs025` +
    `&timezone=GMT&start_date=${startDate}&end_date=${endDate}`;
  const data = await getJson<{ hourly?: Record<string, (number | null)[]> & { time: string[] } }>(
    url,
  );
  if (!data.hourly) return { hours: [], runs: [] };
  const hours = data.hourly.time.map((time) => Date.parse(`${time}:00Z`));
  // a run with gaps would misalign its hours; runs are complete in practice
  const runs = Object.entries(data.hourly)
    .filter(([key]) => key.startsWith("temperature_2m"))
    .map(([, series]) => series as (number | null)[])
    .filter((series) => series.every((value) => typeof value === "number")) as number[][];
  return { hours, runs };
};
