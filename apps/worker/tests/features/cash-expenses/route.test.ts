import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type {
  ActivityExportResponse,
  ActivityItem,
  ActivityMonthSummary,
  CashExpense,
} from "@taiwan-fin-hub/shared";
import { activityRoutes } from "../../../src/features/activity/route";
import { activityRoleRoutes } from "../../../src/features/activity-roles/route";
import { cashExpenseRoutes } from "../../../src/features/cash-expenses/route";
import { honoFactory } from "../../../src/platform/hono";
import { apiErrorResponse } from "../../../src/platform/http";
import type { Env } from "../../../src/platform/env";
import { createTestD1 } from "../../helpers/d1";

// 合成資料：虛構帳戶與提款，不含任何真實資料。
const now = "2026-10-01T00:00:00.000Z";

const withdrawals = [
  { id: "w-aug", day: "2026-08-30", amount: -3000, description: "無卡提款 A1" },
  { id: "w-sep", day: "2026-09-03", amount: -5000, description: "無卡提款 B2" },
  {
    id: "w-advance",
    day: "2026-09-20",
    amount: -2000,
    description: "無卡提款 C3",
  },
  { id: "lunch", day: "2026-09-04", amount: -150, description: "合毅食堂" },
];

describe("cash expenses API", () => {
  let harness: Awaited<ReturnType<typeof createTestD1>>;
  let env: Env;
  const app = honoFactory.createApp();
  app.route("/api", activityRoutes);
  app.route("/api", activityRoleRoutes);
  app.route("/api", cashExpenseRoutes);
  app.onError(apiErrorResponse);

  beforeAll(async () => {
    vi.useFakeTimers({ now: new Date("2026-10-11T04:00:00.000Z") });
    harness = await createTestD1();
    const db = harness.binding;
    env = { DB: db } as Env;
    await db.batch([
      db
        .prepare(
          "INSERT INTO bank_accounts (id, connector_id, source_id, institution_name, account_name, account_last4, account_type, created_at, updated_at) VALUES ('dep-a', 'esun', 'bank:esun:0000', '某銀行', '活期存款', '0000', 'savings', ?1, ?1)",
        )
        .bind(now),
      ...withdrawals.map((tx) =>
        db
          .prepare(
            "INSERT INTO bank_transactions (id, connector_id, account_id, source_id, posted_date, amount, currency, description, created_at, updated_at) VALUES (?1, 'esun', 'dep-a', ?1, ?2, ?3, 'TWD', ?4, ?5, ?5)",
          )
          .bind(tx.id, tx.day, tx.amount, tx.description, now),
      ),
    ]);
  }, 60_000);

  afterAll(async () => {
    vi.useRealTimers();
    await harness?.mf.dispose();
  });

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

  async function create(body: Record<string, unknown>) {
    const response = await send("POST", "/api/cash-expenses", body);
    expect(response.status).toBe(201);
    return (await response.json()) as CashExpense;
  }

  async function month(value: string) {
    const response = await app.request(
      `/api/activity/items?month=${value}`,
      {},
      env,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      items: ActivityItem[];
      summary: ActivityMonthSummary;
    };
    return {
      ...body,
      byId: new Map(body.items.map((item) => [item.id, item])),
    };
  }

  it("rejects invalid input with messages the dialog can show", async () => {
    const cases: Array<[Record<string, unknown>, number, string]> = [
      [
        { date: "2026-09-05", amount: 0, categoryId: "food" },
        400,
        "INVALID_REQUEST",
      ],
      [
        { date: "2026-09-05", amount: 1.5, categoryId: "food" },
        400,
        "INVALID_REQUEST",
      ],
      [
        { date: "2026-02-30", amount: 100, categoryId: "food" },
        400,
        "INVALID_REQUEST",
      ],
      [
        { date: "2026-10-12", amount: 100, categoryId: "food" },
        400,
        "INVALID_REQUEST",
      ],
      [
        { date: "2026-09-05", amount: 100, categoryId: "income.salary" },
        400,
        "INVALID_CATEGORY",
      ],
      [
        { date: "2026-09-05", amount: 100, categoryId: "other" },
        400,
        "INVALID_CATEGORY",
      ],
      [
        { date: "2026-09-05", amount: 100, categoryId: "user:missing" },
        400,
        "INVALID_CATEGORY",
      ],
      [
        { date: "2026-09-05", amount: 100, categoryId: "food", extra: 1 },
        400,
        "INVALID_REQUEST",
      ],
      [
        {
          date: "2026-09-05",
          amount: 100,
          categoryId: "food",
          description: "x".repeat(101),
        },
        400,
        "INVALID_REQUEST",
      ],
    ];
    for (const [body, status, code] of cases) {
      const response = await send("POST", "/api/cash-expenses", body);
      expect(response.status, JSON.stringify(body)).toBe(status);
      const json = (await response.json()) as {
        error: { code: string; message: string };
      };
      expect(json.error.code).toBe(code);
      expect(json.error.message).toMatch(/[一-鿿]/u);
    }
    const missing = await send(
      "PUT",
      `/api/cash-expenses/${crypto.randomUUID()}`,
      { date: "2026-09-05", amount: 100, categoryId: "food" },
    );
    expect(missing.status).toBe(404);
    expect((await send("DELETE", "/api/cash-expenses/not-a-uuid")).status).toBe(
      404,
    );
  });

  it("splits a withdrawal into categories without changing the monthly total", async () => {
    const before = await month("2026-09");
    expect(before.byId.get("w-sep")?.cashWithdrawal).toEqual({
      allocated: 0,
      remaining: 5000,
    });
    const expense = await create({
      date: "2026-09-05",
      amount: 300,
      categoryId: "food",
      description: "  夜市   雞排 ",
    });
    expect(expense).toMatchObject({
      date: "2026-09-05",
      amount: 300,
      categoryId: "food",
      description: "夜市 雞排",
    });
    const after = await month("2026-09");
    expect(after.summary.spending).toBe(before.summary.spending);
    expect(after.summary.spendingByCategory.food).toBe(
      (before.summary.spendingByCategory.food ?? 0) + 300,
    );
    expect(after.summary.spendingByCategory.misc).toBe(
      before.summary.spendingByCategory.misc! - 300,
    );
    expect(after.byId.get("w-sep")?.cashWithdrawal).toEqual({
      allocated: 300,
      remaining: 4700,
    });
    expect(after.byId.get(expense.id)).toMatchObject({
      source: "cash",
      title: "夜市 雞排",
      amount: -300,
      categoryId: "food",
      category: "餐飲",
      economicRole: "spending",
      reviewStatus: "confirmed",
      roleReason: "cash_expense",
      cashExpense: { description: "夜市 雞排" },
    });
  });

  it("does not deduct from a withdrawal marked as an advance", async () => {
    const response = await send(
      "PUT",
      "/api/activity/role-overrides/bank_transaction/w-advance",
      { economicRole: "advance", counterparty: "朋友" },
    );
    expect(response.status).toBe(200);
    const { byId } = await month("2026-09");
    expect(byId.get("w-advance")?.cashWithdrawal).toBeUndefined();
  });

  it("deducts next-month cash from this month even in a single-month view", async () => {
    const before = await month("2026-09");
    // 十月沒有提款：用的是九月領的錢，九月的未細分金額減少，十月照常計入消費。
    const october = await create({
      date: "2026-10-02",
      amount: 1000,
      categoryId: "shopping",
    });
    const after = await month("2026-09");
    expect(after.byId.get("w-sep")?.cashWithdrawal).toEqual({
      allocated: 1300,
      remaining: 3700,
    });
    expect(after.summary.spending).toBe(before.summary.spending - 1000);
    const oct = await month("2026-10");
    expect(oct.byId.get(october.id)?.source).toBe("cash");
    expect(oct.summary.spending).toBe(1000);
    expect(oct.summary.spendingByCategory).toEqual({ shopping: 1000 });

    const range = await app.request(
      "/api/activity/summary?from=2026-08&to=2026-10",
      {},
      env,
    );
    const months = ((await range.json()) as { months: ActivityMonthSummary[] })
      .months;
    // 八月的提款沒被扣到（九月自己的提款還夠）。
    expect(months.map((summary) => summary.spending)).toEqual([
      3000,
      after.summary.spending,
      1000,
    ]);
  });

  it("edits and deletes, restoring the withdrawal", async () => {
    const expense = await create({
      date: "2026-09-10",
      amount: 200,
      categoryId: "misc",
    });
    const edited = await send("PUT", `/api/cash-expenses/${expense.id}`, {
      date: "2026-09-11",
      amount: 250,
      categoryId: "transport",
      description: "",
    });
    expect(edited.status).toBe(200);
    expect(await edited.json()).toMatchObject({
      id: expense.id,
      date: "2026-09-11",
      amount: 250,
      categoryId: "transport",
      description: null,
      createdAt: expense.createdAt,
    });
    let { byId } = await month("2026-09");
    expect(byId.get(expense.id)).toMatchObject({
      title: "現金支出",
      amount: -250,
      categoryId: "transport",
    });
    expect(byId.get("w-sep")?.cashWithdrawal?.remaining).toBe(3450);

    expect(
      (await send("DELETE", `/api/cash-expenses/${expense.id}`)).status,
    ).toBe(200);
    ({ byId } = await month("2026-09"));
    expect(byId.has(expense.id)).toBe(false);
    expect(byId.get("w-sep")?.cashWithdrawal?.remaining).toBe(3700);
    expect(
      (await send("DELETE", `/api/cash-expenses/${expense.id}`)).status,
    ).toBe(404);
  });

  it("exports cash expenses and withdrawal splits for LLM analysis", async () => {
    const response = await app.request(
      "/api/activity/export?from=2026-09&to=2026-09",
      {},
      env,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as ActivityExportResponse;
    expect(body.items.find((item) => item.source === "cash")).toMatchObject({
      date: "2026-09-05",
      amountTwd: -300,
      displayName: "夜市 雞排",
      categoryId: "food",
      account: "現金",
    });
    expect(
      body.items.find((item) => item.displayName.startsWith("無卡提款 B2")),
    ).toMatchObject({
      amountTwd: -5000,
      cashWithdrawal: { allocated: 1300, remaining: 3700 },
    });
  });
});
