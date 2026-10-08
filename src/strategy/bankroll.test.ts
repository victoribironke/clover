import { expect, test } from "bun:test";
import { reserveBankroll, type Bankroll } from "./bankroll.ts";

test("reserving a bet updates a scan bankroll without changing its capital base", () => {
  const bankroll: Bankroll = {
    exchange: "kalshi",
    currency: "USD",
    capital: 50,
    available: 40,
    exposure: 10,
    bankroll: 50,
    deployable: 40,
    withdrawable: 0,
    realizedPnl: 0,
    dryRun: true,
  };
  expect(reserveBankroll(bankroll, 5)).toEqual({
    ...bankroll,
    available: 35,
    exposure: 15,
    deployable: 35,
  });
  expect(bankroll.available).toBe(40);
});
