import type { MarketEvent } from "@/exchanges/types.ts";
import { errorMessage, log } from "@/lib/logger.ts";
import { fetchWeatherData, parseWeatherQuestion } from "./weather.ts";

// Hard data gathered before research, so the model reasons from the current number rather
// than from history alone. Everything here is best effort: a failed fetch just means less data.
export type EventData = {
  // facts for the research brief, one per line
  notes: string[];
  // pages the model may open with URL context (search snippets rarely carry live numbers)
  pages: string[];
  // we fetched a live reading or forecast ourselves
  hasLiveData: boolean;
};

// Sites that block logged-out reading or only work as apps: listing them wastes a fetch
const UNREADABLE = /(^|\.)(x\.com|twitter\.com|apps\.apple\.com|music\.apple\.com|instagram\.com|tiktok\.com|charts\.spotify\.com)$/i;

const readable = (url: string) => {
  try {
    const { protocol, hostname } = new URL(url);
    return (protocol === "https:" || protocol === "http:") && !UNREADABLE.test(hostname);
  } catch {
    return false;
  }
};

// Public mirrors of charts whose official sites need a login
const chartPages = (event: MarketEvent) => {
  const text = `${event.title} ${event.description} ${event.resolutionSource}`.toLowerCase();
  const nigeria = /nigeria|\bng\b|naija/.test(text) || text.includes("spotify.com") || text.includes("apple music");
  const pages: string[] = [];
  if (nigeria && text.includes("spotify")) pages.push("https://kworb.net/spotify/country/ng_daily.html");
  if (nigeria && text.includes("apple music")) pages.push("https://kworb.net/charts/apple_s/ng.html");
  return pages;
};

// Recurring counts of a habit (an account's posts per day/week). Unlike a one-off release,
// the history of the same count is real evidence here, even without a live reading.
export const isRecurringCount = (event: MarketEvent) => /number of (x )?posts|\bposts\b.*\b(today|by \d|this week)/i.test(event.title);

export const gatherEventData = async (event: MarketEvent): Promise<EventData> => {
  const notes: string[] = [];
  let hasLiveData = false;

  const weather = parseWeatherQuestion(event);
  if (weather) {
    try {
      const data = await fetchWeatherData(weather);
      if (data) {
        notes.push(data.note);
        hasLiveData = true;
      }
    } catch (error) {
      log.warn("weather data failed", { eventId: event.id, error: errorMessage(error) });
    }
  }

  const pages = [...new Set([...(readable(event.resolutionSource) ? [event.resolutionSource] : []), ...chartPages(event)])];
  return { notes, pages, hasLiveData };
};
