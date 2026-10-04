import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { unstable_splitSqlQuery } from "wrangler";
import { createTestD1, readMigrations } from "../testing/d1";

const migration = readFileSync(
  new URL("../migrations/0072_ctbc_disable_schedule.sql", import.meta.url),
  "utf8",
);
const all = readMigrations();
const previous = all.slice(0, all.indexOf(migration));

it("disables the CTBC schedule and clears only its stale failure", async () => {
  const h = await createTestD1(undefined, previous);
  try {
    const db = h.binding;
    await db.batch([
      db.prepare(
        "UPDATE sync_jobs SET enabled = 1, last_status = 'failed', last_error = '中國信託行動銀行服務暫時無法連線。', last_success_at = '2026-09-30T03:11:45.256Z' WHERE id = 'ctbc:all'",
      ),
      db.prepare(
        "UPDATE sync_jobs SET enabled = 1, last_status = 'failed', last_error = 'boom' WHERE id = 'taishin:all'",
      ),
    ]);
    await db.batch(
      unstable_splitSqlQuery(migration).map((statement) =>
        db.prepare(statement),
      ),
    );
    const rows = await db
      .prepare(
        "SELECT id, enabled, last_status, last_error, last_success_at FROM sync_jobs WHERE id IN ('ctbc:all', 'taishin:all') ORDER BY id",
      )
      .all();
    expect(rows.results).toEqual([
      {
        id: "ctbc:all",
        enabled: 0,
        last_status: "success",
        last_error: null,
        last_success_at: "2026-09-30T03:11:45.256Z",
      },
      {
        id: "taishin:all",
        enabled: 1,
        last_status: "failed",
        last_error: "boom",
        last_success_at: null,
      },
    ]);
  } finally {
    await h.mf.dispose();
  }
}, 60_000);
