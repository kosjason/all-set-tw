import { describe, expect, it } from "vitest";
import {
  applyEconomicRoleOverride,
  attributeForeignTransactionFees,
  buildActivityItems,
  foreignFeeBaseAmount,
  invoiceAmountTwd,
  invoiceRepeatGroups,
  matchInvoicesToTransactions,
  preciseInvoiceAmount,
  resolveInvoiceDedupe,
  summarizeActivityMonths,
  type ActivityInvoice,
  type ActivityTransaction,
  type EconomicRoleFields,
  type InvoiceTransactionPreference,
} from "@taiwan-fin-hub/core";

// 合成資料：商家、金額、卡號都是假的。
type Tx = ActivityTransaction & {
  economicRole: "spending";
  duplicateOf: null;
};

const RATES = { USD: 32.4 };

function card(
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

function usd(
  id: string,
  invoiceDate: string,
  amount: number,
  overrides: Partial<ActivityInvoice> = {},
): ActivityInvoice {
  return {
    id,
    invoiceDate,
    amount,
    currency: "USD",
    sellerName: "Cloudflare Inc.",
    sellerBan: "11112222",
    itemsKey: "registrar transfer fee - example.test",
    ...overrides,
  };
}

function run(
  transactions: Tx[],
  invoices: ActivityInvoice[],
  options: {
    rates?: Record<string, number>;
    preferences?: InvoiceTransactionPreference[];
    overrides?: Map<string, Pick<EconomicRoleFields, "economicRole">>;
    month?: string;
  } = {},
) {
  const rates = options.rates ?? RATES;
  const preferences = options.preferences ?? [];
  const matches = matchInvoicesToTransactions(
    transactions,
    invoices,
    preferences,
    { exchangeRates: rates },
  );
  const { roles, statuses } = resolveInvoiceDedupe(
    invoices,
    transactions,
    matches,
    preferences,
    { today: "2026-08-31" },
  );
  const invoiceRoles = new Map(
    [...roles].map(([id, fields]) => {
      const override = options.overrides?.get(id);
      return [
        id,
        applyEconomicRoleOverride(
          fields,
          override ? { ...override, duplicateOf: null } : null,
        ),
      ];
    }),
  );
  const items = buildActivityItems(
    transactions,
    invoices,
    [],
    new Map(),
    matches,
    {
      roles: { invoices: invoiceRoles, invoiceMatches: statuses },
      exchangeRates: rates,
    },
  );
  const [summary] = summarizeActivityMonths(
    items,
    [options.month ?? "2026-07"],
    rates,
  );
  const byId = new Map(items.map((item) => [item.id, item]));
  return { matches, statuses, items, byId, summary };
}

describe("外幣發票的金額", () => {
  it("prefers the decimal invoice total, including tax beyond the items", () => {
    expect(
      preciseInvoiceAmount({
        amount: 10,
        currency: "USD",
        detailAmount: "10.98",
        itemsAmount: 10.98,
      }),
    ).toBe(10.98);
    // 品項 US$5、含稅總額 US$5.25：以發票總額為準。
    expect(
      preciseInvoiceAmount({
        amount: 5,
        currency: "USD",
        detailAmount: "5.25",
        itemsAmount: 5,
      }),
    ).toBe(5.25);
  });

  it("falls back to the item sum when the total is truncated too", () => {
    expect(
      preciseInvoiceAmount({
        amount: 88,
        currency: "USD",
        detailAmount: "88",
        itemsAmount: -16.41 + 105,
      }),
    ).toBe(88.59);
    // 品項加總與整數金額不一致時不採用。
    expect(
      preciseInvoiceAmount({
        amount: 88,
        currency: "USD",
        detailAmount: null,
        itemsAmount: 90.5,
      }),
    ).toBe(88);
  });

  it("keeps domestic invoices unchanged", () => {
    expect(
      preciseInvoiceAmount({
        amount: 120,
        currency: null,
        detailAmount: "120.4",
        itemsAmount: 120.4,
      }),
    ).toBe(120);
  });

  it("converts with the system rate and reports a missing rate", () => {
    expect(invoiceAmountTwd({ amount: 10.98, currency: "USD" }, RATES)).toBe(
      10.98 * 32.4,
    );
    expect(invoiceAmountTwd({ amount: 10.98, currency: "USD" }, {})).toBe(
      undefined,
    );
    expect(invoiceAmountTwd({ amount: 120, currency: "TWD" })).toBe(120);
  });

  it("exposes the original amount and the TWD conversion on the activity item", () => {
    const { byId } = run([], [usd("inv", "2026-07-27T09:10:00.000Z", 10.98)]);
    expect(byId.get("inv")).toMatchObject({
      amount: 10.98,
      currency: "USD",
      amountTwd: 355.75,
      invoiceAmount: 10.98,
    });
  });

  it("marks the summary incomplete when the rate is missing", () => {
    const { byId, summary } = run(
      [card("cf", "2026-07-27", -356, "CLOUDFLAREA3906 SAN FR")],
      [usd("inv", "2026-07-27T09:10:00.000Z", 10.98)],
      { rates: {} },
    );
    // 缺匯率：無從換算比對，不自動配對；刷卡照常計入。
    expect(byId.get("inv")).toMatchObject({
      matchStatus: "unmatched",
      amountTwd: null,
    });
    expect(summary.spending).toBe(356);
    expect(summary.complete).toBe(false);
    expect(summary.missingCurrencies).toEqual(["USD"]);
  });
});

describe("外幣發票與台幣刷卡配對", () => {
  it("pairs a USD invoice with the TWD card charge and counts it once", () => {
    const { byId, summary } = run(
      [
        card("cf", "2026-07-28", -356, "CLOUDFLAREA3906 SAN FR", {
          authorizedAt: "2026-07-27",
        }),
        card("fee", "2026-07-28", -6, "國外交易服務費－356.00", {
          authorizedAt: "2026-07-27",
        }),
      ],
      [usd("inv", "2026-07-27T09:10:00.000Z", 10.98)],
    );
    expect(byId.get("inv")).toMatchObject({
      matchStatus: "matched_card",
      matchedTransactionId: "cf",
      duplicateOf: { kind: "bank_transaction", id: "cf" },
    });
    expect(byId.get("cf")).toMatchObject({
      matchedInvoiceId: "inv",
      invoiceAmount: 356,
      invoiceCurrency: "USD",
      invoiceOriginalAmount: 10.98,
    });
    // 國外交易服務費不配發票。
    expect(byId.get("fee")).toMatchObject({ matchedInvoiceId: null });
    expect(summary.spending).toBe(356 + 6);
    expect(summary.duplicateExcluded).toBe(355.75);
    expect(summary.dedupe.invoicesMerged).toBe(1);
  });

  it.each([
    ["the amount differs by more than 5%", -380, "2026-07-27", "CLOUDFLARE"],
    [
      "the charge is 6 days after the invoice",
      -356,
      "2026-08-02",
      "CLOUDFLARE",
    ],
    [
      "the charge is 2 days before the invoice",
      -356,
      "2026-07-25",
      "CLOUDFLARE",
    ],
    ["the merchant differs", -356, "2026-07-27", "AMAZON WEB SERVICES"],
  ])("does not pair when %s", (_label, amount, day, description) => {
    const { byId, summary } = run(
      [card("tx", day, amount, description)],
      [usd("inv", "2026-07-27T09:10:00.000Z", 10.98)],
    );
    expect(byId.get("inv")).toMatchObject({ matchStatus: "unmatched" });
    expect(byId.get("inv")?.duplicateOf).toBeNull();
    if (day.startsWith("2026-07"))
      expect(summary.spending).toBeCloseTo(Math.abs(amount) + 355.75, 2);
  });

  it("accepts a charge up to 5 days later or 1 day earlier", () => {
    for (const day of ["2026-07-26", "2026-08-01"]) {
      const { byId } = run(
        [card("tx", day, -356, "CLOUDFLAREA3906 SAN FR")],
        [usd("inv", "2026-07-27T09:10:00.000Z", 10.98)],
      );
      expect(byId.get("inv")).toMatchObject({ matchStatus: "matched_card" });
    }
  });

  it("does not pair a foreign invoice with a deposit account outflow", () => {
    const { byId } = run(
      [
        card("tx", "2026-07-27", -356, "CLOUDFLARE", {
          accountType: "savings",
          accountId: "dep",
        }),
      ],
      [usd("inv", "2026-07-27T09:10:00.000Z", 10.98)],
    );
    expect(byId.get("inv")).toMatchObject({ matchStatus: "unmatched" });
  });

  it("compares a same-currency card charge in the original amount within 1%", () => {
    const matched = run(
      [
        card("tx", "2026-07-27", -10.98, "CLOUDFLARE", {
          currency: "USD",
        }),
      ],
      [usd("inv", "2026-07-27T09:10:00.000Z", 10.98)],
      { rates: {} },
    );
    expect(matched.byId.get("inv")).toMatchObject({
      matchStatus: "matched_card",
    });
    const tooFar = run(
      [card("tx", "2026-07-27", -11.2, "CLOUDFLARE", { currency: "USD" })],
      [usd("inv", "2026-07-27T09:10:00.000Z", 10.98)],
    );
    expect(tooFar.byId.get("inv")).toMatchObject({ matchStatus: "unmatched" });
  });

  it("counts a foreign-currency card charge in TWD in the summary", () => {
    const { byId, summary } = run(
      [card("tx", "2026-07-27", -20, "STEAM PURCHASE", { currency: "USD" })],
      [],
    );
    expect(byId.get("tx")).toMatchObject({ amountTwd: -648 });
    expect(summary.spending).toBe(648);
    const missing = run(
      [card("tx", "2026-07-27", -20, "STEAM PURCHASE", { currency: "USD" })],
      [],
      { rates: {} },
    );
    expect(missing.summary.complete).toBe(false);
  });
});

describe("同一筆消費重複開立的外幣發票", () => {
  const four = [
    usd("inv-1", "2026-07-27T09:10:21.000Z", 10.98),
    usd("inv-2", "2026-07-27T09:22:53.000Z", 10.98),
    usd("inv-3", "2026-07-27T09:28:07.000Z", 10.98),
    usd("inv-4", "2026-07-27T09:36:13.000Z", 10.98),
  ];

  it("keeps the paired invoice and holds back the repeats", () => {
    const { byId, summary } = run(
      [card("cf", "2026-07-27", -356, "CLOUDFLAREA3906 SAN FR")],
      four,
    );
    expect(byId.get("inv-1")).toMatchObject({
      matchStatus: "matched_card",
      matchedTransactionId: "cf",
    });
    for (const id of ["inv-2", "inv-3", "inv-4"])
      expect(byId.get(id)).toMatchObject({
        matchStatus: "ambiguous",
        economicRole: "spending",
        reviewStatus: "needs_review",
        roleReason: "invoice_repeat",
        duplicateOf: { kind: "invoice", id: "inv-1" },
      });
    // 只計刷卡一次；四張發票都列在重複排除。
    expect(summary.spending).toBe(356);
    expect(summary.duplicateExcluded).toBe(1423.01);
    expect(summary.dedupe).toEqual({
      invoicesMerged: 1,
      invoicesUnmatched: 0,
      invoicesAwaitingCard: 0,
      invoicesAmbiguous: 3,
    });
  });

  it("keeps the paired invoice even when it is not the first one", () => {
    const { byId } = run(
      [card("cf", "2026-07-27", -356, "CLOUDFLAREA3906 SAN FR")],
      four,
      {
        preferences: [
          { invoiceId: "inv-3", transactionId: "cf", decision: "linked" },
        ],
      },
    );
    expect(byId.get("inv-3")).toMatchObject({ matchStatus: "matched_card" });
    for (const id of ["inv-1", "inv-2", "inv-4"])
      expect(byId.get(id)).toMatchObject({
        roleReason: "invoice_repeat",
        duplicateOf: { kind: "invoice", id: "inv-3" },
      });
  });

  it("counts the first invoice when there is no payment record", () => {
    const { byId, summary } = run([], four.slice(0, 2));
    expect(byId.get("inv-1")).toMatchObject({
      matchStatus: "unmatched",
      roleReason: "invoice",
      duplicateOf: null,
    });
    expect(byId.get("inv-2")).toMatchObject({
      matchStatus: "ambiguous",
      reviewStatus: "needs_review",
      roleReason: "invoice_repeat",
      duplicateOf: { kind: "invoice", id: "inv-1" },
    });
    expect(summary.spending).toBe(355.75);
    expect(summary.duplicateExcluded).toBe(355.75);
  });

  it("pairs every invoice when each one has its own payment", () => {
    const { byId, summary } = run(
      [
        card("cf-a", "2026-07-27", -356, "CLOUDFLAREA3906 SAN FR"),
        card("cf-b", "2026-07-28", -356, "CLOUDFLAREA3906 SAN FR"),
      ],
      four.slice(0, 2),
    );
    expect(byId.get("inv-1")).toMatchObject({ matchStatus: "matched_card" });
    expect(byId.get("inv-2")).toMatchObject({ matchStatus: "matched_card" });
    expect(summary.spending).toBe(712);
  });

  it("lets the user decide: an override confirms, keeping it separate counts it", () => {
    const confirmed = run([], four.slice(0, 2), {
      overrides: new Map([["inv-2", { economicRole: "spending" }]]),
    });
    expect(confirmed.byId.get("inv-2")).toMatchObject({
      reviewStatus: "confirmed",
      roleReason: "override",
      duplicateOf: { kind: "invoice", id: "inv-1" },
    });
    expect(confirmed.summary.spending).toBe(355.75);

    const separate = run([], four.slice(0, 2), {
      preferences: [
        { invoiceId: "inv-2", transactionId: null, decision: "separate" },
      ],
    });
    expect(separate.byId.get("inv-2")).toMatchObject({
      reviewStatus: "confirmed",
      duplicateOf: null,
    });
    expect(separate.summary.spending).toBe(355.75 * 2);
  });

  it("groups only same seller, items, amount and currency within 24 hours", () => {
    const groups = invoiceRepeatGroups([
      usd("a", "2026-07-27T09:00:00.000Z", 10.98),
      usd("b", "2026-07-28T08:59:00.000Z", 10.98),
      // 超過第一張 24 小時。
      usd("c", "2026-07-28T09:01:00.000Z", 10.98),
      usd("d", "2026-07-27T10:00:00.000Z", 14.91),
      usd("e", "2026-07-27T10:00:00.000Z", 10.98, { itemsKey: "other" }),
      usd("f", "2026-07-27T10:00:00.000Z", 10.98, { sellerBan: "33334444" }),
      // 國內發票：同一家店隔天買同樣的東西是常態，不判重複。
      usd("g", "2026-07-27T03:00:00.000Z", 105, {
        currency: null,
        sellerBan: "55556666",
        itemsKey: "紅茶牛奶",
      }),
      usd("h", "2026-07-28T02:00:00.000Z", 105, {
        currency: null,
        sellerBan: "55556666",
        itemsKey: "紅茶牛奶",
      }),
    ]);
    expect(groups.map((group) => group.map(({ id }) => id))).toEqual([
      ["a", "b"],
    ]);
  });
});

describe("國外交易服務費的歸屬", () => {
  const base = {
    accountId: "card-1111",
    accountType: "credit",
    currency: "TWD",
  };

  it("reads the original TWD amount from the fee description", () => {
    expect(foreignFeeBaseAmount("國外交易服務費－479.00")).toBe(479);
    expect(foreignFeeBaseAmount("國外交易服務費-1,690.00")).toBe(1690);
    expect(foreignFeeBaseAmount("國外交易手續費")).toBeUndefined();
  });

  it("links the fee to the purchase with the stated amount on the same card", () => {
    const result = attributeForeignTransactionFees([
      {
        ...base,
        id: "cf",
        amount: -356,
        postedDate: "2026-07-27",
        description: "CLOUDFLAREA3906 SAN FR",
      },
      {
        ...base,
        id: "fee",
        amount: -6,
        postedDate: "2026-07-28",
        description: "國外交易服務費－356.00",
      },
      // 另一張卡同額：不考慮。
      {
        ...base,
        id: "other-card",
        accountId: "card-2222",
        amount: -356,
        postedDate: "2026-07-27",
        description: "SOMETHING",
      },
    ]);
    expect(result).toEqual(new Map([["fee", "cf"]]));
  });

  it("uses the 1.5% rate when the description has no amount", () => {
    const result = attributeForeignTransactionFees([
      {
        ...base,
        id: "claude",
        amount: -6451,
        postedDate: "2026-08-12",
        description: "ANTHROPIC* CLAUDE SUB",
      },
      {
        ...base,
        id: "fee",
        amount: -97,
        postedDate: "2026-08-12",
        description: "國外交易手續費",
      },
    ]);
    expect(result).toEqual(new Map([["fee", "claude"]]));
  });

  it("prefers the foreign merchant and leaves real ambiguity alone", () => {
    const preferred = attributeForeignTransactionFees([
      {
        ...base,
        id: "local",
        amount: -479,
        postedDate: "2026-07-13",
        description: "好食餐飲",
      },
      {
        ...base,
        id: "yt",
        amount: -479,
        postedDate: "2026-07-13",
        description: "GOOGLE*YOUTUBEPREMIUM",
      },
      {
        ...base,
        id: "fee",
        amount: -7,
        postedDate: "2026-07-13",
        description: "國外交易服務費－479.00",
      },
    ]);
    expect(preferred).toEqual(new Map([["fee", "yt"]]));
    const ambiguous = attributeForeignTransactionFees([
      {
        ...base,
        id: "a",
        amount: -479,
        postedDate: "2026-07-13",
        description: "GOOGLE*YOUTUBEPREMIUM",
      },
      {
        ...base,
        id: "b",
        amount: -479,
        postedDate: "2026-07-14",
        description: "SPOTIFY",
      },
      {
        ...base,
        id: "fee",
        amount: -7,
        postedDate: "2026-07-13",
        description: "國外交易服務費－479.00",
      },
    ]);
    expect(ambiguous.size).toBe(0);
    const tooFar = attributeForeignTransactionFees([
      {
        ...base,
        id: "a",
        amount: -479,
        postedDate: "2026-07-10",
        description: "GOOGLE*YOUTUBEPREMIUM",
      },
      {
        ...base,
        id: "fee",
        amount: -7,
        postedDate: "2026-07-13",
        description: "國外交易服務費－479.00",
      },
    ]);
    expect(tooFar.size).toBe(0);
  });
});
