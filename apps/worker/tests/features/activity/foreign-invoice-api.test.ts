import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ActivityMonthSummary, InboxItem } from "@taiwan-fin-hub/core";
import { activityRoutes } from "../../../src/features/activity/route";
import { invoiceRoutes } from "../../../src/features/invoices/route";
import { getInbox } from "../../../src/features/inbox/service";
import { honoFactory } from "../../../src/platform/hono";
import { apiErrorResponse } from "../../../src/platform/http";
import type { Env } from "../../../src/platform/env";
import { createTestD1 } from "../../../../../packages/db/testing/d1";

// 合成資料：賣方統編、卡號末碼、網域都是假的。
const now = "2026-07-30T00:00:00.000Z";

function usdInvoice(
  id: string,
  invoiceDate: string,
  amount: string,
  description: string,
) {
  return {
    id,
    invoiceDate,
    raw: JSON.stringify({
      invoice: {
        invDate: invoiceDate,
        sellerName: "Cloudflare Inc.",
        sellerID: "11112222",
        amount: Math.trunc(Number(amount)),
      },
      detail: {
        invStatus: "開立已確認",
        sellerBan: "11112222",
        sellerName: "Cloudflare Inc.",
        amount,
        currency: "USD",
        details: [{ rowNum: "1", description, quantity: "1", amount }],
      },
    }),
    amount: Math.trunc(Number(amount)),
  };
}

const invoices = [
  usdInvoice(
    "cf-1",
    "2026-07-27T09:10:21.000Z",
    "10.98",
    "Registrar Transfer Fee - example.test",
  ),
  usdInvoice(
    "cf-2",
    "2026-07-27T09:22:53.000Z",
    "10.98",
    "Registrar Transfer Fee - example.test",
  ),
  usdInvoice(
    "cf-3",
    "2026-07-27T09:28:07.000Z",
    "10.98",
    "Registrar Transfer Fee - example.test",
  ),
  usdInvoice(
    "cf-4",
    "2026-07-27T09:36:13.000Z",
    "10.98",
    "Registrar Transfer Fee  - EXAMPLE.test",
  ),
  usdInvoice(
    "cf-reg",
    "2026-07-29T06:40:02.000Z",
    "14.91",
    "Registrar Registration Fee - example.app (1 yr)",
  ),
];

describe("foreign-currency invoices through the API", () => {
  let harness: Awaited<ReturnType<typeof createTestD1>>;
  let env: Env;
  const app = honoFactory.createApp();
  app.route("/api", activityRoutes);
  app.route("/api", invoiceRoutes);
  app.onError(apiErrorResponse);

  beforeAll(async () => {
    harness = await createTestD1();
    const db = harness.binding;
    env = { DB: db } as Env;
    await db.batch([
      db
        .prepare(
          "INSERT INTO bank_accounts (id, connector_id, source_id, institution_name, account_type, account_last4, created_at, updated_at) VALUES ('card-a', 'taishin', 'card:taishin:4321', '台新', 'credit', '4321', ?1, ?1)",
        )
        .bind(now),
      db
        .prepare(
          `INSERT INTO bank_transactions (id, connector_id, account_id, source_id, posted_date, authorized_at, amount, currency, description, created_at, updated_at) VALUES
            ('cf', 'taishin', 'card-a', 'cf', '2026-07-28', '2026-07-27', -356, 'TWD', 'CLOUDFLAREA3906 SAN FR', ?1, ?1),
            ('cf-fee', 'taishin', 'card-a', 'cf-fee', '2026-07-28', '2026-07-27', -6, 'TWD', '國外交易服務費－356.00', ?1, ?1),
            ('reg', 'taishin', 'card-a', 'reg', '2026-07-30', '2026-07-29', -483, 'TWD', 'CLOUDFLAREA3906 SAN FR', ?1, ?1),
            ('reg-fee', 'taishin', 'card-a', 'reg-fee', '2026-07-30', '2026-07-29', -7, 'TWD', '國外交易服務費－483.00', ?1, ?1),
            ('lone-fee', 'taishin', 'card-a', 'lone-fee', '2026-07-10', '2026-07-08', -3, 'TWD', '國外交易服務費－160.00', ?1, ?1)`,
        )
        .bind(now),
      ...invoices.map((invoice) =>
        db
          .prepare(
            "INSERT INTO invoices (id, connector_id, source_id, invoice_date, seller_name, amount, raw_payload, created_at, updated_at) VALUES (?1, 'einvoice', ?1, ?2, 'Cloudflare Inc.', ?3, ?4, ?5, ?5)",
          )
          .bind(
            invoice.id,
            invoice.invoiceDate,
            invoice.amount,
            invoice.raw,
            now,
          ),
      ),
      db
        .prepare(
          "INSERT INTO exchange_rates (currency, rate_to_twd, updated_at) VALUES ('USD', 32.4, ?1)",
        )
        .bind(now),
    ]);
  }, 60_000);

  afterAll(async () => {
    await harness?.mf.dispose();
  });

  async function month() {
    const response = await app.request(
      "/api/activity/items?month=2026-07",
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

  it("derives the currency and the precise amount from the raw payload", async () => {
    const response = await app.request(
      "/api/invoices?from=2026-07&to=2026-07",
      {},
      env,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Array<Record<string, unknown>>;
    expect(body.find(({ id }) => id === "cf-reg")).toMatchObject({
      currency: "USD",
      amount: 14.91,
      itemsKey: "registrar registration fee - example.app (1 yr)",
    });
    // 空白與大小寫差異不影響品項簽章。
    expect(body.find(({ id }) => id === "cf-4")).toMatchObject({
      itemsKey: "registrar transfer fee - example.test",
    });
  });

  it("pairs each purchase once, holds back repeats and attributes the fees", async () => {
    const { items, summary } = await month();
    expect(items.get("cf-1")).toMatchObject({
      amount: 10.98,
      currency: "USD",
      amountTwd: 355.75,
      matchStatus: "matched_card",
      matchedTransactionId: "cf",
    });
    for (const id of ["cf-2", "cf-3", "cf-4"])
      expect(items.get(id)).toMatchObject({
        matchStatus: "ambiguous",
        reviewStatus: "needs_review",
        roleReason: "invoice_repeat",
        duplicateOf: { kind: "invoice", id: "cf-1" },
      });
    expect(items.get("cf-reg")).toMatchObject({
      matchStatus: "matched_card",
      matchedTransactionId: "reg",
    });
    expect(items.get("reg")).toMatchObject({
      matchedInvoiceId: "cf-reg",
      invoiceAmount: 483,
      invoiceCurrency: "USD",
      invoiceOriginalAmount: 14.91,
    });
    // 國外交易服務費不配發票，分類跟著所屬的國外消費。
    const purchase = items.get("cf")!;
    expect(purchase.categoryId).toBe("tech");
    // 手續費在 0067 起歸入「其他」。
    expect(items.get("lone-fee")?.categoryId).toBe("misc");
    expect(items.get("cf-fee")).toMatchObject({
      matchedInvoiceId: null,
      foreignFeeOf: "cf",
      categoryId: purchase.categoryId,
    });
    expect(items.get("reg-fee")).toMatchObject({ foreignFeeOf: "reg" });
    expect(items.get("lone-fee")?.foreignFeeOf).toBeUndefined();
    // 只計刷卡與費用，發票全部視為重複。
    expect(summary.spending).toBe(356 + 6 + 483 + 7 + 3);
    expect(summary.complete).toBe(true);
    expect(summary.dedupe).toEqual({
      invoicesMerged: 2,
      invoicesUnmatched: 0,
      invoicesAwaitingCard: 0,
      invoicesAmbiguous: 3,
    });
    const categoryTotal = Object.values(summary.spendingByCategory).reduce(
      (sum, value) => sum + value,
      0,
    );
    expect(categoryTotal).toBe(summary.spending);
  });

  it("lists the repeats in the inbox with TWD amounts", async () => {
    const inbox = await getInbox(env.DB, new Date("2026-07-30T04:00:00.000Z"));
    const repeats = inbox.items.filter((item: InboxItem) =>
      item.id.startsWith("duplicate_ambiguous:invoice:cf-"),
    );
    expect(repeats).toHaveLength(3);
    expect(repeats[0]).toMatchObject({
      kind: "duplicate_ambiguous",
      amount: 355.75,
      currency: "TWD",
    });
  });

  it("marks the month incomplete and stops pairing without a USD rate", async () => {
    await env.DB.prepare("DELETE FROM exchange_rates").run();
    const { items, summary } = await month();
    expect(items.get("cf-reg")).toMatchObject({
      matchStatus: "unmatched",
      amountTwd: null,
    });
    expect(summary.complete).toBe(false);
    expect(summary.missingCurrencies).toEqual(["USD"]);
    expect(summary.spending).toBe(356 + 6 + 483 + 7 + 3);
  });
});
