import { describe, expect, it } from "vitest";
import {
  applyEconomicRoleOverride,
  ECONOMIC_ROLES,
  isVoidedInvoiceStatus,
  matchInvoicesToTransactions,
  resolveInvoiceDedupe,
  RULE_ECONOMIC_ROLES,
  summarizeActivityMonths,
  type SummaryActivity,
} from "@taiwan-fin-hub/core";

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
    categoryId: "other",
    economicRole: "spending",
    reviewStatus: "auto",
    duplicateOf: null,
    ...extra,
  };
}

describe("excluded economic role", () => {
  it("is an override role but not a rule role", () => {
    expect(ECONOMIC_ROLES).toContain("excluded");
    expect(RULE_ECONOMIC_ROLES as readonly string[]).not.toContain("excluded");
    expect(
      applyEconomicRoleOverride(
        {
          economicRole: "spending",
          reviewStatus: "auto",
          duplicateOf: null,
          investmentEventKind: null,
          roleReason: "sign",
        },
        { economicRole: "excluded", duplicateOf: null },
      ),
    ).toMatchObject({
      economicRole: "excluded",
      reviewStatus: "confirmed",
      roleReason: "override",
    });
  });

  it("keeps excluded activities out of every summary field", () => {
    const base = [
      item("card", "2026-09-03", -500, { categoryId: "food" }),
      item("bank", "2026-09-05", 30000, { economicRole: "income" }),
    ];
    const excluded = [
      // 各種來源與方向的不計入活動，包含待確認、外幣缺匯率與發票。
      item("card", "2026-09-04", -1000, {
        economicRole: "excluded",
        categoryId: "food",
      }),
      item("bank", "2026-09-06", -5000, {
        economicRole: "excluded",
        reviewStatus: "needs_review",
      }),
      item("bank", "2026-09-07", 5000, { economicRole: "excluded" }),
      item("invoice", "2026-09-08", 699, {
        economicRole: "excluded",
        matchStatus: "unmatched",
      }),
      item("card", "2026-09-09", -10, {
        economicRole: "excluded",
        currency: "JPY",
      }),
    ];
    const [withoutExcluded] = summarizeActivityMonths(base, ["2026-09"], {});
    const [withExcluded] = summarizeActivityMonths(
      [...base, ...excluded],
      ["2026-09"],
      {},
    );
    expect(withExcluded).toEqual({
      ...withoutExcluded,
      excludedAmount: 1000 + 5000 + 5000 + 699,
      excludedCount: 5,
    });
    expect(withExcluded).toMatchObject({
      income: 30000,
      spending: 500,
      ownTransfer: 0,
      cardPayment: 0,
      investment: 0,
      duplicateExcluded: 0,
      needsReview: { count: 0, amount: 0 },
      activityCount: 2,
      spendingByCategory: { food: 500 },
      complete: true,
      missingCurrencies: [],
      dedupe: {
        invoicesMerged: 0,
        invoicesUnmatched: 0,
        invoicesAwaitingCard: 0,
        invoicesAmbiguous: 0,
      },
    });
  });
});

describe("voided invoices", () => {
  it.each([
    [null, false],
    ["", false],
    ["開立", false],
    ["開立已確認", false],
    ["已確認", false],
    ["作廢", true],
    ["作廢已確認", true],
    ["註銷", true],
    ["開立後作廢", true],
    ["不明狀態", true],
  ])("status %s → voided %s", (status, voided) => {
    expect(isVoidedInvoiceStatus(status)).toBe(voided);
  });

  it("excludes voided invoices automatically and keeps them out of matching", () => {
    const transactions = [
      {
        id: "card-1",
        connectorId: "esun",
        sourceId: "card-1",
        accountType: "credit",
        amount: -699,
        currency: "TWD",
        postedDate: "2026-09-10",
        description: "某某商店",
        economicRole: "spending" as const,
        duplicateOf: null,
      },
    ];
    const invoices = [
      {
        id: "inv-void",
        invoiceDate: "2026-09-10",
        amount: 699,
        sellerName: "某某商店",
        invoiceStatus: "作廢",
      },
      {
        id: "inv-ok",
        invoiceDate: "2026-09-12",
        amount: 120,
        sellerName: "別家店",
        invoiceStatus: "開立已確認",
      },
    ];
    const matches = matchInvoicesToTransactions(transactions, invoices);
    // 作廢的發票不吃掉同額同日的刷卡交易。
    expect(matches.transactionToInvoice.has("card-1")).toBe(false);
    const { roles, statuses } = resolveInvoiceDedupe(
      invoices,
      transactions,
      matches,
    );
    expect(roles.get("inv-void")).toEqual({
      economicRole: "excluded",
      reviewStatus: "auto",
      duplicateOf: null,
      investmentEventKind: null,
      roleReason: "invoice_voided",
    });
    expect(statuses.get("inv-void")?.matchStatus).toBe("unmatched");
    expect(roles.get("inv-ok")).toMatchObject({
      economicRole: "spending",
      roleReason: "invoice",
    });
    // 使用者仍可 override 回消費。
    expect(
      applyEconomicRoleOverride(roles.get("inv-void")!, {
        economicRole: "spending",
        duplicateOf: null,
      }),
    ).toMatchObject({ economicRole: "spending", roleReason: "override" });
  });
});
