import { expect, test } from "bun:test";
import { lagosDate, lagosDateTime, lagosTime, money, signedMoney } from "./format";

test("money groups thousands and handles negatives", () => {
  expect(money(10890)).toBe("₦10,890");
  expect(money(-592.4)).toBe("-₦592");
  expect(signedMoney(4293)).toBe("+₦4,293");
  expect(money(0)).toBe("₦0");
});

test("dates are shown in Lagos time (UTC+1)", () => {
  expect(lagosDateTime("2026-09-25T23:30:00Z")).toBe("26 Sep, 00:30");
  expect(lagosDate("2026-09-25T10:00:00Z")).toBe("25 Sep");
  expect(lagosTime("2026-09-25T13:05:00Z")).toBe("14:05");
});
