import { describe, expect, it } from "vitest";
import {
  deduplicateBankTransactions,
  invoiceTransactionCandidates,
  matchInvoicesToTransactions,
} from "@/data/activity/matching";
import type { BankTransactionRow } from "@/data/bank/types";
import type { InvoiceSummaryRow } from "@/data/invoices/types";

function transaction(
  overrides: Partial<BankTransactionRow> = {},
): BankTransactionRow {
  return {
    id: "transaction-1",
    connectorId: "sinopac",
    accountId: "card-1",
    sourceId: "source-1",
    postedDate: "2026-07-10",
    authorizedAt: "2026-07-10T12:00:00.000Z",
    amount: -860,
    currency: "TWD",
    description: "信用卡消費",
    counterparty: "好食餐飲",
    status: "posted",
    excludedFromCalculation: false,
    ...overrides,
  };
}

function invoice(
  overrides: Partial<InvoiceSummaryRow> = {},
): InvoiceSummaryRow {
  return {
    id: "invoice-1",
    connectorId: "einvoice",
    sourceId: "invoice-source-1",
    invoiceDate: "2026-07-10",
    invoiceNumber: "AB12345678",
    sellerName: "好食餐飲有限公司",
    amount: 860,
    ...overrides,
  };
}

describe("invoice transaction matching", () => {
  it("matches the same day and amount without checking the merchant", () => {
    const result = matchInvoicesToTransactions(
      [transaction({ counterparty: "完全不同的商家" })],
      [invoice()],
    );

    expect(result.invoiceToTransactionId.get("invoice-1")).toBe(
      "transaction-1",
    );
    expect(result.transactionToInvoice.get("transaction-1")?.id).toBe(
      "invoice-1",
    );
  });

  it("matches a positive pending credit-card expense by absolute amount", () => {
    const result = matchInvoicesToTransactions(
      [transaction({ accountType: "credit", amount: 860 })],
      [invoice()],
    );

    expect(result.invoiceToTransactionId.get("invoice-1")).toBe(
      "transaction-1",
    );
  });

  it("does not auto-match a payment with a different amount", () => {
    const result = matchInvoicesToTransactions(
      [
        transaction({
          accountType: "credit",
          amount: -125,
          description: "連支×楓康超市",
        }),
      ],
      [invoice({ amount: 168 })],
    );

    expect(result.invoiceToTransactionId.size).toBe(0);
  });

  it("still offers same-day expenses with different amounts for manual mapping", () => {
    const transactions = [
      transaction({
        id: "pxpay-tea",
        accountType: "credit",
        postedDate: "2026-07-06T00:00:00.000Z",
        authorizedAt: undefined,
        amount: 37,
        description: "全支付﹘樂法 台中漢口店",
        counterparty: "全支付﹘樂法 台中漢口店",
      }),
      transaction({
        id: "linepay-dinner",
        accountType: "credit",
        postedDate: "2026-07-06",
        authorizedAt: undefined,
        amount: -265,
        description: "連支＊萬川雞飯．肉骨茶",
        counterparty: "連支＊萬川雞飯．肉骨茶",
      }),
    ];
    const targetInvoice = invoice({
      invoiceDate: "2026-07-06T04:39:18.000Z",
      sellerName: "菲尖極道商行",
      amount: 50,
    });
    const result = matchInvoicesToTransactions(transactions, [targetInvoice]);

    expect(result.invoiceToTransactionId.size).toBe(0);
    expect(
      invoiceTransactionCandidates(transactions, targetInvoice).map(
        ({ id }) => id,
      ),
    ).toEqual(["pxpay-tea", "linepay-dinner"]);
  });

  it("applies manual links before automatic matching", () => {
    const result = matchInvoicesToTransactions(
      [transaction()],
      [invoice({ sellerName: "不同商家", amount: 999 })],
      [
        {
          invoiceId: "invoice-1",
          transactionId: "transaction-1",
          decision: "linked",
          updatedAt: "2026-07-19T00:00:00.000Z",
        },
      ],
    );

    expect(result.invoiceToTransactionId.get("invoice-1")).toBe(
      "transaction-1",
    );
  });

  it("keeps an automatic match separate after the user unlinks it", () => {
    const result = matchInvoicesToTransactions(
      [transaction()],
      [invoice()],
      [
        {
          invoiceId: "invoice-1",
          transactionId: null,
          decision: "separate",
          updatedAt: "2026-07-19T00:00:00.000Z",
        },
      ],
    );

    expect(result.invoiceToTransactionId.size).toBe(0);
    expect(result.transactionToInvoice.size).toBe(0);
  });

  it("pairs ambiguous same-day amounts deterministically and one-to-one", () => {
    const result = matchInvoicesToTransactions(
      [
        transaction({
          id: "transaction-b",
          amount: -860,
        }),
        transaction({
          id: "transaction-a",
          amount: -860,
        }),
        transaction({ id: "transaction-c", amount: -860 }),
      ],
      [invoice({ id: "invoice-b" }), invoice({ id: "invoice-a" })],
    );

    expect(Array.from(result.invoiceToTransactionId)).toEqual([
      ["invoice-a", "transaction-a"],
      ["invoice-b", "transaction-b"],
    ]);
    expect(
      Array.from(result.transactionToInvoice, ([transactionId, row]) => [
        transactionId,
        row.id,
      ]),
    ).toEqual([
      ["transaction-a", "invoice-a"],
      ["transaction-b", "invoice-b"],
    ]);
    expect(result.transactionToInvoice.has("transaction-c")).toBe(false);
  });

  it("does not treat a positive bank deposit as an expense match", () => {
    const result = matchInvoicesToTransactions(
      [transaction({ accountType: "checking", amount: 860 })],
      [invoice()],
    );

    expect(result.invoiceToTransactionId.size).toBe(0);
  });

  it("uses the authorization day when the posting day differs", () => {
    const result = matchInvoicesToTransactions(
      [
        transaction({
          postedDate: "2026-07-11",
          authorizedAt: "2026-07-10T12:00:00.000Z",
        }),
      ],
      [invoice()],
    );

    expect(result.invoiceToTransactionId.get("invoice-1")).toBe(
      "transaction-1",
    );
  });

  it("uses the Taipei calendar day for ISO timestamps near midnight", () => {
    // UTC 07-09 but Taipei 07-10: four Taipei days after the invoice.
    const outsideWindow = transaction({
      accountType: "credit",
      postedDate: "2026-07-09T16:00:00.000Z",
      authorizedAt: "2026-07-09T16:00:00.000Z",
      amount: -50,
    });
    const targetInvoice = invoice({
      invoiceDate: "2026-07-06T04:39:18.000Z",
      amount: 50,
    });

    expect(
      matchInvoicesToTransactions([outsideWindow], [targetInvoice])
        .invoiceToTransactionId.size,
    ).toBe(0);
    expect(
      invoiceTransactionCandidates([outsideWindow], targetInvoice),
    ).toEqual([]);
    expect(
      matchInvoicesToTransactions([outsideWindow], [targetInvoice], [], {
        dayWindow: 0,
      }).invoiceToTransactionId.size,
    ).toBe(0);
  });

  it("uses the posted-date prefix for a legacy transaction without authorization time", () => {
    const legacy = transaction({
      accountType: "credit",
      postedDate: "2026-07-06T16:00:00.000Z",
      authorizedAt: undefined,
      amount: 50,
    });
    const targetInvoice = invoice({
      invoiceDate: "2026-07-06T04:39:18.000Z",
      amount: 50,
    });

    expect(
      invoiceTransactionCandidates([legacy], targetInvoice).map(({ id }) => id),
    ).toEqual(["transaction-1"]);
  });

  it("does not match when the amount or date differs", () => {
    expect(
      matchInvoicesToTransactions([transaction({ amount: -861 })], [invoice()])
        .invoiceToTransactionId.size,
    ).toBe(0);
    expect(
      matchInvoicesToTransactions(
        [transaction({ postedDate: "2026-07-20", authorizedAt: undefined })],
        [invoice()],
      ).invoiceToTransactionId.size,
    ).toBe(0);
  });

  it("does not match a non-TWD transaction", () => {
    const result = matchInvoicesToTransactions(
      [transaction({ currency: "USD" })],
      [invoice()],
    );

    expect(result.invoiceToTransactionId.size).toBe(0);
  });
});

describe("tolerant invoice transaction matching", () => {
  const onDay = (day: string, overrides: Partial<BankTransactionRow> = {}) =>
    transaction({
      postedDate: day,
      authorizedAt: `${day}T04:00:00.000Z`,
      ...overrides,
    });

  it("pairs a unique same-amount expense a few days after the invoice", () => {
    const result = matchInvoicesToTransactions(
      [
        onDay("2026-07-12", {
          id: "card",
          accountType: "credit",
          description: "統一超商",
        }),
      ],
      [invoice({ sellerName: "統一超商股份有限公司" })],
    );

    expect(result.invoiceToTransactionId.get("invoice-1")).toBe("card");
  });

  it("does not pair beyond three days or in same-day-only mode", () => {
    expect(
      matchInvoicesToTransactions([onDay("2026-07-14")], [invoice()])
        .invoiceToTransactionId.size,
    ).toBe(0);
    expect(
      matchInvoicesToTransactions([onDay("2026-07-11")], [invoice()], [], {
        dayWindow: 0,
      }).invoiceToTransactionId.size,
    ).toBe(0);
  });

  it("leaves an invoice unmatched when two expenses tie at the same gap", () => {
    const result = matchInvoicesToTransactions(
      [
        onDay("2026-07-09", { id: "before" }),
        onDay("2026-07-11", { id: "after" }),
      ],
      [invoice()],
    );

    expect(result.invoiceToTransactionId.size).toBe(0);
    expect(result.transactionToInvoice.size).toBe(0);
  });

  it("leaves an expense unmatched when two invoices compete for it", () => {
    const result = matchInvoicesToTransactions(
      [onDay("2026-07-11")],
      [
        invoice({ id: "invoice-a", invoiceDate: "2026-07-10" }),
        invoice({ id: "invoice-b", invoiceDate: "2026-07-12" }),
      ],
    );

    expect(result.invoiceToTransactionId.size).toBe(0);
  });

  it("prefers the expense with the smallest day gap", () => {
    const transactions = [
      onDay("2026-07-13", { id: "three-days" }),
      onDay("2026-07-11", { id: "one-day" }),
    ];
    const result = matchInvoicesToTransactions(transactions, [invoice()]);

    expect(result.invoiceToTransactionId.get("invoice-1")).toBe("one-day");
    expect(
      matchInvoicesToTransactions([...transactions].reverse(), [
        invoice(),
      ]).invoiceToTransactionId.get("invoice-1"),
    ).toBe("one-day");
  });

  it("keeps same-day exact matches ahead of nearby candidates", () => {
    const result = matchInvoicesToTransactions(
      [onDay("2026-07-11", { id: "next-day" }), onDay("2026-07-10")],
      [invoice()],
    );

    expect(result.invoiceToTransactionId.get("invoice-1")).toBe(
      "transaction-1",
    );
    expect(result.transactionToInvoice.has("next-day")).toBe(false);
  });

  it("skips refunds, excluded expenses and e-wallet top-ups", () => {
    for (const candidate of [
      onDay("2026-07-11", { accountType: "credit", amount: 860 }),
      onDay("2026-07-11", { excludedFromCalculation: true }),
      onDay("2026-07-11", {
        accountType: "checking",
        description: "電支交易 街口儲值 P123456",
      }),
    ])
      expect(
        matchInvoicesToTransactions([candidate], [invoice()])
          .invoiceToTransactionId.size,
      ).toBe(0);
    expect(
      matchInvoicesToTransactions(
        [
          onDay("2026-07-10", {
            accountType: "checking",
            description: "電支交易 連加電支儲值 P123456",
          }),
        ],
        [invoice()],
      ).invoiceToTransactionId.size,
    ).toBe(0);
  });

  it("pairs a foreign card charge whose amount differs by FX conversion", () => {
    const cases: Array<[string, number, string, number]> = [
      ["OpenAI OpCo, LLC", 3300, "OPENAI *CHATGPT SUBSCRO6882 OPENAI", -3352],
      ["GoDaddy.com, LLC", 12999, "GODADDY.COM 480-5058855 AZ", -12650],
      ["Valve Corporation", 205, "STEAMGAMES.COM 4259522O4609 BELLEV", -214],
      ["Valve Corporation", 223, "WL *STEAM PURCHASEBELLEV", -230],
      ["Anthropic PBC", 210, "CLAUDE.AI SUBSCRIPTIONANTHROPIC.COM", -216],
      [
        "Google Asia Pacific Pte Ltd",
        198,
        "GOOGLE *YouTubePremiumSINGAP",
        -190,
      ],
    ];
    for (const [sellerName, amount, description, cardAmount] of cases) {
      const result = matchInvoicesToTransactions(
        [
          onDay("2026-07-11", {
            accountType: "credit",
            amount: cardAmount,
            description,
            counterparty: description,
          }),
          onDay("2026-07-11", {
            id: "fee",
            accountType: "credit",
            amount: -Math.round(Math.abs(cardAmount) * 0.015),
            description: `國外交易服務費－${Math.abs(cardAmount)}.00`,
            counterparty: `國外交易服務費－${Math.abs(cardAmount)}.00`,
          }),
        ],
        [invoice({ sellerName, amount })],
      );

      expect(result.invoiceToTransactionId.get("invoice-1"), sellerName).toBe(
        "transaction-1",
      );
    }
  });

  it("does not fuzzy-pair a different merchant, a bank debit or a large gap", () => {
    const openAiInvoice = invoice({
      sellerName: "OpenAI OpCo, LLC",
      amount: 3300,
    });
    const card = (overrides: Partial<BankTransactionRow>) =>
      onDay("2026-07-11", {
        accountType: "credit",
        amount: -3320,
        description: "OPENAI *CHATGPT SUBSCRO6882 OPENAI",
        counterparty: "OPENAI *CHATGPT SUBSCRO6882 OPENAI",
        ...overrides,
      });

    for (const candidate of [
      card({
        description: "ANTHROPIC CLAUDE",
        counterparty: "ANTHROPIC CLAUDE",
      }),
      card({ description: "統一超商", counterparty: "統一超商" }),
      card({ accountType: "checking" }),
      card({ amount: -3500 }),
      card({ postedDate: "2026-07-14", authorizedAt: undefined }),
    ])
      expect(
        matchInvoicesToTransactions([candidate], [openAiInvoice])
          .invoiceToTransactionId.size,
      ).toBe(0);
  });

  it("leaves a foreign invoice unmatched when two charges fit", () => {
    const result = matchInvoicesToTransactions(
      [
        onDay("2026-07-11", {
          id: "steam-a",
          accountType: "credit",
          amount: -214,
          description: "STEAMGAMES.COM BELLEV",
        }),
        onDay("2026-07-09", {
          id: "steam-b",
          accountType: "credit",
          amount: -210,
          description: "WL *STEAM PURCHASE",
        }),
      ],
      [invoice({ sellerName: "Valve Corporation", amount: 205 })],
    );

    expect(result.invoiceToTransactionId.size).toBe(0);
  });

  it("lets a merchant name resolve an exact-amount tie across days", () => {
    const result = matchInvoicesToTransactions(
      [
        onDay("2026-07-11", {
          id: "steam",
          accountType: "credit",
          amount: -205,
          description: "STEAMGAMES.COM BELLEV",
        }),
        onDay("2026-07-09", {
          id: "other",
          accountType: "credit",
          amount: -205,
          description: "全家便利商店",
        }),
      ],
      [invoice({ sellerName: "Valve Corporation", amount: 205 })],
    );

    expect(result.invoiceToTransactionId.get("invoice-1")).toBe("steam");
  });

  it("keeps manual links and separations ahead of tolerant matching", () => {
    const transactions = [
      onDay("2026-07-11", { id: "nearby" }),
      onDay("2026-07-20", { id: "manual", amount: -999 }),
    ];

    const linked = matchInvoicesToTransactions(
      transactions,
      [invoice()],
      [
        {
          invoiceId: "invoice-1",
          transactionId: "manual",
          decision: "linked",
        },
      ],
    );
    expect(linked.invoiceToTransactionId.get("invoice-1")).toBe("manual");
    expect(linked.transactionToInvoice.has("nearby")).toBe(false);

    const separate = matchInvoicesToTransactions(
      transactions,
      [invoice()],
      [{ invoiceId: "invoice-1", transactionId: null, decision: "separate" }],
    );
    expect(separate.invoiceToTransactionId.size).toBe(0);

    const linkedElsewhere = matchInvoicesToTransactions(
      transactions,
      [invoice(), invoice({ id: "invoice-2", invoiceDate: "2026-07-20" })],
      [
        {
          invoiceId: "invoice-2",
          transactionId: "nearby",
          decision: "linked",
        },
      ],
    );
    expect(linkedElsewhere.invoiceToTransactionId.has("invoice-1")).toBe(false);
  });

  it("lists nearby expenses as manual candidates, closest amount and day first", () => {
    const transactions = [
      onDay("2026-07-13", { id: "three-days" }),
      onDay("2026-07-10", { id: "same-day-other", amount: -900 }),
      onDay("2026-07-11", { id: "one-day" }),
      onDay("2026-07-14", { id: "too-far" }),
    ];

    expect(
      invoiceTransactionCandidates(transactions, invoice()).map(({ id }) => id),
    ).toEqual(["one-day", "three-days", "same-day-other"]);
  });
});

describe("bank transaction deduplication", () => {
  it("prefers the posted E.SUN lifecycle copy and lets its invoice match", () => {
    const pending = transaction({
      id: "pending",
      connectorId: "esun",
      sourceId:
        "2026-07-05T00:00:00.000Z:credit:esun:1204:全支付﹘全聯:252:TWD:未入帳:1",
      accountType: "credit",
      postedDate: "2026-07-05T00:00:00.000Z",
      authorizedAt: "2026-07-05T00:00:00.000Z",
      amount: 252,
      description: "全支付﹘全聯",
      counterparty: "全支付﹘全聯",
    });
    const posted = transaction({
      ...pending,
      id: "posted",
      sourceId: pending.sourceId.replace("未入帳", "已入帳"),
    });
    const transactions = deduplicateBankTransactions([pending, posted]);

    expect(transactions.map(({ id }) => id)).toEqual(["posted"]);
    expect(
      matchInvoicesToTransactions(transactions, [
        invoice({
          invoiceDate: "2026-07-05T14:41:11.000Z",
          sellerName: "全聯實業股份有限公司台中旅順分公司",
          amount: 252,
        }),
      ]).invoiceToTransactionId.get("invoice-1"),
    ).toBe("posted");
  });

  it("keeps distinct occurrences and unrelated connectors", () => {
    const first = transaction({
      id: "first",
      connectorId: "esun",
      sourceId: "same:已入帳:1",
    });
    const second = transaction({
      id: "second",
      connectorId: "esun",
      sourceId: "same:已入帳:2",
    });
    const unrelated = transaction({ id: "unrelated", connectorId: "tdcc" });

    expect(
      deduplicateBankTransactions([first, second, unrelated]).map(
        ({ id }) => id,
      ),
    ).toEqual(["first", "second", "unrelated"]);
  });
});
