import { describe, expect, it } from "vitest";
import type { BankTransactionRow } from "@/data/bank/types";
import type { InvoiceSummaryRow } from "@/data/invoices/types";
import {
  activityInvoiceDifference,
  activityInvoiceTwd,
  activitySourceLabel,
  bankTransactionMerchant,
  foreignFeeLabel,
  invoiceAmountText,
  invoiceTransactionDifference,
} from "./labels";
import type { ActivityItem } from "./types";

const item: ActivityItem = {
  id: "a",
  source: "bank",
  date: "2026-09-04",
  title: "活動",
  subtitle: "",
  amount: -90,
  currency: "TWD",
  category: "餐飲",
  status: "posted",
};

describe("activity labels", () => {
  it("labels sources and marks linked invoices", () => {
    expect(activitySourceLabel(item)).toBe("銀行");
    expect(activitySourceLabel({ ...item, invoiceId: "i" })).toBe("銀行＋發票");
    expect(
      activitySourceLabel({ ...item, source: "invoice", invoiceId: "i" }),
    ).toBe("發票");
  });

  it("computes the invoice difference only when both amounts exist", () => {
    expect(activityInvoiceDifference({ ...item, invoiceAmount: 100 })).toBe(10);
    expect(activityInvoiceDifference(item)).toBe(0);
  });

  it("names transactions and compares them to invoices", () => {
    const transaction = {
      amount: -90,
      description: "刷卡消費",
    } as BankTransactionRow;
    expect(bankTransactionMerchant(transaction)).toBe("刷卡消費");
    expect(
      bankTransactionMerchant({ ...transaction, counterparty: "全聯" }),
    ).toBe("全聯");
    expect(
      bankTransactionMerchant({ ...transaction, description: undefined }),
    ).toBe("銀行交易");
    expect(
      invoiceTransactionDifference(
        { amount: 100 } as InvoiceSummaryRow,
        transaction,
      ),
    ).toBe(10);
  });
});

describe("foreign-currency invoices", () => {
  it("shows the original amount with the TWD conversion", () => {
    expect(invoiceAmountText(10.98, "USD", 356)).toBe("US$10.98（≈NT$356）");
    expect(invoiceAmountText(10.98, "USD", null)).toBe("US$10.98");
    expect(invoiceAmountText(120, "TWD", 120)).toBe("NT$120");
    expect(invoiceAmountText(120, undefined)).toBe("NT$120");
  });

  it("takes the TWD value from the invoice or the matched card item", () => {
    expect(
      activityInvoiceTwd({
        ...item,
        source: "invoice",
        currency: "USD",
        amount: 10.98,
        amountTwd: 356,
      }),
    ).toBe(356);
    expect(
      activityInvoiceTwd({
        ...item,
        source: "card",
        invoiceId: "inv",
        invoiceAmount: 356,
        invoiceCurrency: "USD",
        invoiceOriginalAmount: 10.98,
      }),
    ).toBe(356);
    expect(activityInvoiceTwd({ ...item, invoiceAmount: 90 })).toBeUndefined();
  });

  it("does not report an exchange-rate gap as a points discount", () => {
    expect(
      activityInvoiceDifference({
        ...item,
        amount: -360,
        invoiceAmount: 356,
        invoiceCurrency: "USD",
      }),
    ).toBe(0);
    expect(
      invoiceTransactionDifference(
        { id: "i", amount: 10.98, currency: "USD" } as InvoiceSummaryRow,
        { amount: -356 } as BankTransactionRow,
      ),
    ).toBe(0);
  });

  it("names the purchase a foreign transaction fee belongs to", () => {
    const purchase: ActivityItem = {
      ...item,
      id: "tx-claude",
      transactionId: "tx-claude",
      title: "CLAUDE.AI SUBSCRIPTION",
      displayName: "Claude",
    };
    const fee: ActivityItem = {
      ...item,
      id: "tx-fee",
      transactionId: "tx-fee",
      title: "國外交易服務費",
      foreignFeeOf: "tx-claude",
    };
    expect(foreignFeeLabel(fee, [purchase, fee])).toBe(
      "屬於 Claude 的國外交易服務費",
    );
    expect(foreignFeeLabel(fee, [fee])).toBe("國外交易服務費");
    expect(foreignFeeLabel(purchase, [purchase])).toBeUndefined();
  });
});
