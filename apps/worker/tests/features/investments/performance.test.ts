import { describe, expect, it } from "vitest";
import {
  attributeDividend,
  brokerFee,
  computeInvestmentPerformance,
  openingQuantity,
  sameDaySequence,
  transactionTax,
  type BankFlowInput,
  type PerformanceInput,
  type PerformancePositionInput,
  type PerformanceTransactionInput,
  type PriceBook,
} from "../../../src/features/investments/performance";

// 合成資料：虛構券商帳號、股數與價格。
const ACCOUNT = "1234:7654321";
const OTHER_ACCOUNT = "9X9X:1111111";

let sequence = 0;
function tx(
  input: Partial<PerformanceTransactionInput> &
    Pick<PerformanceTransactionInput, "symbol" | "date" | "code" | "quantity">,
): PerformanceTransactionInput {
  sequence += 1;
  const direction =
    input.code === "113" || input.code === "1F5"
      ? "in"
      : input.code === "123" || input.code === "1G5"
        ? "out"
        : null;
  return {
    id: `t${sequence}`,
    accountId: ACCOUNT,
    brokerNo: ACCOUNT.split(":")[0]!,
    brokerName: null,
    name: `測試${input.symbol}`,
    assetType: "etf",
    direction,
    balanceAfter: null,
    ...input,
  };
}

function position(
  input: Partial<PerformancePositionInput> &
    Pick<PerformancePositionInput, "symbol" | "quantity" | "marketValue">,
): PerformancePositionInput {
  return {
    accountId: ACCOUNT,
    name: `測試${input.symbol}`,
    assetType: "etf",
    brokerNo: ACCOUNT.split(":")[0]!,
    brokerName: "測試證券",
    date: "2026-11-24",
    ...input,
  };
}

function priceBook(
  closes: Record<string, number>,
  pending: (symbol: string, date: string) => boolean = () => false,
): PriceBook {
  return {
    close: (symbol, date) => closes[`${symbol}:${date}`],
    pending,
  };
}

function run(
  input: Partial<PerformanceInput> &
    Pick<PerformanceInput, "transactions" | "positions" | "prices">,
) {
  return computeInvestmentPerformance({
    history: [],
    bankFlows: [],
    bankDataSince: "2026-06-29",
    openingCosts: new Map(),
    today: "2026-11-25",
    ...input,
  });
}

describe("手續費與證交稅", () => {
  it("零股最低 1 元、整股最低 20 元，無條件捨去", () => {
    expect(brokerFee(1000, 10)).toBe(1);
    expect(brokerFee(1000, 1000)).toBe(20);
    expect(brokerFee(100_000, 1000)).toBe(142);
  });

  it("股票 0.3%、ETF 0.1%、債券 ETF 免稅", () => {
    expect(transactionTax(100_000, "2330", "stock")).toBe(300);
    expect(transactionTax(100_000, "0056", "etf")).toBe(100);
    expect(transactionTax(100_000, "00720B", "etf")).toBe(0);
  });
});

describe("期初股數", () => {
  it("由第一筆的異動後餘額推出", () => {
    expect(
      openingQuantity([
        tx({
          symbol: "0050",
          date: "2023-01-06",
          code: "113",
          quantity: 17,
          balanceAfter: 363,
        }),
      ]),
    ).toEqual({ quantity: 346, ok: true });
  });

  it("同一天多筆時找出能逐筆接上的起點", () => {
    const rows = [
      tx({
        symbol: "0056",
        date: "2023-01-06",
        code: "123",
        quantity: 100,
        balanceAfter: 950,
      }),
      tx({
        symbol: "0056",
        date: "2023-01-06",
        code: "113",
        quantity: 50,
        balanceAfter: 1050,
      }),
    ];
    // 1000 + 50 = 1050 → −100 = 950。
    expect(openingQuantity(rows)).toEqual({ quantity: 1000, ok: true });
  });
});

describe("computeInvestmentPerformance", () => {
  it("期初持股以第一天收盤價估算，買進加手續費，賣出扣手續費與證交稅", () => {
    const result = run({
      transactions: [
        tx({
          symbol: "0056",
          date: "2023-01-06",
          code: "113",
          quantity: 100,
          balanceAfter: 1100,
        }),
        tx({
          symbol: "0056",
          date: "2024-03-01",
          code: "123",
          quantity: 550,
          balanceAfter: 550,
        }),
      ],
      positions: [
        position({ symbol: "0056", quantity: 550, marketValue: 22_000 }),
      ],
      prices: priceBook({ "0056:2023-01-06": 25, "0056:2024-03-01": 38 }),
    });
    const [holding] = result.holdings;
    // 期初 1,000 股 × 25 = 25,000；買進 100 × 25 = 2,500 + 手續費 3 → 27,503。
    expect(holding!.opening).toEqual({
      quantity: 1000,
      date: "2023-01-06",
      cost: 25_000,
      manual: false,
    });
    // 賣出一半：成本 13,751.5；收入 20,900 − 手續費 29 − 證交稅 20 = 20,851。
    expect(holding!.realizedPnl).toBe(Math.round(20_851 - 27_503 / 2));
    expect(holding!.costBasis).toBe(Math.round(27_503 / 2));
    expect(holding!.unrealizedPnl).toBe(22_000 - Math.round(27_503 / 2));
    expect(holding!.averageCost).toBe(25.0);
    expect(holding!.costBreakdown.opening).toBe(12_500);
    expect(holding!.issues).toEqual([]);
    expect(holding!.events.map((event) => event.kind)).toEqual([
      "opening",
      "buy",
      "sell",
    ]);
  });

  it("分割（0050 → 0050O → 0050）成本整筆移轉，股數依集保", () => {
    const result = run({
      transactions: [
        tx({
          symbol: "0050",
          date: "2024-01-05",
          code: "113",
          quantity: 100,
          balanceAfter: 100,
        }),
        tx({
          symbol: "0050",
          date: "2025-06-13",
          code: "1G5",
          quantity: 100,
          balanceAfter: 0,
        }),
        tx({
          symbol: "0050O",
          date: "2025-06-13",
          code: "1F5",
          quantity: 100,
          balanceAfter: 100,
        }),
        tx({
          symbol: "0050O",
          date: "2025-06-18",
          code: "1G5",
          quantity: 100,
          balanceAfter: 0,
        }),
        tx({
          symbol: "0050",
          date: "2025-06-18",
          code: "1F5",
          quantity: 400,
          balanceAfter: 400,
        }),
      ],
      positions: [
        position({ symbol: "0050", quantity: 400, marketValue: 20_000 }),
      ],
      prices: priceBook({ "0050:2024-01-05": 130 }),
    });
    expect(result.holdings).toHaveLength(1);
    const [holding] = result.holdings;
    expect(holding!.quantity).toBe(400);
    // 13,000 + 手續費 18。
    expect(holding!.costBasis).toBe(13_018);
    expect(holding!.averageCost).toBe(32.55);
    expect(holding!.issues).toEqual([]);
    // 0050O 沒有賣出也沒有配息，不列在已出清。
    expect(result.closed).toEqual([]);
  });

  it("同一天的定期定額扣款依收盤價 × 股數分攤到各檔", () => {
    const debit: BankFlowInput = {
      date: "2026-07-13",
      amount: -30_100,
      description: "證券定期                           STAQ",
    };
    const result = run({
      transactions: [
        tx({
          symbol: "0050",
          date: "2026-07-13",
          code: "113",
          quantity: 200,
          balanceAfter: 200,
        }),
        tx({
          symbol: "0056",
          date: "2026-07-13",
          code: "113",
          quantity: 200,
          balanceAfter: 200,
        }),
      ],
      positions: [
        position({ symbol: "0050", quantity: 200, marketValue: 20_000 }),
        position({ symbol: "0056", quantity: 200, marketValue: 10_000 }),
      ],
      bankFlows: [debit],
      prices: priceBook({ "0050:2026-07-13": 100, "0056:2026-07-13": 50 }),
    });
    const bySymbol = Object.fromEntries(
      result.holdings.map((holding) => [holding.symbol, holding]),
    );
    // 20,000 : 10,000 分攤 30,100。
    expect(bySymbol["0050"]!.costBasis).toBe(20_067);
    expect(bySymbol["0056"]!.costBasis).toBe(10_033);
    expect(bySymbol["0050"]!.costBreakdown.bank).toBe(20_067);
    expect(bySymbol["0050"]!.events[0]!.costSource).toBe("bank");
    // 估算 20,000 + 28 + 10,000 + 14 = 30,042，與實際 30,100 差 0.19%。
    expect(result.estimateCheck).toEqual({
      samples: 1,
      meanAbsErrorPct: 0.19,
    });
  });

  it("扣款與估算差太多時不採用，改用估算", () => {
    const result = run({
      transactions: [
        tx({
          symbol: "0056",
          date: "2026-08-10",
          code: "113",
          quantity: 100,
          balanceAfter: 100,
        }),
      ],
      positions: [
        position({ symbol: "0056", quantity: 100, marketValue: 5_000 }),
      ],
      bankFlows: [
        { date: "2026-08-10", amount: -9_000, description: "證券定期 STAQ" },
      ],
      prices: priceBook({ "0056:2026-08-10": 50 }),
    });
    expect(result.holdings[0]!.costBasis).toBe(5_007);
    expect(result.holdings[0]!.events[0]!.costSource).toBe("estimate");
    expect(result.estimateCheck.samples).toBe(0);
  });

  it("只有一筆買進時，沒有收盤價也採用扣款金額", () => {
    const result = run({
      transactions: [
        tx({
          symbol: "0056",
          date: "2026-11-13",
          code: "113",
          quantity: 136,
          balanceAfter: 136,
        }),
      ],
      positions: [
        position({ symbol: "0056", quantity: 136, marketValue: 7_000 }),
      ],
      bankFlows: [
        { date: "2026-11-13", amount: -7_237, description: "證券定期 STAQ" },
      ],
      prices: priceBook({}, () => true),
    });
    expect(result.holdings[0]!.costBasis).toBe(7_237);
    expect(result.holdings[0]!.issues).toEqual([]);
    expect(result.pricesPending).toBe(false);
  });

  it("缺收盤價時不給本金，並標示補抓中", () => {
    const result = run({
      transactions: [
        tx({
          symbol: "0056",
          date: "2023-05-08",
          code: "113",
          quantity: 10,
          balanceAfter: 10,
        }),
      ],
      positions: [position({ symbol: "0056", quantity: 10, marketValue: 500 })],
      prices: priceBook({}, () => true),
    });
    const [holding] = result.holdings;
    expect(holding!.costBasis).toBeNull();
    expect(holding!.unrealizedPnl).toBeNull();
    expect(holding!.issues).toEqual(["prices_pending"]);
    expect(holding!.missingPriceDates).toEqual(["2023-05-08"]);
    expect(result.pricesPending).toBe(true);
    expect(result.totals.costBasis).toBeNull();
    expect(result.totals.marketValue).toBe(500);
  });

  it("集保股數對不起來時不給本金", () => {
    const result = run({
      transactions: [
        tx({
          symbol: "0056",
          date: "2023-05-08",
          code: "113",
          quantity: 10,
          balanceAfter: 10,
        }),
        tx({
          symbol: "0056",
          date: "2023-06-08",
          code: "113",
          quantity: 10,
          balanceAfter: 25,
        }),
      ],
      positions: [
        position({ symbol: "0056", quantity: 25, marketValue: 1_250 }),
      ],
      prices: priceBook({ "0056:2023-05-08": 30, "0056:2023-06-08": 31 }),
    });
    expect(result.holdings[0]!.costBasis).toBeNull();
    expect(result.holdings[0]!.issues).toContain("quantity_mismatch");
  });

  it("最新快照的股數和紀錄不同時不給本金", () => {
    const result = run({
      transactions: [
        tx({
          symbol: "0056",
          date: "2023-05-08",
          code: "113",
          quantity: 10,
          balanceAfter: 10,
        }),
      ],
      positions: [position({ symbol: "0056", quantity: 12, marketValue: 600 })],
      prices: priceBook({ "0056:2023-05-08": 30 }),
    });
    expect(result.holdings[0]!.costBasis).toBeNull();
    expect(result.holdings[0]!.issues).toEqual(["quantity_mismatch"]);
  });

  it("同一檔分屬兩個帳戶時各算各的", () => {
    const result = run({
      transactions: [
        tx({
          symbol: "0050",
          date: "2026-03-03",
          code: "113",
          quantity: 1,
          balanceAfter: 1,
          accountId: OTHER_ACCOUNT,
        }),
        tx({
          symbol: "0050",
          date: "2026-03-10",
          code: "113",
          quantity: 10,
          balanceAfter: 10,
        }),
      ],
      positions: [
        position({ symbol: "0050", quantity: 10, marketValue: 1_000 }),
        position({
          symbol: "0050",
          quantity: 1,
          marketValue: 100,
          accountId: OTHER_ACCOUNT,
        }),
      ],
      prices: priceBook({ "0050:2026-03-03": 90, "0050:2026-03-10": 92 }),
    });
    expect(
      result.holdings.map((holding) => [holding.key, holding.costBasis]),
    ).toEqual([
      [`${ACCOUNT}:0050`, 921],
      [`${OTHER_ACCOUNT}:0050`, 91],
    ]);
  });

  it("使用者填的期初成本取代估算", () => {
    const result = run({
      transactions: [
        tx({
          symbol: "0056",
          date: "2023-01-06",
          code: "113",
          quantity: 100,
          balanceAfter: 1100,
        }),
      ],
      positions: [
        position({ symbol: "0056", quantity: 1100, marketValue: 40_000 }),
      ],
      prices: priceBook({ "0056:2023-01-06": 25 }),
      openingCosts: new Map([[`${ACCOUNT}:0056`, 20_000]]),
    });
    const [holding] = result.holdings;
    expect(holding!.opening).toMatchObject({ cost: 20_000, manual: true });
    expect(holding!.costBasis).toBe(22_503);
    expect(holding!.costBreakdown).toEqual({
      bank: 0,
      estimate: 2_503,
      opening: 0,
      manual: 20_000,
    });
  });

  it("股票賣出用 0.3% 證交稅，全部賣出列在已出清", () => {
    const result = run({
      transactions: [
        tx({
          symbol: "2330",
          date: "2026-01-15",
          code: "113",
          quantity: 10,
          balanceAfter: 10,
          assetType: "stock",
        }),
        tx({
          symbol: "2330",
          date: "2026-03-23",
          code: "123",
          quantity: 10,
          balanceAfter: 0,
          assetType: "stock",
        }),
      ],
      positions: [],
      prices: priceBook({ "2330:2026-01-15": 1000, "2330:2026-03-23": 1100 }),
    });
    expect(result.holdings).toEqual([]);
    const [closed] = result.closed;
    // 成本 10,000 + 14；收入 11,000 − 15 − 33。
    expect(closed!.realizedPnl).toBe(11_000 - 15 - 33 - 10_014);
    expect(closed!.costBasis).toBe(0);
    expect(result.totals.realizedPnl).toBe(938);
  });

  it("配息依代號或名稱對回持股，對不到的另外列出", () => {
    const result = run({
      transactions: [
        tx({
          symbol: "0056",
          date: "2026-01-06",
          code: "113",
          quantity: 1000,
          balanceAfter: 1000,
          name: "元大高股息",
        }),
        tx({
          symbol: "00929",
          date: "2026-01-06",
          code: "113",
          quantity: 1000,
          balanceAfter: 1000,
          name: "復華台灣科技優息",
        }),
      ],
      positions: [
        position({
          symbol: "0056",
          quantity: 1000,
          marketValue: 50_000,
          name: "元大高股息",
        }),
        position({
          symbol: "00929",
          quantity: 1000,
          marketValue: 20_000,
          name: "復華台灣科技優息",
        }),
      ],
      bankFlows: [
        {
          date: "2026-08-10",
          amount: 1_000,
          description: "轉帳   0056FUND        基金配息",
        },
        {
          date: "2026-09-14",
          amount: 90,
          description: "轉帳 科技優息 基金配息",
        },
        {
          date: "2026-10-14",
          amount: 77,
          description: "轉帳 某某收益 基金配息",
        },
      ],
      prices: priceBook({ "0056:2026-01-06": 35, "00929:2026-01-06": 18 }),
    });
    const bySymbol = Object.fromEntries(
      result.holdings.map((holding) => [holding.symbol, holding]),
    );
    expect(bySymbol["0056"]!.dividends).toBe(1_000);
    expect(bySymbol["00929"]!.dividends).toBe(90);
    expect(bySymbol["00929"]!.events.at(-1)).toMatchObject({
      kind: "dividend",
      date: "2026-09-14",
      amount: 90,
      quantityAfter: 1000,
    });
    expect(result.unattributedDividends).toEqual([
      { date: "2026-10-14", amount: 77, description: "轉帳 某某收益 基金配息" },
    ]);
    expect(result.totals.dividends).toBe(1_090);
    expect(result.totals.dividendsThisYear).toBe(1_090);
    expect(result.totals.marketValueByCategory).toEqual({
      equity: 70_000,
      bond: 0,
    });
  });
});

describe("attributeDividend", () => {
  const holdings = [
    { symbol: "0050", name: "元大台灣50", quantity: 10 },
    { symbol: "00720B", name: "元大投資級公司債", quantity: 5 },
  ];
  it("代號後面接 FUND 也能對到", () => {
    expect(
      attributeDividend("轉帳 00720BFUND 收益分配", holdings)?.symbol,
    ).toBe("00720B");
  });
  it("名稱片段對到多檔時不歸屬", () => {
    expect(attributeDividend("轉帳 元大 基金配息", holdings)).toBeUndefined();
  });
});

describe("審查回饋的邊界情況", () => {
  it("分割轉入後同一天賣出：先接手成本再賣", () => {
    const rows = [
      tx({
        symbol: "0050",
        date: "2024-01-05",
        code: "113",
        quantity: 100,
        balanceAfter: 100,
      }),
      tx({
        symbol: "0050",
        date: "2025-06-13",
        code: "1G5",
        quantity: 100,
        balanceAfter: 0,
      }),
      tx({
        symbol: "0050O",
        date: "2025-06-13",
        code: "1F5",
        quantity: 100,
        balanceAfter: 100,
      }),
      // 賣出排在分割轉入前面（例如 id 排序），依餘額仍應先轉入再賣出。
      tx({
        symbol: "0050",
        date: "2025-06-18",
        code: "123",
        quantity: 100,
        balanceAfter: 300,
      }),
      tx({
        symbol: "0050",
        date: "2025-06-18",
        code: "1F5",
        quantity: 400,
        balanceAfter: 400,
      }),
      tx({
        symbol: "0050O",
        date: "2025-06-18",
        code: "1G5",
        quantity: 100,
        balanceAfter: 0,
      }),
    ];
    const result = run({
      transactions: rows,
      positions: [
        position({ symbol: "0050", quantity: 300, marketValue: 6_000 }),
      ],
      prices: priceBook({ "0050:2024-01-05": 10, "0050:2025-06-18": 20 }),
    });
    const [holding] = result.holdings;
    // 成本 1,001（含手續費 1）分給 400 股，賣 100 股：剩 750.75；收入 2,000 − 2 − 2。
    expect(holding!.costBasis).toBe(751);
    expect(holding!.realizedPnl).toBe(1746);
    expect(holding!.issues).toEqual([]);
    expect(
      // 各部位已依餘額排好（0050：轉入→賣出），0050 排在前面也要等 0050O 轉出。
      sameDaySequence([rows[4]!, rows[3]!, rows[5]!]).map(
        (row) => `${row.symbol}:${row.code}`,
      ),
    ).toEqual(["0050O:1G5", "0050:1F5", "0050:123"]);
  });

  it("交易比持股快照新時，本金取快照當天的", () => {
    const result = run({
      transactions: [
        tx({
          symbol: "0056",
          date: "2026-11-20",
          code: "113",
          quantity: 100,
          balanceAfter: 100,
        }),
        tx({
          symbol: "0056",
          date: "2026-11-25",
          code: "113",
          quantity: 100,
          balanceAfter: 200,
        }),
      ],
      positions: [
        position({
          symbol: "0056",
          quantity: 100,
          marketValue: 1_100,
          date: "2026-11-24",
        }),
      ],
      prices: priceBook({ "0056:2026-11-20": 10, "0056:2026-11-25": 20 }),
    });
    const [holding] = result.holdings;
    expect(holding!.quantity).toBe(100);
    expect(holding!.costBasis).toBe(1_001);
    expect(holding!.averageCost).toBe(10.01);
    expect(holding!.unrealizedPnl).toBe(99);
    expect(holding!.issues).toEqual([]);
  });

  it("第一天先買後賣、順序不明時，不假設之前就有持股", () => {
    expect(
      openingQuantity([
        tx({
          symbol: "2486",
          date: "2026-02-26",
          code: "123",
          quantity: 100,
          balanceAfter: 0,
        }),
        tx({
          symbol: "2486",
          date: "2026-02-26",
          code: "113",
          quantity: 100,
          balanceAfter: 100,
        }),
      ]),
    ).toEqual({ quantity: 0, ok: true });
  });

  it("全部賣出後再買，之前缺價不影響新部位的本金", () => {
    const result = run({
      transactions: [
        tx({
          symbol: "0056",
          date: "2023-05-08",
          code: "113",
          quantity: 10,
          balanceAfter: 10,
        }),
        tx({
          symbol: "0056",
          date: "2024-05-08",
          code: "123",
          quantity: 10,
          balanceAfter: 0,
        }),
        tx({
          symbol: "0056",
          date: "2026-05-08",
          code: "113",
          quantity: 100,
          balanceAfter: 100,
        }),
      ],
      positions: [
        position({ symbol: "0056", quantity: 100, marketValue: 4_000 }),
      ],
      prices: priceBook(
        { "0056:2024-05-08": 30, "0056:2026-05-08": 35 },
        (_symbol, date) => date === "2023-05-08",
      ),
    });
    const [holding] = result.holdings;
    // 100 × 35 + 手續費 4。
    expect(holding!.costBasis).toBe(3_504);
    expect(holding!.realizedPnl).toBeNull();
    // 已實現損益仍未知，說明原因。
    expect(holding!.issues).toEqual(["prices_pending"]);
    expect(holding!.missingPriceDates).toEqual(["2023-05-08"]);
  });

  it("賣出缺價只影響已實現損益，不擋剩下持股的本金", () => {
    const result = run({
      transactions: [
        tx({
          symbol: "0056",
          date: "2023-05-08",
          code: "113",
          quantity: 20,
          balanceAfter: 20,
        }),
        tx({
          symbol: "0056",
          date: "2024-05-08",
          code: "123",
          quantity: 10,
          balanceAfter: 10,
        }),
      ],
      positions: [position({ symbol: "0056", quantity: 10, marketValue: 400 })],
      prices: priceBook({ "0056:2023-05-08": 30 }, () => false),
    });
    const [holding] = result.holdings;
    expect(holding!.costBasis).toBe(301);
    expect(holding!.realizedPnl).toBeNull();
    expect(holding!.issues).toEqual(["price_missing"]);
  });

  it("同代號分屬兩個帳戶、股數相近時，配息不歸屬", () => {
    const holdings = [
      { symbol: "0050", name: "元大台灣50", quantity: 1000 },
      { symbol: "0050", name: "元大台灣50", quantity: 400 },
    ];
    expect(
      attributeDividend("轉帳 0050FUND 基金配息", holdings),
    ).toBeUndefined();
    const dominant = [
      { symbol: "0050", name: "元大台灣50", quantity: 5090 },
      { symbol: "0050", name: "元大台灣50", quantity: 1 },
    ];
    expect(attributeDividend("轉帳 0050FUND 基金配息", dominant)).toBe(
      dominant[0],
    );
  });
});
