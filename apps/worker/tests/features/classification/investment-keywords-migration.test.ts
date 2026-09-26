import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

const migrationsDirectory = fileURLToPath(
  new URL("../../../../../packages/db/migrations/", import.meta.url),
);
const migrationFile = "0068_investment_keywords_exclude_foundation.sql";
const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function migrate(upTo: string, inclusive: boolean) {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  for (const file of readdirSync(migrationsDirectory)
    .filter(
      (name) =>
        name.endsWith(".sql") && (inclusive ? name <= upTo : name < upTo),
    )
    .sort()) {
    database.exec(readFileSync(`${migrationsDirectory}/${file}`, "utf8"));
  }
  return database;
}

function investmentPattern(database: DatabaseSync) {
  const row = database
    .prepare(
      "SELECT pattern FROM classification_rules WHERE id = 'system:bank:investment-keywords'",
    )
    .get() as { pattern: string };
  return new RegExp(row.pattern, "iu");
}

describe("0068 investment keywords", () => {
  it("不再把基金會當成投資，仍比對基金", () => {
    const before = investmentPattern(migrate(migrationFile, false));
    expect(before.test("家扶基金會")).toBe(true);

    const after = investmentPattern(migrate(migrationFile, true));
    expect(after.test("家扶基金會QAICHU")).toBe(false);
    expect(after.test("定期定額基金")).toBe(true);
    expect(after.test("元大台灣50 ETF")).toBe(true);
  });
});
