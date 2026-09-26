import type { ActivityMonthSummary } from "@taiwan-fin-hub/core";

/** 測試用的月收支 summary（`GET /api/activity/summary` 的單月結果）。 */
export function summaryFixture(
  month: string,
  overrides: Partial<ActivityMonthSummary> = {},
): ActivityMonthSummary {
  return {
    month,
    currency: "TWD",
    income: 0,
    spending: 0,
    investment: 0,
    ownTransfer: 0,
    cardPayment: 0,
    saved: 0,
    needsReview: { count: 0, amount: 0 },
    duplicateExcluded: 0,
    excludedAmount: 0,
    excludedCount: 0,
    spendingByCategory: {},
    spendingBySubcategory: {},
    complete: true,
    missingCurrencies: [],
    incompleteReasons: [],
    activityCount: 0,
    dedupe: {
      invoicesMerged: 0,
      invoicesUnmatched: 0,
      invoicesAwaitingCard: 0,
      invoicesAmbiguous: 0,
    },
    ...overrides,
  };
}
