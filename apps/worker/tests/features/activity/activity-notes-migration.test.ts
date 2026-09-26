import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

const migrationsDirectory = fileURLToPath(
  new URL("../../../../../packages/db/migrations/", import.meta.url),
);
const migrationFile = "0063_activity_notes_excluded_role.sql";
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
    .sort())
    database.exec(readFileSync(`${migrationsDirectory}/${file}`, "utf8"));
  return database;
}

function applyMigration(database: DatabaseSync) {
  database.exec(
    readFileSync(`${migrationsDirectory}/${migrationFile}`, "utf8"),
  );
}

const insertOverride = (
  database: DatabaseSync,
  id: string,
  role: string,
  duplicate: [string, string] | null = null,
) =>
  database
    .prepare(
      `INSERT INTO activity_role_overrides
        (target_kind, target_id, economic_role, review_status, duplicate_of_kind,
         duplicate_of_id, created_at, updated_at)
       VALUES ('bank_transaction', ?, ?, 'confirmed', ?, ?, '2026-09-01', '2026-09-02')`,
    )
    .run(id, role, duplicate?.[0] ?? null, duplicate?.[1] ?? null);

describe("0063 activity notes and excluded role", () => {
  it("keeps existing overrides and relaxes the role CHECK to allow excluded", () => {
    const database = createDatabase();
    insertOverride(database, "tx-1", "own_transfer");
    insertOverride(database, "tx-2", "spending", ["invoice", "inv-9"]);
    // 0063 之前不允許 excluded。
    expect(() => insertOverride(database, "tx-3", "excluded")).toThrow(
      /CHECK constraint failed/,
    );

    applyMigration(database);

    expect(
      database
        .prepare(
          "SELECT target_kind, target_id, economic_role, review_status, duplicate_of_kind, duplicate_of_id, created_at, updated_at FROM activity_role_overrides ORDER BY target_id",
        )
        .all(),
    ).toEqual([
      {
        target_kind: "bank_transaction",
        target_id: "tx-1",
        economic_role: "own_transfer",
        review_status: "confirmed",
        duplicate_of_kind: null,
        duplicate_of_id: null,
        created_at: "2026-09-01",
        updated_at: "2026-09-02",
      },
      {
        target_kind: "bank_transaction",
        target_id: "tx-2",
        economic_role: "spending",
        review_status: "confirmed",
        duplicate_of_kind: "invoice",
        duplicate_of_id: "inv-9",
        created_at: "2026-09-01",
        updated_at: "2026-09-02",
      },
    ]);
    insertOverride(database, "tx-3", "excluded");
    // 其他 CHECK 仍在。
    expect(() => insertOverride(database, "tx-4", "refund")).toThrow(
      /CHECK constraint failed/,
    );
    expect(() =>
      insertOverride(database, "tx-5", "spending", [
        "bank_transaction",
        "tx-5",
      ]),
    ).toThrow(/CHECK constraint failed/);
    expect(() => insertOverride(database, "tx-1", "income")).toThrow(
      /UNIQUE constraint failed/,
    );
    expect(
      database
        .prepare("SELECT name FROM sqlite_schema WHERE name LIKE '%_new'")
        .all(),
    ).toEqual([]);
  });

  it("creates activity_notes with length and target checks", () => {
    const database = createDatabase();
    applyMigration(database);
    const insert = (kind: string, id: string, note: string) =>
      database
        .prepare(
          "INSERT INTO activity_notes (target_kind, target_id, note, created_at, updated_at) VALUES (?, ?, ?, '2026-09-01', '2026-09-01')",
        )
        .run(kind, id, note);
    insert("bank_transaction", "tx-1", "跟朋友A買人民幣，存富邦華一");
    insert("invoice", "inv-1", "中".repeat(1000));
    expect(() => insert("invoice", "inv-2", "中".repeat(1001))).toThrow(
      /CHECK constraint failed/,
    );
    expect(() => insert("invoice", "inv-3", "")).toThrow(
      /CHECK constraint failed/,
    );
    expect(() => insert("trade", "t-1", "x")).toThrow(
      /CHECK constraint failed/,
    );
    expect(() => insert("bank_transaction", "tx-1", "again")).toThrow(
      /UNIQUE constraint failed/,
    );
  });
});
