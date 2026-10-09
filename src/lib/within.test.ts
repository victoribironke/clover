import { expect, test } from "bun:test";
import { within } from "./within.ts";

test("falls back when the promise is slow or fails", async () => {
  expect(await within(Bun.sleep(5).then(() => "fast"), 100, "late")).toBe("fast");
  expect(await within(Bun.sleep(100).then(() => "slow"), 5, "late")).toBe("late");
  expect(await within(Promise.reject(new Error("down")), 100, "late")).toBe("late");
});
