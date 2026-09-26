import { describe, expect, it } from "vitest";
import {
  buildActivityItems,
  invoiceCarrierCardSuffix,
  matchInvoicesToTransactions,
  merchantSimilarity,
  resolveInvoiceDedupe,
  summarizeActivityMonths,
  type ActivityInvoice,
  type ActivityTransaction,
  type InvoiceTransactionPreference,
} from "@taiwan-fin-hub/core";

// 合成資料：卡號、載具只用假末碼。
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
    connectorId: "cathaybk",
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

function bankTx(id: string, day: string, amount: number, description: string) {
  return tx(id, day, amount, description, {
    accountId: "dep-1",
    accountType: "savings",
    accountLast4: "9999",
  });
}

function inv(
  id: string,
  day: string,
  amount: number,
  sellerName: string,
  overrides: Partial<ActivityInvoice> = {},
): ActivityInvoice {
  return { id, invoiceDate: day, amount, sellerName, ...overrides };
}

const CARDS = new Set(["1111", "2222"]);

function run(
  transactions: Tx[],
  invoices: ActivityInvoice[],
  options: {
    today?: string;
    preferences?: InvoiceTransactionPreference[];
  } = {},
) {
  const preferences = options.preferences ?? [];
  const matches = matchInvoicesToTransactions(
    transactions,
    invoices,
    preferences,
    { syncedCardSuffixes: CARDS },
  );
  const { roles, statuses } = resolveInvoiceDedupe(
    invoices,
    transactions,
    matches,
    preferences,
    { today: options.today ?? "2026-09-30" },
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
  return { matches, roles, statuses, items, summary };
}

describe("merchantSimilarity", () => {
  it.each([
    ["好食餐飲有限公司", "信用卡消費 好食餐飲", "strong"],
    ["全聯實業股份有限公司台中旅順分公司", "全支付﹘全聯", "partial"],
    ["統一超商股份有限公司", "統一超商－台北門市", "strong"],
    ["Valve Corporation", "WL *STEAM PURCHASE", "strong"],
    ["連鎖商店", "商店甲", "partial"],
    ["好食餐飲有限公司", "全家便利商店", "none"],
  ] as const)("%s vs %s → %s", (sellerName, text, expected) => {
    expect(merchantSimilarity({ sellerName }, text)).toBe(expected);
  });

  it("treats the seller tax id in the descriptor as a strong match", () => {
    expect(
      merchantSimilarity(
        { sellerName: "某某股份有限公司", sellerBan: "12345678" },
        "特約商店 12345678",
      ),
    ).toBe("strong");
  });
});

describe("invoiceCarrierCardSuffix", () => {
  it("only resolves a card carrier whose suffix is a synced credit card", () => {
    expect(
      invoiceCarrierCardSuffix(
        { carrierType: "EK0002", carrierSuffix: "1111" },
        CARDS,
      ),
    ).toBe("1111");
    expect(
      invoiceCarrierCardSuffix(
        { carrierType: "EK0002", carrierSuffix: "3333" },
        CARDS,
      ),
    ).toBeUndefined();
    // 手機條碼、悠遊卡等不是信用卡，即使末碼剛好相同。
    for (const carrierType of ["3J0002", "1K0001", "1H0001", "CQ0001"])
      expect(
        invoiceCarrierCardSuffix({ carrierType, carrierSuffix: "1111" }, CARDS),
      ).toBeUndefined();
  });
});

describe("invoice ↔ transaction dedupe", () => {
  it("pairs two same-day same-amount card charges with two invoices one-to-one", () => {
    const transactions = [
      tx("coffee", "2026-09-05", -120, "路易莎咖啡"),
      tx("bakery", "2026-09-05", -120, "85度C"),
    ];
    const invoices = [
      inv("inv-bakery", "2026-09-05", 120, "美食達人股份有限公司85度C"),
      inv("inv-coffee", "2026-09-05", 120, "路易莎職人咖啡股份有限公司"),
    ];
    for (const order of [transactions, [...transactions].reverse()]) {
      const { matches, statuses, summary } = run(order, invoices);
      expect(matches.invoiceToTransactionId.get("inv-coffee")).toBe("coffee");
      expect(matches.invoiceToTransactionId.get("inv-bakery")).toBe("bakery");
      expect(statuses.get("inv-coffee")).toMatchObject({
        matchStatus: "matched_card",
        matchedTransactionId: "coffee",
      });
      expect(summary.spending).toBe(240);
      expect(summary.dedupe.invoicesMerged).toBe(2);
    }
  });

  it("uses the card carrier to pair otherwise identical charges", () => {
    const { matches, statuses } = run(
      [
        tx("card-a", "2026-09-06", -300, "全家便利商店"),
        tx("card-b", "2026-09-06", -300, "全家便利商店", {
          accountId: "card-2222",
          accountLast4: "2222",
        }),
      ],
      [
        inv("inv-b", "2026-09-06", 300, "全家便利商店股份有限公司", {
          carrierType: "EK0002",
          carrierSuffix: "2222",
        }),
        inv("inv-a", "2026-09-06", 300, "全家便利商店股份有限公司", {
          carrierType: "EK0002",
          carrierSuffix: "1111",
        }),
      ],
    );
    expect(matches.invoiceToTransactionId.get("inv-a")).toBe("card-a");
    expect(matches.invoiceToTransactionId.get("inv-b")).toBe("card-b");
    expect(statuses.get("inv-b")?.matchScore).toBe(1);
  });

  it("merges a points-discounted charge only with merchant or carrier evidence", () => {
    const discounted = run(
      [tx("px", "2026-09-07", -450, "全聯福利中心")],
      [inv("inv-px", "2026-09-07", 500, "全聯福利中心股份有限公司")],
    );
    expect(discounted.statuses.get("inv-px")).toMatchObject({
      matchStatus: "matched_card",
      matchedTransactionId: "px",
    });
    // 發票不另計：消費以實付 450 為準。
    expect(discounted.summary.spending).toBe(450);

    const unrelated = run(
      [tx("other", "2026-09-07", -450, "某餐廳")],
      [inv("inv-px", "2026-09-07", 500, "全聯福利中心股份有限公司")],
    );
    expect(unrelated.statuses.get("inv-px")?.matchStatus).toBe("unmatched");
    expect(unrelated.summary.spending).toBe(950);

    // 差額太大不是折抵。
    const tooLarge = run(
      [tx("px", "2026-09-07", -300, "全聯福利中心")],
      [inv("inv-px", "2026-09-07", 500, "全聯福利中心股份有限公司")],
    );
    expect(tooLarge.statuses.get("inv-px")?.matchStatus).toBe("unmatched");
  });

  it("never pairs foreign-currency charges or foreign transaction fees", () => {
    const { statuses, summary } = run(
      [
        tx("usd", "2026-09-08", -30, "AMAZON.COM", { currency: "USD" }),
        tx("fee", "2026-09-08", -45, "國外交易服務費－3000.00"),
      ],
      [
        inv("inv-usd", "2026-09-08", 30, "某書店"),
        inv("inv-fee", "2026-09-08", 45, "某商店"),
      ],
    );
    expect(statuses.get("inv-usd")?.matchStatus).toBe("unmatched");
    expect(statuses.get("inv-fee")?.matchStatus).toBe("unmatched");
    expect(summary.dedupe.invoicesMerged).toBe(0);
  });

  it("never pairs an e-wallet top-up with the purchase invoice", () => {
    const { statuses } = run(
      [bankTx("topup", "2026-09-09", -500, "電支交易 街口儲值 P123")],
      [inv("inv-shop", "2026-09-09", 500, "某超商")],
    );
    expect(statuses.get("inv-shop")?.matchStatus).toBe("unmatched");
  });

  it("marks a bank-side match as matched_bank", () => {
    const { statuses } = run(
      [bankTx("debit", "2026-09-10", -880, "金融卡消費 好食餐飲")],
      [inv("inv-meal", "2026-09-10", 880, "好食餐飲有限公司")],
    );
    expect(statuses.get("inv-meal")).toMatchObject({
      matchStatus: "matched_bank",
      matchedTransactionId: "debit",
    });
  });

  it("waits for the card charge of a card-carrier invoice, then merges it once", () => {
    const invoice = inv("inv-card", "2026-09-12", 1680, "某百貨股份有限公司", {
      carrierType: "EK0002",
      carrierSuffix: "1111",
    });
    // 發票先到；其他帳戶剛好有同額交易也不能拿來配。
    const before = run(
      [
        bankTx("same-amount", "2026-09-12", -1680, "轉帳"),
        tx("other-card", "2026-09-12", -1680, "某百貨", {
          accountId: "card-2222",
          accountLast4: "2222",
        }),
      ],
      [invoice],
      { today: "2026-09-14" },
    );
    expect(before.statuses.get("inv-card")).toMatchObject({
      matchStatus: "awaiting_card",
      carrierCardSuffix: "1111",
      awaitingOverdue: false,
    });
    expect(before.roles.get("inv-card")).toMatchObject({
      economicRole: "spending",
      reviewStatus: "auto",
      roleReason: "invoice_awaiting_card",
      duplicateOf: null,
    });
    expect(before.summary.dedupe.invoicesAwaitingCard).toBe(1);
    // 暫時計入：發票 1680 + 另兩筆交易。
    expect(before.summary.spending).toBe(1680 * 3);

    // 刷卡交易晚兩天入帳（沒有授權時間）後自動合併，只算一次。
    const after = run(
      [
        bankTx("same-amount", "2026-09-12", -1680, "轉帳"),
        tx("other-card", "2026-09-12", -1680, "某百貨", {
          accountId: "card-2222",
          accountLast4: "2222",
        }),
        tx("posted", "2026-09-16", -1680, "某百貨"),
      ],
      [invoice],
      { today: "2026-09-17" },
    );
    expect(after.statuses.get("inv-card")).toMatchObject({
      matchStatus: "matched_card",
      matchedTransactionId: "posted",
    });
    expect(after.summary.spending).toBe(1680 * 3);
    expect(after.summary.duplicateExcluded).toBe(1680);
    expect(after.summary.dedupe).toEqual({
      invoicesMerged: 1,
      invoicesUnmatched: 0,
      invoicesAwaitingCard: 0,
      invoicesAmbiguous: 0,
    });
    expect(
      after.items.find((item) => item.id === "posted")?.matchedInvoiceId,
    ).toBe("inv-card");
  });

  it("flags a card-carrier invoice for review after ten days without the charge", () => {
    const { statuses, roles, summary } = run(
      [],
      [
        inv("inv-card", "2026-09-01", 990, "某商店", {
          carrierType: "EK0002",
          carrierSuffix: "1111",
        }),
      ],
      { today: "2026-09-12" },
    );
    expect(statuses.get("inv-card")).toMatchObject({
      matchStatus: "awaiting_card",
      awaitingOverdue: true,
    });
    expect(roles.get("inv-card")?.reviewStatus).toBe("needs_review");
    expect(summary.needsReview).toEqual({ count: 1, amount: 990 });
  });

  it("leaves close candidates ambiguous and asks for review", () => {
    const { statuses, roles, summary } = run(
      [
        tx("before", "2026-09-19", -3000, "商店甲"),
        tx("after", "2026-09-21", -3000, "商店乙"),
      ],
      [inv("inv", "2026-09-20", 3000, "連鎖商店")],
    );
    expect(statuses.get("inv")).toMatchObject({
      matchStatus: "ambiguous",
      matchedTransactionId: null,
    });
    expect(roles.get("inv")).toMatchObject({
      reviewStatus: "needs_review",
      roleReason: "invoice_ambiguous",
    });
    expect(summary.dedupe.invoicesAmbiguous).toBe(1);
    expect(summary.needsReview.count).toBe(1);
    // 歧義的發票暫時計入，兩筆刷卡也照算。
    expect(summary.spending).toBe(9000);
  });

  it("lets the merchant name break a day-gap tie", () => {
    const { statuses } = run(
      [
        tx("before", "2026-09-19", -3000, "商店甲"),
        tx("after", "2026-09-21", -3000, "商店乙"),
      ],
      [inv("inv", "2026-09-20", 3000, "商店乙")],
    );
    expect(statuses.get("inv")).toMatchObject({
      matchStatus: "matched_card",
      matchedTransactionId: "after",
    });
  });

  it("keeps a separated invoice unmatched and a manual link at full score", () => {
    const { statuses } = run(
      [
        tx("a", "2026-09-22", -200, "某店"),
        tx("b", "2026-09-25", -999, "另一家"),
      ],
      [
        inv("inv-a", "2026-09-22", 200, "某店"),
        inv("inv-b", "2026-09-25", 150, "另一家"),
      ],
      {
        preferences: [
          { invoiceId: "inv-a", transactionId: null, decision: "separate" },
          { invoiceId: "inv-b", transactionId: "b", decision: "linked" },
        ],
      },
    );
    expect(statuses.get("inv-a")?.matchStatus).toBe("unmatched");
    expect(statuses.get("inv-b")).toMatchObject({
      matchStatus: "matched_card",
      matchScore: 1,
    });
  });
});
