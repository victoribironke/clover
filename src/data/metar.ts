// Airport weather reports (METARs) for any station worldwide, from aviationweather.gov (free, no
// key; up to 96 hours back). US stations report tenths of °C in their remarks ("T01780111");
// most others report whole °C. Polymarket settles its temperature markets on these reports.

export type Metar = {
  at: number;
  // °C as reported: tenths for US stations, whole degrees elsewhere
  c: number;
  // "METAR" (routine, usually hourly or half-hourly) or "SPECI" (a special report between them)
  type: string;
};

export type MetarStation = { name: string; latitude: number; longitude: number };

type RawMetar = {
  icaoId: string;
  obsTime: number;
  temp?: number | null;
  metarType?: string;
  name?: string;
  lat?: number;
  lon?: number;
};

const CACHE_MS = 10 * 60_000;
const cache = new Map<string, { at: number; data: Promise<RawMetar[]> }>();

const fetchRaw = (icao: string, hours: number) => {
  const key = `${icao}|${hours}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  const data = (async () => {
    const response = await fetch(
      `https://aviationweather.gov/api/data/metar?ids=${encodeURIComponent(icao)}&format=json&hours=${hours}`,
      {
        headers: { "User-Agent": "clover-bot (prediction market research)" },
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!response.ok) throw new Error(`${response.status} from aviationweather.gov for ${icao}`);
    // an empty body means no reports in the window
    const text = await response.text();
    return text.trim() ? (JSON.parse(text) as RawMetar[]) : [];
  })();
  data.catch(() => cache.delete(key));
  cache.set(key, { at: Date.now(), data });
  return data;
};

// Reports in [start, end), oldest first
export const metars = async (icao: string, start: number, end: number): Promise<Metar[]> => {
  const hours = Math.min(96, Math.max(1, Math.ceil((Date.now() - start) / 3_600_000) + 1));
  return (await fetchRaw(icao, hours))
    .filter((raw): raw is RawMetar & { temp: number } => typeof raw.temp === "number")
    .map((raw) => ({ at: raw.obsTime * 1000, c: raw.temp, type: raw.metarType ?? "METAR" }))
    .filter((metar) => metar.at >= start && metar.at < end)
    .sort((a, b) => a.at - b.at);
};

export const metarStation = async (icao: string): Promise<MetarStation | null> => {
  const latest = (await fetchRaw(icao, 6))[0] ?? (await fetchRaw(icao, 48))[0];
  if (!latest || latest.lat === undefined || latest.lon === undefined) return null;
  return { name: latest.name ?? icao, latitude: latest.lat, longitude: latest.lon };
};

// The station's time zone, from Open-Meteo's lookup of its coordinates (cached: zones don't move)
const zones = new Map<string, Promise<string>>();

export const timeZoneAt = (latitude: number, longitude: number) => {
  const key = `${latitude.toFixed(2)},${longitude.toFixed(2)}`;
  const cached = zones.get(key);
  if (cached) return cached;
  const zone = (async () => {
    const response = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&timezone=auto&forecast_days=1&current=temperature_2m`,
      { signal: AbortSignal.timeout(15_000) },
    );
    if (!response.ok) throw new Error(`${response.status} from Open-Meteo time zone lookup`);
    return ((await response.json()) as { timezone: string }).timezone;
  })();
  zone.catch(() => zones.delete(key));
  zones.set(key, zone);
  return zone;
};

// UTC offset in minutes of `timeZone` at `at` (daylight saving included)
export const offsetMinutesAt = (timeZone: string, at: number) => {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(new Date(at))
    .find((part) => part.type === "timeZoneName")?.value;
  const match = name?.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!match) return 0;
  return (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]));
};
