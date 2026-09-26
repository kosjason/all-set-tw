import {
  pairTaishinTransactions,
  parseTaishinCreditCardData,
  taishinTransactionMatchKind,
  type TaishinMatchTransaction,
} from "@taiwan-fin-hub/connectors";
import { describe, expect, it } from "vitest";

const summary = {
  value: {
    "001": {
      "OUT-AVAIL-CREDIT": "168,500",
      "OUT-STMT-BALANCE": "10,060",
      "OUT-CRLIMIT-PERM": "200,000",
    },
  },
  error: null,
};

const overview = {
  value: {
    carInfoList: {
      "001": {
        BillYear: "2026",
        BillMon: "07",
        StmtBalance: "$10,060",
        LstPymtAmt: "$10,060",
      },
    },
  },
  error: null,
};

function transaction(
  description: string,
  amount: string,
  cardLast4 = "3108",
  currency = "新臺幣",
  transactionDate = "2026/07/08",
  country = "TW",
) {
  return {
    order: `信用卡 (卡號末四碼:${cardLast4})`,
    detail: [
      {
        showOutDesc: description,
        showOutCurrency: currency,
        showOutPostDate: "2026/07/10",
        showOutTXNDate: transactionDate,
        showOutAmt: amount,
        showOutCountry: country,
      },
    ],
  };
}

function bill(period = "2026/07", details = [transaction("測試商店", "350")]) {
  return {
    value: {
      showAccoutnYM: period,
      showStmtDate: "2026/07/20",
      showDueDate: "2026/08/05",
      showCbalance: "10,060",
      showCdue: "10,060",
      showMinPay: "1,129",
      showPayment: "0",
      newAcctDetailList: details,
    },
    error: null,
  };
}

function realtime(rows: unknown[][], cardLast4 = "3108") {
  return {
    value: {
      fmtRealTxListMap: [
        {
          cardname: `信用卡 (卡號末四碼:${cardLast4})`,
          txlist: rows,
        },
      ],
    },
    error: null,
  };
}

describe("Taishin credit-card parser", () => {
  it("uses one aggregate credit account and limits bills to three periods", () => {
    const result = parseTaishinCreditCardData(
      {
        summary,
        overview,
        bills: Array.from({ length: 7 }, (_, index) =>
          bill(`2026/${String(7 - index).padStart(2, "0")}`, []),
        ),
      },
      new Date("2026-07-23T00:00:00.000Z"),
    );

    expect(result.bankAccounts).toHaveLength(1);
    expect(result.bankAccounts[0]).toMatchObject({
      sourceId: "credit:taishin:main",
      creditLimit: 200000,
    });
    expect(result.creditCardBills).toHaveLength(3);
    expect(result.bankBalanceSnapshots[0]).toMatchObject({
      availableBalance: 168500,
      statementBalance: 10060,
    });
  });

  it("uses the current overview payment as the current card liability", () => {
    const partiallyPaidBill = bill();
    Object.assign(partiallyPaidBill.value, {
      showCbalance: "10,060",
      showCdue: "2,060",
      showPayment: "8,000",
    });
    const partial = parseTaishinCreditCardData({
      summary,
      overview: {
        value: {
          carInfoList: {
            "001": {
              BillYear: "2026",
              BillMon: "07",
              StmtBalance: "$10,060",
              LstPymtAmt: "$8,000",
            },
          },
        },
      },
      bills: [partiallyPaidBill],
    });

    expect(partial.bankBalanceSnapshots[0]).toMatchObject({
      balance: -2060,
      statementBalance: 10060,
      noPaymentNeeded: false,
    });

    const paid = parseTaishinCreditCardData({
      summary,
      overview,
      bills: [partiallyPaidBill],
    });

    expect(paid.bankBalanceSnapshots[0]).toMatchObject({
      balance: 0,
      statementBalance: 10060,
      noPaymentNeeded: true,
    });
  });

  it("parses compact dates returned by the real bill API", () => {
    const compactDateBill = bill();
    Object.assign(compactDateBill.value, {
      showStmtDate: "2026/7/20",
      showDueDate: "20260805",
    });
    const result = parseTaishinCreditCardData({
      summary,
      overview,
      bills: [compactDateBill],
    });

    expect(result.creditCardBills[0]).toMatchObject({
      statementClosingDate: "2026-07-20",
      paymentDueDate: "2026-08-05",
      paidAmount: 10060,
      isPaid: true,
    });
  });

  it("uses the newest valid bill when the current month is empty", () => {
    const previousBill = bill("2026/06", []);
    Object.assign(previousBill.value, {
      showCbalance: "8,060",
      showCdue: "2,060",
      showPayment: "6,000",
      showStmtDate: "2026/06/20",
      showDueDate: "2026/07/05",
    });

    const result = parseTaishinCreditCardData({
      summary,
      overview: {
        value: {
          carInfoList: {
            "001": {
              BillYear: "2026",
              BillMon: "06",
              StmtBalance: "$8,060",
              LstPymtAmt: "$6,000",
            },
          },
        },
      },
      bills: [{ value: {}, error: null }, previousBill],
    });

    expect(result.bankBalanceSnapshots[0]).toMatchObject({
      balance: -2060,
      statementBalance: 8060,
      paymentDueDate: "2026-07-05",
      statementClosingDate: "2026-06-20",
      noPaymentNeeded: false,
    });
    expect(
      result.creditCardBills.map(({ billingPeriod }) => billingPeriod),
    ).toEqual(["2026-06"]);
  });

  it("keeps a valid bill when the bank leaves the remaining due blank", () => {
    const noPaymentBill = bill();
    Object.assign(noPaymentBill.value, {
      showCdue: "",
      showCbalance: "",
    });

    const result = parseTaishinCreditCardData({
      summary: { value: {}, error: null },
      bills: [noPaymentBill],
    });

    expect(result.creditCardBills).toHaveLength(1);
    expect(result.bankBalanceSnapshots).toEqual([]);
  });

  it("upgrades merchant-matched pending occurrences and keeps the rest pending", () => {
    const result = parseTaishinCreditCardData({
      summary,
      bills: [
        bill("2026/07", [
          transaction("第一商店（入帳後）", "350"),
          transaction("第二商店", "350"),
        ]),
      ],
      realtime: realtime([
        ["2026/07/08", "12:30:00", "第一商店", "350", "TW", "成功"],
        ["2026/07/08", "13:30:00", "第二商店", "350", "TW", "成功"],
        ["2026/07/08", "14:30:00", "尚未入帳", "350", "TW", "成功"],
      ]),
    });

    expect(result.bankTransactions).toHaveLength(3);
    expect(result.bankTransactions.map(({ sourceId }) => sourceId)).toEqual([
      expect.stringMatching(/第一商店入帳後:1$/),
      expect.stringMatching(/第二商店:1$/),
      expect.stringMatching(/尚未入帳:1$/),
    ]);
    expect(result.bankTransactions.map(({ status }) => status)).toEqual([
      "posted",
      "posted",
      "pending",
    ]);
  });

  it("replaces an MCC-category authorization with its posted merchant row", () => {
    const result = parseTaishinCreditCardData({
      summary,
      bills: [
        bill("2026/09", [
          transaction(
            "SAMPLE SOFTWARE 0000-00",
            "793",
            "4321",
            "新臺幣",
            "2026/09/15",
            "US",
          ),
        ]),
      ],
      realtime: realtime(
        [
          [
            "2026/09/15",
            "18:05:02",
            "電腦、電腦外圍用具、軟體",
            "793",
            "US",
            "成功",
          ],
        ],
        "4321",
      ),
    });

    expect(result.bankTransactions).toEqual([
      expect.objectContaining({
        description: "SAMPLE SOFTWARE 0000-00",
        status: "posted",
        amount: -793,
        authorizedAt: "2026-09-15T18:05:02+08:00",
        sourceId: expect.stringMatching(/samplesoftware000000:1$/),
      }),
    ]);
  });

  it("pairs an authorization posted up to three days later but not four", () => {
    const parse = (transactionDate: string) =>
      parseTaishinCreditCardData({
        summary,
        bills: [
          bill("2026/07", [
            transaction("商戶 B", "350", "3108", "新臺幣", transactionDate),
          ]),
        ],
        realtime: realtime([
          ["2026/07/08", "23:30:00", "餐飲", "350", "TW", "成功"],
        ]),
      }).bankTransactions.map(({ status }) => status);

    expect(parse("2026/07/11")).toEqual(["posted"]);
    expect(parse("2026/07/12")).toEqual(["posted", "pending"]);
  });

  it("never merges when two same-amount authorizations compete for one posted row", () => {
    const result = parseTaishinCreditCardData({
      summary,
      bills: [bill("2026/07", [transaction("商戶 B", "350")])],
      realtime: realtime([
        ["2026/07/08", "12:30:00", "餐飲", "350", "TW", "成功"],
        ["2026/07/08", "19:30:00", "餐飲", "350", "TW", "成功"],
      ]),
    });

    expect(result.bankTransactions.map(({ status }) => status)).toEqual([
      "posted",
      "pending",
      "pending",
    ]);
  });

  it("does not pair a foreign transaction fee, another card or another country", () => {
    const result = parseTaishinCreditCardData({
      summary,
      bills: [
        bill("2026/07", [
          transaction(
            "國外交易服務費－793.00",
            "12",
            "3108",
            "新臺幣",
            "2026/07/08",
            "",
          ),
          transaction("其他卡商戶", "90", "9921"),
          transaction("愛爾蘭商戶", "60", "3108", "新臺幣", "2026/07/08", "IE"),
        ]),
      ],
      realtime: realtime([
        ["2026/07/08", "12:30:00", "其他交易", "12", "", "成功"],
        ["2026/07/08", "12:40:00", "百貨公司", "90", "TW", "成功"],
        ["2026/07/08", "12:50:00", "其他交易", "60", "US", "成功"],
      ]),
    });

    expect(
      result.bankTransactions.filter(({ status }) => status === "pending"),
    ).toHaveLength(3);
  });

  it("keeps different merchants stable across lifecycle subsets", () => {
    const first = parseTaishinCreditCardData({
      summary,
      bills: [bill("2026/07", [])],
      realtime: realtime([
        ["2026/07/08", "12:30:00", "商戶 A", "350", "TW", "成功"],
        ["2026/07/08", "13:30:00", "商戶 B", "420", "TW", "成功"],
      ]),
    });
    const firstIds = new Map(
      first.bankTransactions.map(({ description, sourceId }) => [
        description,
        sourceId,
      ]),
    );

    const next = parseTaishinCreditCardData({
      summary,
      bills: [bill("2026/07", [transaction("商戶 A", "350")])],
      realtime: realtime([
        ["2026/07/08", "13:30:00", "商戶 B", "420", "TW", "成功"],
      ]),
    });

    expect(
      new Map(
        next.bankTransactions.map(({ description, sourceId }) => [
          description,
          sourceId,
        ]),
      ),
    ).toEqual(firstIds);
  });

  it("reuses occurrence ids for indistinguishable posted transactions", () => {
    const parsePosted = (count: number) =>
      parseTaishinCreditCardData({
        summary,
        bills: [
          bill(
            "2026/07",
            Array.from({ length: count }, () => transaction("同一商戶", "350")),
          ),
        ],
      }).bankTransactions.map(({ sourceId }) => sourceId);

    const first = parsePosted(2);
    const second = parsePosted(2);
    const third = parsePosted(3);

    expect(first).toEqual(second);
    expect(first).toEqual([
      expect.stringMatching(/:1$/),
      expect.stringMatching(/:2$/),
    ]);
    expect(third.slice(0, 2)).toEqual(first);
    expect(third[2]).toMatch(/:3$/);
    expect(new Set(third).size).toBe(3);
  });

  it("pairs indistinguishable pending and posted transactions by count", () => {
    const result = parseTaishinCreditCardData({
      summary,
      bills: [
        bill("2026/07", [
          transaction("同一商戶", "350"),
          transaction("同一商戶", "350"),
        ]),
      ],
      realtime: realtime([
        ["2026/07/08", "12:30:00", "同一商戶", "350", "TW", "成功"],
        ["2026/07/08", "13:30:00", "同一商戶", "350", "TW", "成功"],
      ]),
    });

    expect(result.bankTransactions).toHaveLength(2);
    expect(result.bankTransactions.map(({ status }) => status)).toEqual([
      "posted",
      "posted",
    ]);
    expect(result.bankTransactions.map(({ sourceId }) => sourceId)).toEqual([
      expect.stringMatching(/同一商戶:1$/),
      expect.stringMatching(/同一商戶:2$/),
    ]);
  });

  it("keeps a remaining merchant in its own identity bucket", () => {
    const result = parseTaishinCreditCardData({
      summary,
      bills: [bill("2026/07", [])],
      realtime: realtime([
        ["2026/07/08", "13:30:00", "商戶 B", "350", "TW", "成功"],
      ]),
    });

    expect(result.bankTransactions[0]?.sourceId).toMatch(/商戶b:1$/);
  });

  it("keeps cards isolated and preserves refunds and foreign currency", () => {
    const result = parseTaishinCreditCardData({
      summary,
      bills: [
        bill("2026/07", [
          transaction("美元消費", "12.50", "3108", "USD"),
          transaction("退款", "88", "9921"),
        ]),
      ],
      realtime: realtime([
        ["2026/07/08", "12:30:00", "不同卡同額", "12.50", "US", "成功"],
      ]),
    });

    expect(
      result.bankTransactions.find(({ currency }) => currency === "USD"),
    ).toMatchObject({ amount: -12.5, status: "posted" });
    expect(
      result.bankTransactions.find(({ description }) => description === "退款"),
    ).toMatchObject({ amount: 88, status: "posted" });
    expect(
      result.bankTransactions.filter(({ amount }) => amount === -12.5),
    ).toHaveLength(2);
  });

  it("records a negative consumption discount as a positive credit", () => {
    const result = parseTaishinCreditCardData({
      summary,
      bills: [
        bill("2026/07", [
          transaction("樂購蝦皮－daniel0329TAIPEI", "350"),
          transaction("信用卡消費折抵_樂購蝦皮－daniel0329", "-63"),
        ]),
      ],
    });

    expect(result.bankTransactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          description: "樂購蝦皮－daniel0329TAIPEI",
          amount: -350,
        }),
        expect.objectContaining({
          description: "信用卡消費折抵_樂購蝦皮－daniel0329",
          amount: 63,
        }),
      ]),
    );
  });

  it("persists only masked, whitelisted raw fields", () => {
    const payload = bill();
    Object.assign(payload.value, {
      customerName: "王小明",
      nationalId: "A123456789",
      cardNumber: "4111111111113108",
      debitAccount: "01234567890123",
    });

    const result = parseTaishinCreditCardData({
      summary,
      bills: [payload],
    });
    const serialized = JSON.stringify(result);

    expect(serialized).not.toMatch(
      /王小明|A123456789|4111111111113108|01234567890123/,
    );
    expect(serialized).toContain("3108");
  });

  it("returns a partial result when no statement is available", () => {
    const result = parseTaishinCreditCardData({
      summary: { value: {}, error: null },
      bills: [],
      realtime: realtime([
        ["2026/07/08", "12:30:00", "尚未入帳", "350", "TW", "成功"],
      ]),
    });

    expect(result.bankAccounts).toHaveLength(1);
    expect(result.bankBalanceSnapshots).toEqual([]);
    expect(result.creditCardBills).toEqual([]);
    expect(result.bankTransactions).toHaveLength(1);
  });

  it("fails explicitly on error payloads", () => {
    expect(() =>
      parseTaishinCreditCardData({
        summary: { value: {}, error: { code: "DRIFT" } },
        bills: [bill()],
      }),
    ).toThrow("API 回傳錯誤");
  });
});

describe("Taishin pending/posted matching", () => {
  const pending = (
    overrides: Partial<TaishinMatchTransaction> = {},
    raw: Record<string, unknown> = {},
  ): TaishinMatchTransaction => ({
    authorizedAt: "2026-09-15T18:05:02+08:00",
    amount: -793,
    currency: "TWD",
    description: "電腦、電腦外圍用具、軟體",
    raw: { cardLast4: "4321", country: "US", ...raw },
    ...overrides,
  });
  const posted = (
    overrides: Partial<TaishinMatchTransaction> = {},
    raw: Record<string, unknown> = {},
  ): TaishinMatchTransaction => ({
    authorizedAt: "2026-09-15",
    amount: -793,
    currency: "TWD",
    description: "SAMPLE SOFTWARE 0000-00",
    raw: { cardLast4: "4321", country: "US", ...raw },
    ...overrides,
  });

  it("uses authorization codes before the card/amount/date fallback", () => {
    expect(
      taishinTransactionMatchKind(
        pending({}, { authorizationCode: "A1" }),
        posted({ authorizedAt: "2026-09-30" }, { authorizationCode: "A1" }),
      ),
    ).toBe("authorization");
    expect(
      taishinTransactionMatchKind(
        pending({}, { authorizationCode: "A1" }),
        posted({}, { authorizationCode: "B2" }),
      ),
    ).toBeUndefined();

    const first = pending({}, { authorizationCode: "A1" });
    const second = pending(
      { authorizedAt: "2026-09-15T19:00:00+08:00" },
      { authorizationCode: "B2" },
    );
    const target = posted({}, { authorizationCode: "B2" });
    expect(
      pairTaishinTransactions(
        [first, second],
        [target],
        taishinTransactionMatchKind,
      ),
    ).toEqual([[second, target]]);
  });

  it("falls back to card, amount, currency and a three-day window without codes", () => {
    expect(taishinTransactionMatchKind(pending(), posted())).toBe("fallback");
    for (const mismatch of [
      posted({ amount: -794 }),
      posted({ currency: "USD" }),
      posted({ authorizedAt: "2026-09-19" }),
      posted({}, { cardLast4: "8765" }),
      posted({}, { country: "IE" }),
      posted({ description: "國外交易服務費－793.00" }, { country: undefined }),
    ])
      expect(taishinTransactionMatchKind(pending(), mismatch)).toBeUndefined();
  });

  it("leaves both sides unpaired when either has two candidates", () => {
    const a = pending();
    const b = pending({ authorizedAt: "2026-09-16T09:00:00+08:00" });
    const target = posted();
    expect(
      pairTaishinTransactions([a, b], [target], taishinTransactionMatchKind),
    ).toEqual([]);
    const other = posted({ authorizedAt: "2026-09-16" });
    expect(
      pairTaishinTransactions(
        [a],
        [target, other],
        taishinTransactionMatchKind,
      ),
    ).toEqual([]);
  });
});
