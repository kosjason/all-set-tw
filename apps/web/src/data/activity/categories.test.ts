import { describe, expect, it } from "vitest";
import {
  activityCategoryDisplay,
  categoryOptionText,
  spendingCategoryOptions,
} from "./categories";
import { activityDisplayName, activityItemsSummary } from "./names";

describe("spending category menu", () => {
  it("offers the spending categories with emoji, then custom categories", () => {
    const options = spendingCategoryOptions([
      { id: "food", label: "餐飲" },
      { id: "income.salary", label: "薪資", kind: "income" },
      { id: "other", label: "未分類", kind: "uncategorized" },
      { id: "user:pet", label: "寵物", kind: "spending" },
      // 0067 前的舊 id 不再出現。
      { id: "lifestyle", label: "生活娛樂", kind: "spending" },
    ]);
    expect(options.map(categoryOptionText)).toEqual([
      "🍜 餐飲",
      "🚇 交通",
      "🏠 居住",
      "🛍️ 購物",
      "💻 3C 數位",
      "🎬 娛樂",
      "🩺 醫療保險",
      "🙏 捐款",
      "📌 其他",
      "寵物",
    ]);
  });

  it("describes the current category even when it is not in the menu", () => {
    const options = spendingCategoryOptions();
    expect(activityCategoryDisplay("other", "未分類", options)).toEqual({
      id: "other",
      label: "未分類",
      emoji: "❔",
    });
    expect(
      activityCategoryDisplay("income.salary", "薪資", options),
    ).toMatchObject({ label: "薪資", emoji: "💼" });
    expect(
      activityCategoryDisplay(undefined, "投資活動", options),
    ).toMatchObject({
      label: "投資活動",
      emoji: "",
    });
  });
});

describe("activity names", () => {
  it("prefers the merchant display name", () => {
    expect(
      activityDisplayName({ title: "連支＊全家", displayName: "全家" }),
    ).toBe("全家");
    expect(activityDisplayName({ title: "全家", displayName: "  " })).toBe(
      "全家",
    );
  });

  it("summarises up to three invoice items", () => {
    expect(
      activityItemsSummary({
        source: "invoice",
        itemsPreview: ["拿鐵", "可頌", "司康", "水"],
      }),
    ).toBe("拿鐵、可頌、司康");
    expect(
      activityItemsSummary({ source: "card", itemsPreview: ["拿鐵"] }),
    ).toBe("");
    expect(
      activityItemsSummary({
        source: "card",
        invoiceId: "inv",
        itemsPreview: ["拿鐵"],
      }),
    ).toBe("拿鐵");
  });
});
