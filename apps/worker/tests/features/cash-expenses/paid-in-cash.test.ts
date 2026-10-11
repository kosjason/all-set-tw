import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  ActivityExportResponse,
  ActivityItem,
  ActivityMonthSummary,
} from "@taiwan-fin-hub/shared";
import { activityRoutes } from "../../../src/features/activity/route";
import { merchantRoutes } from "../../../src/features/merchants/route";
import { honoFactory } from "../../../src/platform/hono";
import { apiErrorResponse } from "../../../src/platform/http";
import type { Env } from "../../../src/platform/env";
import { createTestD1 } from "../../helpers/d1";

// 合成資料：虛構帳戶、提款與賣方統編，不含任何真實資料。
const now = "2026-10-01T00:00:00.000Z";
const CASH_SELLER = "12345678";
const OTHER_SELLER = "87654321";

describe("merchant paid-in-cash rule", () => {
  let harness: Awaited<ReturnType<typeof createTestD1>>;
  let env: Env;
  const app = honoFactory.createApp();
  app.route("/api", activityRoutes);
  app.route("/api", merchantRoutes);
  app.onError(apiErrorResponse);

  beforeAll(async () => {
    harness = await createTestD1();
    const db = harness.binding;
    env = { DB: db } as Env;
    const invoice = (id: string, day: string, seller: string, amount: number) =>
      db
        .prepare(
          "INSERT INTO invoices (id, connector_id, source_id, invoice_date, seller_name, amount, raw_payload, created_at, updated_at) VALUES (?1, 'einvoice', ?1, ?2, ?3, ?4, ?5, ?6, ?6)",
        )
        .bind(
          id,
          day,
          seller === CASH_SELLER ? "虛構早餐店" : "虛構飲料店",
          amount,
          JSON.stringify({
            invoice: { sellerID: seller },
            detail: { invStatus: "開立" },
          }),
          now,
        );
    await db.batch([
      db
        .prepare(
          "INSERT INTO bank_accounts (id, connector_id, source_id, institution_name, account_name, account_last4, account_type, created_at, updated_at) VALUES ('dep-a', 'esun', 'bank:esun:0000', '某銀行', '活期存款', '0000', 'savings', ?1, ?1)",
        )
        .bind(now),
      db
        .prepare(
          "INSERT INTO bank_transactions (id, connector_id, account_id, source_id, posted_date, amount, currency, description, created_at, updated_at) VALUES ('w-sep', 'esun', 'dep-a', 'w-sep', '2026-09-03', -5000, 'TWD', '無卡提款 B2', ?1, ?1)",
        )
        .bind(now),
      invoice("inv-cash-1", "2026-09-05", CASH_SELLER, 85),
      invoice("inv-cash-2", "2026-09-12", CASH_SELLER, 65),
      invoice("inv-other", "2026-09-06", OTHER_SELLER, 120),
      // 十月沒有提款：用九月領的錢付，九月的提款要扣到（單月檢視也一樣）。
      invoice("inv-cash-oct", "2026-10-02", CASH_SELLER, 40),
    ]);
  }, 60_000);

  afterAll(async () => {
    await harness?.mf.dispose();
  });

  function put(path: string, body: unknown) {
    return app.request(
      path,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      env,
    );
  }

  async function get<T>(path: string) {
    const response = await app.request(path, {}, env);
    expect(response.status).toBe(200);
    return (await response.json()) as T;
  }

  async function month() {
    const body = await get<{
      items: ActivityItem[];
      summary: ActivityMonthSummary;
    }>("/api/activity/items?month=2026-09");
    return {
      ...body,
      byId: new Map(body.items.map((item) => [item.id, item])),
    };
  }

  const merchantPath = `/api/merchants/${encodeURIComponent(`ban:${CASH_SELLER}`)}`;

  it("stops double counting cash-paid invoices once the merchant is marked", async () => {
    const before = await month();
    // 提款 5,000 與三張發票都各自計入。
    expect(before.summary.spending).toBe(5270);
    expect(before.byId.get("w-sep")?.cashWithdrawal).toEqual({
      allocated: 0,
      remaining: 5000,
    });

    const response = await put(merchantPath, { paidInCash: true });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      merchantKey: `ban:${CASH_SELLER}`,
      alias: { paidInCash: true, displayName: null, categoryId: null },
    });

    const after = await month();
    expect(after.byId.get("inv-cash-1")).toMatchObject({
      merchantPaidInCash: true,
      matchStatus: "unmatched",
      amount: 85,
    });
    expect(after.byId.get("inv-other")?.merchantPaidInCash).toBeUndefined();
    expect(after.byId.get("w-sep")?.cashWithdrawal).toEqual({
      allocated: 190,
      remaining: 4810,
    });
    expect(after.summary.spending).toBe(5080);
    expect(after.summary.spendingByCategory.misc).toBe(4810);

    const { months } = await get<{ months: ActivityMonthSummary[] }>(
      "/api/activity/summary?from=2026-09&to=2026-10",
    );
    expect(months.map((summary) => summary.spending)).toEqual([5080, 40]);
  });

  it("keeps the flag when other merchant rules change", async () => {
    expect((await put(merchantPath, { displayName: "巷口早餐" })).status).toBe(
      200,
    );
    const merchant = await get<{ alias: { paidInCash: boolean } }>(
      merchantPath,
    );
    expect(merchant.alias.paidInCash).toBe(true);
    const list = await get<
      Array<{ merchantKey: string; alias: { paidInCash: boolean } | null }>
    >("/api/merchants?months=12");
    expect(
      list.find((row) => row.merchantKey === `ban:${CASH_SELLER}`)?.alias
        ?.paidInCash,
    ).toBe(true);
  });

  it("exports cash-paid invoices for LLM analysis", async () => {
    const body = await get<ActivityExportResponse>(
      "/api/activity/export?from=2026-09&to=2026-09",
    );
    expect(
      body.items
        .filter((item) => item.paidInCash)
        .map((item) => item.amountTwd),
    ).toEqual([-85, -65]);
  });

  it("restores the withdrawal when the flag is cleared", async () => {
    expect((await put(merchantPath, { paidInCash: false })).status).toBe(200);
    const { byId, summary } = await month();
    expect(byId.get("inv-cash-1")?.merchantPaidInCash).toBeUndefined();
    expect(byId.get("w-sep")?.cashWithdrawal?.remaining).toBe(5000);
    expect(summary.spending).toBe(5270);
    expect((await put(merchantPath, { paidInCash: "yes" })).status).toBe(400);
  });
});
