import {
  economicRoleOverrideKey,
  type ActivityRef,
  type EconomicRole,
  type EconomicRoleOverride,
  type EconomicRoleTargetKind,
} from "@taiwan-fin-hub/core";
import {
  activityExists,
  deleteActivityRoleOverride,
  listActivityRoleOverrides,
  upsertActivityRoleOverride,
} from "./repository";
import { setActivityNote } from "../activity-notes/service";

export class ActivityRoleTargetNotFoundError extends Error {}
export class ActivityRoleDuplicateNotFoundError extends Error {}
export class ActivityRoleSelfDuplicateError extends Error {}
export class ActivityRoleOverrideNotFoundError extends Error {}

export function getActivityRoleOverrides(db: D1Database) {
  return listActivityRoleOverrides(db);
}

/** 讀取指定活動的覆寫，回傳以 kind + id 為 key 的對照表。 */
export async function loadActivityRoleOverrides(
  db: D1Database,
  kind: EconomicRoleTargetKind,
  ids: string[],
) {
  const rows = await listActivityRoleOverrides(db, {
    kind,
    ids: [...new Set(ids)],
  });
  return new Map(
    rows.map((row) => [
      economicRoleOverrideKey(row.targetKind, row.targetId),
      row,
    ]),
  );
}

export async function setActivityRoleOverride(
  db: D1Database,
  kind: EconomicRoleTargetKind,
  id: string,
  input: {
    economicRole: EconomicRole;
    duplicateOf?: ActivityRef | null;
    /** 一併寫入備註；空字串或 null 刪除，undefined 不變更。 */
    note?: string | null;
  },
) {
  const duplicateOf = input.duplicateOf ?? null;
  if (duplicateOf && duplicateOf.kind === kind && duplicateOf.id === id)
    throw new ActivityRoleSelfDuplicateError();
  const [targetExists, duplicateExists] = await Promise.all([
    activityExists(db, kind, id),
    duplicateOf
      ? activityExists(db, duplicateOf.kind, duplicateOf.id)
      : Promise.resolve(true),
  ]);
  if (!targetExists) throw new ActivityRoleTargetNotFoundError();
  if (!duplicateExists) throw new ActivityRoleDuplicateNotFoundError();

  const now = new Date().toISOString();
  const override: EconomicRoleOverride = {
    targetKind: kind,
    targetId: id,
    economicRole: input.economicRole,
    reviewStatus: "confirmed",
    duplicateOf,
    createdAt: now,
    updatedAt: now,
  };
  const saved = await upsertActivityRoleOverride(db, override);
  if (input.note === undefined) return saved;
  const note = await setActivityNote(db, kind, id, input.note ?? "", {
    skipTargetCheck: true,
  });
  return { ...saved, note: note.note };
}

export async function removeActivityRoleOverride(
  db: D1Database,
  kind: EconomicRoleTargetKind,
  id: string,
) {
  if (!(await deleteActivityRoleOverride(db, kind, id)))
    throw new ActivityRoleOverrideNotFoundError();
}
