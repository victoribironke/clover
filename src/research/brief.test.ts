import { expect, test } from "bun:test";
import { parseBrief } from "./brief.ts";

test("reads the reading, live flag and facts", () => {
  const text = `READING: Over 2.5 at 1.88 on Pinnacle, Sep 27
LIVE: yes
FACTS:
- Italy lost 2-0 to Belgium on Sep 25 (UEFA)
- Calhanoglu out injured (Sky Sports, Sep 26)`;
  expect(parseBrief(text)).toEqual({
    reading: "Over 2.5 at 1.88 on Pinnacle, Sep 27",
    live: true,
    facts: [
      "Italy lost 2-0 to Belgium on Sep 25 (UEFA)",
      "Calhanoglu out injured (Sky Sports, Sep 26)",
    ],
  });
});

test("tolerates markdown, numbered lists and chatter", () => {
  const text = `Here is the brief.
**Reading:** none
**Live:** no
**Facts:**
1. Belgium had 19 shots in its opener
* No shot-line odds found`;
  expect(parseBrief(text)).toEqual({
    reading: "none",
    live: false,
    facts: ["Belgium had 19 shots in its opener", "No shot-line odds found"],
  });
});

test("never marks a missing reading as live", () => {
  expect(parseBrief("READING: none\nLIVE: yes\n- a fact").live).toBe(false);
});

test("fails on an empty brief", () => {
  expect(() => parseBrief("Sorry, I couldn't find anything.")).toThrow(/no reading or facts/);
});
