import { expect, test } from "bun:test";
import { createHash, createHmac } from "node:crypto";
import { signRequest } from "./http.ts";

// Mirrors the reference implementation in https://docs.bayse.markets/authentication
test("signs {timestamp}.{METHOD}.{path}.{sha256(body)} with HMAC-SHA256, base64", () => {
  const body = '{"side":"BUY","outcomeId":"abc","amount":100,"type":"MARKET","currency":"NGN"}';
  const path = "/v1/pm/events/evt_123/markets/mkt_456/orders";
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const expected = createHmac("sha256", "sk_test").update(`1700000000.POST.${path}.${bodyHash}`).digest("base64");

  expect(signRequest("sk_test", 1700000000, "post", path, body)).toBe(expected);
});

test("bodiless requests end the payload with a trailing dot", () => {
  const expected = createHmac("sha256", "sk_test").update("1700000000.DELETE./v1/pm/orders/o1.").digest("base64");
  expect(signRequest("sk_test", 1700000000, "DELETE", "/v1/pm/orders/o1", null)).toBe(expected);
});
