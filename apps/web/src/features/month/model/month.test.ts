import type { ActivityItem } from "@taiwan-fin-hub/core";
import { describe, expect, it } from "vitest";
import { summaryFixture } from "@/testing/activity-summary";
import {
  ACTIVITY_CATEGORY_COLOR_BY_ID,
  ACTIVITY_CATEGORY_OVERFLOW_COLOR,
  buildSpendingCategoryRanking,
} from "@/data/activity/categories";
import { monthDedupeCounts } from "./dedupe";
import {
  adjacentMonth,
  buildMonthTrend,
  cardDueLabel,
  cardDueReminder,
  categoryTransactionsQuery,
  latestSyncSuccess,
  monthTransactionsQuery,
  pendingBanner,
  recentTransactions,
} from "./month";

const item = (overrides: Partial<ActivityItem>): ActivityItem => ({
  id: "a",
  source: "card",
  date: "2026-09-01",
  title: "活動",
  subtitle: "",
  amount: -100,
  currency: "TWD",
  category: "餐飲",
  status: "posted",
  ...overrides,
});

describe("month page model", () => {
  it("moves between the available months", () => {
    const months = ["2026-07", "2026-08", "2026-09"];
    expect(adjacentMonth(months, "2026-08", -1)).toBe("2026-07");
    expect(adjacentMonth(months, "2026-09", 1)).toBeNull();
    expect(adjacentMonth(months, "2025-01", 1)).toBeNull();
  });

  it("lists the latest transactions without merged duplicates", () => {
    const items = Array.from({ length: 10 }, (_, index) =>
      item({
        id: `t${index}`,
        date: `2026-09-${String(index + 1).padStart(2, "0")}`,
      }),
    );
    items.push(
      item({
        id: "dup",
        source: "invoice",
        date: "2026-09-30",
        duplicateOf: { kind: "bank_transaction", id: "t9" },
      }),
    );
    const recent = recentTransactions(items);
    expect(recent).toHaveLength(8);
    expect(recent[0]!.id).toBe("t9");
    expect(recent.map((row) => row.id)).not.toContain("dup");
  });

  it("builds the six-month income / spending trend from summaries", () => {
    const trend = buildMonthTrend(
      [
        summaryFixture("2026-06", {
          spending: 20000,
          saved: -20000,
          activityCount: 2,
        }),
        summaryFixture("2026-08", {
          income: 28000,
          spending: 30000,
          saved: -2000,
          activityCount: 3,
        }),
        summaryFixture("2026-09", {
          income: 35000,
          spending: 20000,
          saved: 15000,
          activityCount: 5,
          complete: false,
        }),
      ],
      ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"],
      "2026-09",
    );
    expect(trend.map((point) => point.month)).toEqual([
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
    ]);
    // 早於第一個有活動的月份沒有資料。
    expect(trend[0]).toMatchObject({ noData: true });
    // 6 月在銀行同步範圍（7–9 月）之外，只有部分資料，不能當成超支。
    expect(trend[1]).toMatchObject({
      noData: false,
      outsideSyncWindow: true,
    });
    // 7 月在同步範圍內但沒有 summary。
    expect(trend[2]).toMatchObject({ outsideSyncWindow: false, income: 0 });
    expect(trend[3]).toEqual({
      month: "2026-08",
      income: 28000,
      spending: 30000,
      saved: -2000,
      noData: false,
      incomplete: false,
      outsideSyncWindow: false,
    });
    expect(trend[4]).toMatchObject({
      income: 35000,
      spending: 20000,
      saved: 15000,
      incomplete: true,
      outsideSyncWindow: false,
    });
  });

  it("finds the latest successful sync", () => {
    expect(
      latestSyncSuccess([
        { lastSuccessAt: "2026-09-20T01:00:00Z" },
        { lastSuccessAt: null },
        { lastSuccessAt: "2026-09-25T01:00:00Z" },
      ] as never),
    ).toBe("2026-09-25T01:00:00Z");
    expect(latestSyncSuccess([])).toBeUndefined();
  });

  it("reminds about card bills only when unpaid and due within 7 days", () => {
    const due = (daysUntilDue: number, paymentStatus = "unpaid") => ({
      nextDue: {
        issuer: "cathaybk",
        name: "國泰世華",
        paymentDueDate: "2026-10-01",
        daysUntilDue,
        remainingAmount: 12000,
        paymentStatus: paymentStatus as "unpaid",
      },
    });
    expect(cardDueReminder(due(3))).toMatchObject({
      name: "國泰世華",
      daysUntilDue: 3,
    });
    expect(cardDueReminder(due(7, "partial"))).not.toBeNull();
    expect(cardDueReminder(due(-2))).not.toBeNull();
    expect(cardDueReminder(due(8))).toBeNull();
    expect(cardDueReminder(due(1, "paid"))).toBeNull();
    expect(cardDueReminder(due(1, "unknown"))).toBeNull();
    expect(cardDueReminder({ nextDue: null })).toBeNull();
    expect(cardDueReminder(undefined)).toBeNull();
    expect(cardDueLabel(0)).toBe("今天截止");
    expect(cardDueLabel(3)).toBe("3 天後截止");
    expect(cardDueLabel(-2)).toBe("已逾期 2 天");
  });

  it("links a spending category to the transactions page with the same scope", () => {
    expect(categoryTransactionsQuery("food", "2026-09", "2026-09")).toBe(
      "role=spending&category=food",
    );
    expect(categoryTransactionsQuery("invoice", "2026-08", "2026-09")).toBe(
      "month=2026-08&role=spending&category=invoice",
    );
    expect(monthTransactionsQuery("2026-08", "2026-09", { review: "1" })).toBe(
      "month=2026-08&review=1",
    );
    expect(monthTransactionsQuery("2026-09", "2026-09")).toBe("");
  });

  it("shows the pending banner for inbox items, else for needs-review activities", () => {
    const review = summaryFixture("2026-09", {
      needsReview: { count: 2, amount: 500 },
    });
    expect(pendingBanner({ blocking: 1, tidy: 2 }, review)).toEqual({
      kind: "inbox",
      count: 3,
      blocking: true,
    });
    expect(pendingBanner({ blocking: 0, tidy: 0 }, review)).toEqual({
      kind: "review",
      count: 2,
      amount: 500,
    });
    expect(pendingBanner(undefined, summaryFixture("2026-09"))).toBeNull();
  });

  it("reads the invoice de-duplication counts and hides an empty month", () => {
    expect(monthDedupeCounts(summaryFixture("2026-09"))).toBeNull();
    expect(monthDedupeCounts(undefined)).toBeNull();
    expect(
      monthDedupeCounts(
        summaryFixture("2026-09", {
          dedupe: {
            invoicesMerged: 12,
            invoicesUnmatched: 3,
            invoicesAwaitingCard: 1,
            invoicesAmbiguous: 0,
          },
        }),
      ),
    ).toEqual({ merged: 12, unmatched: 3, awaitingCard: 1, ambiguous: 0 });
  });

  it("ranks spending categories by amount with bars relative to the largest", () => {
    const ranking = buildSpendingCategoryRanking(
      { food: 3000, other: 6000, invoice: 1500, refund: -200 },
      [{ id: "food", label: "餐飲" }],
    );
    expect(
      ranking.map(({ category, barPercent, color }) => ({
        category,
        barPercent,
        color,
      })),
    ).toEqual([
      {
        category: "未分類",
        barPercent: 100,
        color: ACTIVITY_CATEGORY_COLOR_BY_ID.other,
      },
      {
        category: "餐飲",
        barPercent: 50,
        color: ACTIVITY_CATEGORY_COLOR_BY_ID.food,
      },
      {
        category: "發票",
        barPercent: 25,
        color: ACTIVITY_CATEGORY_OVERFLOW_COLOR,
      },
    ]);
  });
});
