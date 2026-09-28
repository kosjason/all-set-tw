import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { unstable_splitSqlQuery } from "wrangler";
import { createTestD1, readMigrations } from "../testing/d1";

const migration = readFileSync(
  new URL("../migrations/0071_budget_monthly_limit.sql", import.meta.url),
  "utf8",
);
const all = readMigrations();
const previous = all.slice(0, all.indexOf(migration));

it("keeps the expected income and annual reserve when switching to a monthly budget", async () => {
  const h = await createTestD1(undefined, previous);
  try {
    const db = h.binding;
    await db
      .prepare(
        "INSERT INTO budget_settings (id, expected_income, savings_target_type, savings_target_value, annual_reserve, updated_at) VALUES ('default', 160000, 'percent', 30, 60000, '2026-09-28T00:00:00.000Z')",
      )
      .run();
    await db.batch(
      unstable_splitSqlQuery(migration).map((statement) =>
        db.prepare(statement),
      ),
    );
    expect(
      await db.prepare("SELECT * FROM budget_settings").all(),
    ).toMatchObject({
      results: [
        {
          id: "default",
          monthly_budget: null,
          expected_income: 160000,
          annual_reserve: 60000,
          updated_at: "2026-09-28T00:00:00.000Z",
        },
      ],
    });
    const columns = (
      await db.prepare("PRAGMA table_info('budget_settings')").all<{
        name: string;
      }>()
    ).results.map((column) => column.name);
    expect(columns).not.toContain("savings_target_type");
    await expect(
      db
        .prepare(
          "UPDATE budget_settings SET monthly_budget = -1 WHERE id = 'default'",
        )
        .run(),
    ).rejects.toThrow();
  } finally {
    await h.mf.dispose();
  }
});
