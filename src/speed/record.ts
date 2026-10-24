// The speed test (from 2026-10-24): does Kalshi's price for a city's daily low react slower than a
// new airport report reaches us? If the band prices only move minutes after a report that changes
// the low, a bot reading reports the moment they post could trade in that gap. If they've already
// moved by the time we see it, there's no gap for us, and that ends the idea.
// Every minute: read the latest report for each station (aviationweather.gov), and when a new one
// appears, snapshot that city's Kalshi prices then and at fixed minutes after. A baseline snapshot
// before the hourly reports (they arrive around :51-:56) shows where prices stood beforehand.

// minutes after we first see a report at which its city's prices are snapshotted
export const SNAPSHOT_MINUTES = [0, 1, 2, 3, 5, 10, 15] as const;
// baseline snapshots are taken in this minute range of each hour, once per hour
export const BASELINE_MINUTES = [44, 50] as const;

export type Report = {
  station: string;
  // when the station observed it, and when NWS received it (epoch ms)
  obsAt: number;
  receiptAt: number | null;
  tempC: number | null;
  type: string;
  raw: string;
};

// a market's price at one moment: yes bid/ask and last trade, in dollars; volume in contracts
export type Quote = { t: string; e: string; b: number; a: number; l: number; v: number };
export type Snapshot = { at: number; markets: Quote[] };

export type OpenWindow = { id: string; series: string; seenAt: number; taken: number[] };

export type SpeedState = {
  // per station, the observation time of the latest report already handled
  lastObs: Record<string, number>;
  // reports still being followed, and which snapshot minutes they have
  open: OpenWindow[];
  // per series, the latest baseline snapshot
  baselines: Record<string, Snapshot>;
};

export type RawMetar = {
  icaoId: string;
  obsTime: number;
  receiptTime?: string;
  temp?: number | null;
  metarType?: string;
  rawOb?: string;
};

export const toReport = (raw: RawMetar): Report => ({
  station: raw.icaoId,
  obsAt: raw.obsTime * 1000,
  receiptAt: raw.receiptTime ? Date.parse(raw.receiptTime) : null,
  tempC: typeof raw.temp === "number" ? raw.temp : null,
  type: raw.metarType ?? "METAR",
  raw: raw.rawOb ?? "",
});

// The reports newer than the last one handled per station. A station seen for the first time only
// sets its marker: its current report may be an hour old, too late to time anything.
export const newReports = (reports: Report[], lastObs: Record<string, number>) => {
  const latest = new Map<string, Report>();
  for (const report of reports) {
    const current = latest.get(report.station);
    if (!current || report.obsAt > current.obsAt) latest.set(report.station, report);
  }
  const fresh: Report[] = [];
  const markers = { ...lastObs };
  for (const [station, report] of latest) {
    const last = lastObs[station];
    if (last !== undefined && report.obsAt > last) fresh.push(report);
    if (last === undefined || report.obsAt > last) markers[station] = report.obsAt;
  }
  return { fresh, markers };
};

// The snapshot minute a window is due for now, or null. A late run takes the latest minute that has
// passed (a missed minute is skipped, not taken late under its own label).
export const dueMinute = (window: OpenWindow, now: number) => {
  const elapsed = (now - window.seenAt) / 60_000;
  const passed = SNAPSHOT_MINUTES.filter((minute) => minute <= elapsed + 0.25);
  const next = passed.at(-1);
  if (next === undefined || window.taken.includes(next)) return null;
  // nothing after a later minute was already taken
  if (window.taken.some((minute) => minute > next)) return null;
  return next;
};

export const windowDone = (window: OpenWindow, now: number) =>
  now - window.seenAt > (SNAPSHOT_MINUTES.at(-1)! + 2) * 60_000;

export const baselineDue = (now: number, last: Snapshot | undefined) => {
  const minute = new Date(now).getUTCMinutes();
  const inRange = minute >= BASELINE_MINUTES[0] && minute <= BASELINE_MINUTES[1];
  return inRange && (!last || now - last.at > 30 * 60_000);
};

export type RawMarket = {
  ticker: string;
  event_ticker: string;
  yes_bid_dollars?: string;
  yes_ask_dollars?: string;
  last_price_dollars?: string;
  volume_fp?: string;
  rules_primary?: string;
};

const dollars = (value: string | undefined) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

export const toSnapshot = (at: number, markets: RawMarket[]): Snapshot => ({
  at,
  markets: markets.map((market) => ({
    t: market.ticker,
    e: market.event_ticker,
    b: dollars(market.yes_bid_dollars),
    a: dollars(market.yes_ask_dollars),
    l: dollars(market.last_price_dollars),
    v: dollars(market.volume_fp),
  })),
});

// "(CLINYC)" in a market's rules -> "KNYC"
export const stationOf = (rules: string) => {
  const code = rules.match(/\(CLI([A-Z]{3})\)/)?.[1];
  return code ? `K${code}` : null;
};
