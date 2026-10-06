import { expect, test } from "bun:test";
import { pickText } from "./format.ts";

test("names the band, not just Yes or No", () => {
  expect(
    pickText({ eventTitle: "Highest temperature in NYC on Oct 6?", marketTitle: "47° to 48°", outcomeLabel: "Yes" }),
  ).toBe("47° to 48° → Yes");
  // a one-market event: the outcome says it all
  expect(
    pickText({ eventTitle: "Will it rain in Lagos?", marketTitle: "Will it rain in Lagos?", outcomeLabel: "No" }),
  ).toBe("No");
});
