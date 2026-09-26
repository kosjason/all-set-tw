import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ActivityMonthSummary } from "@taiwan-fin-hub/core";
import { activityRoutes } from "../../../src/features/activity/route";
import { activityRoleRoutes } from "../../../src/features/activity-roles/route";
import { bankRoutes } from "../../../src/features/bank/route";
import { honoFactory } from "../../../src/platform/hono";
import { apiErrorResponse } from "../../../src/platform/http";
import type { Env } from "../../../src/platform/env";
import { createTestD1 } from "../../../../../packages/db/testing/d1";

// 合成資料重現「9 月以為沒存錢」的情境；帳號只用假末碼。
const now = "2026-09-30T00:00:00.000Z";

type Tx = {
  id: string;
  account?: "dep-a" | "card-a";
  day: string;
  amount: number;
  description: string;
  counterparty?: string;
  bankCode?: string;
  suffix?: string;
};

const transactions: Tx[] = [
  // 薪水經企網轉帳入帳，被分類成「轉帳」（id 避開薪資關鍵字，分類會比對 source_id）。
  {
    id: "company-in",
    day: "2026-09-05",
    amount: 162000,
    description: "企網非約轉帳",
    counterparty: "某科技公司",
  },
  {
    id: "invest",
    day: "2026-09-06",
    amount: -42000,
    description: "證券交割款",
  },
  // 轉到自己未同步的台新帳戶。
  {
    id: "own",
    day: "2026-09-07",
    amount: -20000,
    description: "跨行轉出",
    bankCode: "812",
    suffix: "22222",
  },
  // 國泰卡費：銀行端「信用卡款」與卡片端繳款兩邊都出現。
  {
    id: "ccpay",
    day: "2026-09-08",
    amount: -18000,
    description: "信用卡款",
    counterparty: "國泰世華卡",
  },
  {
    id: "ccpay-card",
    account: "card-a",
    day: "2026-09-08",
    amount: 18000,
    description: "本行自動扣繳",
    counterparty: "國泰世華信用卡繳款",
  },
  { id: "rent", day: "2026-09-01", amount: -20000, description: "房租繳納" },
  // 繳未同步的信用卡：看不到明細，繳款就是消費。
  {
    id: "unsynced",
    day: "2026-09-12",
    amount: -6000,
    description: "跨行轉出",
    bankCode: "810",
    suffix: "33333",
  },
  { id: "topup", day: "2026-09-20", amount: -5000, description: "全支付儲值" },
  { id: "misc", day: "2026-09-21", amount: -1000, description: "雜項支出" },
  // 給別人（或自己沒登記的帳戶）的轉帳，需要使用者確認。
  {
    id: "to-friend",
    day: "2026-09-15",
    amount: -27000,
    description: "跨行轉出",
    bankCode: "012",
    suffix: "66666",
  },
  {
    id: "to-relative",
    day: "2026-09-16",
    amount: -47500,
    description: "轉帳 換人民幣",
  },
  {
    id: "shop",
    account: "card-a",
    day: "2026-09-02",
    amount: -12000,
    description: "全聯福利中心",
  },
  {
    id: "meal",
    account: "card-a",
    day: "2026-09-03",
    amount: -1200,
    description: "好吃餐廳",
  },
  {
    id: "shop-a",
    account: "card-a",
    day: "2026-09-09",
    amount: -3000,
    description: "商店甲",
  },
  {
    id: "shop-b",
    account: "card-a",
    day: "2026-09-11",
    amount: -3000,
    description: "商店乙",
  },
  {
    id: "august",
    account: "card-a",
    day: "2026-08-31",
    amount: -999,
    description: "咖啡",
  },
];

const invoices = [
  // 與刷卡同日同額，自動配對 → 重複。
  { id: "inv-meal", day: "2026-09-03", amount: 1200, seller: "好吃餐廳" },
  // 前後各一天都有同額刷卡、賣方名稱也無法區分，無法唯一配對 → needs_review。
  { id: "inv-ambiguous", day: "2026-09-10", amount: 3000, seller: "連鎖商店" },
  // 電支儲值買的東西：儲值是移轉，發票才是消費。
  { id: "inv-wallet", day: "2026-09-20", amount: 4800, seller: "某超商" },
];

/** 真實消費：房租、刷卡、未同步卡費、電支消費的發票。 */
const TRUE_SPENDING = 20000 + 12000 + 1200 + 3000 + 3000 + 6000 + 4800;

describe("economic roles and monthly summary", () => {
  let harness: Awaited<ReturnType<typeof createTestD1>>;
  let env: Env;
  const app = honoFactory.createApp();
  app.route("/api", activityRoutes);
  app.route("/api", activityRoleRoutes);
  app.route("/api", bankRoutes);
  app.onError(apiErrorResponse);

  beforeAll(async () => {
    harness = await createTestD1();
    const db = harness.binding;
    env = { DB: db } as Env;
    await db.batch([
      db
        .prepare(
          "INSERT INTO bank_accounts (id, connector_id, source_id, institution_name, account_type, created_at, updated_at) VALUES ('dep-a', 'cathaybk', 'bank:cathaybk:0000', '國泰世華', 'savings', ?1, ?1), ('card-a', 'cathaybk', 'card:cathaybk:0000', '國泰世華', 'credit', ?1, ?1)",
        )
        .bind(now),
      db
        .prepare(
          "INSERT INTO own_accounts (id, kind, bank_code, account_suffix, label, created_at, updated_at) VALUES ('own:taishin', 'own_account', '812', '22222', NULL, ?1, ?1), ('own:card', 'unsynced_card', '810', '33333', NULL, ?1, ?1)",
        )
        .bind(now),
      ...transactions.map((tx) =>
        db
          .prepare(
            "INSERT INTO bank_transactions (id, connector_id, account_id, source_id, posted_date, amount, currency, description, counterparty, counterparty_bank_code, counterparty_account_suffix, created_at, updated_at) VALUES (?1, 'cathaybk', ?2, ?1, ?3, ?4, 'TWD', ?5, ?6, ?7, ?8, ?9, ?9)",
          )
          .bind(
            tx.id,
            tx.account ?? "dep-a",
            tx.day,
            tx.amount,
            tx.description,
            tx.counterparty ?? null,
            tx.bankCode ?? null,
            tx.suffix ?? null,
            now,
          ),
      ),
      ...invoices.map((invoice) =>
        db
          .prepare(
            "INSERT INTO invoices (id, connector_id, source_id, invoice_date, seller_name, amount, created_at, updated_at) VALUES (?1, 'einvoice', ?1, ?2, ?3, ?4, ?5, ?5)",
          )
          .bind(invoice.id, invoice.day, invoice.seller, invoice.amount, now),
      ),
      // 使用者手動把「雜項支出」設為不計入。
      db
        .prepare(
          "INSERT INTO bank_transaction_preferences (transaction_id, excluded_from_calculation, created_at, updated_at) VALUES ('misc', 1, ?1, ?1)",
        )
        .bind(now),
    ]);
  }, 60_000);

  afterAll(async () => {
    await harness?.mf.dispose();
  });

  async function september(): Promise<ActivityMonthSummary> {
    const response = await app.request(
      "/api/activity/summary?month=2026-09",
      {},
      env,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { months: ActivityMonthSummary[] };
    expect(body.months).toHaveLength(1);
    return body.months[0];
  }

  function put(path: string, body: unknown) {
    return app.request(
      `/api/activity/role-overrides/${path}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      env,
    );
  }

  it("keeps investment, own transfers, card payments and duplicates out of spending", async () => {
    const summary = await september();
    // 未確認的轉帳與無法唯一配對的發票仍先計入消費，但全部標成待確認。
    expect(summary).toMatchObject({
      month: "2026-09",
      income: 162000,
      spending: TRUE_SPENDING + 27000 + 47500 + 3000,
      investment: 42000,
      ownTransfer: 20000 + 5000 + 1000,
      cardPayment: 18000,
      saved: 162000 - (TRUE_SPENDING + 27000 + 47500 + 3000),
      needsReview: { count: 4, amount: 162000 + 27000 + 47500 + 3000 },
      duplicateExcluded: 1200,
      complete: true,
      missingCurrencies: [],
      dedupe: {
        invoicesMerged: 1,
        invoicesUnmatched: 1,
        invoicesAwaitingCard: 0,
        invoicesAmbiguous: 1,
      },
    });
    expect(
      Object.values(summary.spendingByCategory).reduce((a, b) => a + b, 0),
    ).toBe(summary.spending);
    expect(summary.spendingByCategory.investment).toBeUndefined();
  });

  it("returns role fields on bank rows and month items, keeping duplicates listed", async () => {
    const bank = await app.request("/api/bank?month=2026-09", {}, env);
    const rows = new Map(
      (
        (await bank.json()) as {
          transactions: Array<Record<string, unknown> & { id: string }>;
        }
      ).transactions.map((row) => [row.id, row]),
    );
    expect(rows.get("company-in")).toMatchObject({
      economicRole: "income",
      reviewStatus: "needs_review",
      duplicateOf: null,
    });
    expect(rows.get("ccpay")).toMatchObject({ economicRole: "card_payment" });
    expect(rows.get("ccpay-card")).toMatchObject({
      economicRole: "card_payment",
    });
    expect(rows.get("own")).toMatchObject({
      economicRole: "own_transfer",
      roleReason: "own_account",
    });
    expect(rows.get("unsynced")).toMatchObject({ economicRole: "spending" });
    expect(rows.get("topup")).toMatchObject({
      economicRole: "own_transfer",
      roleReason: "ewallet_topup",
    });
    expect(rows.get("misc")).toMatchObject({
      economicRole: "own_transfer",
      reviewStatus: "confirmed",
      roleReason: "calculation_preference",
    });
    expect(rows.get("invest")).toMatchObject({
      economicRole: "investment",
      investmentEventKind: null,
    });

    const response = await app.request(
      "/api/activity/items?month=2026-09",
      {},
      env,
    );
    const body = (await response.json()) as {
      items: Array<Record<string, unknown> & { id: string; source: string }>;
      summary: ActivityMonthSummary;
    };
    const items = new Map(body.items.map((item) => [item.id, item]));
    expect(items.has("august")).toBe(false);
    expect(items.get("inv-meal")).toMatchObject({
      source: "invoice",
      duplicateOf: { kind: "bank_transaction", id: "meal" },
    });
    expect(items.get("inv-meal")).toMatchObject({
      matchStatus: "matched_card",
      matchedTransactionId: "meal",
    });
    expect(items.get("meal")).toMatchObject({
      invoiceId: "inv-meal",
      matchedInvoiceId: "inv-meal",
    });
    expect(items.get("shop")).toMatchObject({ matchedInvoiceId: null });
    expect(items.get("inv-ambiguous")).toMatchObject({
      reviewStatus: "needs_review",
      roleReason: "invoice_ambiguous",
      matchStatus: "ambiguous",
      matchedTransactionId: null,
    });
    expect(items.get("inv-wallet")).toMatchObject({
      economicRole: "spending",
      reviewStatus: "auto",
      matchStatus: "unmatched",
    });
    expect(body.summary).toEqual(await september());
  });

  it("lists each source with its match status for the ledger tabs", async () => {
    async function view(source: string) {
      const response = await app.request(
        `/api/activity/sources?month=2026-09&source=${source}`,
        {},
        env,
      );
      expect(response.status).toBe(200);
      return (await response.json()) as {
        month: string;
        source: string;
        records: Array<Record<string, unknown> & { id: string }>;
        sourceCounts: Record<string, number>;
        dedupe: ActivityMonthSummary["dedupe"];
      };
    }
    const invoiceView = await view("invoice");
    expect(invoiceView.records.map(({ id }) => id).sort()).toEqual([
      "inv-ambiguous",
      "inv-meal",
      "inv-wallet",
    ]);
    expect(
      invoiceView.records.find(({ id }) => id === "inv-meal"),
    ).toMatchObject({
      matchStatus: "matched_card",
      matchedTransactionId: "meal",
      carrierType: null,
      carrierCardSuffix: null,
    });
    expect(invoiceView.dedupe).toEqual((await september()).dedupe);
    const cardView = await view("card");
    expect(cardView.records.every((record) => record.source === "card")).toBe(
      true,
    );
    expect(cardView.records.find(({ id }) => id === "meal")).toMatchObject({
      matchedInvoiceId: "inv-meal",
    });
    const bankView = await view("bank");
    expect(bankView.records.every((record) => record.source === "bank")).toBe(
      true,
    );
    expect(bankView.sourceCounts).toEqual({
      bank: bankView.records.length,
      card: cardView.records.length,
      invoice: 3,
    });
    expect(
      (
        await app.request(
          "/api/activity/sources?month=2026-09&source=investment",
          {},
          env,
        )
      ).status,
    ).toBe(400);
  });

  it("applies user overrides before every derived rule", async () => {
    expect(
      (await put("bank_transaction/company-in", { economicRole: "income" }))
        .status,
    ).toBe(200);
    expect(
      (
        await put("bank_transaction/to-friend", {
          economicRole: "own_transfer",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await put("bank_transaction/to-relative", {
          economicRole: "own_transfer",
        })
      ).status,
    ).toBe(200);
    const duplicate = await put("invoice/inv-ambiguous", {
      economicRole: "spending",
      duplicateOf: { kind: "bank_transaction", id: "shop-b" },
    });
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toMatchObject({
      targetKind: "invoice",
      targetId: "inv-ambiguous",
      economicRole: "spending",
      reviewStatus: "confirmed",
      duplicateOf: { kind: "bank_transaction", id: "shop-b" },
    });
    // override 也優先於系統規則（這裡把繳卡費改成消費再改回來）。
    await put("bank_transaction/ccpay", { economicRole: "spending" });
    expect((await september()).cardPayment).toBe(0);
    await app.request(
      "/api/activity/role-overrides/bank_transaction/ccpay",
      { method: "DELETE" },
      env,
    );

    const summary = await september();
    expect(summary).toMatchObject({
      income: 162000,
      spending: TRUE_SPENDING,
      investment: 42000,
      ownTransfer: 20000 + 5000 + 1000 + 27000 + 47500,
      cardPayment: 18000,
      saved: 162000 - TRUE_SPENDING,
      needsReview: { count: 0, amount: 0 },
      duplicateExcluded: 1200 + 3000,
    });

    const list = await app.request("/api/activity/role-overrides", {}, env);
    expect(
      ((await list.json()) as Array<{ targetId: string }>).map(
        (row) => row.targetId,
      ),
    ).toEqual(["company-in", "to-friend", "to-relative", "inv-ambiguous"]);
  });

  it("removes overrides and falls back to the derived role", async () => {
    const response = await app.request(
      "/api/activity/role-overrides/bank_transaction/to-friend",
      { method: "DELETE" },
      env,
    );
    expect(response.status).toBe(200);
    const summary = await september();
    expect(summary.needsReview).toEqual({ count: 1, amount: 27000 });
    expect(summary.spending).toBe(TRUE_SPENDING + 27000);

    const missing = await app.request(
      "/api/activity/role-overrides/bank_transaction/to-friend",
      { method: "DELETE" },
      env,
    );
    expect(missing.status).toBe(404);
  });

  it("validates override targets", async () => {
    expect(
      (await put("bank_transaction/missing", { economicRole: "income" }))
        .status,
    ).toBe(404);
    expect(
      (
        await put("invoice/inv-wallet", {
          economicRole: "spending",
          duplicateOf: { kind: "invoice", id: "inv-wallet" },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await put("invoice/inv-wallet", {
          economicRole: "spending",
          duplicateOf: { kind: "bank_transaction", id: "missing" },
        })
      ).status,
    ).toBe(404);
    expect((await put("trade/x", { economicRole: "income" })).status).toBe(400);
    expect(
      (await put("bank_transaction/company-in", { economicRole: "budget" }))
        .status,
    ).toBe(400);
  });

  it("returns a monthly trend", async () => {
    const response = await app.request(
      "/api/activity/summary?from=2026-08&to=2026-09",
      {},
      env,
    );
    const body = (await response.json()) as { months: ActivityMonthSummary[] };
    expect(body.months.map((month) => month.month)).toEqual([
      "2026-08",
      "2026-09",
    ]);
    expect(body.months[0]).toMatchObject({ spending: 999, income: 0 });
    expect(
      (
        await app.request(
          "/api/activity/summary?month=2026-09&months=3",
          {},
          env,
        )
      ).status,
    ).toBe(400);
    expect(
      (await app.request("/api/activity/summary?months=3", {}, env)).status,
    ).toBe(200);
  });
});
