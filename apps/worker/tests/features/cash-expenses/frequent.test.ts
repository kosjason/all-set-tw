import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FrequentCashExpense } from "@taiwan-fin-hub/shared";
import { cashExpenseRoutes } from "../../../src/features/cash-expenses/route";
import { honoFactory } from "../../../src/platform/hono";
import { apiErrorResponse } from "../../../src/platform/http";
import type { Env } from "../../../src/platform/env";
import { createTestD1 } from "../../helpers/d1";

// 合成資料：虛構的現金支出。台北今天是 2026-10-11，「常用」看 2026-07-13（含）之後；
// 豆花在邊界上但排第 9，被 8 個的上限擋掉。

const rows: Array<[string, number, string, string | null, string]> = [
  // 日期、金額、分類、說明、建立時間
  ["2026-10-01", 35, "food", "鮮奶茶", "2026-10-01T01:00:00.000Z"],
  ["2026-10-05", 35, "food", "鮮奶茶", "2026-10-05T01:00:00.000Z"],
  ["2026-10-09", 35, "food", "鮮奶茶", "2026-10-09T01:00:00.000Z"],
  ["2026-10-10", 50, "food", "鮮奶茶", "2026-10-10T01:00:00.000Z"],
  ["2026-10-11", 60, "food", "早餐", "2026-10-11T01:00:00.000Z"],
  ["2026-09-20", 200, "transport", "計程車", "2026-09-20T01:00:00.000Z"],
  ["2026-09-21", 200, "transport", "計程車", "2026-09-21T01:00:00.000Z"],
  // 沒有說明的不列入；超過 90 天的不列入。
  ["2026-10-08", 100, "misc", null, "2026-10-08T01:00:00.000Z"],
  ["2026-10-08", 100, "misc", null, "2026-10-08T02:00:00.000Z"],
  ["2026-10-08", 100, "misc", null, "2026-10-08T03:00:00.000Z"],
  ["2026-10-08", 100, "misc", null, "2026-10-08T04:00:00.000Z"],
  ["2026-07-12", 500, "shopping", "夜市", "2026-07-12T01:00:00.000Z"],
  ["2026-07-12", 500, "shopping", "夜市", "2026-07-12T02:00:00.000Z"],
  ["2026-07-12", 500, "shopping", "夜市", "2026-07-12T03:00:00.000Z"],
  ["2026-07-12", 500, "shopping", "夜市", "2026-07-12T04:00:00.000Z"],
  ["2026-07-13", 80, "food", "豆花", "2026-07-13T01:00:00.000Z"],
  // 只記過一次的依最近日期排，最多 8 個。
  ["2026-08-01", 10, "food", "一", "2026-08-01T01:00:00.000Z"],
  ["2026-08-02", 20, "food", "二", "2026-08-02T01:00:00.000Z"],
  ["2026-08-03", 30, "food", "三", "2026-08-03T01:00:00.000Z"],
  ["2026-08-04", 40, "food", "四", "2026-08-04T01:00:00.000Z"],
];

describe("frequent cash expenses", () => {
  let harness: Awaited<ReturnType<typeof createTestD1>>;
  let env: Env;
  const app = honoFactory.createApp();
  app.route("/api", cashExpenseRoutes);
  app.onError(apiErrorResponse);

  beforeAll(async () => {
    vi.useFakeTimers({ now: new Date("2026-10-11T04:00:00.000Z") });
    harness = await createTestD1();
    const db = harness.binding;
    env = { DB: db } as Env;
    await db.batch(
      rows.map(([date, amount, categoryId, description, createdAt]) =>
        db
          .prepare(
            "INSERT INTO cash_expenses (id, expense_date, amount, category_id, description, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
          )
          .bind(
            crypto.randomUUID(),
            date,
            amount,
            categoryId,
            description,
            createdAt,
          ),
      ),
    );
  }, 60_000);

  afterAll(async () => {
    vi.useRealTimers();
    await harness?.mf.dispose();
  });

  it("ranks recent described expenses by uses, then by the latest date", async () => {
    const response = await app.request("/api/cash-expenses/frequent", {}, env);
    expect(response.status).toBe(200);
    const { items } = (await response.json()) as {
      items: FrequentCashExpense[];
    };
    expect(items).toEqual([
      {
        description: "鮮奶茶",
        amount: 35,
        categoryId: "food",
        uses: 3,
        lastDate: "2026-10-09",
      },
      {
        description: "計程車",
        amount: 200,
        categoryId: "transport",
        uses: 2,
        lastDate: "2026-09-21",
      },
      {
        description: "早餐",
        amount: 60,
        categoryId: "food",
        uses: 1,
        lastDate: "2026-10-11",
      },
      {
        description: "鮮奶茶",
        amount: 50,
        categoryId: "food",
        uses: 1,
        lastDate: "2026-10-10",
      },
      expect.objectContaining({ description: "四" }),
      expect.objectContaining({ description: "三" }),
      expect.objectContaining({ description: "二" }),
      expect.objectContaining({ description: "一" }),
    ]);
  });
});
