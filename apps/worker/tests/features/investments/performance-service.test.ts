import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createTestD1 } from "../../helpers/d1";
import {
  clearInvestmentOpeningCost,
  getInvestmentPerformance,
  positionAccountId,
  pricesMonthsToFetch,
  PRICE_ERROR_RETRY_MS,
  PRICE_OPEN_MONTH_REFRESH_MS,
  refreshSecurityPrices,
  setInvestmentOpeningCost,
} from "../../../src/features/investments/performance-service";

// 合成資料：虛構券商帳號、銀行帳號、股數與價格。
const ACCOUNT = "1234:7654321";
const BANK_ACCOUNT = "cathaybk:bank:cathaybk:000011112222";
const NOW = new Date("2026-11-25T02:00:00.000Z");

function twseMonth(closes: [string, number][]) {
  return {
    stat: "OK",
    fields: [
      "日期",
      "成交股數",
      "成交金額",
      "開盤價",
      "最高價",
      "最低價",
      "收盤價",
    ],
    data: closes.map(([roc, close]) => [
      roc,
      "1",
      "1",
      "1",
      "1",
      "1",
      String(close),
    ]),
  };
}

describe("positionAccountId", () => {
  it("取出持股快照 source_id 的帳戶部分", () => {
    expect(
      positionAccountId({
        sourceId: `${ACCOUNT}:0050:2026-11-24T00:00:00.000Z`,
        symbol: "0050",
        asOfDate: "2026-11-24T00:00:00.000Z",
        brokerNo: "1234",
      }),
    ).toBe(ACCOUNT);
  });
});

describe("pricesMonthsToFetch", () => {
  const base = {
    exchanges: new Map([["0050", "twse" as const]]),
    cached: new Set<string>(),
    now: NOW,
  };
  const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

  it("略過已快取的日期、已結束的月份與未來月份", () => {
    expect(
      pricesMonthsToFetch({
        ...base,
        cached: new Set(["0050:2023-01-06"]),
        needs: [
          { symbol: "0050", date: "2023-01-06" },
          { symbol: "0050", date: "2023-02-06" },
          { symbol: "0050", date: "2023-03-06" },
          { symbol: "0050", date: "2026-12-01" },
        ],
        months: [
          {
            symbol: "0050",
            month: "2023-02",
            status: "empty",
            final: true,
            fetchedAt: ago(1000),
          },
        ],
      }),
    ).toEqual([{ symbol: "0050", month: "2023-03", exchange: "twse" }]);
  });

  it("失敗的月份一小時後重試，尚未結束的月份六小時後重抓", () => {
    const needs = [
      { symbol: "0050", date: "2026-10-12" },
      { symbol: "0050", date: "2026-11-10" },
    ];
    const months = (age: number) => [
      {
        symbol: "0050",
        month: "2026-10",
        status: "error",
        final: false,
        fetchedAt: ago(age),
      },
      {
        symbol: "0050",
        month: "2026-11",
        status: "ok",
        final: false,
        fetchedAt: ago(age),
      },
    ];
    expect(
      pricesMonthsToFetch({ ...base, needs, months: months(1000) }),
    ).toEqual([]);
    expect(
      pricesMonthsToFetch({
        ...base,
        needs,
        months: months(PRICE_ERROR_RETRY_MS + 1),
      }).map((item) => item.month),
    ).toEqual(["2026-10"]);
    expect(
      pricesMonthsToFetch({
        ...base,
        needs,
        months: months(PRICE_OPEN_MONTH_REFRESH_MS + 1),
      }).map((item) => item.month),
    ).toEqual(["2026-10", "2026-11"]);
  });
});

describe("投資績效（隔離 D1）", () => {
  let harness: Awaited<ReturnType<typeof createTestD1>>;
  let db: D1Database;
  beforeAll(async () => {
    harness = await createTestD1();
    db = harness.binding;
  }, 60_000);
  afterAll(async () => {
    await harness?.mf.dispose();
  });
  beforeEach(async () => {
    await db.batch(
      [
        "investment_transactions",
        "investment_positions",
        "security_prices",
        "security_price_months",
        "investment_opening_costs",
        "bank_transactions",
        "bank_accounts",
      ].map((table) => db.prepare(`DELETE FROM ${table}`)),
    );
    await db
      .prepare(
        "INSERT INTO bank_accounts (id, connector_id, source_id, account_type, created_at, updated_at) VALUES (?, 'cathaybk', 'bank:cathaybk:000011112222', 'savings', 't', 't')",
      )
      .bind(BANK_ACCOUNT)
      .run();
  });

  async function trade(input: {
    id: string;
    symbol: string;
    date: string;
    code: string;
    dbCr: "1" | "2";
    quantity: number;
    balance: number;
    exchange?: "0" | "1";
  }) {
    const raw = {
      brokerNo: "1234",
      brokerAccount: "7654321",
      fields: {
        stockNo: input.symbol,
        txnCode: input.code,
        dbCRCode: input.dbCr,
        txnSHR: `${input.quantity}.000000000000000000`,
        txnPBBal: `${input.balance}.000000000000000000`,
        stockExcg: input.exchange ?? "0",
        price: "1",
      },
    };
    await db
      .prepare(
        `INSERT INTO investment_transactions
          (id, connector_id, account_id, source_id, broker_no, broker_account, symbol, name,
           asset_type, trade_date, posted_date, transaction_code, quantity, price, currency,
           raw_payload, created_at, updated_at)
         VALUES (?, 'tdcc', ?, ?, '1234', '7654321', ?, ?, 'etf', ?, ?, ?, ?, 1, 'TWD', ?, 't', 't')`,
      )
      .bind(
        input.id,
        ACCOUNT,
        input.id,
        input.symbol,
        `測試${input.symbol}`,
        `${input.date}T00:00:00.000Z`,
        `${input.date}T00:00:00.000Z`,
        input.code,
        input.quantity,
        JSON.stringify(raw),
      )
      .run();
  }

  async function snapshot(input: {
    symbol: string;
    date: string;
    quantity: number;
    marketValue: number;
  }) {
    const asOf = `${input.date}T00:00:00.000Z`;
    await db
      .prepare(
        `INSERT INTO investment_positions
          (id, connector_id, source_id, asset_type, symbol, name, quantity, market_value,
           currency, as_of_date, created_at, updated_at, broker_no, broker_name)
         VALUES (?, 'tdcc', ?, 'etf', ?, ?, ?, ?, 'TWD', ?, 't', 't', '1234', '測試證券')`,
      )
      .bind(
        `p-${input.symbol}-${input.date}`,
        `${ACCOUNT}:${input.symbol}:${asOf}`,
        input.symbol,
        `測試${input.symbol}`,
        input.quantity,
        input.marketValue,
        asOf,
      )
      .run();
  }

  async function bank(
    id: string,
    date: string,
    amount: number,
    description: string,
  ) {
    await db
      .prepare(
        `INSERT INTO bank_transactions
          (id, connector_id, account_id, source_id, amount, currency, description,
           posted_date, status, created_at, updated_at)
         VALUES (?, 'cathaybk', ?, ?, ?, 'TWD', ?, ?, 'posted', 't', 't')`,
      )
      .bind(id, BANK_ACCOUNT, id, amount, description, date)
      .run();
  }

  async function seed() {
    await trade({
      id: "a",
      symbol: "0056",
      date: "2023-01-06",
      code: "113",
      dbCr: "2",
      quantity: 100,
      balance: 1100,
    });
    await trade({
      id: "b",
      symbol: "0056",
      date: "2026-11-13",
      code: "113",
      dbCr: "2",
      quantity: 100,
      balance: 1200,
    });
    await snapshot({
      symbol: "0056",
      date: "2026-11-23",
      quantity: 1200,
      marketValue: 58_800,
    });
    await snapshot({
      symbol: "0056",
      date: "2026-11-24",
      quantity: 1200,
      marketValue: 60_000,
    });
    await bank("d1", "2026-11-13", -5_007, "證券定期 STAQ");
    await bank("d2", "2026-11-11", 1_200, "轉帳 0056FUND 基金配息");
  }

  it("排程補抓收盤價後算出本金；讀取 API 不連外", async () => {
    await seed();
    const before = await getInvestmentPerformance(db, NOW);
    expect(before.pricesPending).toBe(true);
    expect(before.holdings[0]!.costBasis).toBeNull();
    expect(before.holdings[0]!.marketValue).toBe(60_000);

    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      const text = String(url);
      if (text.includes("date=20230101"))
        return Response.json(twseMonth([["112/01/06", 25]]));
      return Response.json(twseMonth([["115/11/13", 50]]));
    });
    const sleep = vi.fn(async () => {});
    await expect(
      refreshSecurityPrices(db, { now: NOW, fetcher: fetcher as never, sleep }),
    ).resolves.toEqual({ fetched: 2, remaining: 0, failed: false });
    expect(sleep).toHaveBeenCalledTimes(1);

    const months = await db
      .prepare(
        "SELECT month, status, final FROM security_price_months ORDER BY month",
      )
      .all();
    expect(months.results).toEqual([
      { month: "2023-01", status: "ok", final: 1 },
      { month: "2026-11", status: "ok", final: 0 },
    ]);

    const after = await getInvestmentPerformance(db, NOW);
    const [holding] = after.holdings;
    // 期初 1,000 × 25；買進 100 × 25 + 3；11/13 用銀行扣款 5,007。
    expect(holding!.costBasis).toBe(25_000 + 2_503 + 5_007);
    expect(holding!.unrealizedPnl).toBe(60_000 - 32_510);
    expect(holding!.dividends).toBe(1_200);
    expect(holding!.history).toEqual([
      { date: "2026-11-23", marketValue: 58_800, costBasis: 32_510 },
      { date: "2026-11-24", marketValue: 60_000, costBasis: 32_510 },
    ]);
    // 需要的價格都有了；11 月尚未結束不影響。
    expect(after.pricesPending).toBe(false);
    expect(after.estimateCheck).toEqual({ samples: 1, meanAbsErrorPct: 0 });
    expect(after.dividendsSince).toBe("2026-11-11");

    // 已結束的月份不再重抓；本月剛抓過也不抓。
    fetcher.mockClear();
    await refreshSecurityPrices(db, {
      now: NOW,
      fetcher: fetcher as never,
      sleep,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("交易所回應異常時記為 error 並停止這次補抓，不覆蓋先前成功的資料", async () => {
    await seed();
    await db
      .prepare(
        "INSERT INTO security_price_months (symbol, month, exchange, status, final, fetched_at) VALUES ('0056', '2026-11', 'twse', 'ok', 0, '2026-11-01T00:00:00.000Z')",
      )
      .run();
    const fetcher = vi.fn(async () => new Response("<html>busy</html>"));
    await expect(
      refreshSecurityPrices(db, {
        now: NOW,
        fetcher: fetcher as never,
        sleep: async () => {},
      }),
    ).resolves.toEqual({ fetched: 0, remaining: 2, failed: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const months = await db
      .prepare(
        "SELECT month, status, final FROM security_price_months ORDER BY month",
      )
      .all();
    expect(months.results).toEqual([
      { month: "2023-01", status: "error", final: 0 },
      { month: "2026-11", status: "ok", final: 0 },
    ]);
    const performance = await getInvestmentPerformance(db, NOW);
    expect(performance.holdings[0]!.issues).toContain("prices_pending");
  });

  it("期初成本可以改成使用者填的金額，也能清除", async () => {
    await seed();
    await setInvestmentOpeningCost(db, `${ACCOUNT}:0056`, 20_000);
    let performance = await getInvestmentPerformance(db, NOW);
    expect(performance.holdings[0]!.opening).toMatchObject({
      quantity: 1000,
      cost: 20_000,
      manual: true,
    });
    await clearInvestmentOpeningCost(db, `${ACCOUNT}:0056`);
    performance = await getInvestmentPerformance(db, NOW);
    expect(performance.holdings[0]!.opening).toMatchObject({
      cost: null,
      manual: false,
    });
  });
});
