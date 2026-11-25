import { describe, expect, it } from "vitest";
import type {
  InvestmentHolding,
  InvestmentPerformance,
} from "@taiwan-fin-hub/shared";
import {
  costBreakdownText,
  costIssueText,
  dividendText,
  eventDetail,
  estimateNote,
  findHoldingPerformance,
  matchingHoldings,
  formatSignedCurrency,
  formatSignedPercent,
  openingText,
  pnlTone,
  shortDate,
} from "./investment-performance";

// 合成資料：虛構股數與金額。
function holding(
  overrides: Partial<InvestmentHolding> = {},
): InvestmentHolding {
  return {
    key: "1234:1:0056",
    symbol: "0056",
    name: "測試高股息",
    assetType: "etf",
    category: "equity",
    brokerNo: "1234",
    brokerName: null,
    quantity: 1000,
    marketValue: 40_000,
    closePrice: 40,
    asOfDate: "2026-11-24",
    costBasis: 30_000,
    averageCost: 30,
    unrealizedPnl: 10_000,
    unrealizedPct: 33.33,
    realizedPnl: 0,
    dividends: 0,
    totalReturn: 10_000,
    costBreakdown: { bank: 5_000, estimate: 20_000, opening: 5_000, manual: 0 },
    opening: {
      quantity: 200,
      date: "2023-01-06",
      cost: 5_000,
      manual: false,
    },
    issues: [],
    missingPriceDates: [],
    events: [],
    history: [],
    ...overrides,
  };
}

describe("投資績效的顯示文字", () => {
  it("損益帶正負號，0 不帶", () => {
    expect(formatSignedCurrency(1234)).toBe("+NT$1,234");
    expect(formatSignedCurrency(-1234)).toBe("−NT$1,234");
    expect(formatSignedCurrency(0)).toBe("NT$0");
    expect(formatSignedPercent(12.345)).toBe("+12.3%");
    expect(formatSignedPercent(-5.08)).toBe("−5.1%");
    expect(pnlTone(5)).toBe("text-moss");
    expect(pnlTone(-5)).toBe("text-coral");
    expect(pnlTone(null)).toBe("");
  });

  it("短日期", () => {
    expect(shortDate("2023-01-06")).toBe("2023/1/6");
    expect(shortDate(null)).toBe("");
  });

  it("本金來源只列有金額的項目", () => {
    expect(costBreakdownText(holding())).toBe(
      "銀行扣款 NT$5,000 · 收盤價估算 NT$20,000 · 期初估算 NT$5,000",
    );
  });

  it("期初持股說明估算與使用者填的成本", () => {
    expect(openingText(holding())).toBe(
      "集保紀錄從 2023/1/6 開始，之前已持有 200 股；成本以當天收盤價估算為 NT$5,000。",
    );
    expect(
      openingText(
        holding({
          opening: {
            quantity: 200,
            date: "2023-01-06",
            cost: 4_000,
            manual: true,
          },
        }),
      ),
    ).toBe(
      "集保紀錄從 2023/1/6 開始，之前已持有 200 股；成本採用你填的 NT$4,000。",
    );
  });

  it("沒有對到配息時顯示未找到，不顯示 0", () => {
    expect(dividendText(holding())).toBe("未找到");
    expect(dividendText(holding({ dividends: 1_200 }))).toBe("NT$1,200");
  });

  it("缺價原因列出日期", () => {
    expect(
      costIssueText(
        "price_missing",
        holding({ missingPriceDates: ["2024-02-15", "2024-03-06"] }),
      ),
    ).toBe("交易所沒有 2024/2/15、2024/3/6 的收盤價，無法估算本金。");
  });

  it("時間軸說明：銀行扣款顯示每股，估算顯示收盤價", () => {
    expect(
      eventDetail({
        date: "2026-07-13",
        kind: "buy",
        quantity: 188,
        price: 106.28,
        amount: 19_980,
        costSource: "bank",
        realizedPnl: null,
        quantityAfter: 4317,
      }),
    ).toBe("188 股 · 每股 106.28 · 銀行扣款");
    expect(
      eventDetail({
        date: "2025-06-18",
        kind: "split_in",
        quantity: 2936,
        price: null,
        amount: null,
        costSource: null,
        realizedPnl: null,
        quantityAfter: 2936,
      }),
    ).toBe("2,936 股 · 持有 2,936 股");
  });

  it("估算說明帶出和實際扣款比對的誤差", () => {
    const performance = {
      estimateCheck: { samples: 7, meanAbsErrorPct: 0.24 },
    } as InvestmentPerformance;
    expect(estimateNote(performance)).toContain(
      "和 7 次實際扣款比對，估算平均誤差 0.24%。",
    );
  });

  it("依券商與代號找到唯一的持股績效", () => {
    const performance = {
      holdings: [holding(), holding({ key: "9X9X:1:0056", brokerNo: "9X9X" })],
    } as InvestmentPerformance;
    expect(
      findHoldingPerformance(performance, {
        brokerNo: "9X9X",
        symbol: "0056 ",
      })?.key,
    ).toBe("9X9X:1:0056");
    expect(
      findHoldingPerformance(performance, { brokerNo: null, symbol: "0056" }),
    ).toBeUndefined();
    // 同一券商兩個帳戶都有這檔：找得到但不唯一，持倉列不顯示損益、也不重複列出。
    const twoAccounts = {
      holdings: [holding(), holding({ key: "1234:2:0056" })],
    } as InvestmentPerformance;
    expect(
      matchingHoldings(twoAccounts, { brokerNo: "1234", symbol: "0056" }),
    ).toHaveLength(2);
    expect(
      findHoldingPerformance(twoAccounts, { brokerNo: "1234", symbol: "0056" }),
    ).toBeUndefined();
  });
});
