import { describe, expect, it } from "vitest";
import type { BankTransactionRow } from "@/data/bank/types";
import {
  cardIdentity,
  groupByCard,
  invoiceItemsPreview,
  invoiceMatchStatus,
  transactionCardLast4,
} from "./source-tabs";
import type { ActivityItem } from "./types";

const base: ActivityItem = {
  id: "x",
  source: "card",
  date: "2026-09-01",
  title: "刷卡",
  subtitle: "",
  amount: -100,
  currency: "TWD",
  category: "餐飲",
  status: "posted",
};
const card = { ...base, id: "tx-card", transactionId: "tx-card" };
const bank = {
  ...base,
  id: "tx-bank",
  source: "bank" as const,
  transactionId: "tx-bank",
};
const invoice = (overrides: Partial<ActivityItem>): ActivityItem => ({
  ...base,
  id: "inv",
  source: "invoice",
  invoiceId: "inv",
  ...overrides,
});

describe("invoice match status", () => {
  it("derives the status from duplicateOf and roleReason", () => {
    const all = [card, bank];
    expect(
      invoiceMatchStatus(
        invoice({ duplicateOf: { kind: "bank_transaction", id: "tx-card" } }),
        all,
      ).label,
    ).toBe("已對應刷卡");
    expect(
      invoiceMatchStatus(
        invoice({ duplicateOf: { kind: "bank_transaction", id: "tx-bank" } }),
        all,
      ).label,
    ).toBe("已對應銀行／電支");
    expect(
      invoiceMatchStatus(invoice({ roleReason: "invoice_ambiguous" }), all)
        .label,
    ).toBe("疑似重複");
    expect(invoiceMatchStatus(invoice({}), all).label).toBe("未對應");
  });

  it("prefers the backend matchStatus when present", () => {
    const withStatus = (matchStatus: string) =>
      invoice({ matchStatus } as Partial<ActivityItem>);
    expect(invoiceMatchStatus(withStatus("awaiting_card"), []).label).toBe(
      "等待刷卡入帳",
    );
    expect(invoiceMatchStatus(withStatus("matched_bank"), []).label).toBe(
      "已對應銀行／電支",
    );
    expect(invoiceMatchStatus(withStatus("ambiguous"), []).label).toBe(
      "疑似重複",
    );
    expect(invoiceMatchStatus(withStatus("something-new"), []).label).toBe(
      "未對應",
    );
  });

  it("reads up to three preview items", () => {
    expect(
      invoiceItemsPreview(
        invoice({
          itemsPreview: ["a", "", "b", "c", "d"],
        } as Partial<ActivityItem>),
      ),
    ).toEqual(["a", "b", "c"]);
    expect(invoiceItemsPreview(invoice({}))).toBeUndefined();
  });
});

describe("card grouping", () => {
  const tx = (overrides: Partial<BankTransactionRow>) =>
    ({
      id: "t",
      connectorId: "taishin",
      accountId: "acc",
      sourceId: "s",
      amount: -1,
      currency: "TWD",
      status: "posted",
      excludedFromCalculation: false,
      institutionName: "台新銀行",
      accountName: "信用卡",
      accountLast4: "1234",
      ...overrides,
    }) as BankTransactionRow;

  it("prefers a transaction-level card number over the account's", () => {
    expect(transactionCardLast4(tx({}))).toBe("1234");
    expect(
      transactionCardLast4(
        tx({ cardLast4: "4444" } as Partial<BankTransactionRow>),
      ),
    ).toBe("4444");
    expect(transactionCardLast4(tx({ accountLast4: "12" }))).toBeUndefined();
    expect(transactionCardLast4(undefined)).toBeUndefined();
  });

  it("groups card records by card and counts pending ones", () => {
    const items = [
      { ...card, id: "a", status: "pending" },
      { ...card, id: "b" },
      { ...card, id: "c" },
    ];
    const transactions: Record<string, BankTransactionRow> = {
      a: tx({ id: "a" }),
      b: tx({ id: "b", accountId: "acc-2", accountLast4: "5678" }),
      c: tx({ id: "c" }),
    };
    const groups = groupByCard(items, (item) =>
      cardIdentity(item, transactions[item.id]),
    );
    expect(
      groups.map(({ name, last4, items, pendingCount }) => ({
        name,
        last4,
        ids: items.map((item) => item.id),
        pendingCount,
      })),
    ).toEqual([
      {
        name: "台新銀行 信用卡",
        last4: "1234",
        ids: ["a", "c"],
        pendingCount: 1,
      },
      { name: "台新銀行 信用卡", last4: "5678", ids: ["b"], pendingCount: 0 },
    ]);
  });
});
