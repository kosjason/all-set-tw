import { describe, expect, it } from "vitest";
import {
  canCategorize,
  categorizeRequest,
  categorizeTarget,
  merchantPromptText,
  merchantSiblingCount,
} from "./categorize";
import type { ActivityItem } from "./types";

const card: ActivityItem = {
  id: "tx-1",
  source: "card",
  date: "2026-09-04",
  title: "STARBUCKS 信義",
  subtitle: "",
  amount: -150,
  currency: "TWD",
  category: "未分類",
  categoryId: "other",
  status: "posted",
  transactionId: "tx-1",
  merchantKey: "ban:12345678",
  displayName: "星巴克",
};
const cashInvoice: ActivityItem = {
  ...card,
  id: "inv-1",
  source: "invoice",
  transactionId: undefined,
  invoiceId: "inv-1",
  title: "統一星巴克",
};

describe("categorize targets", () => {
  it("categorizes transactions and unmatched invoices directly", () => {
    expect(categorizeTarget(card)).toEqual({
      targetKind: "bank_transaction",
      targetId: "tx-1",
    });
    expect(categorizeTarget(cashInvoice)).toEqual({
      targetKind: "invoice",
      targetId: "inv-1",
    });
    expect(canCategorize(cashInvoice)).toBe(true);
  });

  it("writes a matched invoice to its transaction so both share one category", () => {
    expect(
      categorizeTarget({
        ...cashInvoice,
        duplicateOf: { kind: "bank_transaction", id: "tx-1" },
      }),
    ).toEqual({ targetKind: "bank_transaction", targetId: "tx-1" });
  });

  it("does not categorize investment trades", () => {
    expect(
      canCategorize({
        ...card,
        source: "investment",
        transactionId: undefined,
      }),
    ).toBe(false);
  });

  it("builds the categorize body with the merchant key", () => {
    expect(categorizeRequest(cashInvoice, "food", true)).toEqual({
      targets: [{ kind: "invoice", id: "inv-1", merchantKey: "ban:12345678" }],
      categoryId: "food",
      applyToMerchant: true,
    });
  });
});

describe("merchant prompt", () => {
  it("counts other activities of the merchant that are not user overrides", () => {
    const items: ActivityItem[] = [
      card,
      cashInvoice,
      {
        ...cashInvoice,
        id: "inv-2",
        invoiceId: "inv-2",
        categorySource: "user",
      },
      {
        ...cashInvoice,
        id: "inv-3",
        invoiceId: "inv-3",
        duplicateOf: { kind: "bank_transaction", id: "tx-9" },
      },
      { ...card, id: "tx-2", transactionId: "tx-2", merchantKey: "name:other" },
    ];
    expect(merchantSiblingCount(items, card)).toBe(1);
    expect(
      merchantSiblingCount(items, { ...card, merchantKey: undefined }),
    ).toBe(0);
  });

  it("asks with the display name and category", () => {
    expect(merchantPromptText(card, "餐飲", 3)).toBe(
      "將『星巴克』的其他 3 筆也設為「餐飲」，並記住這個商家？",
    );
    expect(merchantPromptText(card, "餐飲", 0)).toBe(
      "記住『星巴克』，之後的交易也設為「餐飲」？",
    );
  });
});
