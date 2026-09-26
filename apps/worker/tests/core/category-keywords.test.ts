import { describe, expect, it } from "vitest";
import {
  AUTO_APPLY_SUGGESTION_SOURCES,
  ITEM_KEYWORD_RULES,
  MERCHANT_KEYWORD_RULES,
  matchMerchantKeywords,
  suggestCategory,
} from "@taiwan-fin-hub/core";

const merchant = (text: string) => matchMerchantKeywords(text)?.categoryId;

describe("merchant keywords (2026-09 additions)", () => {
  it.each([
    ["真芳國際飲品", "food"],
    ["阿嬤飲料店", "food"],
    ["大茶飲", "food"],
    ["巷口手搖", "food"],
    ["小林咖啡", "food"],
    ["古早味豆花", "food"],
    ["阿婆剉冰", "food"],
    ["合毅食堂", "food"],
    ["夜市小吃", "food"],
    ["阿明麵店", "food"],
    ["老張牛肉麵", "food"],
    ["池上飯包", "food"],
    ["好好餐館", "food"],
    ["美味便當", "food"],
    ["晨間早餐", "food"],
    ["老四川麻辣鍋", "food"],
    ["燒肉達人", "food"],
    ["平價壽司", "food"],
    ["一蘭拉麵", "food"],
  ])("%s → %s", (text, categoryId) => {
    expect(merchant(text)).toBe(categoryId);
  });

  it.each([
    // 反例：字面含關鍵字但不是餐飲。
    ["王記餐具行", undefined],
    ["環球餐桌椅", undefined],
    ["晶華飯店", "entertainment"],
    ["大同電鍋專賣", undefined],
    ["小家電子鍋", undefined],
    ["不鏽鋼鍋具", undefined],
    ["麵粉原料行", undefined],
    ["冰箱維修", undefined],
    ["燦坤冰箱館", "tech"],
  ])("%s is not misclassified (%s)", (text, categoryId) => {
    expect(merchant(text)).toBe(categoryId);
  });

  it("refines convenience stores by items, otherwise groceries", () => {
    for (const store of ["全家便利商店", "7-ELEVEN", "萊爾富", "OK mart"]) {
      expect(
        suggestCategory({
          texts: [store],
          items: [{ description: "大杯美式", amount: 45 }],
        }),
      ).toEqual({ categoryId: "food", source: "item_keywords" });
      expect(
        suggestCategory({
          texts: [store],
          items: [{ description: "排骨便當", amount: 85 }],
        }),
      ).toEqual({ categoryId: "food", source: "item_keywords" });
      expect(suggestCategory({ texts: [store] })).toEqual({
        categoryId: "food",
        source: "merchant_keywords",
      });
    }
    // 「全家福」不是全家便利商店。
    expect(merchant("全家福餐廳")).toBe("food");
  });

  it("auto-applies history, merchant and item keyword suggestions only", () => {
    expect([...AUTO_APPLY_SUGGESTION_SOURCES].sort()).toEqual([
      "item_keywords",
      "merchant_history",
      "merchant_keywords",
    ]);
  });
});

describe("merchant keywords (2026-09 8 categories)", () => {
  it.each([
    ["王品牛排", "food"],
    ["POPEYES 信義店", "food"],
    ["麥當勞-台北車站", "food"],
    ["肯德基", "food"],
    ["摩斯漢堡", "food"],
    ["漢堡王", "food"],
    ["SUBWAY 南京店", "food"],
    ["星巴克信義店", "food"],
    ["路易莎咖啡", "food"],
    ["CAMA CAFE", "food"],
    ["85度C", "food"],
    ["TRADINGVIEW* PRO", "tech"],
    ["TREND MICRO", "tech"],
    ["趨勢科技", "tech"],
    ["APPLE.COM/BILL", "tech"],
    ["App Store 購買", "tech"],
    ["GOOGLE *Google Play", "tech"],
    // Steam 是遊戲平台，歸娛樂（不是軟體）。
    ["STEAM PURCHASE", "entertainment"],
    ["NETFLIX.COM", "entertainment"],
    ["LINE禮物", "misc"],
    ["家扶基金會QAICHU", "donation"],
    ["慈濟基金會", "donation"],
    // 平台排在品牌之前：LINE禮物送的星巴克券是人情。
    ["LINE禮物 星巴克咖啡券", "misc"],
    ["無卡提款", "misc"],
    ["ATM 提款", "misc"],
    ["跨行提款", "misc"],
    ["郵局提款", "misc"],
  ])("%s → %s", (text, categoryId) => {
    expect(merchant(text)).toBe(categoryId);
  });

  it.each([
    // 反例
    ["牛排刀具組", undefined],
    ["Canon Camera 相機", undefined],
    ["提款卡補發", undefined],
    ["Apple Store 信義", "tech"],
    ["SUBWAYSURFERS", undefined],
  ])("%s is not misclassified (%s)", (text, categoryId) => {
    expect(merchant(text)).toBe(categoryId);
  });

  it("only uses the eight top-level ids and income subcategories", () => {
    const allowed = new Set([
      "food",
      "transport",
      "housing",
      "shopping",
      "tech",
      "entertainment",
      "health",
      "donation",
      "misc",
      "income.salary",
      "income.investment",
      "income.other",
    ]);
    for (const rule of [...MERCHANT_KEYWORD_RULES, ...ITEM_KEYWORD_RULES])
      expect(allowed.has(rule.categoryId), rule.pattern.source).toBe(true);
  });
});
