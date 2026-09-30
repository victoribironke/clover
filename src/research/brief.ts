// The search model's brief, in plain lines rather than JSON:
//   READING: Over 2.5 at 1.88 on Pinnacle, Sep 27
//   LIVE: yes
//   FACTS:
//   - Italy lost 2-0 to Belgium on Sep 25 (UEFA)
// Read leniently: a missing or malformed line only loses that line, never the whole deep dive.
export type Brief = { reading: string; live: boolean; facts: string[] };

const field = (text: string, name: string) =>
  text.match(new RegExp(`^[*_\\s]*${name}[*_]*\\s*:[*_]*\\s*(.*)$`, "im"))?.[1]?.trim();

const isNone = (reading: string) => /^(none|n\/a|not found|no\b.*found)\.?$/i.test(reading);

export const parseBrief = (text: string): Brief => {
  const reading = field(text, "reading") || "none";
  const facts = text
    .split("\n")
    .map((line) => line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.+)$/)?.[1]?.trim())
    .filter((fact): fact is string => Boolean(fact));
  if (facts.length === 0 && isNone(reading)) {
    throw new Error(`Gemini's brief had no reading or facts: ${text.slice(0, 160)}`);
  }
  // "live" without an actual reading would lift the confidence cap on nothing
  const live = !isNone(reading) && /^(yes|true)\b/i.test(field(text, "live") ?? "");
  return { reading, live, facts };
};
