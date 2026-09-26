import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ActivityItem, ActivityMonthSummary } from "@taiwan-fin-hub/core";
import { activityRoutes } from "../../../src/features/activity/route";
import { bankRoutes } from "../../../src/features/bank/route";
import { classificationRoutes } from "../../../src/features/classification/route";
import { matchesClassificationRule } from "../../../src/features/classification/service";
import { merchantRoutes } from "../../../src/features/merchants/route";
import { honoFactory } from "../../../src/platform/hono";
import { apiErrorResponse } from "../../../src/platform/http";
import type { Env } from "../../../src/platform/env";
import { createTestD1 } from "../../../../../packages/db/testing/d1";

// 合成的「9 月情境」：LINE Pay 小店、醜商家字串、發票品項；不含真實帳號或姓名。
const now = "2026-09-30T00:00:00.000Z";

type Tx = {
  id: string;
  account?: "dep-a" | "card-a";
  day: string;
  amount: number;
  description: string;
  counterparty?: string;
};

const transactions: Tx[] = [
  { id: "salary", day: "2026-09-05", amount: 50000, description: "薪資入帳" },
  { id: "rent", day: "2026-09-01", amount: -20000, description: "房租" },
  {
    id: "topup",
    day: "2026-09-24",
    amount: -2000,
    description: "電支交易 連加電支儲值 P0000000000000000123",
  },
  ...["2026-09-02", "2026-09-09", "2026-09-16"].map((day, index) => ({
    id: `beef-${index + 1}`,
    account: "card-a" as const,
    day,
    amount: -180,
    description: "連支＊老王牛肉麵",
  })),
  {
    id: "coffee",
    account: "card-a",
    day: "2026-09-03",
    amount: -120,
    description: "連加＊好好咖啡",
  },
  {
    id: "lunch",
    account: "card-a",
    day: "2026-09-04",
    amount: -350,
    description: "已田商行股份有限公司承德路門市",
  },
  {
    id: "seven",
    account: "card-a",
    day: "2026-09-06",
    amount: -85,
    description: "7-ELEVEN 民生門市",
  },
  {
    id: "grocery",
    account: "card-a",
    day: "2026-09-07",
    amount: -1200,
    description: "全聯福利中心",
  },
  {
    id: "ride",
    account: "card-a",
    day: "2026-09-08",
    amount: -250,
    description: "UBER *TRIP HELP.UBER.COM",
  },
  {
    id: "stream",
    account: "card-a",
    day: "2026-09-10",
    amount: -390,
    description: "NETFLIX.COM",
  },
  {
    id: "mystery",
    account: "card-a",
    day: "2026-09-11",
    amount: -999,
    description: "某某有限公司",
  },
  {
    id: "ai",
    account: "card-a",
    day: "2026-09-14",
    amount: -600,
    description: "CLAUDE.AI SUBSCRIPTION",
  },
  {
    id: "studio",
    account: "card-a",
    day: "2026-09-13",
    amount: -600,
    description: "阿明工作室",
  },
];

const invoices = [
  {
    id: "inv-lunch",
    day: "2026-09-04",
    amount: 350,
    seller: "已田商行股份有限公司",
    ban: "33333333",
    items: [
      ["排骨便當 x2", 300],
      ["紅茶 1杯", 50],
    ],
  },
  {
    id: "inv-seven",
    day: "2026-09-06",
    amount: 85,
    seller: "統一超商股份有限公司台北市第一七五分公司",
    ban: "22222222",
    items: [
      ["4710088412345 大杯拿鐵", 65],
      ["茶葉蛋", 20],
    ],
  },
  {
    id: "inv-breakfast",
    day: "2026-09-12",
    amount: 75,
    seller: "巷口早餐店",
    ban: null,
    items: [
      ["蛋餅 1份", 40],
      ["豆漿(大)", 35],
    ],
  },
  // 電支儲值後的消費：只有發票。
  {
    id: "inv-grocer",
    day: "2026-09-25",
    amount: 240,
    seller: "好日子雜貨有限公司",
    ban: "11111111",
    items: [
      ["抽取式衛生紙 3包", 199],
      ["購物袋", 2],
      ["口香糖", 39],
    ],
  },
] as const;

type Item = ActivityItem & { id: string };

describe("merchants, categories and suggestions", () => {
  let harness: Awaited<ReturnType<typeof createTestD1>>;
  let env: Env;
  const app = honoFactory.createApp();
  app.route("/api", activityRoutes);
  app.route("/api", bankRoutes);
  app.route("/api", merchantRoutes);
  app.route("/api", classificationRoutes);
  app.onError(apiErrorResponse);

  beforeAll(async () => {
    harness = await createTestD1();
    const db = harness.binding;
    env = { DB: db } as Env;
    await db.batch([
      db
        .prepare(
          "INSERT INTO bank_accounts (id, connector_id, source_id, institution_name, account_type, created_at, updated_at) VALUES ('dep-a', 'esun', 'bank:esun:0000', '某銀行', 'savings', ?1, ?1), ('card-a', 'esun', 'card:esun:0000', '某銀行', 'credit', ?1, ?1)",
        )
        .bind(now),
      ...transactions.map((tx) =>
        db
          .prepare(
            "INSERT INTO bank_transactions (id, connector_id, account_id, source_id, posted_date, amount, currency, description, counterparty, created_at, updated_at) VALUES (?1, 'esun', ?2, ?1, ?3, ?4, 'TWD', ?5, ?6, ?7, ?7)",
          )
          .bind(
            tx.id,
            tx.account ?? "dep-a",
            tx.day,
            tx.amount,
            tx.description,
            tx.counterparty ?? null,
            now,
          ),
      ),
      ...invoices.map((invoice) =>
        db
          .prepare(
            "INSERT INTO invoices (id, connector_id, source_id, invoice_date, seller_name, amount, raw_payload, created_at, updated_at) VALUES (?1, 'einvoice', ?1, ?2, ?3, ?4, ?5, ?6, ?6)",
          )
          .bind(
            invoice.id,
            invoice.day,
            invoice.seller,
            invoice.amount,
            JSON.stringify({ invoice: { sellerID: invoice.ban ?? "" } }),
            now,
          ),
      ),
      ...invoices.flatMap((invoice) =>
        invoice.items.map(([description, amount], index) =>
          db
            .prepare(
              "INSERT INTO invoice_line_items (id, invoice_id, connector_id, invoice_source_id, source_id, line_number, description, amount, created_at, updated_at) VALUES (?1, ?2, 'einvoice', ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
            )
            .bind(
              `${invoice.id}:${index + 1}`,
              invoice.id,
              String(index + 1),
              index + 1,
              description,
              amount,
              now,
            ),
        ),
      ),
    ]);
  }, 60_000);

  afterAll(async () => {
    await harness?.mf.dispose();
  });

  async function month() {
    const response = await app.request(
      "/api/activity/items?month=2026-09",
      {},
      env,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      items: Item[];
      summary: ActivityMonthSummary;
    };
    return {
      ...body,
      byId: new Map(body.items.map((item) => [item.id, item])),
    };
  }

  function send(method: string, path: string, body?: unknown) {
    return app.request(
      path,
      {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      env,
    );
  }

  /** 計入的消費（不含重複、非消費角色）。 */
  const spendingItems = (items: Item[]) =>
    items.filter(
      (item) =>
        item.economicRole === "spending" &&
        !item.duplicateOf &&
        item.source !== "investment",
    );
  const uncategorized = (item: Item) =>
    !item.categoryId || item.categoryId === "other";

  let beforeRate = 0;

  it("reduces the uncategorized share compared with the legacy rules", async () => {
    const { items } = await month();
    const spending = spendingItems(items);

    // 舊版：只用 0055 之前的系統規則分類銀行／信用卡交易，發票一律沒有分類。
    const legacy = new DatabaseSync(":memory:");
    const migrations = fileURLToPath(
      new URL("../../../../../packages/db/migrations/", import.meta.url),
    );
    for (const file of readdirSync(migrations)
      .filter((name) => name.endsWith(".sql") && name < "0055")
      .sort())
      legacy.exec(readFileSync(`${migrations}/${file}`, "utf8"));
    const legacyRules = legacy
      .prepare(
        "SELECT id, category_id, field, operator, pattern, target_type FROM classification_rules WHERE enabled = 1 ORDER BY priority DESC, updated_at DESC, id",
      )
      .all() as Array<{
      id: string;
      category_id: string;
      field: string;
      operator: string;
      pattern: string;
    }>;
    legacy.close();
    const legacyUncategorized = spending.filter((item) => {
      if (item.source === "invoice") return true;
      const tx = transactions.find((row) => row.id === item.id)!;
      const rule = legacyRules.find(
        (candidate) =>
          (candidate.id !== "system:bank:other-income-keywords" ||
            tx.amount > 0) &&
          matchesClassificationRule(candidate, {
            id: tx.id,
            sourceId: tx.id,
            description: tx.description,
            counterparty: tx.counterparty,
          }),
      );
      return !rule || rule.category_id === "other";
    });
    beforeRate = legacyUncategorized.length / spending.length;
    const after = spending.filter(uncategorized);
    const afterRate = after.length / spending.length;
    const withoutSuggestion = after.filter((item) => !item.suggestedCategoryId);
    const withoutSuggestionRate = withoutSuggestion.length / spending.length;
    console.info(
      `[9 月情境] 消費 ${spending.length} 筆；未分類 舊版 ${(beforeRate * 100).toFixed(0)}% → 新版 ${(afterRate * 100).toFixed(0)}%；未分類且無建議 ${(withoutSuggestionRate * 100).toFixed(0)}%`,
    );
    expect(afterRate).toBeLessThan(beforeRate / 2);
    expect(withoutSuggestion.map((item) => item.id).sort()).toEqual([
      "mystery",
      "studio",
    ]);
  });

  it("returns merchant names, item previews, categories and suggestions", async () => {
    const { byId, summary } = await month();
    // LINE Pay「連支＊」取出真正的商家；系統規則依商家名稱分類。
    expect(byId.get("beef-1")).toMatchObject({
      merchantKey: "name:老王牛肉麵",
      displayName: "老王牛肉麵",
      merchantPaymentMethod: "line_pay",
      categoryId: "food",
      classificationSource: "system_rule",
    });
    // 「NETFLIX」含有 etf，不再被投資關鍵字誤判。
    expect(byId.get("stream")).toMatchObject({
      economicRole: "spending",
      categoryId: "entertainment",
    });
    // 配對成功的交易以發票的商家（統編）為準，並沿用發票品項。
    // 品項關鍵字的建議直接套用（categorySource = auto_suggestion）。
    expect(byId.get("lunch")).toMatchObject({
      merchantKey: "ban:33333333",
      displayName: "已田商行",
      itemsPreview: ["排骨便當", "紅茶"],
      categoryId: "food",
      category: "餐飲",
      categorySource: "auto_suggestion",
      suggestedCategoryId: "food",
      suggestionSource: "item_keywords",
    });
    // 超商由系統規則分到「餐飲」；餐飲沒有子類（0067），頂層就是最終分類，不再細分。
    expect(byId.get("seven")).toMatchObject({
      merchantKey: "ban:22222222",
      itemsPreview: ["大杯拿鐵", "茶葉蛋"],
      categoryId: "food",
      categorySource: "rule",
      classificationSource: "system_rule",
    });
    expect(byId.get("seven")?.suggestedCategoryId).toBeUndefined();
    expect(byId.get("inv-seven")).toMatchObject({
      duplicateOf: { kind: "bank_transaction", id: "seven" },
      categoryId: "food",
      categorySource: "rule",
    });
    expect(byId.get("beef-1")?.categorySource).toBe("rule");
    expect(byId.get("mystery")?.categorySource).toBe("none");
    expect(byId.get("inv-breakfast")).toMatchObject({
      merchantKey: "name:巷口早餐店",
      categoryId: "food",
      itemsPreview: ["蛋餅", "豆漿(大)"],
    });
    expect(byId.get("inv-grocer")).toMatchObject({
      merchantKey: "ban:11111111",
      categoryId: "shopping",
      categorySource: "auto_suggestion",
      suggestedCategoryId: "shopping",
      suggestionSource: "item_keywords",
    });
    expect(byId.get("topup")).toMatchObject({
      economicRole: "own_transfer",
      categoryId: "other",
    });
    expect(byId.get("topup")?.suggestedCategoryId).toBeUndefined();
    expect(byId.get("salary")).toMatchObject({
      economicRole: "income",
      categoryId: "income.salary",
    });

    // spendingByCategory 以自動套用後的分類計算。
    expect(summary.spendingByCategory).toEqual({
      housing: 20000,
      food: 120 + 85 + 1200 + 75 + 180 * 3 + 350,
      transport: 250,
      entertainment: 390,
      tech: 600,
      shopping: 240,
      other: 999 + 600,
    });
    // 消費分類沒有子類：spendingBySubcategory 與 spendingByCategory 相同（自訂分類除外）。
    expect(summary.spendingBySubcategory).toEqual(summary.spendingByCategory);
    expect(
      Object.values(summary.spendingByCategory).reduce((a, b) => a + b, 0),
    ).toBe(summary.spending);
  });

  it("renames a merchant and applies the alias to every past transaction", async () => {
    const response = await send(
      "PUT",
      `/api/merchants/${encodeURIComponent("name:老王牛肉麵")}`,
      { displayName: "老王（公司樓下）" },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      merchantKey: "name:老王牛肉麵",
      alias: { displayName: "老王（公司樓下）", categoryId: null },
    });
    const { byId } = await month();
    for (const id of ["beef-1", "beef-2", "beef-3"])
      expect(byId.get(id)).toMatchObject({
        displayName: "老王（公司樓下）",
        merchantName: "老王牛肉麵",
      });

    const search = await app.request(
      `/api/activity/search?${new URLSearchParams({ q: "公司樓下" })}`,
      {},
      env,
    );
    const found = (await search.json()) as { items: Item[] };
    expect(found.items.map((item) => item.id).sort()).toEqual([
      "beef-1",
      "beef-2",
      "beef-3",
    ]);
  });

  it("turns a merchant category into a retroactive rule", async () => {
    await send(
      "PUT",
      `/api/merchants/${encodeURIComponent("name:老王牛肉麵")}`,
      { categoryId: "food" },
    );
    // 依發票統編設定：已配對的刷卡交易一併套用。
    await send("PUT", `/api/merchants/${encodeURIComponent("ban:22222222")}`, {
      categoryId: "food",
    });
    const { byId } = await month();
    for (const id of ["beef-1", "beef-2", "beef-3"]) {
      expect(byId.get(id)).toMatchObject({
        categoryId: "food",
        classificationSource: "merchant_rule",
        displayName: "老王（公司樓下）",
      });
      expect(byId.get(id)?.suggestedCategoryId).toBeUndefined();
    }
    expect(byId.get("seven")).toMatchObject({
      categoryId: "food",
      classificationSource: "merchant_rule",
    });

    const bank = await app.request("/api/bank?month=2026-09", {}, env);
    const rows = new Map(
      (
        (await bank.json()) as {
          transactions: Array<Record<string, unknown> & { id: string }>;
        }
      ).transactions.map((row) => [row.id, row]),
    );
    expect(rows.get("seven")).toMatchObject({
      merchantKey: "ban:22222222",
      displayName: "統一超商",
      itemsPreview: ["大杯拿鐵", "茶葉蛋"],
      categoryId: "food",
      classification: { categoryId: "food", source: "merchant_rule" },
    });
    expect(rows.get("beef-2")).toMatchObject({
      categoryId: "food",
      displayName: "老王（公司樓下）",
    });

    // 個別覆寫仍優先於商家規則。
    await send("PUT", "/api/classification/overrides/bank_transaction/beef-3", {
      categoryId: "misc",
    });
    expect((await month()).byId.get("beef-3")).toMatchObject({
      categoryId: "misc",
      classificationSource: "override",
    });
    await send(
      "DELETE",
      "/api/classification/overrides/bank_transaction/beef-3",
    );
  });

  it("applies a merchant economic role to past transactions", async () => {
    const before = (await month()).summary.spending;
    await send("PUT", `/api/merchants/${encodeURIComponent("name:某某")}`, {
      economicRole: "own_transfer",
    });
    const { byId, summary } = await month();
    expect(byId.get("mystery")).toMatchObject({
      economicRole: "own_transfer",
      reviewStatus: "confirmed",
      roleReason: "merchant_rule",
    });
    expect(summary.spending).toBe(before - 999);
    expect(summary.ownTransfer).toBe(2000 + 999);
  });

  it("batch-categorizes activities and learns merchant history", async () => {
    const response = await send("POST", "/api/activity/categorize", {
      targets: [{ kind: "bank_transaction", id: "studio" }],
      categoryId: "misc",
      applyToMerchant: false,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ updated: 1, merchantRules: [] });

    // 接受建議並寫成商家規則。
    const lunch = await send("POST", "/api/activity/categorize", {
      targets: [
        { kind: "bank_transaction", id: "lunch", merchantKey: "ban:33333333" },
        { kind: "invoice", id: "inv-grocer", categoryId: "shopping" },
      ],
      categoryId: "food",
      applyToMerchant: true,
    });
    expect(await lunch.json()).toEqual({
      updated: 2,
      merchantRules: [
        { merchantKey: "ban:33333333", categoryId: "food" },
        { merchantKey: "ban:11111111", categoryId: "shopping" },
      ],
    });
    const { byId } = await month();
    expect(byId.get("studio")).toMatchObject({
      categoryId: "misc",
      classificationSource: "override",
    });
    expect(byId.get("lunch")).toMatchObject({
      categoryId: "food",
      classificationSource: "merchant_rule",
    });
    expect(byId.get("inv-grocer")).toMatchObject({
      categoryId: "shopping",
      classificationSource: "merchant_rule",
    });

    // 同商家的新交易：以使用者過去的選擇為建議。
    await harness.binding
      .prepare(
        "INSERT INTO bank_transactions (id, connector_id, account_id, source_id, posted_date, amount, currency, description, created_at, updated_at) VALUES ('studio-2', 'esun', 'card-a', 'studio-2', '2026-09-28', -800, 'TWD', '阿明工作室', ?1, ?1)",
      )
      .bind(now)
      .run();
    expect((await month()).byId.get("studio-2")).toMatchObject({
      categoryId: "misc",
      categorySource: "auto_suggestion",
      suggestedCategoryId: "misc",
      suggestionSource: "merchant_history",
    });

    expect(
      (
        await send("POST", "/api/activity/categorize", {
          targets: [{ kind: "bank_transaction", id: "missing" }],
          categoryId: "food",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await send("POST", "/api/activity/categorize", {
          targets: [{ kind: "bank_transaction", id: "stream" }],
          categoryId: "no-such-category",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await send("POST", "/api/activity/categorize", {
          targets: [{ kind: "bank_transaction", id: "stream" }],
        })
      ).status,
    ).toBe(400);
  });

  it("searches item names, display names and amounts", async () => {
    const search = async (q: string) => {
      const response = await app.request(
        `/api/activity/search?${new URLSearchParams({ q })}`,
        {},
        env,
      );
      expect(response.status).toBe(200);
      return ((await response.json()) as { items: Item[] }).items
        .map((item) => item.id)
        .sort();
    };
    expect(await search("蛋餅")).toEqual(["inv-breakfast"]);
    // 已配對的發票品項比對到刷卡交易。
    expect(await search("拿鐵")).toEqual(["seven"]);
    expect(await search("180")).toEqual(["beef-1", "beef-2", "beef-3"]);
    expect(await search(">1000")).toEqual([
      "grocery",
      "rent",
      "salary",
      "topup",
    ]);
    expect(await search("100-200")).toEqual([
      "beef-1",
      "beef-2",
      "beef-3",
      "coffee",
    ]);
    expect(await search("牛肉麵 <100")).toEqual([]);
  });

  it("lists, filters and deletes merchant rules", async () => {
    const response = await app.request(
      "/api/merchants?query=老王&months=12",
      {},
      env,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        merchantKey: "name:老王牛肉麵",
        displayName: "老王（公司樓下）",
        defaultName: "老王牛肉麵",
        activityCount: 3,
        spending: 540,
        topCategoryId: "food",
        paymentMethods: ["line_pay"],
        alias: expect.objectContaining({
          displayName: "老王（公司樓下）",
          categoryId: "food",
          economicRole: null,
        }),
      },
    ]);
    const key = encodeURIComponent("name:老王牛肉麵");
    expect((await send("DELETE", `/api/merchants/${key}`)).status).toBe(200);
    expect((await send("DELETE", `/api/merchants/${key}`)).status).toBe(404);
    expect(
      (
        await send("PUT", `/api/merchants/${encodeURIComponent("ban:12")}`, {
          displayName: "x",
        })
      ).status,
    ).toBe(400);
    expect(
      (await send("PUT", `/api/merchants/${key}`, { categoryId: "nope" }))
        .status,
    ).toBe(404);
    const { byId } = await month();
    // 刪除商家規則後回到系統規則。
    expect(byId.get("beef-1")).toMatchObject({
      displayName: "老王牛肉麵",
      categoryId: "food",
      classificationSource: "system_rule",
    });
  });

  it("exposes the category tree with emoji and fixed colors", async () => {
    const response = await app.request(
      "/api/classification/categories",
      {},
      env,
    );
    const rows = (await response.json()) as Array<{
      id: string;
      parentId: string | null;
      emoji: string;
      color: { light: string; dark: string };
      kind: string;
    }>;
    expect(rows.find((row) => row.id === "food")).toMatchObject({
      parentId: null,
      emoji: "🍜",
      kind: "spending",
      color: { light: "#2a78d6", dark: "#3987e5" },
    });
    // 0067 起消費只有 8 個頂層分類，沒有子類。
    expect(
      rows.filter((row) => row.kind === "spending").map((row) => row.id),
    ).toEqual([
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
    expect(
      rows.filter((row) => row.kind === "spending" && row.parentId !== null),
    ).toEqual([]);
    expect(rows.map((row) => row.id)).not.toContain("salary");
    expect(beforeRate).toBeGreaterThan(0);
  });
});
