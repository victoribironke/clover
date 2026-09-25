import type { MarketEvent } from "@/exchanges/types.ts";

// Weather markets on Bayse look like:
//   "Will the Temperature in Lagos, Nigeria be above 28°C by 5:00 PM WAT on Sept 26?"
// and resolve on the Apple Weather reading at that hour. We can't read Apple Weather, but
// Open-Meteo's ensemble (122 runs of the ICON, GFS and ECMWF models, free and keyless) gives
// a real probability for the same reading, which is far better than the model's gut feel.

export type WeatherQuestion = {
  city: string;
  country: string | null;
  direction: "above" | "below";
  thresholdC: number;
  // the hour the reading is taken, in UTC
  at: Date;
};

const TITLE =
  /temperature in (.+?)\s+be\s+(above|below)\s+(-?\d+(?:\.\d+)?)\s*°?\s*C\s+(?:by|at)\s+(\d{1,2}):(\d{2})\s*(AM|PM)\s+WAT\s+on\s+([A-Za-z]+)\.?\s+(\d{1,2})/i;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export const parseWeatherQuestion = (event: MarketEvent): WeatherQuestion | null => {
  const match = event.title.match(TITLE);
  if (!match) return null;
  const [, place, direction, threshold, hour, minute, meridiem, monthName, day] = match;
  const month = MONTHS.indexOf(monthName!.slice(0, 3).toLowerCase());
  if (month === -1) return null;

  const [city, country] = place!.split(",").map((part) => part.trim());
  const year = new Date(event.resolutionDate ?? event.closingDate ?? Date.now()).getUTCFullYear();
  const hour24 = (Number(hour) % 12) + (meridiem!.toUpperCase() === "PM" ? 12 : 0);
  // WAT is UTC+1 all year (no daylight saving)
  const at = new Date(Date.UTC(year, month, Number(day), hour24 - 1, Number(minute)));

  return {
    city: city!,
    country: country ?? null,
    direction: direction!.toLowerCase() as "above" | "below",
    thresholdC: Number(threshold),
    at,
  };
};

type GeoResult = { name: string; latitude: number; longitude: number; country?: string; population?: number };

const geocodeCache = new Map<string, GeoResult | null>();

const geocode = async (city: string, country: string | null) => {
  const key = `${city}|${country ?? ""}`;
  if (geocodeCache.has(key)) return geocodeCache.get(key)!;
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=10&language=en`;
  const { results = [] } = (await fetch(url, { signal: AbortSignal.timeout(15_000) }).then((r) => r.json())) as {
    results?: GeoResult[];
  };
  const inCountry = country
    ? results.filter((result) => result.country?.toLowerCase() === country.toLowerCase())
    : results;
  const best = [...(inCountry.length ? inCountry : results)].sort((a, b) => (b.population ?? 0) - (a.population ?? 0))[0] ?? null;
  geocodeCache.set(key, best);
  return best;
};

const utcDay = (date: Date) => date.toISOString().slice(0, 10);
const utcHour = (date: Date) => `${date.toISOString().slice(0, 13)}:00`;

const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;

export type WeatherData = {
  // one line for the research brief
  note: string;
  // share of ensemble runs on the "outcome1 / Yes" side of the threshold, when forecasting
  probabilityYes: number | null;
};

export const fetchWeatherData = async (question: WeatherQuestion, now = Date.now()): Promise<WeatherData | null> => {
  const place = await geocode(question.city, question.country);
  if (!place) return null;

  const coords = `latitude=${place.latitude}&longitude=${place.longitude}`;
  const day = utcDay(question.at);
  const hour = utcHour(question.at);
  const label = `${question.city} at ${question.at.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  const yes = (value: number) => (question.direction === "above" ? value > question.thresholdC : value < question.thresholdC);

  // The reading time has already passed: report what the models recorded for that hour
  if (question.at.getTime() <= now) {
    const url = `https://api.open-meteo.com/v1/forecast?${coords}&hourly=temperature_2m&timezone=GMT&start_date=${day}&end_date=${day}`;
    const data = (await fetch(url, { signal: AbortSignal.timeout(15_000) }).then((r) => r.json())) as {
      hourly?: { time: string[]; temperature_2m: (number | null)[] };
    };
    const value = data.hourly?.temperature_2m[data.hourly.time.indexOf(hour)];
    if (value === null || value === undefined) return null;
    return {
      note: `Open-Meteo recorded ${value}°C for ${label} (reading time has passed; Apple Weather may differ by ~1°C).`,
      probabilityYes: null,
    };
  }

  const url = `https://ensemble-api.open-meteo.com/v1/ensemble?${coords}&hourly=temperature_2m&models=icon_seamless,gfs_seamless,ecmwf_ifs025&timezone=GMT&start_date=${day}&end_date=${day}`;
  const data = (await fetch(url, { signal: AbortSignal.timeout(20_000) }).then((r) => r.json())) as {
    hourly?: Record<string, (number | null)[]> & { time: string[] };
  };
  if (!data.hourly) return null;
  const index = data.hourly.time.indexOf(hour);
  if (index === -1) return null;

  const values = Object.entries(data.hourly)
    .filter(([key]) => key.startsWith("temperature_2m"))
    .map(([, series]) => (series as (number | null)[])[index])
    .filter((value): value is number => typeof value === "number")
    .sort((a, b) => a - b);
  if (values.length === 0) return null;

  const probabilityYes = values.filter(yes).length / values.length;
  return {
    note:
      `Open-Meteo ensemble, ${values.length} runs (ICON, GFS, ECMWF), ${label}: median ${quantile(values, 0.5)}°C, ` +
      `10-90% range ${quantile(values, 0.1)}-${quantile(values, 0.9)}°C; ${Math.round(probabilityYes * 100)}% of runs ${question.direction} ${question.thresholdC}°C. ` +
      `Apple Weather uses its own model and may differ by ~1°C.`,
    probabilityYes,
  };
};
