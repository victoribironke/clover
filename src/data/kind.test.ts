import { expect, test } from "bun:test";
import { marketKind, type MarketKind } from "./kind.ts";

// Titles and categories as they appear on Bayse
const kind = (title: string, category: string) =>
  marketKind({ title, category, resolutionDate: "2026-09-26T22:59:00Z", closingDate: null });

test.each<[string, string, MarketKind]>([
  ["Will the Temperature in Lagos, Nigeria be  above 28°C by 5:00 PM WAT on Sept 26?", "OTHERS", "weather"],
  ["Pop Base’s Number of X Posts Today, September 25, 2026?", "SOCIAL MEDIA", "post-count"],
  ["Elon Musk's Number of Posts September 22 - September 29, 2026?", "SOCIAL MEDIA", "post-count"],
  ["How Many First-Day Streams For New Ayo Maff ft Zinoleesky?", "ENTERTAINMENT", "streams"],
  ['How Many Spotify NG Streams for "Volume" in Week of September 24?', "ENTERTAINMENT", "streams"],
  ["#1 Song on Apple Music Top Songs by September 27?", "ENTERTAINMENT", "chart"],
  ["Will Seyi Vibez Have 7+ Songs on Apple Music (Top 10) Top Songs by October 1?", "ENTERTAINMENT", "chart"],
  ["Bitcoin Price above $84,275.36 by 4:00 PM GMT on Sep 25?", "CRYPTO", "price"],
  ["Gold (XAUUSD) Up or Down on Sep 25?", "FINANCE", "price"],
  ["Will Nigeria’s Gross External Reserves Cross $56.5 Billion Before Q4 2026 Ends?", "ECONOMY", "economy"],
  ["Will Tinubu Post an Independence Day Message before 10AM October 1?", "SOCIAL MEDIA", "other"],
])("%s → %s", (title, category, expected) => {
  expect(kind(title, category)).toBe(expected);
});
