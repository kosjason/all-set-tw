import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { BudgetSummary, WeeklyReview } from "@taiwan-fin-hub/core";
import { budgetRoutes } from "../../../src/features/budget/route";
import {
  getBudget,
  getWeeklyReview,
} from "../../../src/features/budget/service";
import { honoFactory } from "../../../src/platform/hono";
import { apiErrorResponse } from "../../../src/platform/http";
import type { Env } from "../../../src/platform/env";
import { createTestD1 } from "../../../../../packages/db/testing/d1";

/** 合成資料：台北 2026-09-21（週一）。薪資每月 5 日入帳，訂閱每月 10 日扣款。 */
const NOW = new Date("2026-09-21T04:00:00.000Z");
const CREATED = "2026-06-01T00:00:00.000Z";

type Tx = {
  id: string;
  account: "dep" | "card";
  day: string;
  amount: number;
  description: string;
};

const MONTHS = ["2026-06", "2026-07", "2026-08", "2026-09"];
const transactions: Tx[] = [
  ...MONTHS.map((month) => ({
    id: `salary-${month}`,
    account: "dep" as const,
    day: `${month}-05`,
    amount: 160000,
    description: "薪資",
  })),
  ...MONTHS.filter((month) => month !== "2026-09").map((month) => ({
    id: `stream-${month}`,
    account: "card" as const,
    day: `${month}-10`,
    amount: -390,
    description: "串流影音訂閱",
  })),
  ...MONTHS.map((month, index) => ({
    id: `grocery-${month}`,
    account: "card" as const,
    day: `${month}-15`,
    amount: -(1000 + index * 2000),
    description: "超市採買",
  })),
  // 週回顧：上週（09-14 起）兩筆、本週一一筆。
  {
    id: "dinner",
    account: "card",
    day: "2026-09-16",
    amount: -2500,
    description: "燒肉晚餐",
  },
  {
    id: "coffee",
    account: "card",
    day: "2026-09-21",
    amount: -150,
    description: "咖啡豆專賣",
  },
];

describe("budget API", () => {
  let harness: Awaited<ReturnType<typeof createTestD1>>;
  let db: D1Database;
  const app = honoFactory.createApp();
  app.route("/api", budgetRoutes);
  app.onError(apiErrorResponse);

  async function request(path: string, init?: RequestInit) {
    return app.request(`http://localhost/api${path}`, init, {
      DB: db,
    } as unknown as Env);
  }

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    harness = await createTestD1();
    db = harness.binding;
    await db.batch([
      db
        .prepare(
          "INSERT INTO bank_accounts (id, connector_id, source_id, institution_name, account_name, account_type, bank_code, created_at, updated_at) VALUES ('dep', 'cathaybk', 'bank:cathaybk:000012345678', '國泰世華銀行', '國泰臺幣帳戶', 'savings', '013', ?1, ?1), ('card', 'taishin', 'credit:taishin:main', '台新銀行', '台新信用卡', 'credit', NULL, ?1, ?1)",
        )
        .bind(CREATED),
      ...transactions.map((tx) =>
        db
          .prepare(
            "INSERT INTO bank_transactions (id, connector_id, account_id, source_id, posted_date, authorized_at, amount, currency, description, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?1, ?4, ?4, ?5, 'TWD', ?6, 'posted', ?7, ?7)",
          )
          .bind(
            tx.id,
            tx.account === "dep" ? "cathaybk" : "taishin",
            tx.account,
            tx.day,
            tx.amount,
            tx.description,
            CREATED,
          ),
      ),
    ]);
  }, 60_000);

  afterAll(async () => {
    vi.useRealTimers();
    await harness?.mf.dispose();
  });

  it("infers income and lists stable monthly merchants as candidates", async () => {
    const budget = await getBudget(db, NOW);
    expect(budget).toMatchObject({
      month: "2026-09",
      today: "2026-09-21",
      daysLeft: 10,
      expectedIncome: { amount: 160000, source: "history" },
    });
    // 超市金額每月變動超過 1.5 倍，不列入候選。
    expect(budget.candidates.map((candidate) => candidate.displayName)).toEqual(
      [expect.stringContaining("串流影音")],
    );
    expect(budget.candidates[0]!.monthlyAmounts).toEqual([390, 390, 390]);
    // 本月已花：超市 7000 + 燒肉 2500 + 咖啡 150。
    expect(budget.spent).toBe(9650);
    expect(budget.available).toBe(160000 - 9650);
  });

  it("reserves a confirmed monthly merchant that has not been charged yet", async () => {
    const before = await getBudget(db, NOW);
    const stream = before.candidates[0]!;
    const saved = await request(
      `/budget/merchants/${encodeURIComponent(stream.merchantKey)}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "monthly",
          displayName: stream.displayName,
          expectedAmount: null,
        }),
      },
    );
    expect(saved.status).toBe(200);

    const settings = await request("/budget/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedIncome: null,
        savingsTargetType: "percent",
        savingsTargetValue: 25,
        annualReserve: 12000,
      }),
    });
    expect(settings.status).toBe(200);

    const budget = (await (await request("/budget")).json()) as BudgetSummary;
    expect(budget.candidates).toEqual([]);
    expect(budget.fixedMerchants).toEqual([
      expect.objectContaining({
        merchantKey: stream.merchantKey,
        kind: "monthly",
        expectedAmount: 390,
        expectedAmountSource: "history",
        paidThisMonth: 0,
      }),
    ]);
    expect(budget).toMatchObject({
      savingsTarget: 40000,
      monthlyReserve: 1000,
      fixedRemaining: 390,
      available: 160000 - 40000 - 1000 - 9650 - 390,
    });

    const removed = await request(
      `/budget/merchants/${encodeURIComponent(stream.merchantKey)}`,
      { method: "DELETE" },
    );
    expect(removed.status).toBe(200);
    const missing = await request(
      `/budget/merchants/${encodeURIComponent(stream.merchantKey)}`,
      { method: "DELETE" },
    );
    expect(missing.status).toBe(404);
  });

  it("rejects invalid settings, merchant keys and weeks", async () => {
    const put = (path: string, body: unknown) =>
      request(path, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    expect(
      (
        await put("/budget/settings", {
          expectedIncome: 100,
          savingsTargetType: "percent",
          savingsTargetValue: 120,
          annualReserve: 0,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await put("/budget/settings", {
          expectedIncome: -1,
          savingsTargetType: "amount",
          savingsTargetValue: 0,
          annualReserve: 0,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await put("/budget/merchants/not-a-key", {
          kind: "monthly",
          displayName: "x",
          expectedAmount: null,
        })
      ).status,
    ).toBe(400);
    expect((await request("/budget/week?start=2026-09-15")).status).toBe(400);
    expect((await request("/budget/week?start=2026-10-05")).status).toBe(400);
  });

  it("reviews last week against the past weeks", async () => {
    const review = (await (
      await request("/budget/week?start=2026-09-14")
    ).json()) as WeeklyReview;
    expect(review).toMatchObject({
      weekStart: "2026-09-14",
      weekEnd: "2026-09-20",
      complete: true,
      // 超市 7000（09-15）+ 燒肉 2500（09-16）。
      total: 9500,
      // 週一看上週：週六、日的刷卡可能還沒入帳。
      possiblyIncompleteFrom: "2026-09-19",
    });
    expect(review.largest.map((largest) => largest.amount)).toEqual([
      7000, 2500,
    ]);
    expect(review.newMerchants.map((merchant) => merchant.displayName)).toEqual(
      [expect.stringContaining("燒肉")],
    );

    const current = await getWeeklyReview(db, "2026-09-21", NOW);
    expect(current).toMatchObject({
      complete: false,
      elapsedDays: 1,
      total: 150,
      // 不早於這週週一。
      possiblyIncompleteFrom: "2026-09-21",
    });
  });
});
