import { describe, expect, it } from "vitest";
import { reconcileCathayCardAccountStatements } from "../../../src/sources/cathaybk/repository";
import { type SqliteD1, useSqliteD1 } from "../../helpers/sqlite-d1";

const createDb = useSqliteD1();

describe("Cathay credit card account repair", () => {
  function seedCathayCardHistory(db: SqliteD1, cardIds: string[]) {
    db.database.exec(`
      INSERT INTO bank_accounts
        (id, connector_id, source_id, account_type, currency, raw_payload,
         created_at, updated_at)
      VALUES
        ('cathay-main', 'cathaybk', 'credit:cathaybk:main', 'credit', 'TWD',
         '{}', '2026-03-01', '2026-07-10'),
        ('cathay-deposit', 'cathaybk', 'bank:cathaybk:0001', 'savings', 'TWD',
         '{}', '2026-03-01', '2026-07-10'),
        ${cardIds
          .map(
            (last4) =>
              `('cathay-${last4}', 'cathaybk', 'credit:cathaybk:${last4}',
                'credit', 'TWD', '{}', '2026-07-10', '2026-07-10')`,
          )
          .join(",\n")};

      INSERT INTO bank_transactions
        (id, connector_id, account_id, source_id, posted_date, authorized_at,
         amount, currency, description, raw_payload, created_at, updated_at)
      VALUES
        ('old-in-window', 'cathaybk', 'cathay-main',
         '2026-07-09T00:00:00:credit:cathaybk:main:320:全家:1',
         '2026-07-09T00:00:00', '2026-07-09T00:00:00+08:00', -320, 'TWD',
         '全家', '{}', '2026-07-09', '2026-07-09'),
        ('new-in-window', 'cathaybk', 'cathay-1234',
         '2026-07-09T00:00:00:credit:cathaybk:main:320:全家:1',
         '2026-07-09', '2026-07-09', -320, 'TWD', '全家', '{}',
         '2026-07-10', '2026-07-10'),
        ('old-outside-window', 'cathaybk', 'cathay-main',
         '2026-03-01T00:00:00:credit:cathaybk:main:99:早餐:1',
         '2026-03-01T00:00:00', '2026-03-01T00:00:00+08:00', -99, 'TWD',
         '早餐', '{}', '2026-03-01', '2026-03-01'),
        ('deposit-midnight', 'cathaybk', 'cathay-deposit', 'deposit-1',
         '2026-07-05T00:00:00', '2026-07-05T00:00:00+08:00', 252, 'TWD',
         '薪資', '{}', '2026-07-05', '2026-07-05');

      INSERT INTO bank_transaction_preferences
        (transaction_id, excluded_from_calculation, created_at, updated_at)
      VALUES ('old-in-window', 1, '2026-07-09', '2026-07-09');

      INSERT INTO classification_overrides
        (id, target_type, target_id, category_id, created_at, updated_at)
      VALUES ('old-override', 'bank_transaction', 'old-in-window', 'shopping',
        '2026-07-09', '2026-07-09');

      INSERT INTO bank_balance_snapshots
        (id, connector_id, account_id, source_id, balance, currency, as_of_at,
         raw_payload, created_at, updated_at)
      VALUES
        ('main-balance', 'cathaybk', 'cathay-main',
         'credit:cathaybk:main:2026-07-09', -320, 'TWD', '2026-07-09', '{}',
         '2026-07-09', '2026-07-09');

      INSERT INTO credit_card_bills
        (id, connector_id, account_id, source_id, billing_period,
         statement_amount, currency, raw_payload, created_at, updated_at)
      VALUES
        ('main-june', 'cathaybk', 'cathay-main',
         'credit:cathaybk:main:bill:2026-06', '2026-06', 5000, 'TWD', '{}',
         '2026-06-23', '2026-06-23');
    `);
  }

  function cathayTransactions(db: SqliteD1) {
    return db.database
      .prepare(
        `SELECT id, account_id AS accountId, posted_date AS postedDate,
                authorized_at AS authorizedAt
         FROM bank_transactions WHERE connector_id = 'cathaybk' ORDER BY id`,
      )
      .all();
  }

  it("moves Cathay summary transactions to split cards and keeps pooled data on the summary account", async () => {
    const db = createDb();
    seedCathayCardHistory(db, ["1234", "5678"]);

    await db.batch(
      reconcileCathayCardAccountStatements(db as unknown as D1Database),
    );

    expect(cathayTransactions(db)).toEqual([
      {
        id: "deposit-midnight",
        accountId: "cathay-deposit",
        postedDate: "2026-07-05T00:00:00",
        authorizedAt: "2026-07-05T00:00:00+08:00",
      },
      {
        id: "new-in-window",
        accountId: "cathay-1234",
        postedDate: "2026-07-09",
        authorizedAt: "2026-07-09",
      },
      {
        id: "old-outside-window",
        accountId: "cathay-main",
        postedDate: "2026-03-01T00:00:00",
        authorizedAt: "2026-03-01T00:00:00+08:00",
      },
    ]);
    expect(
      db.database
        .prepare(
          "SELECT transaction_id, excluded_from_calculation FROM bank_transaction_preferences",
        )
        .get(),
    ).toEqual({
      transaction_id: "new-in-window",
      excluded_from_calculation: 1,
    });
    expect(
      db.database
        .prepare("SELECT target_id, category_id FROM classification_overrides")
        .get(),
    ).toEqual({ target_id: "new-in-window", category_id: "shopping" });
    expect(
      db.database
        .prepare(
          "SELECT COUNT(*) AS count FROM bank_accounts WHERE connector_id = 'cathaybk'",
        )
        .get(),
    ).toEqual({ count: 4 });
    expect(
      db.database
        .prepare(
          `SELECT
             (SELECT account_id FROM credit_card_bills) AS billAccountId,
             (SELECT account_id FROM bank_balance_snapshots) AS balanceAccountId`,
        )
        .get(),
    ).toEqual({
      billAccountId: "cathay-main",
      balanceAccountId: "cathay-main",
    });
  });

  it("merges the Cathay summary account into the only physical card", async () => {
    const db = createDb();
    seedCathayCardHistory(db, ["1234"]);

    await db.batch(
      reconcileCathayCardAccountStatements(db as unknown as D1Database),
    );

    expect(
      db.database
        .prepare(
          `SELECT source_id AS sourceId FROM bank_accounts
           WHERE connector_id = 'cathaybk' ORDER BY source_id`,
        )
        .all(),
    ).toEqual([
      { sourceId: "bank:cathaybk:0001" },
      { sourceId: "credit:cathaybk:1234" },
    ]);
    expect(cathayTransactions(db)).toEqual([
      {
        id: "deposit-midnight",
        accountId: "cathay-deposit",
        postedDate: "2026-07-05T00:00:00",
        authorizedAt: "2026-07-05T00:00:00+08:00",
      },
      {
        id: "new-in-window",
        accountId: "cathay-1234",
        postedDate: "2026-07-09",
        authorizedAt: "2026-07-09",
      },
      {
        id: "old-outside-window",
        accountId: "cathay-1234",
        postedDate: "2026-03-01T00:00:00",
        authorizedAt: "2026-03-01T00:00:00+08:00",
      },
    ]);
    expect(
      db.database
        .prepare("SELECT target_id, category_id FROM classification_overrides")
        .get(),
    ).toEqual({ target_id: "new-in-window", category_id: "shopping" });
    expect(
      db.database
        .prepare(
          `SELECT
             (SELECT account_id FROM credit_card_bills) AS billAccountId,
             (SELECT account_id FROM bank_balance_snapshots) AS balanceAccountId`,
        )
        .get(),
    ).toEqual({
      billAccountId: "cathay-1234",
      balanceAccountId: "cathay-1234",
    });
  });
});
