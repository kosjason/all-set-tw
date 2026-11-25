import { describe, expect, it, vi } from "vitest";
import {
  fetchMonthPrices,
  MarketPriceUnavailableError,
  parseTpexMonth,
  parseTwseMonth,
  rocDate,
  tpexMonthUrl,
  twseMonthUrl,
} from "../../../src/features/investments/market-prices";

// 合成的交易所回應（格式仿照證交所 STOCK_DAY 與櫃買中心 tradingStock）。
const twseOk = {
  stat: "OK",
  date: "20230101",
  fields: [
    "日期",
    "成交股數",
    "成交金額",
    "開盤價",
    "最高價",
    "最低價",
    "收盤價",
    "漲跌價差",
    "成交筆數",
    "註記",
  ],
  data: [
    ["112/01/03", "1,000", "1", "1", "1", "1", "110.75", "+0.55", "1", ""],
    ["112/01/04", "1,000", "1", "1", "1", "1", "--", "X", "0", ""],
    ["112/01/05", "1,000", "1", "1", "1", "1", "1,111.30", "+0.80", "1", ""],
  ],
};

const tpexOk = {
  tables: [
    {
      title: "個股日成交資訊",
      fields: [
        "日 期",
        "成交張數",
        "成交仟元",
        "開盤",
        "最高",
        "最低",
        "收盤",
        "漲跌",
        "筆數",
      ],
      data: [
        [
          "114/12/01",
          "1",
          "1",
          "34.08",
          "34.08",
          "33.98",
          "33.98",
          "-0.07",
          "1",
        ],
      ],
    },
  ],
  stat: "ok",
};

describe("交易所回應解析", () => {
  it("民國日期轉西元", () => {
    expect(rocDate("114/12/01")).toBe("2025-12-01");
    expect(rocDate("99/1/5")).toBe("2010-01-05");
    expect(rocDate("2025-12-01")).toBeUndefined();
  });

  it("證交所：讀收盤價，略過沒有成交的日子", () => {
    expect(parseTwseMonth(twseOk, "2023-01")).toEqual({
      status: "ok",
      closes: [
        { date: "2023-01-03", close: 110.75 },
        { date: "2023-01-05", close: 1111.3 },
      ],
    });
  });

  it("證交所明確回覆沒有資料時為 empty", () => {
    expect(
      parseTwseMonth(
        { stat: "很抱歉，沒有符合條件的資料!", total: 0 },
        "2025-12",
      ),
    ).toEqual({ status: "empty", closes: [] });
  });

  it("其他回應（限流、改版）不能當成沒有資料", () => {
    expect(() => parseTwseMonth("<html>blocked</html>", "2025-12")).toThrow(
      MarketPriceUnavailableError,
    );
    expect(() => parseTwseMonth({ stat: "查詢過於頻繁" }, "2025-12")).toThrow(
      MarketPriceUnavailableError,
    );
    expect(() =>
      parseTwseMonth({ ...twseOk, fields: ["日期", "成交股數"] }, "2023-01"),
    ).toThrow(MarketPriceUnavailableError);
    // 日期或收盤價格式改版：不能變成 empty 被當成「沒有資料」永久快取。
    expect(() =>
      parseTwseMonth(
        { ...twseOk, data: [["2023-01-03", "1", "1", "1", "1", "1", "100"]] },
        "2023-01",
      ),
    ).toThrow(MarketPriceUnavailableError);
    expect(() =>
      parseTwseMonth(
        { ...twseOk, data: [["112/01/03", "1", "1", "1", "1", "1", "N/A"]] },
        "2023-01",
      ),
    ).toThrow(MarketPriceUnavailableError);
    // 缺收盤價欄位或空白也不能當成沒有成交。
    for (const row of [
      ["112/01/03"],
      ["112/01/03", "1", "1", "1", "1", "1", ""],
    ])
      expect(() =>
        parseTwseMonth({ ...twseOk, data: [row] }, "2023-01"),
      ).toThrow(MarketPriceUnavailableError);
  });

  it("櫃買中心：欄位名稱含空白也能讀", () => {
    expect(parseTpexMonth(tpexOk, "2025-12")).toEqual({
      status: "ok",
      closes: [{ date: "2025-12-01", close: 33.98 }],
    });
    expect(
      parseTpexMonth(
        {
          tables: [{ fields: tpexOk.tables[0]!.fields, data: [] }],
          stat: "ok",
        },
        "2025-12",
      ),
    ).toEqual({ status: "empty", closes: [] });
    expect(() => parseTpexMonth({ stat: "error" }, "2025-12")).toThrow(
      MarketPriceUnavailableError,
    );
  });

  it("網址帶月份第一天與代號", () => {
    expect(twseMonthUrl("0050", "2023-01")).toBe(
      "https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?date=20230101&stockNo=0050&response=json",
    );
    expect(tpexMonthUrl("00720B", "2025-12")).toBe(
      "https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock?code=00720B&date=2025%2F12%2F01&response=json",
    );
  });
});

describe("fetchMonthPrices", () => {
  it("依交易所選擇來源", async () => {
    const fetcher = vi.fn(async (_url: string) => Response.json(tpexOk));
    await expect(
      fetchMonthPrices("tpex", "00720B", "2025-12", fetcher as never),
    ).resolves.toMatchObject({ status: "ok" });
    expect(String(fetcher.mock.calls[0]![0])).toContain("tpex.org.tw");
  });

  it("HTTP 錯誤與網路錯誤都視為暫時無法取得", async () => {
    await expect(
      fetchMonthPrices(
        "twse",
        "0050",
        "2023-01",
        (async () => new Response("", { status: 503 })) as never,
      ),
    ).rejects.toThrow(MarketPriceUnavailableError);
    await expect(
      fetchMonthPrices("twse", "0050", "2023-01", (async () => {
        throw new TypeError("network");
      }) as never),
    ).rejects.toThrow(MarketPriceUnavailableError);
  });
});
