import { describe, expect, it } from "vitest";
import {
  reconcileHncbLegacyTransactionStatements,
  reconcileHncbSingleCardSummaryAccountStatements,
} from "../../../src/sources/hncb/repository";
import { useSqliteD1 } from "../../helpers/sqlite-d1";

const createDb = useSqliteD1();

describe("HNCB repair statements", () => {
  it("merges matching HNCB transaction ids and preserves unmatched history", async () => {
    const db = createDb();
    db.database.exec(`
      INSERT INTO bank_accounts
        (id, connector_id, source_id, account_type, currency, raw_payload, created_at, updated_at)
      VALUES
        ('hncb:credit:hncb:8103', 'hncb', 'credit:hncb:8103', 'credit', 'TWD', '{}', '2026-07-01', '2026-07-01');

      INSERT INTO bank_transactions
        (id, connector_id, account_id, source_id, posted_date, authorized_at, amount, currency, description, status, raw_payload, created_at, updated_at)
      VALUES
        ('hncb-legacy', 'hncb', 'hncb:credit:hncb:8103', 'hncb:card:tx:8103:2026-07-22:230:abc123:1', '2026-07-27', '2026-07-22', -230, 'TWD', '????', 'posted', '{}', '2026-07-19', '2026-07-19'),
        ('hncb-orphan', 'hncb', 'hncb:credit:hncb:8103', 'hncb:card:tx:8103:2026-06-01:80:def456:1', '2026-06-01', '2026-06-01', -80, 'TWD', '????', 'posted', '{}', '2026-06-01', '2026-06-01'),
        ('hncb-canonical', 'hncb', 'hncb:credit:hncb:8103', 'hncb:card:tx:v2:8103:2026-07-22:230:1', '2026-07-27', '2026-07-22', -230, 'TWD', '連加＊餓肆', 'posted', '{}', '2026-07-22', '2026-07-22');

      INSERT INTO bank_transaction_preferences
        (transaction_id, excluded_from_calculation, created_at, updated_at)
      VALUES ('hncb-legacy', 1, '2026-07-19', '2026-07-19');

      INSERT INTO classification_overrides
        (id, target_type, target_id, category_id, created_at, updated_at)
      VALUES ('hncb-legacy-override', 'bank_transaction', 'hncb-legacy', 'shopping', '2026-07-19', '2026-07-19');
    `);

    await db.batch(
      reconcileHncbLegacyTransactionStatements(db as unknown as D1Database),
    );

    expect(
      db.database
        .prepare("SELECT id FROM bank_transactions ORDER BY id")
        .all()
        .map((row) => row.id),
    ).toEqual(["hncb-canonical", "hncb-orphan"]);
    expect(
      db.database
        .prepare(
          "SELECT transaction_id AS transactionId FROM bank_transaction_preferences",
        )
        .get(),
    ).toEqual({ transactionId: "hncb-canonical" });
    expect(
      db.database
        .prepare("SELECT target_id AS targetId FROM classification_overrides")
        .get(),
    ).toEqual({ targetId: "hncb-canonical" });
  });

  it("merges HNCB summary transactions before moving the remaining rows", async () => {
    const db = createDb();
    db.database.exec(`
      INSERT INTO bank_accounts
        (id, connector_id, source_id, account_type, currency, raw_payload, created_at, updated_at)
      VALUES
        ('hncb-main', 'hncb', 'credit:hncb:main', 'credit', 'TWD', '{}', '2026-08-19', '2026-08-19'),
        ('hncb-8103', 'hncb', 'credit:hncb:8103', 'credit', 'TWD', '{}', '2026-08-19', '2026-08-19');

      INSERT INTO bank_balance_snapshots
        (id, connector_id, account_id, source_id, balance, currency, as_of_at, raw_payload, created_at, updated_at)
      VALUES
        ('hncb-main-snapshot', 'hncb', 'hncb-main', 'snapshot:hncb:credit:8103', -150, 'TWD', '2026-09-16', '{}', '2026-09-16', '2026-09-16'),
        ('hncb-8103-snapshot', 'hncb', 'hncb-8103', 'snapshot:hncb:credit:8103', -150, 'TWD', '2026-09-15', '{}', '2026-09-15', '2026-09-15'),
        ('hncb-main-only-snapshot', 'hncb', 'hncb-main', 'snapshot:hncb:credit:8103:older', -200, 'TWD', '2026-09-15', '{}', '2026-09-15', '2026-09-15');

      INSERT INTO bank_transactions
        (id, connector_id, account_id, source_id, posted_date, authorized_at, amount, currency, description, status, raw_payload, created_at, updated_at)
      VALUES
        ('hncb-main-duplicate', 'hncb', 'hncb-main', 'hncb:card:tx:v2:8103:2026-09-15:100:1', '2026-09-15', '2026-09-15', -100, 'TWD', '摘要交易', 'posted', '{}', '2026-09-16', '2026-09-16'),
        ('hncb-8103-canonical', 'hncb', 'hncb-8103', 'hncb:card:tx:v2:8103:2026-09-15:100:1', '2026-09-15', '2026-09-15', -100, 'TWD', '實體卡交易', 'posted', '{}', '2026-09-15', '2026-09-15'),
        ('hncb-main-only', 'hncb', 'hncb-main', 'hncb:card:tx:v2:8103:2026-09-14:200:2', '2026-09-14', '2026-09-14', -200, 'TWD', '只有摘要帳戶的交易', 'posted', '{}', '2026-09-16', '2026-09-16');

      INSERT INTO bank_transaction_preferences
        (transaction_id, excluded_from_calculation, created_at, updated_at)
      VALUES ('hncb-main-duplicate', 1, '2026-09-16', '2026-09-16');

      INSERT INTO classification_overrides
        (id, target_type, target_id, category_id, created_at, updated_at)
      VALUES ('hncb-main-override', 'bank_transaction', 'hncb-main-duplicate', 'shopping', '2026-09-16', '2026-09-16');

      INSERT INTO credit_card_bills
        (id, connector_id, account_id, source_id, billing_period, statement_amount, currency, raw_payload, created_at, updated_at)
      VALUES
        ('hncb-main-bill', 'hncb', 'hncb-main', 'hncb:card:bill:2026-08', '2026-08', 150, 'TWD', '{}', '2026-09-16', '2026-09-16'),
        ('hncb-8103-bill', 'hncb', 'hncb-8103', 'hncb:card:bill:2026-08', '2026-08', 150, 'TWD', '{}', '2026-09-15', '2026-09-15');
    `);

    await db.batch(
      reconcileHncbSingleCardSummaryAccountStatements(
        db as unknown as D1Database,
      ),
    );

    expect(
      db.database
        .prepare(
          "SELECT source_id AS sourceId FROM bank_accounts WHERE connector_id = 'hncb'",
        )
        .all(),
    ).toEqual([{ sourceId: "credit:hncb:8103" }]);
    expect(
      db.database
        .prepare(
          "SELECT id, account_id AS accountId FROM bank_transactions WHERE connector_id = 'hncb' ORDER BY id",
        )
        .all(),
    ).toEqual([
      { id: "hncb-8103-canonical", accountId: "hncb-8103" },
      { id: "hncb-main-only", accountId: "hncb-8103" },
    ]);
    expect(
      db.database
        .prepare(
          "SELECT transaction_id AS transactionId FROM bank_transaction_preferences",
        )
        .get(),
    ).toEqual({ transactionId: "hncb-8103-canonical" });
    expect(
      db.database
        .prepare(
          "SELECT target_id AS targetId, category_id AS categoryId FROM classification_overrides",
        )
        .get(),
    ).toEqual({ targetId: "hncb-8103-canonical", categoryId: "shopping" });
    expect(
      db.database
        .prepare(
          "SELECT id, account_id AS accountId FROM bank_balance_snapshots WHERE connector_id = 'hncb' ORDER BY id",
        )
        .all(),
    ).toEqual([
      { id: "hncb-8103-snapshot", accountId: "hncb-8103" },
      { id: "hncb-main-only-snapshot", accountId: "hncb-8103" },
    ]);
    expect(
      db.database
        .prepare(
          "SELECT id, account_id AS accountId FROM credit_card_bills WHERE connector_id = 'hncb'",
        )
        .get(),
    ).toEqual({ id: "hncb-8103-bill", accountId: "hncb-8103" });
  });
});
