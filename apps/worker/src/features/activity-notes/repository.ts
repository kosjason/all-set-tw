import { activityNotes, createDrizzle } from "@taiwan-fin-hub/db";
import type {
  ActivityNote,
  ActivityNoteRow,
  EconomicRoleTargetKind,
} from "@taiwan-fin-hub/core";
import { and, eq, sql } from "drizzle-orm";

const noteColumns = {
  targetKind: sql<EconomicRoleTargetKind>`${activityNotes.targetKind}`,
  targetId: activityNotes.targetId,
  note: activityNotes.note,
  createdAt: activityNotes.createdAt,
  updatedAt: activityNotes.updatedAt,
};

/** 讀取指定活動的備註（以單一 JSON 參數綁定，避免 D1 參數上限）。 */
export async function listActivityNotesForTargets(
  db: D1Database,
  kind: EconomicRoleTargetKind,
  ids: string[],
): Promise<ActivityNote[]> {
  if (ids.length === 0) return [];
  return createDrizzle(db)
    .select(noteColumns)
    .from(activityNotes)
    .where(
      and(
        eq(activityNotes.targetKind, kind),
        sql`${activityNotes.targetId} IN (SELECT value FROM json_each(${JSON.stringify([...new Set(ids)])}))`,
      ),
    )
    .all();
}

export async function findActivityNote(
  db: D1Database,
  kind: EconomicRoleTargetKind,
  id: string,
): Promise<ActivityNote | null> {
  return (
    (await createDrizzle(db)
      .select(noteColumns)
      .from(activityNotes)
      .where(
        and(eq(activityNotes.targetKind, kind), eq(activityNotes.targetId, id)),
      )
      .get()) ?? null
  );
}

export async function upsertActivityNote(
  db: D1Database,
  input: {
    targetKind: EconomicRoleTargetKind;
    targetId: string;
    note: string;
    now: string;
  },
) {
  await createDrizzle(db)
    .insert(activityNotes)
    .values({
      targetKind: input.targetKind,
      targetId: input.targetId,
      note: input.note,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoUpdate({
      target: [activityNotes.targetKind, activityNotes.targetId],
      set: { note: input.note, updatedAt: input.now },
    })
    .run();
}

export async function deleteActivityNote(
  db: D1Database,
  kind: EconomicRoleTargetKind,
  id: string,
) {
  const result = await createDrizzle(db)
    .delete(activityNotes)
    .where(
      and(eq(activityNotes.targetKind, kind), eq(activityNotes.targetId, id)),
    )
    .run();
  return result.meta.changes > 0;
}

/**
 * 列出備註與所屬活動的台北日期；指定 month（YYYY-MM）時只回傳該月活動的備註。
 * 日期運算與活動搜尋的候選日相同（精確時間 +8 小時，純日期原樣）。
 */
export async function listActivityNotes(
  db: D1Database,
  month?: string,
): Promise<ActivityNoteRow[]> {
  const monthFilter = month ?? null;
  const rows = await createDrizzle(db).all<ActivityNoteRow>(sql`
    WITH noted AS (
      SELECT
        note.target_kind AS targetKind,
        note.target_id AS targetId,
        note.note AS note,
        note.created_at AS createdAt,
        note.updated_at AS updatedAt,
        CASE note.target_kind
          WHEN 'bank_transaction' THEN (
            SELECT CASE WHEN length(txn.authorized_at) > 10
              THEN COALESCE(date(txn.authorized_at, '+8 hours'), substr(txn.authorized_at, 1, 10))
              ELSE substr(COALESCE(txn.authorized_at, txn.posted_date), 1, 10) END
            FROM bank_transactions txn WHERE txn.id = note.target_id)
          ELSE (
            SELECT CASE WHEN length(inv.invoice_date) > 10
              THEN COALESCE(date(inv.invoice_date, '+8 hours'), substr(inv.invoice_date, 1, 10))
              ELSE substr(inv.invoice_date, 1, 10) END
            FROM invoices inv WHERE inv.id = note.target_id)
        END AS date
      FROM activity_notes note
    )
    SELECT targetKind, targetId, note, createdAt, updatedAt, date FROM noted
    WHERE ${monthFilter} IS NULL OR substr(date, 1, 7) = ${monthFilter}
    ORDER BY date DESC, updatedAt DESC, targetKind, targetId
  `);
  return rows.map((row) => ({ ...row, date: row.date ?? null }));
}
