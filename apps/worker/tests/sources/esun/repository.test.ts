import { describe, expect, it } from "vitest";
import {
  reconcileEsunLifecycleShadowStatements,
  reconcileEsunSingleCardSummaryAccountStatements,
} from "../../../src/sources/esun/repository";
import { useSqliteD1 } from "../../helpers/sqlite-d1";

const createDb = useSqliteD1();

describe("E.SUN repair statements", () => {
  it("preserves E.SUN lifecycle shadows when multiple old rows match one transaction", async () => {
    const db = createDb();
    db.database.exec(`
      INSERT INTO bank_accounts
        (id, connector_id, source_id, account_type, currency, raw_payload, created_at, updated_at)
      VALUES
        ('esun:credit:esun:1204', 'esun', 'credit:esun:1204', 'credit', 'TWD', '{}', '2026-07-01', '2026-07-01');

      INSERT INTO bank_transactions
        (id, connector_id, account_id, source_id, posted_date, amount, currency, description, raw_payload, created_at, updated_at)
      VALUES
        ('shadow-posted', 'esun', 'esun:credit:esun:1204', '2026-07-05:credit:esun:1204:全聯:252:TWD:已入帳:1', '2026-07-05', 252, 'TWD', '全聯', '{}', '2026-07-05', '2026-07-05'),
        ('shadow-pending', 'esun', 'esun:credit:esun:1204', '2026-07-05:credit:esun:1204:全聯:252:TWD:未入帳:1', '2026-07-05', 252, 'TWD', '全聯', '{}', '2026-07-05', '2026-07-05'),
        ('canonical', 'esun', 'esun:credit:esun:1204', '2026-07-05:credit:esun:1204:全聯:252:TWD:1', '2026-07-05', 252, 'TWD', '全聯', '{}', '2026-07-05', '2026-07-05');

      INSERT INTO bank_transaction_preferences
        (transaction_id, excluded_from_calculation, created_at, updated_at)
      VALUES ('shadow-posted', 1, '2026-07-05', '2026-07-05');

      INSERT INTO classification_overrides
        (id, target_type, target_id, category_id, created_at, updated_at)
      VALUES ('old-override', 'bank_transaction', 'shadow-posted', 'shopping', '2026-07-05', '2026-07-05');
    `);

    await db.batch(
      reconcileEsunLifecycleShadowStatements(db as unknown as D1Database),
    );

    expect(
      db.database
        .prepare("SELECT id FROM bank_transactions ORDER BY id")
        .all()
        .map((row) => row.id),
    ).toEqual(["canonical", "shadow-pending", "shadow-posted"]);
    expect(
      db.database
        .prepare(
          "SELECT transaction_id, excluded_from_calculation FROM bank_transaction_preferences",
        )
        .get(),
    ).toEqual({
      transaction_id: "shadow-posted",
      excluded_from_calculation: 1,
    });
    expect(
      db.database
        .prepare("SELECT target_id, category_id FROM classification_overrides")
        .get(),
    ).toEqual({ target_id: "shadow-posted", category_id: "shopping" });
  });

  it("merges the E.SUN single-card summary account into the physical card", async () => {
    const db = createDb();
    db.database.exec(`
      INSERT INTO bank_accounts
        (id, connector_id, source_id, institution_name, account_name, account_type,
         currency, raw_payload, created_at, updated_at)
      VALUES
        ('esun-main', 'esun', 'credit:esun:main', '玉山銀行', '玉山信用卡',
         'credit', 'TWD', '{}', '2026-07-01', '2026-08-09'),
        ('esun-1204', 'esun', 'credit:esun:1204', '玉山銀行', '玉山 Unicard',
         'credit', 'TWD', '{}', '2026-07-01', '2026-08-09');

      INSERT INTO bank_balance_snapshots
        (id, connector_id, account_id, source_id, balance, currency, as_of_at,
         raw_payload, created_at, updated_at)
      VALUES
        ('old-balance', 'esun', 'esun-main', 'credit:esun:main:2026-08-08',
         -14510, 'TWD', '2026-08-08', '{}', '2026-08-08', '2026-08-08'),
        ('new-balance', 'esun', 'esun-1204', 'credit:esun:1204:2026-08-09',
         -14510, 'TWD', '2026-08-09', '{}', '2026-08-09', '2026-08-09');

      INSERT INTO bank_transactions
        (id, connector_id, account_id, source_id, posted_date, amount, currency,
         description, status, raw_payload, created_at, updated_at)
      VALUES
        ('main-transaction', 'esun', 'esun-main', 'fallback-transaction',
         '2026-07-20', -500, 'TWD', '測試交易', 'posted', '{}',
         '2026-07-20', '2026-07-20');

      INSERT INTO credit_card_bills
        (id, connector_id, account_id, source_id, billing_period,
         statement_amount, currency, raw_payload, created_at, updated_at)
      VALUES
        ('old-june', 'esun', 'esun-main', 'main:bill:2026-06', '2026-06',
         5000, 'TWD', '{}', '2026-06-23', '2026-06-23'),
        ('old-july', 'esun', 'esun-main', 'main:bill:2026-07', '2026-07',
         14000, 'TWD', '{}', '2026-07-23', '2026-07-23'),
        ('new-july', 'esun', 'esun-1204', '1204:bill:2026-07', '2026-07',
         14510, 'TWD', '{}', '2026-08-09', '2026-08-09');
    `);

    await db.batch(
      reconcileEsunSingleCardSummaryAccountStatements(
        db as unknown as D1Database,
      ),
    );

    expect(
      db.database
        .prepare(
          "SELECT source_id AS sourceId FROM bank_accounts WHERE connector_id = 'esun'",
        )
        .all(),
    ).toEqual([{ sourceId: "credit:esun:1204" }]);
    expect(
      db.database
        .prepare(
          "SELECT DISTINCT account_id AS accountId FROM bank_balance_snapshots WHERE connector_id = 'esun'",
        )
        .all(),
    ).toEqual([{ accountId: "esun-1204" }]);
    expect(
      db.database
        .prepare(
          "SELECT account_id AS accountId FROM bank_transactions WHERE connector_id = 'esun'",
        )
        .get(),
    ).toEqual({ accountId: "esun-1204" });
    expect(
      db.database
        .prepare(
          `SELECT billing_period AS billingPeriod, statement_amount AS statementAmount,
                  account_id AS accountId
           FROM credit_card_bills WHERE connector_id = 'esun'
           ORDER BY billing_period`,
        )
        .all(),
    ).toEqual([
      {
        billingPeriod: "2026-06",
        statementAmount: 5000,
        accountId: "esun-1204",
      },
      {
        billingPeriod: "2026-07",
        statementAmount: 14510,
        accountId: "esun-1204",
      },
    ]);
  });

  it("keeps the E.SUN summary account when multiple physical cards exist", async () => {
    const db = createDb();
    db.database.exec(`
      INSERT INTO bank_accounts
        (id, connector_id, source_id, account_type, currency, raw_payload,
         created_at, updated_at)
      VALUES
        ('esun-main', 'esun', 'credit:esun:main', 'credit', 'TWD', '{}',
         '2026-07-01', '2026-08-09'),
        ('esun-1204', 'esun', 'credit:esun:1204', 'credit', 'TWD', '{}',
         '2026-07-01', '2026-08-09'),
        ('esun-9876', 'esun', 'credit:esun:9876', 'credit', 'TWD', '{}',
         '2026-07-01', '2026-08-09');
    `);

    await db.batch(
      reconcileEsunSingleCardSummaryAccountStatements(
        db as unknown as D1Database,
      ),
    );

    expect(
      db.database
        .prepare(
          "SELECT COUNT(*) AS count FROM bank_accounts WHERE connector_id = 'esun'",
        )
        .get(),
    ).toEqual({ count: 3 });
  });
});
