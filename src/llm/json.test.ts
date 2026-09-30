import { expect, test } from "bun:test";
import { parseModelJson } from "./json.ts";

test("parses valid JSON untouched", () => {
  expect(parseModelJson('{"p":0.55,"note":"a. b"}')).toEqual({ p: 0.55, note: "a. b" });
});

test("repairs leading and trailing decimal points", () => {
  expect(parseModelJson('{"p":.55,"q":[.1, -.2],"n":3.}')).toEqual({
    p: 0.55,
    q: [0.1, -0.2],
    n: 3,
  });
});

test("strips a markdown fence", () => {
  expect(parseModelJson('```json\n{"p":0.5}\n```')).toEqual({ p: 0.5 });
});

test("reports the reply when it can't be repaired", () => {
  expect(() => parseModelJson('{"p": ...}')).toThrow(/in model reply: \{"p": \.\.\.\}/);
});
