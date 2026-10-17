import { describe, expect, it } from "vitest";
import {
  parseTaishinCreditCardData,
  taishinValueShape,
} from "../../../src/sources/taishin/protocol";

// 合成資料：虛構卡號、商店與金額。
function payloads(realtimeAmount: string, unbilled?: unknown) {
  return {
    summary: {
      value: {
        "001": {
          "OUT-AVAIL-CREDIT": "168,500",
          "OUT-STMT-BALANCE": "0",
          "OUT-CRLIMIT-PERM": "200,000",
        },
      },
      error: "",
    },
    // 本期帳單 10,060 元、尚未繳款：餘額 = −(未繳 + 未出帳)。
    overview: {
      value: {
        carInfoList: {
          "001": {
            BillYear: "2026",
            BillMon: "09",
            StmtBalance: "$10,060",
            LstPymtAmt: "$0",
          },
        },
      },
    },
    bills: [
      {
        value: {
          showAccoutnYM: "2026/09",
          showStmtDate: "2026/09/20",
          showDueDate: "2026/10/05",
          showCbalance: "10,060",
          showCdue: "10,060",
          showMinPay: "1,129",
          showPayment: "0",
          newAcctDetailList: [],
        },
        error: null,
      },
    ],
    realtime: {
      value: {
        fmtRealTxListMap: [
          {
            cardname: "測試卡 (卡號末四碼:3108)",
            txlist: [
              [
                "2026/10/16",
                "12:30:00",
                "測試商店",
                realtimeAmount,
                "TW",
                "成功",
                "",
              ],
            ],
          },
        ],
      },
      error: null,
    },
    unbilled: unbilled ?? { value: { unpostedTx: {} }, error: null },
  };
}

const NO_CONSUMPTION = "(CRXTIKE004)無消費資料";

function unbilledWith(
  twdRows: unknown[][],
  subtotal: unknown,
  usdRows: unknown[][] = [],
) {
  const group = (rows: unknown[][]) =>
    rows.length
      ? { data: [{ cardname: "測試卡 (卡號末四碼:3108)", txlist: rows }] }
      : { ErrMsg: NO_CONSUMPTION };
  return {
    value: {
      unpostedTx: { "001TWD": group(twdRows), "002USD": group(usdRows) },
      showRB0712_SUBTOTAL: subtotal,
    },
    error: null,
  };
}

describe("taishin card amount format errors", () => {
  it("masks digits, letters and other text in the value shape", () => {
    expect(taishinValueShape("<b>NT$ 1,404</b>")).toBe("AA$ 9,999");
    expect(taishinValueShape("1,404元")).toBe("9,999字");
    expect(taishinValueShape("測試商店ABC123")).toBe("字字字字AAA999");
    expect(taishinValueShape("1".repeat(30))).toBe(`${"9".repeat(24)}…`);
  });

  it("names the list, column and shape without leaking the amount", () => {
    expect(() =>
      parseTaishinCreditCardData(
        payloads("US$ 39.99"),
        new Date("2026-10-17T00:00:00.000Z"),
      ),
    ).toThrow(
      "台新信用卡交易金額格式已改變（即時消費第 4 欄，共 7 欄：「AA$ 99.99」）。",
    );
  });

  it("treats a no-consumption TWD subtotal as zero when there are no TWD rows", () => {
    const result = parseTaishinCreditCardData(
      payloads("350", unbilledWith([], NO_CONSUMPTION)),
      new Date("2026-10-17T00:00:00.000Z"),
    );
    expect(result.bankBalanceSnapshots[0]).toMatchObject({
      balance: -10060,
      raw: { unbilledAmount: 0 },
    });
    expect(
      result.bankTransactions.filter(({ status }) => status === "posted"),
    ).toEqual([]);
  });

  it("rejects a no-consumption subtotal next to TWD rows", () => {
    expect(() =>
      parseTaishinCreditCardData(
        payloads(
          "350",
          unbilledWith(
            [["2026/10/16", "2026/10/17", "測試商店", "350", "", "TW", "", ""]],
            NO_CONSUMPTION,
          ),
        ),
        new Date("2026-10-17T00:00:00.000Z"),
      ),
    ).toThrow("台新未出帳消費有新臺幣明細，總額卻顯示無消費資料。");
  });

  it("still parses a normal TWD subtotal", () => {
    const result = parseTaishinCreditCardData(
      payloads(
        "350",
        unbilledWith(
          [["2026/10/16", "2026/10/17", "測試商店", "350", "", "TW", "", ""]],
          "350",
        ),
      ),
      new Date("2026-10-17T00:00:00.000Z"),
    );
    expect(result.bankBalanceSnapshots[0]).toMatchObject({
      balance: -10410,
      raw: { unbilledAmount: 350 },
    });
  });

  it("accepts a no-consumption subtotal when TWD rows are only payments", () => {
    const result = parseTaishinCreditCardData(
      payloads(
        "350",
        unbilledWith(
          [
            [
              "2026/10/16",
              "2026/10/16",
              "繳款-謝謝",
              "-10060",
              "",
              "TW",
              "",
              "",
            ],
          ],
          NO_CONSUMPTION,
        ),
      ),
      new Date("2026-10-17T00:00:00.000Z"),
    );
    expect(result.bankBalanceSnapshots[0]).toMatchObject({
      raw: { unbilledAmount: 0 },
    });
    // 繳款列仍會匯入，供繳卡費配對。
    expect(
      result.bankTransactions.find(
        ({ description }) => description === "繳款-謝謝",
      )?.amount,
    ).toBe(10060);
  });

  it("accepts a no-consumption TWD subtotal when only foreign rows exist", () => {
    const result = parseTaishinCreditCardData(
      payloads(
        "350",
        unbilledWith([], NO_CONSUMPTION, [
          [
            "2026/10/16",
            "2026/10/17",
            "TEST STORE",
            "12.5",
            "",
            "US",
            "",
            "USD",
          ],
        ]),
      ),
      new Date("2026-10-17T00:00:00.000Z"),
    );
    expect(result.bankBalanceSnapshots[0]).toMatchObject({
      balance: -10060,
      raw: { unbilledAmount: 0 },
    });
    expect(
      result.bankTransactions.find(({ currency }) => currency === "USD")
        ?.amount,
    ).toBe(-12.5);
  });
});
