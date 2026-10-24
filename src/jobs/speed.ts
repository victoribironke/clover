import { FieldValue } from "@google-cloud/firestore";
import { collection } from "@/db/firestore.ts";
import { releaseLock, tryLock } from "@/db/kv.ts";
import { log } from "@/lib/logger.ts";
import { settings } from "@/settings.ts";
import {
  baselineDue,
  dueMinute,
  newReports,
  stationOf,
  toReport,
  toSnapshot,
  windowDone,
  type RawMarket,
  type RawMetar,
  type Snapshot,
  type SpeedState,
} from "@/speed/record.ts";

// One run of the speed test (src/speed/record.ts), every minute from Cloud Scheduler. It never
// trades. Reports go to Firestore `speed/{station}-{obsTime}`, the running state to `kv/speed-state`.

const LOCK = "speed";
const STATE = "speed-state";
const STATIONS = "speed-stations";
const DAY = 24 * 3_600_000;

const getJson = async <T>(url: string): Promise<T> => {
  // reads only: back off on rate limits and server errors
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, {
      headers: { "User-Agent": "clover-bot (prediction market research)" },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) {
      const text = await response.text();
      return (text.trim() ? JSON.parse(text) : []) as T;
    }
    if ((response.status !== 429 && response.status < 500) || attempt >= 2)
      throw new Error(`${response.status} from ${new URL(url).host}`);
    await Bun.sleep(1000 * 2 ** attempt);
  }
};

const openMarkets = async (series: string) =>
  (
    await getJson<{ markets?: RawMarket[] }>(
      `${settings.kalshiBaseUrl}/markets?series_ticker=${encodeURIComponent(series)}&status=open&limit=100`,
    )
  ).markets ?? [];

// series -> station, read from each series' market rules once a day
const stationsBySeries = async (): Promise<Record<string, string>> => {
  const ref = collection("kv").doc(STATIONS);
  const saved = (await ref.get()).data() as { at: number; map: Record<string, string> } | undefined;
  if (saved && Date.now() - saved.at < DAY && Object.keys(saved.map).length > 0) return saved.map;
  const map: Record<string, string> = {};
  for (const series of settings.kalshiSeries) {
    const station = stationOf((await openMarkets(series))[0]?.rules_primary ?? "");
    if (station) map[series] = station;
    await Bun.sleep(150);
  }
  await ref.set({ at: Date.now(), map });
  return map;
};

const snapshot = async (series: string): Promise<Snapshot> =>
  toSnapshot(Date.now(), await openMarkets(series));

export const runSpeedTest = async () => {
  if (Date.now() >= Date.parse(settings.speedTestUntil)) return { skipped: "speed test is over" };
  const lock = await tryLock(LOCK, 55_000);
  if (!lock.acquired) return { skipped: "previous run still going" };
  try {
    const stateRef = collection("kv").doc(STATE);
    const state: SpeedState = {
      lastObs: {},
      open: [],
      baselines: {},
      ...((await stateRef.get()).data() as Partial<SpeedState> | undefined),
    };
    const seriesByStation = Object.fromEntries(
      Object.entries(await stationsBySeries()).map(([series, station]) => [station, series]),
    );
    const stations = Object.keys(seriesByStation);
    const raw = await getJson<RawMetar[]>(
      `https://aviationweather.gov/api/data/metar?ids=${stations.join(",")}&format=json`,
    );
    const seenAt = Date.now();
    const { fresh, markers } = newReports(raw.map(toReport), state.lastObs);
    state.lastObs = markers;
    const speed = collection("speed");

    // a new report: its city's prices now, with the last baseline for comparison
    for (const report of fresh) {
      const series = seriesByStation[report.station]!;
      const id = `${report.station}-${report.obsAt}`;
      const first = await snapshot(series);
      await speed.doc(id).set({
        ...report,
        series,
        seenAt,
        baseline: state.baselines[series] ?? null,
        snapshots: [{ minute: 0, ...first }],
      });
      state.open.push({ id, series, seenAt, taken: [0] });
      await Bun.sleep(150);
    }

    // follow-up snapshots for reports seen in the last 15 minutes
    const now = Date.now();
    for (const window of state.open) {
      const minute = dueMinute(window, now);
      if (minute === null) continue;
      const next = await snapshot(window.series);
      await speed.doc(window.id).update({ snapshots: FieldValue.arrayUnion({ minute, ...next }) });
      window.taken.push(minute);
      await Bun.sleep(150);
    }
    state.open = state.open.filter((window) => !windowDone(window, Date.now()));

    // before the hourly reports: where every city's prices stand
    let baselines = 0;
    for (const series of Object.values(seriesByStation)) {
      if (!baselineDue(Date.now(), state.baselines[series])) continue;
      state.baselines[series] = await snapshot(series);
      baselines++;
      await Bun.sleep(150);
    }

    await stateRef.set(state);
    const result = { reports: fresh.length, following: state.open.length, baselines };
    if (fresh.length > 0) log.info("speed test", result);
    return result;
  } finally {
    await releaseLock(LOCK);
  }
};
