import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

const migrationsDirectory = fileURLToPath(
  new URL("../../../../../packages/db/migrations/", import.meta.url),
);
const migrationFile = "0053_investment_position_broker.sql";
const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function createDatabase() {
  const database = new DatabaseSync(":memory:");
  for (const file of readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith(".sql") && name < migrationFile)
    .sort()) {
    database.exec(readFileSync(`${migrationsDirectory}/${file}`, "utf8"));
  }
  databases.push(database);
  return database;
}

function insertPosition(
  database: DatabaseSync,
  id: string,
  sourceId: string,
  assetType = "etf",
  connectorId = "tdcc",
) {
  database
    .prepare(
      `INSERT INTO investment_positions
        (id, connector_id, source_id, asset_type, symbol, name, currency,
         as_of_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, '0050', '測試台灣50', 'TWD', '2026-09-24', ?, ?)`,
    )
    .run(id, connectorId, sourceId, assetType, "2026-09-24", "2026-09-24");
}

describe("0050 investment position broker migration", () => {
  it("backfills broker code and latest broker name for TDCC stock positions", () => {
    const database = createDatabase();
    insertPosition(database, "a", "9A92:1111111:0050:2026-09-24");
    insertPosition(database, "b", "9B01:2222222:0050:2026-09-24");
    insertPosition(database, "fund", "ORG1:FUND1:2026-09-24", "fund");
    insertPosition(
      database,
      "other",
      "9A92:1111111:0050:2026-09-24",
      "etf",
      "manual",
    );
    const trade = database.prepare(
      `INSERT INTO investment_transactions
        (id, connector_id, account_id, source_id, broker_no, broker_name,
         currency, created_at, updated_at)
       VALUES (?, 'tdcc', ?, ?, ?, ?, 'TWD', ?, ?)`,
    );
    trade.run(
      "t-old",
      "9A92:1111111",
      "t-old",
      "9A92",
      "舊名稱",
      "2026-01-01",
      "2026-01-01",
    );
    trade.run(
      "t-new",
      "9A92:1111111",
      "t-new",
      "9A92",
      "測試證券甲",
      "2026-09-01",
      "2026-09-01",
    );

    database.exec(
      readFileSync(`${migrationsDirectory}/${migrationFile}`, "utf8"),
    );

    expect(
      database
        .prepare(
          `SELECT id, broker_no, broker_name FROM investment_positions ORDER BY id`,
        )
        .all(),
    ).toEqual([
      { id: "a", broker_no: "9A92", broker_name: "測試證券甲" },
      { id: "b", broker_no: "9B01", broker_name: null },
      { id: "fund", broker_no: null, broker_name: null },
      { id: "other", broker_no: null, broker_name: null },
    ]);
  });
});
