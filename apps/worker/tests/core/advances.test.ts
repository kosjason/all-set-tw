import { describe, expect, it } from "vitest";
import {
  ADVANCE_COUNTERPARTY_MAX_LENGTH,
  applyEconomicRoleOverride,
  carryInvoiceAdvancesToTransactions,
  matchInvoicesToTransactions,
  resolveInvoiceDedupe,
  normalizeAdvanceCounterparty,
  RULE_ECONOMIC_ROLES,
  summarizeActivityMonths,
  summarizeAdvances,
  type SummaryActivity,
} from "@taiwan-fin-hub/shared";

type Item = Parameters<typeof summarizeAdvances>[0][number];

let seq = 0;
function item(
  source: SummaryActivity["source"],
  date: string,
  amount: number,
  extra: Partial<Item> = {},
): Item {
  seq += 1;
  return {
    id: `t${seq}`,
    title: `活動 ${seq}`,
    status: "posted",
    source,
    date,
    amount,
    currency: "TWD",
    categoryId: "other",
    economicRole: "advance",
    reviewStatus: "confirmed",
    duplicateOf: null,
    advanceCounterparty: "Irene",
    ...extra,
  };
}

describe("advance roles", () => {
  it("are override-only roles that carry a counterparty", () => {
    expect(RULE_ECONOMIC_ROLES as readonly string[]).not.toContain("advance");
    expect(RULE_ECONOMIC_ROLES as readonly string[]).not.toContain(
      "reimbursement",
    );
    const base = {
      economicRole: "spending" as const,
      reviewStatus: "auto" as const,
      duplicateOf: null,
      investmentEventKind: null,
      roleReason: "sign" as const,
    };
    expect(
      applyEconomicRoleOverride(base, {
        economicRole: "advance",
        duplicateOf: null,
        counterparty: "Irene",
      }),
    ).toMatchObject({ economicRole: "advance", advanceCounterparty: "Irene" });
    expect(
      applyEconomicRoleOverride(base, {
        economicRole: "excluded",
        duplicateOf: null,
        counterparty: "Irene",
      }),
    ).not.toHaveProperty("advanceCounterparty");
  });

  it("normalizes counterparty names", () => {
    expect(normalizeAdvanceCounterparty("  Ｉrene   Lin ")).toBe("Irene Lin");
    expect(normalizeAdvanceCounterparty("   ")).toBeNull();
    expect(normalizeAdvanceCounterparty(null)).toBeNull();
    expect(
      normalizeAdvanceCounterparty(
        "王".repeat(ADVANCE_COUNTERPARTY_MAX_LENGTH),
      ),
    ).toHaveLength(ADVANCE_COUNTERPARTY_MAX_LENGTH);
    expect(
      normalizeAdvanceCounterparty(
        "王".repeat(ADVANCE_COUNTERPARTY_MAX_LENGTH + 1),
      ),
    ).toBeNull();
  });
});

describe("summarizeActivityMonths with advances", () => {
  it("counts advances after de-duplication and never as income or spending", () => {
    const [month] = summarizeActivityMonths(
      [
        item("card", "2026-09-29", -31300),
        // 已配對到同一筆刷卡的發票是重複項目，不再計入代墊。
        item("invoice", "2026-09-29", 31300, {
          duplicateOf: { kind: "bank_transaction", id: "t1" },
        }),
        item("bank", "2026-09-30", 31520, { economicRole: "reimbursement" }),
        item("card", "2026-09-30", -200, { economicRole: "spending" }),
      ],
      ["2026-09"],
      {},
    );
    expect(month).toMatchObject({
      spending: 200,
      income: 0,
      saved: -200,
      advanceAmount: 31300,
      advanceCount: 1,
      reimbursementAmount: 31520,
      reimbursementCount: 1,
      activityCount: 1,
    });
  });
});

describe("summarizeAdvances", () => {
  it("nets advances, refunds and repayments per counterparty", () => {
    const [irene, bob] = summarizeAdvances([
      item("card", "2026-09-01", -1000),
      // 代墊的商品退款沖減待收回。
      item("card", "2026-09-05", 200),
      item("bank", "2026-09-10", 500, { economicRole: "reimbursement" }),
      item("card", "2026-09-02", -300, { advanceCounterparty: "Bob" }),
    ]);
    expect(irene).toMatchObject({
      name: "Irene",
      balances: { TWD: 300 },
      advanced: { TWD: 800 },
      reimbursed: { TWD: 500 },
      lastDay: "2026-09-10",
    });
    expect(irene!.entries.map((entry) => entry.receivableDelta)).toEqual([
      -500, -200, 1000,
    ]);
    expect(bob).toMatchObject({ balances: { TWD: 300 } });
  });

  it("keeps currencies apart and treats invoices as outflows", () => {
    const [group] = summarizeAdvances([
      item("invoice", "2026-09-01", 25, { currency: "USD" }),
      item("card", "2026-09-02", -800),
    ]);
    expect(group!.balances).toEqual({ USD: 25, TWD: 800 });
  });

  it("skips duplicates, other roles and missing counterparties", () => {
    expect(
      summarizeAdvances([
        item("card", "2026-09-01", -100, {
          duplicateOf: { kind: "invoice", id: "x" },
        }),
        item("card", "2026-09-01", -100, { economicRole: "spending" }),
        item("card", "2026-09-01", -100, { advanceCounterparty: null }),
        item("investment", "2026-09-01", -100),
      ]),
    ).toEqual([]);
  });
});

describe("advances and e-invoice matching", () => {
  const card = (economicRole: "spending" | "advance") => ({
    id: "card-1",
    connectorId: "esun",
    sourceId: "card-1",
    accountType: "credit",
    amount: -31300,
    currency: "TWD",
    postedDate: "2026-09-29",
    description: "虛構電信門市",
    economicRole,
    duplicateOf: null,
    ...(economicRole === "advance"
      ? { excludedFromCalculation: true, advanceCounterparty: "Irene" }
      : {}),
  });
  const invoice = {
    id: "inv-1",
    invoiceDate: "2026-09-29",
    amount: 31300,
    sellerName: "虛構電信門市",
    invoiceStatus: "開立已確認",
  };

  it("still matches the invoice of an advance paid by card", () => {
    // 代墊仍是一筆實際付款；不配對的話發票會被當成另一筆消費。
    const transactions = [card("advance")];
    const matches = matchInvoicesToTransactions(transactions, [invoice]);
    expect(matches.transactionToInvoice.get("card-1")?.id).toBe("inv-1");
    const { roles } = resolveInvoiceDedupe([invoice], transactions, matches);
    expect(roles.get("inv-1")?.duplicateOf).toEqual({
      kind: "bank_transaction",
      id: "card-1",
    });
  });

  it("carries an advance set on the invoice to the matched card charge", () => {
    const transactions = [{ ...card("spending"), roleReason: "sign" as const }];
    const matches = matchInvoicesToTransactions(transactions, [invoice]);
    const { roles } = resolveInvoiceDedupe([invoice], transactions, matches);
    const invoiceRoles = new Map(
      [...roles].map(([id, fields]) => [
        id,
        applyEconomicRoleOverride(fields, {
          economicRole: "advance",
          duplicateOf: null,
          counterparty: "Irene",
        }),
      ]),
    );
    const [carried] = carryInvoiceAdvancesToTransactions(
      transactions,
      invoiceRoles,
    );
    expect(carried).toMatchObject({
      economicRole: "advance",
      advanceCounterparty: "Irene",
      roleReason: "invoice_override",
    });
    // 交易自己有 override 時以交易為準。
    const [kept] = carryInvoiceAdvancesToTransactions(
      [{ ...transactions[0]!, roleReason: "override" as const }],
      invoiceRoles,
    );
    expect(kept).toMatchObject({ economicRole: "spending" });
  });
});
