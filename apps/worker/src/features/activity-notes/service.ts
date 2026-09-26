import {
  ACTIVITY_NOTE_MAX_LENGTH,
  economicRoleOverrideKey,
  type ActivityNote,
  type ActivityNoteWriteResult,
  type EconomicRoleTargetKind,
} from "@taiwan-fin-hub/core";
import { activityExists } from "../activity-roles/repository";
import {
  deleteActivityNote,
  findActivityNote,
  listActivityNotes,
  listActivityNotesForTargets,
  upsertActivityNote,
} from "./repository";

export class ActivityNoteTargetNotFoundError extends Error {}
export class ActivityNoteNotFoundError extends Error {}
export class ActivityNoteTooLongError extends Error {}

/** 前後空白不保存；統一換行為 \n。 */
export function normalizeActivityNote(note: string) {
  return note.replace(/\r\n?/g, "\n").trim();
}

export function getActivityNotes(db: D1Database, month?: string) {
  return listActivityNotes(db, month);
}

/**
 * 讀取指定活動的備註，回傳以 kind + id（{@link economicRoleOverrideKey}）為 key 的
 * 對照表。
 */
export async function loadActivityNotes(
  db: D1Database,
  targets: { bankTransactionIds: string[]; invoiceIds: string[] },
) {
  const [bank, invoice] = await Promise.all([
    listActivityNotesForTargets(
      db,
      "bank_transaction",
      targets.bankTransactionIds,
    ),
    listActivityNotesForTargets(db, "invoice", targets.invoiceIds),
  ]);
  return new Map<string, ActivityNote>(
    [...bank, ...invoice].map((row) => [
      economicRoleOverrideKey(row.targetKind, row.targetId),
      row,
    ]),
  );
}

/**
 * 寫入或刪除（空字串）備註。活動不存在時拋出
 * {@link ActivityNoteTargetNotFoundError}；刪除不存在的備註不視為錯誤。
 */
export async function setActivityNote(
  db: D1Database,
  kind: EconomicRoleTargetKind,
  id: string,
  rawNote: string,
  options: { skipTargetCheck?: boolean } = {},
): Promise<ActivityNoteWriteResult> {
  const note = normalizeActivityNote(rawNote);
  if ([...note].length > ACTIVITY_NOTE_MAX_LENGTH)
    throw new ActivityNoteTooLongError();
  if (!options.skipTargetCheck && !(await activityExists(db, kind, id)))
    throw new ActivityNoteTargetNotFoundError();
  if (!note) {
    await deleteActivityNote(db, kind, id);
    return { targetKind: kind, targetId: id, note: null };
  }
  await upsertActivityNote(db, {
    targetKind: kind,
    targetId: id,
    note,
    now: new Date().toISOString(),
  });
  return (await findActivityNote(db, kind, id))!;
}

export async function removeActivityNote(
  db: D1Database,
  kind: EconomicRoleTargetKind,
  id: string,
) {
  if (!(await deleteActivityNote(db, kind, id)))
    throw new ActivityNoteNotFoundError();
}
