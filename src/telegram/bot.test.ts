import { expect, mock, test } from "bun:test";

// bot.ts reads the token and chat id from the environment
mock.module("@/config.ts", () => ({ config: { TELEGRAM_BOT_TOKEN: "1:test", TELEGRAM_CHAT_ID: 1 } }));
const { firstDelivery } = await import("./bot.ts");

test("a resent update is handled once", () => {
  expect(firstDelivery(101)).toBe(true);
  expect(firstDelivery(101)).toBe(false);
  expect(firstDelivery(102)).toBe(true);
});
