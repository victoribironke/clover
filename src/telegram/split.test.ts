import { expect, test } from "bun:test";
import { splitMessage } from "./split.ts";

test("keeps a short message whole", () => {
  expect(splitMessage("<b>Scan done</b>\n\nall good")).toEqual(["<b>Scan done</b>\n\nall good"]);
});

test("splits at blank lines, never inside an item", () => {
  const item = (n: number) => `<b>item ${n}</b>\n${"x".repeat(40)}`;
  const html = [1, 2, 3, 4].map(item).join("\n\n");
  const parts = splitMessage(html, 120);
  expect(parts.length).toBeGreaterThan(1);
  expect(parts.join("\n\n")).toBe(html);
  for (const part of parts) expect(part.length).toBeLessThanOrEqual(120);
});

test("an oversized block is split by lines", () => {
  const block = Array.from({ length: 10 }, (_, n) => `line ${n} ${"y".repeat(30)}`).join("\n");
  const parts = splitMessage(block, 100);
  expect(parts.every((part) => part.length <= 100)).toBe(true);
  expect(parts.join("\n")).toBe(block);
});
