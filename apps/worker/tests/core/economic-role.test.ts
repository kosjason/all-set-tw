import { describe, expect, it } from "vitest";
import {
  applyEconomicRoleOverride,
  deriveInvoiceEconomicRoles,
  deriveTransactionEconomicRole,
  matchInvoicesToTransactions,
  summarizeActivityMonths,
  taiwanBankCodeFromText,
  tradeInvestmentEventKind,
  type RoleTransaction,
  type SummaryActivity,
  type TransactionRoleSignals,
} from "@taiwan-fin-hub/core";

function role(signals: Partial<TransactionRoleSignals>) {
  return deriveTransactionEconomicRole({
    amount: -100,
    isCreditAccount: false,
    ...signals,
  });
}

describe("deriveTransactionEconomicRole", () => {
  it.each([
    [
      "user exclusion without other basis",
      { calculationPreference: "exclude" as const, categoryId: "food" },
      "own_transfer",
      "confirmed",
      "calculation_preference",
    ],
    [
      "user exclusion of a card payment",
      { calculationPreference: "exclude" as const, isCardPayment: true },
      "card_payment",
      "confirmed",
      "calculation_preference",
    ],
    [
      "user inclusion wins over own account and card rule",
      {
        calculationPreference: "include" as const,
        ownAccountKind: "own_account" as const,
        classificationRuleId: "system:bank:creditcard-payment",
      },
      "spending",
      "confirmed",
      "calculation_preference",
    ],
    [
      "declared own account",
      { ownAccountKind: "own_account" as const, categoryId: "transfer" },
      "own_transfer",
      "auto",
      "own_account",
    ],
    [
      "payment to an unsynced card is spending",
      { ownAccountKind: "unsynced_card" as const, isCardPayment: true },
      "spending",
      "auto",
      "unsynced_card",
    ],
    [
      "automatic transfer pair",
      {
        classificationSource: "auto_transfer" as const,
        categoryId: "transfer",
      },
      "own_transfer",
      "auto",
      "auto_transfer",
    ],
    [
      "card payment to a synced issuer named in the text",
      {
        classificationRuleId: "system:bank:creditcard-payment",
        categoryId: "transfer",
        text: "信用卡款 國泰世華卡",
        syncedCardIssuerCodes: new Set(["013"]),
      },
      "card_payment",
      "auto",
      "card_payment",
    ],
    [
      "card payment to a synced issuer by counterparty bank code",
      {
        isCardPayment: true,
        text: "繳信用卡費",
        counterpartyBankCode: "822",
        syncedCardIssuerCodes: new Set(["013", "822"]),
      },
      "card_payment",
      "auto",
      "card_payment",
    ],
    [
      "card payment to an issuer without a synced card",
      {
        isCardPayment: true,
        text: "信用卡款 中信卡",
        syncedCardIssuerCodes: new Set(["013"]),
      },
      "card_payment",
      "needs_review",
      "possible_unsynced_card",
    ],
    [
      "card payment whose issuer cannot be inferred",
      {
        classificationRuleId: "system:bank:creditcard-payment",
        text: "繳信用卡費",
        syncedCardIssuerCodes: new Set(["013"]),
      },
      "card_payment",
      "needs_review",
      "possible_unsynced_card",
    ],
    [
      "e-wallet top-up",
      { classificationRuleId: "system:bank:ewallet-topup" },
      "own_transfer",
      "auto",
      "ewallet_topup",
    ],
    [
      "investment rule role",
      { ruleEconomicRole: "investment" as const },
      "investment",
      "auto",
      "category",
    ],
    [
      "salary category",
      { categoryId: "income.salary", amount: 50000 },
      "income",
      "auto",
      "category",
    ],
    [
      "other exclusion (e.g. time deposit)",
      { excludedFromCalculation: true, categoryId: "other" },
      "own_transfer",
      "auto",
      "excluded",
    ],
    [
      "transfer to an unknown account",
      { transferHint: true },
      "spending",
      "needs_review",
      "sign",
    ],
    [
      "transfer in from an unknown account",
      { transferHint: true, amount: 162000 },
      "income",
      "needs_review",
      "sign",
    ],
    [
      "user rule with an own-transfer role",
      { ruleEconomicRole: "own_transfer" as const },
      "own_transfer",
      "auto",
      "rule",
    ],
    [
      "merchant rule role wins over system rules",
      {
        merchantEconomicRole: "own_transfer" as const,
        classificationRuleId: "system:bank:creditcard-payment",
      },
      "own_transfer",
      "confirmed",
      "merchant_rule",
    ],
    [
      "own account still wins over a merchant rule",
      {
        merchantEconomicRole: "spending" as const,
        ownAccountKind: "own_account" as const,
      },
      "own_transfer",
      "auto",
      "own_account",
    ],
    ["plain outflow", { categoryId: "food" }, "spending", "auto", "sign"],
    [
      "plain inflow",
      { categoryId: "other", amount: 20 },
      "income",
      "auto",
      "sign",
    ],
    [
      "credit card refund lowers spending instead of adding income",
      { isCreditAccount: true, amount: 300, text: "退款 某商店" },
      "spending",
      "auto",
      "sign",
    ],
    [
      "credit card payment received",
      { isCreditAccount: true, amount: 18000, text: "本行自動扣繳" },
      "card_payment",
      "auto",
      "card_payment",
    ],
  ])("%s", (_name, signals, economicRole, reviewStatus, roleReason) => {
    expect(role(signals)).toEqual({
      economicRole,
      reviewStatus,
      duplicateOf: null,
      investmentEventKind: null,
      roleReason,
    });
  });

  it("marks bank dividends but leaves settlement direction unknown", () => {
    expect(
      role({ ruleEconomicRole: "investment", amount: 800, text: "現金股利" })
        .investmentEventKind,
    ).toBe("dividend");
    expect(
      role({
        ruleEconomicRole: "investment",
        amount: -42000,
        text: "證券交割",
      }).investmentEventKind,
    ).toBeNull();
  });

  it("reads investment trade kinds from transaction names only", () => {
    expect(tradeInvestmentEventKind({ transactionName: "集保買進" })).toBe(
      "buy",
    );
    expect(tradeInvestmentEventKind({ transactionName: "賣出" })).toBe("sell");
    expect(tradeInvestmentEventKind({ transactionName: "配息" })).toBe(
      "dividend",
    );
    expect(tradeInvestmentEventKind({ transactionName: "匯撥" })).toBeNull();
  });
});

describe("taiwanBankCodeFromText", () => {
  it.each([
    ["信用卡款 國泰世華卡 信用卡款", "013"],
    ["國泰世華信用卡繳款", "013"],
    ["中信卡費", "822"],
    ["中國信託信用卡", "822"],
    ["臺灣銀行", "004"],
    ["台灣企銀", "050"],
    ["繳信用卡費", undefined],
    ["國泰轉中信", undefined],
  ])("%s → %s", (text, code) => {
    expect(taiwanBankCodeFromText(text)).toBe(code);
  });
});

describe("applyEconomicRoleOverride", () => {
  it("replaces the derived role and confirms it", () => {
    const derived = role({ categoryId: "transfer" });
    expect(
      applyEconomicRoleOverride(derived, {
        economicRole: "own_transfer",
        duplicateOf: null,
      }),
    ).toEqual({
      economicRole: "own_transfer",
      reviewStatus: "confirmed",
      duplicateOf: null,
      investmentEventKind: null,
      roleReason: "override",
    });
    expect(applyEconomicRoleOverride(derived, undefined)).toBe(derived);
  });

  it("keeps a derived duplicate unless the override names another one", () => {
    const derived = {
      ...role({}),
      duplicateOf: { kind: "bank_transaction" as const, id: "tx" },
    };
    expect(
      applyEconomicRoleOverride(derived, {
        economicRole: "spending",
        duplicateOf: null,
      }).duplicateOf,
    ).toEqual({ kind: "bank_transaction", id: "tx" });
    expect(
      applyEconomicRoleOverride(derived, {
        economicRole: "spending",
        duplicateOf: { kind: "bank_transaction", id: "other" },
      }).duplicateOf,
    ).toEqual({ kind: "bank_transaction", id: "other" });
  });
});

function tx(
  id: string,
  day: string,
  amount: number,
  extra: Partial<RoleTransaction> = {},
): RoleTransaction {
  return {
    id,
    connectorId: "test",
    sourceId: id,
    accountType: "credit",
    amount,
    currency: "TWD",
    postedDate: day,
    economicRole: "spending",
    duplicateOf: null,
    ...extra,
  };
}

describe("deriveInvoiceEconomicRoles", () => {
  it("points matched invoices at their transaction and flags ambiguous ones", () => {
    const transactions = [
      tx("meal", "2026-09-03", -1200),
      tx("shop-a", "2026-09-09", -3000),
      tx("shop-b", "2026-09-11", -3000),
      tx("topup", "2026-09-20", -4800, {
        accountType: "savings",
        description: "全支付儲值",
        economicRole: "own_transfer",
      }),
    ];
    const invoices = [
      { id: "inv-meal", invoiceDate: "2026-09-03", amount: 1200 },
      { id: "inv-ambiguous", invoiceDate: "2026-09-10", amount: 3000 },
      { id: "inv-wallet", invoiceDate: "2026-09-20", amount: 4800 },
      { id: "inv-separate", invoiceDate: "2026-09-09", amount: 3000 },
    ];
    const preferences = [
      {
        invoiceId: "inv-separate",
        transactionId: null,
        decision: "separate" as const,
      },
    ];
    const matches = matchInvoicesToTransactions(
      transactions,
      invoices,
      preferences,
    );
    const roles = deriveInvoiceEconomicRoles(
      invoices,
      transactions,
      matches,
      preferences,
    );
    expect(roles.get("inv-meal")).toMatchObject({
      economicRole: "spending",
      reviewStatus: "auto",
      duplicateOf: { kind: "bank_transaction", id: "meal" },
      roleReason: "invoice_matched",
    });
    expect(roles.get("inv-ambiguous")).toMatchObject({
      reviewStatus: "needs_review",
      duplicateOf: null,
      roleReason: "invoice_ambiguous",
    });
    // A top-up is an own transfer, never a duplicate of the e-wallet purchase.
    expect(roles.get("inv-wallet")).toMatchObject({
      reviewStatus: "auto",
      roleReason: "invoice",
    });
    expect(roles.get("inv-separate")).toMatchObject({
      reviewStatus: "confirmed",
      roleReason: "invoice",
    });
  });
});

function item(
  source: SummaryActivity["source"],
  date: string,
  amount: number,
  extra: Partial<SummaryActivity> = {},
): SummaryActivity {
  return {
    source,
    date,
    amount,
    currency: "TWD",
    economicRole: "spending",
    reviewStatus: "auto",
    duplicateOf: null,
    ...extra,
  };
}

describe("summarizeActivityMonths", () => {
  it("keeps non-spending roles, duplicates and other months out of spending", () => {
    const [september] = summarizeActivityMonths(
      [
        item("bank", "2026-09-01", 100000, { economicRole: "income" }),
        // 使用者自訂分類歸入「其他」；spendingBySubcategory 保留原本指定的 id。
        item("card", "2026-09-02", -1000, { categoryId: "user:pet" }),
        item("card", "2026-09-03", 200, { categoryId: "misc" }),
        item("invoice", "2026-09-04", 500),
        item("invoice", "2026-09-05", 1000, {
          duplicateOf: { kind: "bank_transaction", id: "x" },
        }),
        item("bank", "2026-09-06", -30000, { economicRole: "investment" }),
        item("bank", "2026-09-07", 2000, { economicRole: "investment" }),
        item("bank", "2026-09-08", -20000, { economicRole: "own_transfer" }),
        item("bank", "2026-09-08", 3000, { economicRole: "own_transfer" }),
        item("bank", "2026-09-09", -18000, { economicRole: "card_payment" }),
        item("card", "2026-09-10", 18000, { economicRole: "card_payment" }),
        item("bank", "2026-09-11", -27000, {
          reviewStatus: "needs_review",
        }),
        item("investment", "2026-09-12", -99999, {
          economicRole: "investment",
        }),
        item("card", "2026-08-31", -777, { categoryId: "food" }),
      ],
      ["2026-09"],
      {},
    );
    expect(september).toEqual({
      month: "2026-09",
      currency: "TWD",
      income: 100000,
      spending: 28300,
      investment: 28000,
      ownTransfer: 20000,
      cardPayment: 18000,
      saved: 71700,
      needsReview: { count: 1, amount: 27000 },
      duplicateExcluded: 1000,
      excludedAmount: 0,
      excludedCount: 0,
      spendingByCategory: { misc: 800, other: 27500 },
      spendingBySubcategory: {
        "user:pet": 1000,
        misc: -200,
        other: 27500,
      },
      complete: true,
      missingCurrencies: [],
      incompleteReasons: [],
      activityCount: 11,
      // 沒有 matchStatus 的項目：有 duplicateOf 視為已合併，其餘為未配對。
      dedupe: {
        invoicesMerged: 1,
        invoicesUnmatched: 1,
        invoicesAwaitingCard: 0,
        invoicesAmbiguous: 0,
      },
    });
  });

  it("converts foreign currencies and reports missing rates as incomplete", () => {
    const [summary] = summarizeActivityMonths(
      [
        item("card", "2026-09-01", -10, { currency: "USD", categoryId: "fee" }),
        item("card", "2026-09-02", -1000, {
          currency: "JPY",
          categoryId: "fee",
        }),
      ],
      ["2026-09"],
      { USD: 32.5 },
    );
    expect(summary).toMatchObject({
      spending: 325,
      complete: false,
      missingCurrencies: ["JPY"],
      incompleteReasons: ["missing_exchange_rates"],
    });
  });

  it("marks every month incomplete when role inputs failed to load", () => {
    const summaries = summarizeActivityMonths(
      [item("card", "2026-09-01", -10, { currency: "USD" })],
      ["2026-08", "2026-09"],
      {},
      ["role_overrides_unavailable", "classification_unavailable"],
    );
    expect(
      summaries.map(({ complete, incompleteReasons }) => ({
        complete,
        incompleteReasons,
      })),
    ).toEqual([
      {
        complete: false,
        incompleteReasons: [
          "classification_unavailable",
          "role_overrides_unavailable",
        ],
      },
      {
        complete: false,
        incompleteReasons: [
          "missing_exchange_rates",
          "classification_unavailable",
          "role_overrides_unavailable",
        ],
      },
    ]);
  });

  it("falls back to the legacy calculation for items without roles", () => {
    const [summary] = summarizeActivityMonths(
      [
        {
          source: "bank",
          date: "2026-09-01",
          amount: 500,
          currency: "TWD",
        },
        {
          source: "bank",
          date: "2026-09-02",
          amount: -200,
          currency: "TWD",
          excludedFromCalculation: true,
        },
      ],
      ["2026-09"],
      {},
    );
    expect(summary).toMatchObject({
      income: 500,
      spending: 0,
      ownTransfer: 200,
    });
  });
});
