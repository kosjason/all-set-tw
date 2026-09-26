import { describe, expect, it } from "vitest";
import {
  bankMerchantIdentity,
  CATEGORY_DEFINITIONS,
  cleanInvoiceItemName,
  getCategoryDefinition,
  invoiceItemsPreview,
  invoiceMerchantIdentity,
  isMerchantKey,
  matchesActivitySearch,
  parseActivitySearch,
  SPENDING_TOP_LEVEL_CATEGORY_IDS,
  suggestCategory,
  suggestCategoryFromItems,
  topLevelCategoryId,
  type ActivityItem,
} from "@taiwan-fin-hub/core";

describe("merchant keys", () => {
  it.each([
    [
      "電支交易 連加電支儲值 P0000000000000000123",
      "name:連加電支儲值",
      "連加電支儲值",
    ],
    ["已田商行股份有限公司承德路門市", "name:已田商行", "已田商行"],
    ["全家便利商店股份有限公司台北民生店", "name:全家便利商店", "全家便利商店"],
    ["統一超商(股)公司台北市第一七五分公司", "name:統一超商", "統一超商"],
    ["中華電信股份有限公司個人家庭分TAIPEI", "name:中華電信", "中華電信"],
    ["ＳＴＡＲＢＵＣＫＳ　信義店", "name:starbucks", "STARBUCKS"],
    ["7-ELEVEN 民生門市", "name:7eleven", "7-ELEVEN"],
    ["Costco 內湖店", "name:costco", "Costco"],
    [
      "OPENAI *CHATGPT SUBSCRO123456 SAN FR",
      "name:openaichatgpt",
      "OPENAI *CHATGPT",
    ],
    ["UBER *TRIP HELP.UBER.COM", "name:ubertrip", "UBER *TRIP"],
    // 店種名稱不是門市字樣。
    ["咖啡店", "name:咖啡店", "咖啡店"],
    ["測試飲料店", "name:測試飲料店", "測試飲料店"],
    ["巷口小吃店", "name:巷口小吃店", "巷口小吃店"],
    ["幸福麵包店", "name:幸福麵包店", "幸福麵包店"],
    // 分店字樣仍會去掉。
    ["幸福麵包店 台北店", "name:幸福麵包店", "幸福麵包店"],
  ])("normalizes %s", (raw, key, name) => {
    expect(bankMerchantIdentity({ description: raw })).toEqual({
      merchantKey: key,
      name,
    });
  });

  it("extracts LINE Pay merchants and marks the payment method", () => {
    expect(bankMerchantIdentity({ description: "連支＊老王牛肉麵" })).toEqual({
      merchantKey: "name:老王牛肉麵",
      name: "老王牛肉麵",
      paymentMethod: "line_pay",
    });
    expect(
      bankMerchantIdentity({ description: "連加＊好好咖啡 台北" }),
    ).toMatchObject({
      merchantKey: "name:好好咖啡",
      paymentMethod: "line_pay",
    });
    // 對方名稱常是支付業者；電支前綴的商家優先。
    expect(
      bankMerchantIdentity({
        description: "連支＊老王牛肉麵",
        counterparty: "連加網路商業股份有限公司",
      }),
    ).toMatchObject({ merchantKey: "name:老王牛肉麵" });
  });

  it("uses the counterparty when the description only names the channel", () => {
    expect(
      bankMerchantIdentity({
        description: "信用卡消費",
        counterparty: "新光三越",
      }),
    ).toEqual({ merchantKey: "name:新光三越", name: "新光三越" });
    expect(
      bankMerchantIdentity({ description: "消費", counterparty: null }),
    ).toBeUndefined();
  });

  it("prefers the seller BAN for invoices", () => {
    expect(
      invoiceMerchantIdentity({
        sellerName: "全聯實業股份有限公司",
        sellerBan: "12345678",
      }),
    ).toEqual({ merchantKey: "ban:12345678", name: "全聯實業" });
    // 統編格式不正確時退回名稱。
    expect(
      invoiceMerchantIdentity({ sellerName: "某某小吃", sellerBan: "123" }),
    ).toEqual({ merchantKey: "name:某某小吃", name: "某某小吃" });
    expect(isMerchantKey("ban:12345678")).toBe(true);
    expect(isMerchantKey("name:老王牛肉麵")).toBe(true);
    expect(isMerchantKey("ban:123")).toBe(false);
    expect(isMerchantKey("other:x")).toBe(false);
  });
});

describe("invoice items", () => {
  it.each([
    ["4710088412345 鮮奶茶(大) x2", "鮮奶茶(大)"],
    ["衛生紙 3 包", "衛生紙"],
    ["*特價* 御飯糰-鮪魚 1個", "御飯糰-鮪魚"],
    ["【促】洋芋片 2入", "洋芋片"],
    ["拿鐵 480ml", "拿鐵"],
    ["12345678", undefined],
  ])("cleans %s", (raw, expected) => {
    expect(cleanInvoiceItemName(raw)).toBe(expected);
  });

  it("previews the first three distinct items without discounts", () => {
    expect(
      invoiceItemsPreview([
        { description: "美式咖啡 x2", amount: 110 },
        { description: "折扣", amount: -10 },
        { description: "美式咖啡", amount: 55 },
        { description: "可頌 1個", amount: 45 },
        { description: "購物袋", amount: 2 },
        { description: "瓶裝水", amount: 20 },
      ]),
    ).toEqual(["美式咖啡", "可頌", "購物袋"]);
  });
});

describe("category taxonomy", () => {
  it("keeps nine stable top-level ids without subcategories", () => {
    expect(SPENDING_TOP_LEVEL_CATEGORY_IDS).toEqual([
      "food",
      "transport",
      "housing",
      "shopping",
      "tech",
      "entertainment",
      "health",
      "donation",
      "misc",
    ]);
    // 八個有色分類依色板順序（validate_palette 驗證過的 8 色）；其他為中性灰。
    const colors = SPENDING_TOP_LEVEL_CATEGORY_IDS.slice(0, 8).map(
      (id) => getCategoryDefinition(id)!.color.light,
    );
    expect(colors).toEqual([
      "#2a78d6",
      "#eb6834",
      "#1baf7a",
      "#eda100",
      "#e87ba4",
      "#008300",
      "#4a3aa7",
      "#e34948",
    ]);
    expect(getCategoryDefinition("misc")?.color.neutral).toBe(true);
    expect(getCategoryDefinition("other")?.color.neutral).toBe(true);
    // 消費分類沒有子類；只有收入保留子類。
    expect(
      CATEGORY_DEFINITIONS.filter(
        (row) => row.kind === "spending" && row.parentId !== null,
      ),
    ).toEqual([]);
    expect(getCategoryDefinition("income.salary")?.parentId).toBe("income");
    for (const legacy of ["food.drinks", "lifestyle", "social", "fees.bank"])
      expect(getCategoryDefinition(legacy)).toBeUndefined();
    expect(new Set(CATEGORY_DEFINITIONS.map((row) => row.label)).size).toBe(
      CATEGORY_DEFINITIONS.length,
    );
    expect(topLevelCategoryId("transport")).toBe("transport");
    expect(topLevelCategoryId("user:abc")).toBe("misc");
    expect(topLevelCategoryId(undefined)).toBe("other");
  });
});

describe("category suggestions", () => {
  it("orders sources: merchant history, merchant keywords, item keywords, refinable merchants", () => {
    expect(
      suggestCategory({
        texts: ["全聯福利中心"],
        merchantHistoryCategoryId: "shopping",
      }),
    ).toEqual({ categoryId: "shopping", source: "merchant_history" });
    expect(
      suggestCategory({
        texts: ["全聯福利中心"],
        items: [{ description: "拿鐵", amount: 60 }],
      }),
    ).toEqual({ categoryId: "food", source: "merchant_keywords" });
    // 超商依品項細分。
    expect(
      suggestCategory({
        texts: ["統一超商"],
        items: [
          { description: "大杯拿鐵", amount: 65 },
          { description: "茶葉蛋", amount: 13 },
        ],
      }),
    ).toEqual({ categoryId: "food", source: "item_keywords" });
    expect(
      suggestCategory({
        texts: ["統一超商"],
        items: [{ description: "抽取式衛生紙 12包", amount: 199 }],
      }),
    ).toEqual({ categoryId: "shopping", source: "item_keywords" });
    expect(
      suggestCategory({
        texts: ["全家便利商店"],
        items: [{ description: "神秘商品", amount: 50 }],
      }),
    ).toEqual({ categoryId: "food", source: "merchant_keywords" });
    expect(
      suggestCategory({
        texts: ["某某有限公司"],
        items: [{ description: "悠遊卡加值", amount: 500 }],
      }),
    ).toEqual({ categoryId: "transport", source: "item_keywords" });
    expect(suggestCategory({ texts: ["某某有限公司"] })).toBeUndefined();
  });

  it.each([
    ["中油", "transport"],
    ["UBER *TRIP", "transport"],
    ["UBER EATS", "food"],
    ["NETFLIX.COM", "entertainment"],
    ["SPOTIFY P1234", "entertainment"],
    ["APPLE.COM/BILL", "tech"],
    ["ANTHROPIC", "tech"],
    ["CLAUDE.AI SUBSCRIPTION", "tech"],
    ["OPENAI *CHATGPT SUBSCR", "tech"],
    ["GITHUB, INC.", "tech"],
    ["GOOGLE *WORKSPACE", "tech"],
    ["AWS EMEA", "tech"],
    ["CLOUDFLARE", "tech"],
    ["GODADDY.COM", "tech"],
    ["APPLE ICLOUD", "tech"],
    ["燦坤3C", "tech"],
    ["全國電子", "tech"],
    ["路易莎咖啡", "food"],
    ["家樂福", "food"],
    ["蝦皮購物", "shopping"],
  ])("suggests %s from merchant keywords", (text, categoryId) => {
    expect(suggestCategory({ texts: [text] })).toEqual({
      categoryId,
      source: "merchant_keywords",
    });
  });

  it("suggests 3C categories from invoice items", () => {
    expect(
      suggestCategory({
        texts: ["某某資訊有限公司"],
        items: [
          { description: "SSL 憑證 1年", amount: 1800 },
          { description: "Domain 續約", amount: 600 },
        ],
      }),
    ).toEqual({ categoryId: "tech", source: "item_keywords" });
    expect(
      suggestCategory({
        texts: ["某某企業社"],
        items: [
          { description: "USB-C 傳輸線", amount: 390 },
          { description: "藍牙耳機", amount: 1990 },
        ],
      }),
    ).toEqual({ categoryId: "tech", source: "item_keywords" });
    expect(
      suggestCategory({
        texts: ["某某科技有限公司"],
        items: [{ description: "Hosting 方案 月繳", amount: 300 }],
      }),
    ).toEqual({ categoryId: "tech", source: "item_keywords" });
  });

  it("uses income keywords only for inflows and weights items by amount", () => {
    expect(
      suggestCategory({ texts: ["現金股利"], direction: "inflow" }),
    ).toEqual({ categoryId: "income.investment", source: "merchant_keywords" });
    expect(suggestCategory({ texts: ["現金股利"] })).toBeUndefined();
    // 衛生紙金額占多數。
    expect(
      suggestCategoryFromItems([
        { description: "衛生紙", amount: 300 },
        { description: "拿鐵", amount: 60 },
      ]),
    ).toBe("shopping");
    // 可辨識品項金額未達 40% 時不建議。
    expect(
      suggestCategoryFromItems([
        { description: "拿鐵", amount: 60 },
        { description: "神秘商品", amount: 500 },
      ]),
    ).toBeUndefined();
  });
});

describe("activity search syntax", () => {
  const item = (amount: number, extra: Partial<ActivityItem> = {}) =>
    ({
      id: `x${amount}`,
      source: "card",
      date: "2026-09-01",
      title: "信用卡消費",
      subtitle: "",
      amount,
      currency: "TWD",
      category: "未分類",
      status: "posted",
      ...extra,
    }) as ActivityItem;

  it("parses numbers, comparisons and ranges", () => {
    expect(parseActivitySearch("125")).toEqual({
      text: "125",
      amounts: [{ op: "=", value: 125 }],
      numberOrText: true,
    });
    expect(parseActivitySearch(">1,000")).toEqual({
      text: "",
      amounts: [{ op: ">", value: 1000 }],
      numberOrText: false,
    });
    expect(parseActivitySearch("咖啡 <= 200")).toEqual({
      text: "咖啡",
      amounts: [{ op: "<=", value: 200 }],
      numberOrText: false,
    });
    expect(parseActivitySearch("100-200").amounts).toEqual([
      { op: ">=", value: 100 },
      { op: "<=", value: 200 },
    ]);
  });

  it("matches amounts by absolute value and item names or display names", () => {
    expect(matchesActivitySearch(item(-125), parseActivitySearch("125"))).toBe(
      true,
    );
    expect(
      matchesActivitySearch(item(-1500), parseActivitySearch(">1000")),
    ).toBe(true);
    expect(
      matchesActivitySearch(item(-500), parseActivitySearch(">1000")),
    ).toBe(false);
    expect(
      matchesActivitySearch(
        item(-65, { itemsPreview: ["大杯拿鐵"] }),
        parseActivitySearch("拿鐵 <100"),
      ),
    ).toBe(true);
    expect(
      matchesActivitySearch(
        item(-65, { displayName: "巷口早餐" }),
        parseActivitySearch("巷口"),
      ),
    ).toBe(true);
  });
});
