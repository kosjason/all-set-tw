import { describe, expect, it } from "vitest";
import { reconcileSinopacLegacyTransactionStatements } from "../../../src/sources/sinopac/repository";
import { useSqliteD1 } from "../../helpers/sqlite-d1";

const createDb = useSqliteD1();

describe("Sinopac repair statements", () => {
  it("migrates preferences and removes matching legacy Sinopac transaction ids", async () => {
    const db = createDb();
    db.database.exec(`
      INSERT INTO bank_accounts
        (id, connector_id, source_id, account_type, currency, raw_payload, created_at, updated_at)
      VALUES
        ('sinopac:credit:sinopac:main', 'sinopac', 'credit:sinopac:main', 'credit', 'TWD', '{}', '2026-07-01', '2026-07-01');

      INSERT INTO bank_transactions
        (id, connector_id, account_id, source_id, posted_date, authorized_at, amount, currency, description, status, raw_payload, created_at, updated_at)
      VALUES
        ('sinopac-legacy', 'sinopac', 'sinopac:credit:sinopac:main', 'sinopac:card:tx:TWD:legacy', '2026-07-19', NULL, -260, 'TWD', '連支＊餐廳', 'posted', '{}', '2026-07-19', '2026-07-19'),
        ('sinopac-canonical', 'sinopac', 'sinopac:credit:sinopac:main', 'sinopac:card:tx:v2:TWD:2026-07-19:-260:8000:1', '2026-07-22', '2026-07-19', -260, 'TWD', '連支＊餐廳', 'posted', '{}', '2026-07-22', '2026-07-22');

      INSERT INTO bank_transaction_preferences
        (transaction_id, excluded_from_calculation, created_at, updated_at)
      VALUES ('sinopac-legacy', 1, '2026-07-19', '2026-07-19');

      INSERT INTO classification_overrides
        (id, target_type, target_id, category_id, created_at, updated_at)
      VALUES ('sinopac-legacy-override', 'bank_transaction', 'sinopac-legacy', 'shopping', '2026-07-19', '2026-07-19');
    `);

    await db.batch(
      reconcileSinopacLegacyTransactionStatements(db as unknown as D1Database),
    );

    expect(
      db.database
        .prepare("SELECT id FROM bank_transactions ORDER BY id")
        .all()
        .map((row) => row.id),
    ).toEqual(["sinopac-canonical"]);
    expect(
      db.database
        .prepare(
          "SELECT transaction_id AS transactionId FROM bank_transaction_preferences",
        )
        .get(),
    ).toEqual({ transactionId: "sinopac-canonical" });
    expect(
      db.database
        .prepare("SELECT target_id AS targetId FROM classification_overrides")
        .get(),
    ).toEqual({ targetId: "sinopac-canonical" });
  });
});
