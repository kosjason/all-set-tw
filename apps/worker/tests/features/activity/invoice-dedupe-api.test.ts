import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { ActivityMonthSummary } from "@taiwan-fin-hub/core";
import { activityRoutes } from "../../../src/features/activity/route";
import { honoFactory } from "../../../src/platform/hono";
import { apiErrorResponse } from "../../../src/platform/http";
import type { Env } from "../../../src/platform/env";
import { createTestD1 } from "../../../../../packages/db/testing/d1";

// 合成資料：信用卡末碼與載具末碼都是假的。
const now = "2026-09-01T00:00:00.000Z";

describe("invoice dedupe through the activity API", () => {
  let harness: Awaited<ReturnType<typeof createTestD1>>;
  let env: Env;
  const app = honoFactory.createApp();
  app.route("/api", activityRoutes);
  app.onError(apiErrorResponse);

  beforeAll(async () => {
    harness = await createTestD1();
    const db = harness.binding;
    env = { DB: db } as Env;
    await db.batch([
      db
        .prepare(
          "INSERT INTO bank_accounts (id, connector_id, source_id, institution_name, account_type, account_last4, created_at, updated_at) VALUES ('card-a', 'cathaybk', 'card:cathaybk:4321', '國泰世華', 'credit', '4321', ?1, ?1), ('dep-a', 'cathaybk', 'bank:cathaybk:0000', '國泰世華', 'savings', '0000', ?1, ?1)",
        )
        .bind(now),
      db
        .prepare(
          "INSERT INTO bank_transactions (id, connector_id, account_id, source_id, posted_date, amount, currency, description, created_at, updated_at) VALUES ('coffee', 'cathaybk', 'card-a', 'coffee', '2026-09-03', -150, 'TWD', '路易莎咖啡', ?1, ?1), ('bakery', 'cathaybk', 'card-a', 'bakery', '2026-09-03', -150, 'TWD', '85度C', ?1, ?1), ('rent', 'cathaybk', 'dep-a', 'rent', '2026-09-05', -2400, 'TWD', '房租繳納', ?1, ?1)",
        )
        .bind(now),
      db
        .prepare(
          "INSERT INTO invoices (id, connector_id, source_id, invoice_date, seller_name, amount, carrier_type, carrier_suffix, created_at, updated_at) VALUES ('inv-coffee', 'einvoice', 'inv-coffee', '2026-09-03', '路易莎職人咖啡股份有限公司', 150, '3J0002', 'AB12', ?1, ?1), ('inv-bakery', 'einvoice', 'inv-bakery', '2026-09-03', '美食達人股份有限公司85度C', 150, '3J0002', 'AB12', ?1, ?1), ('inv-mall', 'einvoice', 'inv-mall', '2026-09-05', '某百貨股份有限公司', 2400, 'EK0002', '4321', ?1, ?1)",
        )
        .bind(now),
    ]);
  }, 60_000);

  afterEach(() => {
    vi.useRealTimers();
  });

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
      items: Array<Record<string, unknown> & { id: string }>;
      summary: ActivityMonthSummary;
    };
    return {
      items: new Map(body.items.map((item) => [item.id, item])),
      summary: body.summary,
    };
  }

  it("keeps a card-carrier invoice awaiting its card charge instead of pairing another account", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-08T04:00:00.000Z"));
    const { items, summary } = await month();
    expect(items.get("inv-coffee")).toMatchObject({
      matchStatus: "matched_card",
      matchedTransactionId: "coffee",
    });
    expect(items.get("inv-bakery")).toMatchObject({
      matchStatus: "matched_card",
      matchedTransactionId: "bakery",
    });
    // 同日同額的存款帳戶支出不是這張卡，不能拿來配。
    expect(items.get("inv-mall")).toMatchObject({
      matchStatus: "awaiting_card",
      matchedTransactionId: null,
      economicRole: "spending",
      reviewStatus: "auto",
      roleReason: "invoice_awaiting_card",
    });
    expect(items.get("rent")).toMatchObject({ matchedInvoiceId: null });
    expect(summary.spending).toBe(150 + 150 + 2400 + 2400);
    expect(summary.dedupe).toEqual({
      invoicesMerged: 2,
      invoicesUnmatched: 0,
      invoicesAwaitingCard: 1,
      invoicesAmbiguous: 0,
    });

    const view = await app.request(
      "/api/activity/sources?month=2026-09&source=invoice",
      {},
      env,
    );
    const body = (await view.json()) as {
      records: Array<Record<string, unknown> & { id: string }>;
    };
    expect(body.records.find(({ id }) => id === "inv-mall")).toMatchObject({
      carrierType: "EK0002",
      carrierSuffix: "4321",
      carrierCardSuffix: "4321",
      awaitingOverdue: false,
    });
  });

  it("asks for review when the card charge is still missing after ten days", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-20T04:00:00.000Z"));
    const { items, summary } = await month();
    expect(items.get("inv-mall")).toMatchObject({
      matchStatus: "awaiting_card",
      reviewStatus: "needs_review",
    });
    expect(summary.needsReview.count).toBe(1);
  });

  it("merges the invoice once the card charge is synced, counting it once", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-09T04:00:00.000Z"));
    await env.DB.prepare(
      "INSERT INTO bank_transactions (id, connector_id, account_id, source_id, posted_date, amount, currency, description, created_at, updated_at) VALUES ('mall', 'cathaybk', 'card-a', 'mall', '2026-09-08', -2400, 'TWD', '某百貨', ?1, ?1)",
    )
      .bind(now)
      .run();
    const { items, summary } = await month();
    expect(items.get("inv-mall")).toMatchObject({
      matchStatus: "matched_card",
      matchedTransactionId: "mall",
      duplicateOf: { kind: "bank_transaction", id: "mall" },
    });
    expect(items.get("mall")).toMatchObject({ matchedInvoiceId: "inv-mall" });
    expect(summary.spending).toBe(150 + 150 + 2400 + 2400);
    expect(summary.duplicateExcluded).toBe(150 + 150 + 2400);
    expect(summary.dedupe).toEqual({
      invoicesMerged: 3,
      invoicesUnmatched: 0,
      invoicesAwaitingCard: 0,
      invoicesAmbiguous: 0,
    });
  });
});
