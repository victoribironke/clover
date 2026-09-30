import { describe, expect, test } from "bun:test";
import {
  createKalshiExchange,
  strikeRange,
  toEvent,
  walkBook,
  type RawKalshiMarket,
} from "./adapter.ts";

// Shapes as Kalshi returned them on 2026-09-30 (KXHIGHNY-26OCT01)
const market = (overrides: Partial<RawKalshiMarket>): RawKalshiMarket => ({
  ticker: "KXHIGHNY-26OCT01-B75.5",
  event_ticker: "KXHIGHNY-26OCT01",
  status: "active",
  yes_sub_title: "75° to 76°",
  rules_primary:
    "If the maximum temperature recorded at New York City (CLINYC) for Oct 1, 2026, is between 75-76°…",
  yes_ask_dollars: "0.2900",
  no_ask_dollars: "0.7200",
  result: "",
  close_time: "2026-10-02T05:00:00Z",
  expected_expiration_time: "2026-10-02T19:00:00Z",
  strike_type: "between",
  floor_strike: 75,
  cap_strike: 76,
  volume_fp: "1200.00",
  ...overrides,
});

describe("strikeRange", () => {
  test("reads Kalshi's whole-degree strikes as inclusive ranges", () => {
    expect(strikeRange(market({}))).toEqual({ min: 75, max: 76 });
    expect(
      strikeRange(market({ strike_type: "greater", floor_strike: 82, cap_strike: undefined })),
    ).toEqual({ min: 83, max: null });
    expect(
      strikeRange(market({ strike_type: "less", floor_strike: undefined, cap_strike: 75 })),
    ).toEqual({ min: null, max: 74 });
  });
});

describe("toEvent", () => {
  test("maps an event with its bands", () => {
    const event = toEvent(
      {
        event_ticker: "KXHIGHNY-26OCT01",
        series_ticker: "KXHIGHNY",
        title: "Highest temperature in New York City on Oct 1, 2026?",
        category: "Climate and Weather",
        mutually_exclusive: true,
      },
      [
        market({}),
        market({
          ticker: "KXHIGHNY-26OCT01-T82",
          yes_ask_dollars: "0.0100",
          no_ask_dollars: "1.0000",
          strike_type: "greater",
          floor_strike: 82,
        }),
      ],
    );
    expect(event.exchange).toBe("kalshi");
    expect(event.type).toBe("combined");
    expect(event.status).toBe("open");
    expect(event.markets[0]!.outcomes.map((outcome) => outcome.price)).toEqual([0.29, 0.72]);
    // an ask of 1.00 means nobody is selling: priced out of reach
    expect(event.markets[1]!.outcomes[1].price).toBe(1);
  });

  test("marks settled markets with the winning side", () => {
    const event = toEvent({ event_ticker: "E", series_ticker: "S", title: "T" }, [
      market({ status: "finalized", result: "no" }),
    ]);
    expect(event.status).toBe("resolved");
    expect(event.markets[0]!.resolvedOutcomeId).toBe("KXHIGHNY-26OCT01-B75.5:no");
  });
});

describe("walkBook", () => {
  test("buys YES from NO bids, whole contracts, fee included", () => {
    // NO bids at 0.70 and 0.60 are YES offers at 0.30 and 0.40
    const quote = walkBook(
      [
        ["0.6000", "10.00"],
        ["0.7000", "5.00"],
      ],
      3,
      0.07,
    );
    // 5 at 0.30 (fee ceil(0.07×5×0.3×0.7) = 0.08) = 1.58, then 3 at 0.40 (fee 0.06) = 1.26
    expect(quote.shares).toBe(8);
    expect(quote.amount).toBeCloseTo(2.84);
    expect(quote.avgPrice).toBeCloseTo(2.84 / 8);
    expect(quote.completeFill).toBe(true);
  });

  test("reports a thin book as not filled", () => {
    const quote = walkBook([["0.7000", "2.00"]], 10, 0.07);
    expect(quote.shares).toBe(2);
    expect(quote.completeFill).toBe(false);
  });

  test("an empty book can't be bought", () => {
    const quote = walkBook([], 5, 0.07);
    expect(quote.shares).toBe(0);
    expect(quote.avgPrice).toBe(Number.POSITIVE_INFINITY);
  });
});

test("quote picks the opposite side's bids", async () => {
  const exchange = createKalshiExchange({
    baseUrl: "",
    series: [],
    fetchJson: async <T>() =>
      ({
        orderbook_fp: { yes_dollars: [["0.2000", "50.00"]], no_dollars: [["0.9000", "50.00"]] },
      }) as T,
  });
  // buying NO takes the YES bid at 0.20: NO costs 0.80
  const no = await exchange.quote({ eventId: "E", marketId: "M", outcomeId: "M:no", amount: 2 });
  expect(no.avgPrice).toBeGreaterThan(0.8);
  // buying YES takes the NO bid at 0.90: YES costs 0.10
  const yes = await exchange.quote({ eventId: "E", marketId: "M", outcomeId: "M:yes", amount: 2 });
  expect(yes.avgPrice).toBeLessThan(0.12);
});
