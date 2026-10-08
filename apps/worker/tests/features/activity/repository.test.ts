import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestD1 } from "../../helpers/d1";
import {
  findMappingTransaction,
  listInvoiceTransactionPreferences,
} from "../../../src/features/activity/repository";

describe("activity repository on D1", () => {
  let harness: Awaited<ReturnType<typeof createTestD1>>;
  beforeAll(async () => {
    harness = await createTestD1();
    const db = harness.binding;
    await db
      .prepare(
        "INSERT INTO bank_accounts (id, connector_id, source_id, account_type, created_at, updated_at) VALUES ('card', 'test', 'card', 'credit', 't', 't')",
      )
      .run();
    for (const [id, status, matched] of [
      ["posted", "posted", null],
      ["pending", "pending", null],
      ["matched-pending", "pending", "posted"],
      ["matched-posted", "posted", "matched-posted"],
    ] as const) {
      await db
        .prepare(
          "INSERT INTO bank_transactions (id, connector_id, source_id, account_id, posted_date, amount, currency, status, matched_transaction_id, created_at, updated_at) VALUES (?, 'test', ?, 'card', '2026-07-13', -35, 'TWD', ?, ?, 't', 't')",
        )
        .bind(id, id, status, matched)
        .run();
    }
    for (const id of [
      "posted",
      "pending",
      "matched-pending",
      "matched-posted",
      "separate",
    ]) {
      await db.batch([
        db
          .prepare(
            "INSERT INTO invoices (id, connector_id, source_id, invoice_date, amount, created_at, updated_at) VALUES (?, 'einvoice', ?, '2026-07-13', 35, 'created', 'updated')",
          )
          .bind(id, id),
        db
          .prepare(
            "INSERT INTO invoice_transaction_preferences VALUES (?, ?, ?, 'created', 'updated')",
          )
          .bind(
            id,
            id === "separate" ? null : id,
            id === "separate" ? "separate" : "linked",
          ),
      ]);
    }
  }, 60_000);
  afterAll(async () => {
    await harness?.mf.dispose();
  });

  it("loads mapping aliases and excludes only matched pending transactions", async () => {
    for (const id of ["posted", "pending", "matched-posted"]) {
      expect(await findMappingTransaction(harness.binding, id)).toEqual({
        id,
        postedDate: "2026-07-13",
        authorizedAt: null,
        amount: -35,
        currency: "TWD",
        accountType: "credit",
      });
    }
    expect(
      await findMappingTransaction(harness.binding, "matched-pending"),
    ).toBeNull();
    expect(await findMappingTransaction(harness.binding, "missing")).toBeNull();
  });

  it("keeps separate NULL preferences and filters only the correlated matched pending row", async () => {
    expect(await listInvoiceTransactionPreferences(harness.binding)).toEqual(
      ["matched-posted", "pending", "posted", "separate"].map((id) => ({
        invoiceId: id,
        transactionId: id === "separate" ? null : id,
        decision: id === "separate" ? "separate" : "linked",
        createdAt: "created",
        updatedAt: "updated",
        // 這些連結都是同日（不是發票晚開），不產生學習紀錄。
        learnedMerchant: null,
      })),
    );
  });

  it("發票晚開的手動連結帶出學習紀錄（賣方統編、刷卡商家、帳戶）", async () => {
    const db = harness.binding;
    await db.batch([
      db.prepare(
        "INSERT INTO bank_transactions (id, connector_id, source_id, account_id, authorized_at, posted_date, amount, currency, description, status, created_at, updated_at) VALUES ('late-card', 'test', 'late-card', 'card', '2026-07-24T08:10:00+08:00', '2026-07-26', -596, 'TWD', '虛構電池服務 TAOYUA', 'posted', 't', 't')",
      ),
      db.prepare(
        `INSERT INTO invoices (id, connector_id, source_id, invoice_date, seller_name, amount, raw_payload, created_at, updated_at)
         VALUES ('late-invoice', 'einvoice', 'late-invoice', '2026-07-30', '虛構能源股份有限公司', 596, '{"invoice":{"sellerBan":"12345678"}}', 'created', 'updated')`,
      ),
      db.prepare(
        "INSERT INTO invoice_transaction_preferences VALUES ('late-invoice', 'late-card', 'linked', 'created', 'updated')",
      ),
    ]);
    const preferences = await listInvoiceTransactionPreferences(db);
    expect(
      preferences.find(({ invoiceId }) => invoiceId === "late-invoice"),
    ).toMatchObject({
      learnedMerchant: {
        sellerKey: "ban:12345678",
        merchantKey: "name:虛構電池服務taoyua",
        accountId: "card",
      },
    });
  });
});
