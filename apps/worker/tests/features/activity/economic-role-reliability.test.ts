import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ActivityMonthSummary } from "@taiwan-fin-hub/core";
import { activityRoutes } from "../../../src/features/activity/route";
import { bankRoutes } from "../../../src/features/bank/route";
import { honoFactory } from "../../../src/platform/hono";
import { apiErrorResponse } from "../../../src/platform/http";
import type { Env } from "../../../src/platform/env";
import { createTestD1 } from "../../../../../packages/db/testing/d1";

// 合成資料；帳號只用假末碼。只有國泰世華信用卡有同步。
const now = "2026-09-30T00:00:00.000Z";

const transactions = [
  {
    id: "pay-cathay",
    amount: -18000,
    description: "信用卡款",
    counterparty: "國泰世華卡",
  },
  {
    id: "pay-ctbc-text",
    amount: -5000,
    description: "信用卡款",
    counterparty: "中信卡",
  },
  {
    id: "pay-ctbc-code",
    amount: -4000,
    description: "繳信用卡費",
    bankCode: "822",
    suffix: "11111",
  },
  { id: "pay-unknown", amount: -3000, description: "繳信用卡費" },
  // 已登記為未同步卡片：既有規則優先，繳款就是消費。
  {
    id: "pay-registered",
    amount: -2000,
    description: "繳信用卡費",
    bankCode: "810",
    suffix: "44444",
  },
  {
    id: "own-out",
    amount: -7000,
    description: "跨行轉出",
    bankCode: "812",
    suffix: "22222",
  },
  { id: "meal", amount: -600, description: "好吃餐廳" },
] as const satisfies ReadonlyArray<{
  id: string;
  amount: number;
  description: string;
  counterparty?: string;
  bankCode?: string;
  suffix?: string;
}>;

/** 讓符合 pattern 的 SQL 在 prepare 時失敗，模擬資料表無法讀取。 */
function failingDb(db: D1Database, pattern: RegExp): D1Database {
  return new Proxy(db, {
    get(target, property) {
      if (property === "prepare")
        return (query: string) => {
          if (pattern.test(query)) throw new Error("simulated D1 failure");
          return target.prepare(query);
        };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

describe("economic role reliability", () => {
  let harness: Awaited<ReturnType<typeof createTestD1>>;
  const app = honoFactory.createApp();
  app.route("/api", activityRoutes);
  app.route("/api", bankRoutes);
  app.onError(apiErrorResponse);

  beforeAll(async () => {
    harness = await createTestD1();
    const db = harness.binding;
    await db.batch([
      db
        .prepare(
          "INSERT INTO bank_accounts (id, connector_id, source_id, institution_name, account_type, created_at, updated_at) VALUES ('dep', 'esun', 'bank:esun:0000', '玉山銀行', 'savings', ?1, ?1), ('card', 'cathaybk', 'card:cathaybk:0000', '國泰世華', 'credit', ?1, ?1)",
        )
        .bind(now),
      db
        .prepare(
          "INSERT INTO own_accounts (id, kind, bank_code, account_suffix, label, created_at, updated_at) VALUES ('own:dbs', 'unsynced_card', '810', '44444', NULL, ?1, ?1), ('own:taishin', 'own_account', '812', '22222', NULL, ?1, ?1)",
        )
        .bind(now),
      ...transactions.map((tx, index) =>
        db
          .prepare(
            "INSERT INTO bank_transactions (id, connector_id, account_id, source_id, posted_date, amount, currency, description, counterparty, counterparty_bank_code, counterparty_account_suffix, created_at, updated_at) VALUES (?1, 'esun', 'dep', ?1, ?2, ?3, 'TWD', ?4, ?5, ?6, ?7, ?8, ?8)",
          )
          .bind(
            tx.id,
            `2026-09-${String(index + 1).padStart(2, "0")}`,
            tx.amount,
            tx.description,
            "counterparty" in tx ? tx.counterparty : null,
            "bankCode" in tx ? tx.bankCode : null,
            "suffix" in tx ? tx.suffix : null,
            now,
          ),
      ),
      db
        .prepare(
          "INSERT INTO activity_role_overrides (target_kind, target_id, economic_role, created_at, updated_at) VALUES ('bank_transaction', 'meal', 'own_transfer', ?1, ?1)",
        )
        .bind(now),
    ]);
  }, 60_000);

  afterAll(async () => {
    await harness?.mf.dispose();
  });

  async function september(db: D1Database = harness.binding) {
    const response = await app.request(
      "/api/activity/summary?month=2026-09",
      {},
      { DB: db } as Env,
    );
    expect(response.status).toBe(200);
    return ((await response.json()) as { months: ActivityMonthSummary[] })
      .months[0];
  }

  it("only trusts card payments to issuers with a synced credit card", async () => {
    const response = await app.request("/api/bank?month=2026-09", {}, {
      DB: harness.binding,
    } as Env);
    const rows = new Map(
      (
        (await response.json()) as {
          transactions: Array<Record<string, unknown> & { id: string }>;
        }
      ).transactions.map((row) => [row.id, row]),
    );
    expect(rows.get("pay-cathay")).toMatchObject({
      economicRole: "card_payment",
      reviewStatus: "auto",
      roleReason: "card_payment",
    });
    for (const id of ["pay-ctbc-text", "pay-ctbc-code", "pay-unknown"])
      expect(rows.get(id)).toMatchObject({
        economicRole: "card_payment",
        reviewStatus: "needs_review",
        roleReason: "possible_unsynced_card",
      });
    expect(rows.get("pay-registered")).toMatchObject({
      economicRole: "spending",
      roleReason: "unsynced_card",
    });

    expect(await september()).toMatchObject({
      cardPayment: 18000 + 5000 + 4000 + 3000,
      spending: 2000,
      ownTransfer: 7000 + 600,
      needsReview: { count: 3, amount: 12000 },
      complete: true,
      incompleteReasons: [],
    });
  });

  it("reports incomplete summaries when classification rules cannot load", async () => {
    const summary = await september(
      failingDb(harness.binding, /classification_rules/),
    );
    expect(summary.complete).toBe(false);
    expect(summary.incompleteReasons).toEqual(["classification_unavailable"]);
  });

  it("reports incomplete summaries when role overrides cannot load", async () => {
    const summary = await september(
      failingDb(harness.binding, /activity_role_overrides/),
    );
    expect(summary.complete).toBe(false);
    expect(summary.incompleteReasons).toEqual(["role_overrides_unavailable"]);
    // override 沒套用時，餐費回到推導出的消費。
    expect(summary.spending).toBe(2000 + 600);
  });

  it("reports incomplete summaries when own accounts cannot load", async () => {
    const summary = await september(
      failingDb(harness.binding, /"own_accounts"/),
    );
    expect(summary.incompleteReasons).toEqual(["own_accounts_unavailable"]);
  });
});
