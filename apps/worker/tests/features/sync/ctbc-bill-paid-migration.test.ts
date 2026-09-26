import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

const migrationsDirectory = fileURLToPath(
  new URL("../../../../../packages/db/migrations/", import.meta.url),
);
const migrationFile = "0064_ctbc_bill_paid_amount.sql";
const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function createDatabase() {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  database.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith(".sql") && name < migrationFile)
    .sort()) {
    database.exec(readFileSync(`${migrationsDirectory}/${file}`, "utf8"));
  }
  return database;
}

function insertBill(database: DatabaseSync, connectorId: string, id: string) {
  database
    .prepare(
      `INSERT INTO bank_accounts
        (id, connector_id, source_id, institution_name, account_name,
         account_type, currency, raw_payload, created_at, updated_at)
       VALUES (?, ?, ?, '虛構銀行', '虛構卡', 'credit', 'TWD', '{}',
               '2026-09-01', '2026-09-01')`,
    )
    .run(`${id}:account`, connectorId, `${id}:account`);
  database
    .prepare(
      `INSERT INTO credit_card_bills
        (id, connector_id, account_id, source_id, billing_period,
         statement_amount, paid_amount, is_paid, currency, raw_payload,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, '2026-09', 1000, 3000, 1, 'TWD', '{}',
               '2026-09-01', '2026-09-01')`,
    )
    .run(id, connectorId, `${id}:account`, id);
}

describe("0064 CTBC bill paid amount cleanup", () => {
  it("只清除中信帳單的已繳金額與已繳旗標", () => {
    const database = createDatabase();
    insertBill(database, "ctbc", "ctbc-bill");
    insertBill(database, "cathaybk", "cathay-bill");

    database.exec(
      readFileSync(`${migrationsDirectory}/${migrationFile}`, "utf8"),
    );

    const rows = database
      .prepare(
        "SELECT connector_id, paid_amount, is_paid FROM credit_card_bills ORDER BY connector_id",
      )
      .all();
    expect(rows).toEqual([
      { connector_id: "cathaybk", paid_amount: 3000, is_paid: 1 },
      { connector_id: "ctbc", paid_amount: null, is_paid: null },
    ]);
  });
});
