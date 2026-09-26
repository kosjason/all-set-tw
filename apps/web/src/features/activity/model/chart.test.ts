import { describe, expect, it } from "vitest";
import {
  activityAmountTwd,
  activityCashFlow,
  activityDisplayAmount,
  ACTIVITY_CATEGORY_COLOR_BY_ID,
  ACTIVITY_CATEGORY_OVERFLOW_COLOR,
  buildSpendingCategorySlices,
} from "./chart";
import type { ActivityItem } from "./types";

function item(overrides: Partial<ActivityItem>): ActivityItem {
  return {
    id: "1",
    source: "bank",
    date: "2026-07-01",
    title: "交易",
    subtitle: "",
    amount: 0,
    currency: "TWD",
    category: "未分類",
    status: "posted",
    ...overrides,
  };
}

const categories = [
  { id: "income.salary", label: "薪資" },
  { id: "food", label: "餐飲" },
  { id: "transport", label: "交通" },
  { id: "shopping", label: "購物" },
  { id: "health", label: "醫療保險" },
  { id: "misc", label: "其他" },
  { id: "other", label: "未分類" },
];

describe("activity category chart", () => {
  it("converts zero foreign amounts without requiring an exchange rate", () => {
    expect(activityAmountTwd(item({ amount: 0, currency: "HKD" }), {})).toBe(0);
    expect(activityAmountTwd(item({ amount: -0, currency: "HKD" }), {})).toBe(
      0,
    );
  });

  it("keeps nonzero foreign amounts unavailable without an exchange rate", () => {
    for (const amount of [100, -100]) {
      expect(
        activityAmountTwd(item({ amount, currency: "HKD" }), {}),
      ).toBeUndefined();
    }
  });

  it("keeps invoices as expenses and card discounts as income in display", () => {
    expect(activityCashFlow(item({ source: "invoice", amount: 500 }))).toBe(
      "expense",
    );
    const discount = item({ source: "card", amount: 63, category: "購物" });
    expect(activityDisplayAmount(discount)).toBe(63);
    expect(activityCashFlow(discount)).toBe("income");
  });
});

describe("spending category slices from the summary API", () => {
  it("labels categories, sorts by amount and computes percentages", () => {
    const slices = buildSpendingCategorySlices(
      { food: 150, transport: 300 },
      categories,
    );
    expect(
      slices.map(({ categoryId, category, amount }) => ({
        categoryId,
        category,
        amount,
      })),
    ).toEqual([
      { categoryId: "transport", category: "交通", amount: 300 },
      { categoryId: "food", category: "餐飲", amount: 150 },
    ]);
    expect(slices[0]?.percentage).toBeCloseTo(66.67, 1);
  });

  it("labels unmatched invoices and skips categories whose refunds exceed spending", () => {
    const slices = buildSpendingCategorySlices(
      { invoice: 200, shopping: -63, food: 0 },
      categories,
    );
    expect(slices).toEqual([
      {
        categoryId: "invoice",
        category: "發票",
        amount: 200,
        percentage: 100,
        color: ACTIVITY_CATEGORY_OVERFLOW_COLOR,
        emoji: "",
      },
    ]);
  });

  it("keeps each category's color when its monthly rank changes", () => {
    const colorsOf = (food: number, transport: number) =>
      Object.fromEntries(
        buildSpendingCategorySlices({ food, transport }, categories).map(
          (slice) => [slice.category, slice.color],
        ),
      );
    const july = colorsOf(500, 100);
    const august = colorsOf(100, 500);
    expect(july).toEqual(august);
    expect(july["餐飲"]).toBe(ACTIVITY_CATEGORY_COLOR_BY_ID.food);
    expect(july["交通"]).toBe(ACTIVITY_CATEGORY_COLOR_BY_ID.transport);
  });

  it("lists hued categories first, then 其他 and 未分類, then unknown gray ones", () => {
    const slices = buildSpendingCategorySlices(
      { legacy: 900, health: 800, other: 700, misc: 600, food: 10 },
      [...categories, { id: "legacy", label: "舊分類" }],
    );
    expect(slices.map(({ category, color }) => ({ category, color }))).toEqual([
      { category: "醫療保險", color: ACTIVITY_CATEGORY_COLOR_BY_ID.health },
      { category: "餐飲", color: ACTIVITY_CATEGORY_COLOR_BY_ID.food },
      { category: "其他", color: ACTIVITY_CATEGORY_COLOR_BY_ID.misc },
      { category: "未分類", color: ACTIVITY_CATEGORY_COLOR_BY_ID.other },
      { category: "舊分類", color: ACTIVITY_CATEGORY_OVERFLOW_COLOR },
    ]);
  });

  it("gives each of the seven hued categories a fixed color from core", () => {
    const hued = [
      "food",
      "transport",
      "housing",
      "shopping",
      "tech",
      "entertainment",
      "health",
    ];
    for (const id of hued)
      expect(ACTIVITY_CATEGORY_COLOR_BY_ID[id]).toMatch(/^#[0-9a-f]{6}$/);
    expect(
      new Set(hued.map((id) => ACTIVITY_CATEGORY_COLOR_BY_ID[id])).size,
    ).toBe(7);
    // 「其他」不另生色相，使用中性灰並依賴文字標籤。
    expect(ACTIVITY_CATEGORY_COLOR_BY_ID.misc).toBe("#8f8e89");
    // 舊的子類與頂層（0067 前）不再有顏色。
    expect(ACTIVITY_CATEGORY_COLOR_BY_ID["food.drinks"]).toBeUndefined();
    expect(ACTIVITY_CATEGORY_COLOR_BY_ID.lifestyle).toBeUndefined();
    // 沒有提供名稱時使用 core 的分類名稱。
    expect(
      buildSpendingCategorySlices({ entertainment: 100 })[0],
    ).toMatchObject({
      category: "娛樂",
      emoji: "🎬",
      color: ACTIVITY_CATEGORY_COLOR_BY_ID.entertainment,
    });
  });
});
