import { describe, expect, it } from "vitest";
import { defaultActivityViewState } from "./url-state";
import {
  activityFilterChips,
  clearActivityFilter,
  clearActivityFilters,
  filterCard,
  filterCategorySlice,
  filterNeedsReview,
  filterRole,
  filterTab,
  filterUncategorized,
  isUncategorizedActivity,
} from "./view-filters";
import type { ActivityItem } from "./types";

const base: ActivityItem = {
  id: "a",
  source: "bank",
  date: "2026-09-01",
  title: "轉帳",
  subtitle: "",
  amount: -100,
  currency: "TWD",
  category: "未分類",
  categoryId: "other",
  status: "posted",
  transactionId: "a",
};

const labels: Record<string, string> = { food: "餐飲", invoice: "發票" };
const categoryLabel = (id: string) => labels[id];

describe("uncategorized filter", () => {
  it("keeps only reclassifiable transactions without a category", () => {
    const items: ActivityItem[] = [
      base,
      { ...base, id: "b", categoryId: "food", category: "餐飲" },
      { ...base, id: "c", source: "invoice", transactionId: undefined },
      { ...base, id: "d", categoryId: undefined },
      { ...base, id: "e", economicRole: "card_payment" },
      { ...base, id: "f", economicRole: "own_transfer" },
      { ...base, id: "g", economicRole: "spending" },
      {
        ...base,
        id: "h",
        economicRole: "spending",
        duplicateOf: { kind: "invoice", id: "x" },
      },
    ];
    expect(items.map(isUncategorizedActivity)).toEqual([
      true,
      false,
      false,
      true,
      false,
      false,
      true,
      false,
    ]);
    expect(filterUncategorized(items, true).map((item) => item.id)).toEqual([
      "a",
      "d",
      "g",
    ]);
    expect(filterUncategorized(items, false)).toBe(items);
  });
});

describe("needs-review filter", () => {
  it("keeps only activities waiting for a role decision", () => {
    const items: ActivityItem[] = [
      { ...base, reviewStatus: "needs_review", economicRole: "spending" },
      { ...base, id: "b", reviewStatus: "auto", economicRole: "spending" },
      { ...base, id: "c" },
    ];
    expect(filterNeedsReview(items, true).map((item) => item.id)).toEqual([
      "a",
    ]);
    expect(filterNeedsReview(items, false)).toBe(items);
  });
});

describe("chart category filter", () => {
  it("lists only non-duplicate activities with the chart's role", () => {
    const food = { ...base, category: "餐飲", categoryId: "food" };
    const items: ActivityItem[] = [
      { ...food, id: "spend", economicRole: "spending" },
      { ...food, id: "refund", amount: 30, economicRole: "spending" },
      { ...food, id: "moved", economicRole: "own_transfer" },
      {
        ...food,
        id: "dup",
        economicRole: "spending",
        duplicateOf: { kind: "bank_transaction", id: "spend" },
      },
      { ...food, id: "legacy" },
      { ...food, id: "other", category: "交通", economicRole: "spending" },
    ];
    expect(
      filterCategorySlice(items, { flow: "expense", category: "餐飲" }).map(
        (item) => item.id,
      ),
    ).toEqual(["spend", "refund", "legacy"]);
    expect(filterCategorySlice(items, null)).toBe(items);
  });
});

describe("role, tab and card filters", () => {
  const items: ActivityItem[] = [
    { ...base, id: "spend", source: "card", economicRole: "spending" },
    { ...base, id: "salary", amount: 5000, economicRole: "income" },
    { ...base, id: "move", economicRole: "own_transfer" },
    { ...base, id: "pay", economicRole: "card_payment" },
    { ...base, id: "buy", economicRole: "investment" },
    { ...base, id: "legacy-out" },
    { ...base, id: "legacy-in", amount: 20 },
    {
      ...base,
      id: "inv",
      source: "invoice",
      transactionId: undefined,
      amount: 120,
      economicRole: "spending",
      duplicateOf: { kind: "bank_transaction", id: "spend" },
    },
  ];
  const ids = (list: ActivityItem[]) => list.map((item) => item.id);

  it("filters by economic role, falling back to the sign for legacy rows", () => {
    expect(ids(filterRole(items, "spending"))).toEqual([
      "spend",
      "legacy-out",
      "inv",
    ]);
    expect(ids(filterRole(items, "income"))).toEqual(["salary", "legacy-in"]);
    expect(ids(filterRole(items, "own_transfer"))).toEqual(["move"]);
    expect(ids(filterRole(items, "card_payment"))).toEqual(["pay"]);
    expect(ids(filterRole(items, "investment"))).toEqual(["buy"]);
    expect(filterRole(items, "all")).toBe(items);
  });

  it("hides merged duplicates in the ledger and keeps raw records per source", () => {
    expect(ids(filterTab(items, "ledger"))).not.toContain("inv");
    expect(ids(filterTab(items, "invoice"))).toEqual(["inv"]);
    expect(ids(filterTab(items, "card"))).toEqual(["spend"]);
    expect(ids(filterTab(items, "bank"))).toEqual([
      "salary",
      "move",
      "pay",
      "buy",
      "legacy-out",
      "legacy-in",
    ]);
  });

  it("keeps only card records whose last four digits match", () => {
    const last4 = (item: ActivityItem) =>
      item.id === "spend" ? "4444" : undefined;
    expect(ids(filterCard(items, "4444", last4))).toEqual(["spend"]);
    expect(filterCard(items, "", last4)).toBe(items);
    expect(filterCard(items, "1111", last4)).toEqual([]);
  });
});

describe("activity filter chips", () => {
  it("lists nothing for the default view", () => {
    expect(
      activityFilterChips(defaultActivityViewState(), {
        searching: false,
        text: "",
        categoryLabel,
      }),
    ).toEqual([]);
  });

  it("describes every applied monthly filter but not the tab", () => {
    const state = {
      ...defaultActivityViewState(),
      tab: "card" as const,
      role: "income" as const,
      categoryId: "food",
      card: "4444",
      uncategorized: true,
      review: true,
    };
    expect(
      activityFilterChips(state, {
        searching: false,
        text: " 咖啡 ",
        categoryLabel,
      }),
    ).toEqual([
      { key: "text", label: "搜尋：咖啡" },
      { key: "role", label: "收入" },
      { key: "category", label: "分類：餐飲" },
      { key: "card", label: "卡片末四碼 4444" },
      { key: "uncategorized", label: "未分類" },
      { key: "review", label: "待確認" },
    ]);
  });

  it("shows the chart category instead of its role and the search range while searching", () => {
    const state = {
      ...defaultActivityViewState(),
      query: "airbnb",
      role: "spending" as const,
      slice: { flow: "expense" as const, category: "餐飲" },
      time: "custom" as const,
      from: "2024-01-01",
    };
    expect(
      activityFilterChips(state, {
        searching: true,
        text: "ignored",
        categoryLabel,
      }),
    ).toEqual([
      { key: "time", label: "2024-01-01 ～ 不限迄日" },
      { key: "slice", label: "消費 · 餐飲" },
    ]);
  });

  it("clears one filter or all filters while keeping month, tab and sort", () => {
    const state = {
      ...defaultActivityViewState(),
      month: "2026-08",
      tab: "bank" as const,
      sort: "amount-asc" as const,
      role: "spending" as const,
      slice: { flow: "expense" as const, category: "餐飲" },
      categoryId: "food",
      card: "4444",
      uncategorized: true,
      review: true,
      time: "year" as const,
    };
    expect(clearActivityFilter(state, "slice")).toMatchObject({
      slice: null,
      role: "all",
      tab: "bank",
    });
    expect(clearActivityFilter(state, "role").role).toBe("all");
    expect(clearActivityFilter(state, "category").categoryId).toBe("");
    expect(clearActivityFilter(state, "card").card).toBe("");
    expect(clearActivityFilter(state, "uncategorized").uncategorized).toBe(
      false,
    );
    expect(clearActivityFilter(state, "review").review).toBe(false);
    expect(clearActivityFilter(state, "time")).toMatchObject({
      time: "all",
      from: "",
      to: "",
    });
    expect(clearActivityFilters(state)).toEqual({
      ...defaultActivityViewState(),
      month: "2026-08",
      tab: "bank",
      sort: "amount-asc",
    });
  });
});
