import { describe, expect, it } from "vitest";
import {
  buildActivityItems,
  lateInvoiceMerchantLearning,
  matchInvoicesToTransactions,
  resolveInvoiceDedupe,
  summarizeActivityMonths,
  type ActivityInvoice,
  type ActivityTransaction,
  type InvoiceTransactionPreference,
} from "@taiwan-fin-hub/shared";

// 合成資料：商家、統編與卡號末碼都是虛構的。發票比刷卡晚幾天開立（例如月費）。
type Tx = ActivityTransaction & {
  economicRole: "spending";
  duplicateOf: null;
};

function tx(
  id: string,
  day: string,
  amount: number,
  description: string,
  overrides: Partial<Tx> = {},
): Tx {
  return {
    id,
    connectorId: "taishin",
    sourceId: id,
    accountId: "card-1111",
    accountType: "credit",
    accountLast4: "1111",
    amount,
    currency: "TWD",
    postedDate: day,
    authorizedAt: null,
    description,
    counterparty: null,
    status: "posted",
    economicRole: "spending",
    duplicateOf: null,
    ...overrides,
  };
}

function inv(
  id: string,
  day: string,
  amount: number,
  overrides: Partial<ActivityInvoice> = {},
): ActivityInvoice {
  return {
    id,
    invoiceDate: day,
    amount,
    sellerName: "虛構能源股份有限公司",
    sellerBan: "12345678",
    ...overrides,
  };
}

const CARD_TEXT = "ＸＹＺＲＩＤＥ　ＮｅｔｗｏｒｋTAOYUA";

/** 七月的手動連結：刷卡 7/24、發票 7/30（晚 6 天）。 */
function julyLink(): InvoiceTransactionPreference {
  const invoice = inv("inv-07", "2026-07-30", 596);
  const transaction = tx("tx-07", "2026-07-24", -596, CARD_TEXT);
  return {
    invoiceId: invoice.id,
    transactionId: transaction.id,
    decision: "linked",
    learnedMerchant: lateInvoiceMerchantLearning(invoice, transaction) ?? null,
  };
}

function run(
  transactions: Tx[],
  invoices: ActivityInvoice[],
  options: {
    preferences?: InvoiceTransactionPreference[];
    dayWindow?: number;
    syncedCardSuffixes?: Set<string>;
  } = {},
) {
  const preferences = options.preferences ?? [];
  const matches = matchInvoicesToTransactions(
    transactions,
    invoices,
    preferences,
    {
      syncedCardSuffixes: options.syncedCardSuffixes ?? new Set(["1111"]),
      ...(options.dayWindow == null ? {} : { dayWindow: options.dayWindow }),
    },
  );
  const { roles, statuses } = resolveInvoiceDedupe(
    invoices,
    transactions,
    matches,
    preferences,
    {
      today: "2026-10-08",
      ...(options.dayWindow == null ? {} : { dayWindow: options.dayWindow }),
    },
  );
  const items = buildActivityItems(
    transactions,
    invoices,
    [],
    new Map(),
    matches,
    { roles: { invoices: roles, invoiceMatches: statuses } },
  );
  const [summary] = summarizeActivityMonths(items, ["2026-09"], {});
  return { matches, roles, statuses, summary };
}

describe("lateInvoiceMerchantLearning", () => {
  it("發票比刷卡晚 4–7 天的手動連結才學：記下賣方、刷卡商家與帳戶", () => {
    expect(julyLink().learnedMerchant).toEqual({
      sellerKey: "ban:12345678",
      merchantKey: expect.stringMatching(/^name:xyzride/),
      accountId: "card-1111",
    });
  });

  it.each([
    ["同日", "2026-07-24"],
    ["晚 3 天（自動配對範圍內）", "2026-07-27"],
    ["發票早於刷卡", "2026-07-20"],
    ["晚 8 天", "2026-08-01"],
  ])("%s不學", (_name, invoiceDay) => {
    expect(
      lateInvoiceMerchantLearning(
        inv("inv", invoiceDay, 596),
        tx("tx", "2026-07-24", -596, CARD_TEXT),
      ),
    ).toBeUndefined();
  });

  it("外幣發票、刷卡只有通用文字、不是支出時不學", () => {
    const transaction = tx("tx", "2026-07-24", -596, CARD_TEXT);
    expect(
      lateInvoiceMerchantLearning(
        inv("inv", "2026-07-30", 596, { currency: "USD" }),
        transaction,
      ),
    ).toBeUndefined();
    expect(
      lateInvoiceMerchantLearning(inv("inv", "2026-07-30", 596), {
        ...transaction,
        description: "信用卡消費",
      }),
    ).toBeUndefined();
    expect(
      lateInvoiceMerchantLearning(inv("inv", "2026-07-30", 596), {
        ...transaction,
        amount: 596,
        accountType: "savings",
      }),
    ).toBeUndefined();
  });
});

describe("學過的商家：晚開發票自動配對", () => {
  const card = () => tx("tx-09", "2026-09-24", -596, CARD_TEXT);
  const invoice = () => inv("inv-09", "2026-09-30", 596);

  it("沒學過時不自動配對，發票列為需要確認（疑似晚開）", () => {
    const { matches, roles, statuses } = run([card()], [invoice()]);
    expect(matches.invoiceToTransactionId.size).toBe(0);
    expect(roles.get("inv-09")).toMatchObject({
      roleReason: "invoice_ambiguous",
      reviewStatus: "needs_review",
    });
    expect(statuses.get("inv-09")?.matchStatus).toBe("ambiguous");
  });

  it("學過後同賣方、同卡、同金額晚 6 天自動配對，只算一次", () => {
    const { matches, roles, summary } = run([card()], [invoice()], {
      preferences: [julyLink()],
    });
    expect(matches.invoiceToTransactionId.get("inv-09")).toBe("tx-09");
    expect(matches.details.get("inv-09")).toMatchObject({
      outcome: "matched",
      learned: true,
    });
    expect(roles.get("inv-09")).toMatchObject({
      roleReason: "invoice_learned",
      duplicateOf: { kind: "bank_transaction", id: "tx-09" },
    });
    expect(summary.spending).toBe(596);
  });

  it("刷卡在同一筆授權列與入帳列的描述略有不同時，仍以商家 key 判斷", () => {
    const { matches } = run(
      [tx("tx-09", "2026-09-24", -596, "ＸＹＺＲＩＤＥ　ＮｅｔｗｏｒｋTAOYUA")],
      [invoice()],
      { preferences: [julyLink()] },
    );
    expect(matches.details.get("inv-09")?.learned).toBe(true);
  });

  it("不同卡、不同商家、刷卡晚於發票或相差超過 7 天時不配對", () => {
    for (const transaction of [
      tx("tx-09", "2026-09-24", -596, CARD_TEXT, {
        accountId: "card-2222",
        accountLast4: "2222",
      }),
      tx("tx-09", "2026-09-24", -596, "自動扣繳 虛構電信"),
      tx("tx-09", "2026-10-04", -596, CARD_TEXT),
      tx("tx-09", "2026-09-22", -596, CARD_TEXT),
    ]) {
      const { matches } = run([transaction], [invoice()], {
        preferences: [julyLink()],
      });
      expect(matches.invoiceToTransactionId.size).toBe(0);
    }
  });

  it("候選不唯一（兩筆同額刷卡或兩張同額發票）時不配對", () => {
    const twoCards = run(
      [card(), tx("tx-09b", "2026-09-26", -596, CARD_TEXT)],
      [invoice()],
      { preferences: [julyLink()] },
    );
    expect(twoCards.matches.invoiceToTransactionId.size).toBe(0);
    const twoInvoices = run(
      [card()],
      [invoice(), inv("inv-09b", "2026-09-29", 596)],
      { preferences: [julyLink()] },
    );
    expect(twoInvoices.matches.invoiceToTransactionId.size).toBe(0);
  });

  it("沿用一般配對資格：載具綁別張卡、分開記錄、不計入的交易都不配", () => {
    const otherCarrier = run(
      [card()],
      [
        inv("inv-09", "2026-09-30", 596, {
          carrierType: "EK0002",
          carrierSuffix: "2222",
        }),
      ],
      {
        preferences: [julyLink()],
        syncedCardSuffixes: new Set(["1111", "2222"]),
      },
    );
    expect(otherCarrier.matches.invoiceToTransactionId.size).toBe(0);

    const separate = run([card()], [invoice()], {
      preferences: [
        julyLink(),
        { invoiceId: "inv-09", transactionId: null, decision: "separate" },
      ],
    });
    expect(separate.matches.invoiceToTransactionId.size).toBe(0);

    const excluded = run(
      [{ ...card(), excludedFromCalculation: true }],
      [invoice()],
      { preferences: [julyLink()] },
    );
    expect(excluded.matches.invoiceToTransactionId.size).toBe(0);
  });

  it("只載入當日資料的搜尋（dayWindow 0）不做學習配對，也不延伸提醒", () => {
    const { matches, roles } = run([card()], [invoice()], {
      preferences: [julyLink()],
      dayWindow: 0,
    });
    expect(matches.invoiceToTransactionId.size).toBe(0);
    expect(roles.get("inv-09")?.roleReason).toBe("invoice");
  });

  it("學過的證據優先於一般自動配對：附近另一張同額發票不會先把刷卡配走", () => {
    const { matches, roles } = run(
      [card()],
      [
        inv("inv-cash", "2026-09-25", 596, {
          sellerName: "另一家虛構商店",
          sellerBan: "87654321",
        }),
        invoice(),
      ],
      { preferences: [julyLink()] },
    );
    expect(matches.invoiceToTransactionId.get("inv-09")).toBe("tx-09");
    expect(matches.invoiceToTransactionId.has("inv-cash")).toBe(false);
    expect(roles.get("inv-cash")?.roleReason).toBe("invoice");
  });

  it("大量資料時學習階段仍是線性成本", () => {
    const transactions: Tx[] = [];
    const invoices: ActivityInvoice[] = [];
    for (let index = 0; index < 2000; index += 1) {
      const day = `2026-${String(1 + (index % 9)).padStart(2, "0")}-${String(1 + (index % 28)).padStart(2, "0")}`;
      transactions.push(
        tx(`t${index}`, day, -(100 + (index % 500)), `虛構商店${index % 50}`),
      );
      invoices.push(
        inv(`i${index}`, day, 100 + ((index * 7) % 500), {
          sellerBan: index % 3 === 0 ? "12345678" : String(10000000 + index),
        }),
      );
    }
    const started = performance.now();
    run(transactions, invoices, { preferences: [julyLink()] });
    expect(performance.now() - started).toBeLessThan(3000);
  });

  it("輸入順序不影響結果", () => {
    const transactions = [
      card(),
      tx("tx-other", "2026-09-25", -120, "虛構咖啡"),
      tx("tx-later", "2026-09-27", -596, "另一家虛構商店"),
    ];
    const invoices = [invoice(), inv("inv-other", "2026-09-25", 120)];
    const forward = run(transactions, invoices, { preferences: [julyLink()] });
    const backward = run([...transactions].reverse(), [...invoices].reverse(), {
      preferences: [julyLink()],
    });
    expect([...backward.matches.invoiceToTransactionId]).toEqual([
      ...forward.matches.invoiceToTransactionId,
    ]);
  });
});

describe("疑似發票晚開的提醒", () => {
  it("小於 NT$100 的發票不延伸提醒", () => {
    const { roles } = run(
      [tx("tx", "2026-09-24", -65, "虛構咖啡")],
      [inv("inv", "2026-09-30", 65)],
    );
    expect(roles.get("inv")?.roleReason).toBe("invoice");
  });

  it("只延伸發票晚開的方向：刷卡晚於發票 4–7 天不提醒", () => {
    const { roles } = run(
      [tx("tx", "2026-10-05", -596, CARD_TEXT)],
      [inv("inv", "2026-09-30", 596)],
    );
    expect(roles.get("inv")?.roleReason).toBe("invoice");
  });

  it("使用者選擇分開記錄後不再提醒", () => {
    const { roles } = run(
      [tx("tx", "2026-09-24", -596, CARD_TEXT)],
      [inv("inv", "2026-09-30", 596)],
      {
        preferences: [
          { invoiceId: "inv", transactionId: null, decision: "separate" },
        ],
      },
    );
    expect(roles.get("inv")).toMatchObject({
      roleReason: "invoice",
      reviewStatus: "confirmed",
    });
  });
});
