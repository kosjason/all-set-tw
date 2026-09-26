import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

const migrationsDirectory = fileURLToPath(
  new URL("../../../../../packages/db/migrations/", import.meta.url),
);
const migrationFile = "0069_donation_category.sql";
const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function migrate(database: DatabaseSync, include: (name: string) => boolean) {
  for (const file of readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith(".sql") && include(name))
    .sort()) {
    database.exec(readFileSync(`${migrationsDirectory}/${file}`, "utf8"));
  }
}

describe("0069 donation category", () => {
  it("keeps 捐款 before 其他 without touching merchant rules", () => {
    const database = new DatabaseSync(":memory:");
    databases.push(database);
    migrate(database, (name) => name < migrationFile);
    database.exec(`
      INSERT INTO merchant_aliases (merchant_key, display_name, category_id, economic_role, created_at, updated_at) VALUES
        ('name:家扶基金會qaichu', NULL, 'misc', NULL, 'now', 'now'),
        ('name:測試基金會', NULL, 'health', NULL, 'now', 'now'),
        ('name:紅包店', NULL, 'misc', NULL, 'now', 'now');
    `);
    migrate(database, (name) => name === migrationFile);

    const categories = database
      .prepare(
        "SELECT id, label FROM classification_categories WHERE id IN ('health', 'donation', 'misc') ORDER BY sort_order",
      )
      .all();
    expect(categories).toEqual([
      { id: "health", label: "醫療保險" },
      { id: "donation", label: "捐款" },
      { id: "misc", label: "其他" },
    ]);
    expect(
      database
        .prepare(
          "SELECT merchant_key, category_id FROM merchant_aliases ORDER BY merchant_key",
        )
        .all(),
    ).toEqual([
      // 使用者選「其他」的慈善商家規則不被改成捐款。
      { merchant_key: "name:家扶基金會qaichu", category_id: "misc" },
      { merchant_key: "name:測試基金會", category_id: "health" },
      { merchant_key: "name:紅包店", category_id: "misc" },
    ]);
  });
});
