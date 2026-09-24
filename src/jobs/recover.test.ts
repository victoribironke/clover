import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Bet } from "@/db/bets.ts";
import type { Exchange, PlacedOrder } from "@/exchanges/types.ts";

// In-memory stand-ins for Firestore and Telegram
let bets: Bet[] = [];
const messages: string[] = [];

mock.module("@/db/bets.ts", () => ({
  listBets: async (statuses: string[]) => bets.filter((bet) => statuses.includes(bet.status)),
  updateBet: async (id: string, patch: Partial<Bet>, fromStatuses?: string[]) => {
    const bet = bets.find((item) => item.id === id);
    if (!bet || (fromStatuses && !fromStatuses.includes(bet.status))) return false;
    Object.assign(bet, patch);
    return true;
  },
}));
mock.module("@/telegram/notify.ts", () => ({
  notify: async (html: string) => {
    messages.push(html);
    return 1;
  },
  clearButtons: async () => {},
}));

const { recoverStuckBets } = await import("./recover.ts");

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const bet = (overrides: Partial<Bet>): Bet => ({
  id: "b1",
  exchange: "bayse",
  currency: "NGN",
  eventId: "e1",
  marketId: "m1",
  outcomeId: "o1",
  eventTitle: "Portugal vs Wales",
  marketTitle: "Portugal to win",
  outcomeLabel: "Yes",
  analysisId: null,
  probability: 0.6,
  marketPrice: 0.5,
  quotedPrice: 0.52,
  expectedReturn: 0.15,
  confidence: "medium",
  stake: 520,
  rationale: "",
  status: "placing",
  dryRun: false,
  executeAt: minutesAgo(40),
  orderId: null,
  fillPrice: null,
  shares: null,
  pnl: null,
  error: null,
  telegramMessageId: null,
  createdAt: minutesAgo(70),
  updatedAt: minutesAgo(15),
  ...overrides,
});

const exchangeWith = (orders: PlacedOrder[] | Error) =>
  ({
    payoutPerShare: 100,
    findOrders: async () => {
      if (orders instanceof Error) throw orders;
      return orders;
    },
  }) as unknown as Exchange;

beforeEach(() => {
  bets = [];
  messages.length = 0;
});

describe("recoverStuckBets", () => {
  test("leaves a bet that only just started placing alone", async () => {
    bets = [bet({ updatedAt: minutesAgo(1) })];
    expect(await recoverStuckBets(exchangeWith([]))).toBe(0);
    expect(bets[0]!.status).toBe("placing");
  });

  test("queues a stuck paper bet again", async () => {
    bets = [bet({ dryRun: true })];
    await recoverStuckBets(exchangeWith(new Error("paper bets never touch Bayse")));
    expect(bets[0]!.status).toBe("pending");
  });

  test("marks a live bet placed when its order is on Bayse", async () => {
    bets = [bet({})];
    await recoverStuckBets(exchangeWith([{ id: "ord1", status: "filled", amount: 520, avgPrice: 0.52, shares: 10 }]));
    expect(bets[0]).toMatchObject({ status: "placed", orderId: "ord1", fillPrice: 0.52, shares: 10 });
  });

  test("derives shares when Bayse doesn't report them", async () => {
    bets = [bet({})];
    await recoverStuckBets(exchangeWith([{ id: "ord1", status: "open", amount: 520, avgPrice: 0.52, shares: 0 }]));
    // ₦520 at 52% of a ₦100 payout = 10 shares
    expect(bets[0]!.shares).toBeCloseTo(10);
  });

  test("fails a live bet with no order on Bayse, without retrying it", async () => {
    bets = [bet({})];
    await recoverStuckBets(exchangeWith([]));
    expect(bets[0]!.status).toBe("failed");
    expect(messages[0]).toContain("Nothing was bought");
  });

  test("leaves a live bet as placing when Bayse can't be reached", async () => {
    bets = [bet({})];
    await recoverStuckBets(exchangeWith(new Error("Bayse is down")));
    expect(bets[0]!.status).toBe("placing");
    expect(messages).toHaveLength(0);
  });
});
