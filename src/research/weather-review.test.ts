import { expect, mock, test } from "bun:test";

mock.module("@/config.ts", () => ({ config: { OPENAI_API_KEY: "test" } }));

const { discussionText } = await import("./weather-review.ts");

test("the forecast discussion is cut before the aviation and marine sections", () => {
  const text = [
    "Area Forecast Discussion",
    ".KEY MESSAGES...",
    "A cold front arrives this evening.",
    "&&",
    ".AVIATION /12Z SATURDAY THROUGH WEDNESDAY/...",
    "VFR.",
    ".MARINE...",
    "Gales.",
  ].join("\n");
  expect(discussionText(text)).toBe(
    "Area Forecast Discussion\n.KEY MESSAGES...\nA cold front arrives this evening.\n&&",
  );
});
