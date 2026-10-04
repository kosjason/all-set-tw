import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { unstable_splitSqlQuery } from "wrangler";
import { createTestD1, readMigrations } from "../testing/d1";

const migration = readFileSync(
  new URL("../migrations/0073_activity_advances.sql", import.meta.url),
  "utf8",
);
const all = readMigrations();
const previous = all.slice(0, all.indexOf(migration));

it("keeps existing role overrides and allows advances with a counterparty", async () => {
  const h = await createTestD1(undefined, previous);
  try {
    const db = h.binding;
    await db
      .prepare(
        "INSERT INTO activity_role_overrides (target_kind, target_id, economic_role, duplicate_of_kind, duplicate_of_id, created_at, updated_at) VALUES ('bank_transaction', 'a', 'excluded', NULL, NULL, '2026-09-30T00:00:00.000Z', '2026-09-30T00:00:00.000Z'), ('invoice', 'b', 'spending', 'bank_transaction', 'a', '2026-09-30T00:00:00.000Z', '2026-09-30T00:00:00.000Z')",
      )
      .run();
    await db.batch(
      unstable_splitSqlQuery(migration).map((statement) =>
        db.prepare(statement),
      ),
    );
    expect(
      (
        await db
          .prepare(
            "SELECT target_id, economic_role, duplicate_of_id, counterparty FROM activity_role_overrides ORDER BY target_id",
          )
          .all()
      ).results,
    ).toEqual([
      {
        target_id: "a",
        economic_role: "excluded",
        duplicate_of_id: null,
        counterparty: null,
      },
      {
        target_id: "b",
        economic_role: "spending",
        duplicate_of_id: "a",
        counterparty: null,
      },
    ]);
    await db
      .prepare(
        "INSERT INTO activity_role_overrides (target_kind, target_id, economic_role, counterparty, created_at, updated_at) VALUES ('bank_transaction', 'c', 'reimbursement', 'Irene', '2026-09-30T00:00:00.000Z', '2026-09-30T00:00:00.000Z')",
      )
      .run();
    await expect(
      db
        .prepare(
          "INSERT INTO activity_role_overrides (target_kind, target_id, economic_role, counterparty, created_at, updated_at) VALUES ('bank_transaction', 'd', 'advance', ' Irene', '2026-09-30T00:00:00.000Z', '2026-09-30T00:00:00.000Z')",
        )
        .run(),
    ).rejects.toThrow();
  } finally {
    await h.mf.dispose();
  }
}, 60_000);
