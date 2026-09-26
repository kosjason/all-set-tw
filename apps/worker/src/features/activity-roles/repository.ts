import {
  activityRoleOverrides,
  bankTransactions,
  createDrizzle,
  invoices,
} from "@taiwan-fin-hub/db";
import type {
  EconomicRole,
  EconomicRoleOverride,
  EconomicRoleTargetKind,
} from "@taiwan-fin-hub/core";
import { and, asc, eq, sql } from "drizzle-orm";

const overrideColumns = {
  targetKind: sql<EconomicRoleTargetKind>`${activityRoleOverrides.targetKind}`,
  targetId: activityRoleOverrides.targetId,
  economicRole: sql<EconomicRole>`${activityRoleOverrides.economicRole}`,
  duplicateOfKind: sql<EconomicRoleTargetKind | null>`${activityRoleOverrides.duplicateOfKind}`,
  duplicateOfId: activityRoleOverrides.duplicateOfId,
  createdAt: activityRoleOverrides.createdAt,
  updatedAt: activityRoleOverrides.updatedAt,
};

type OverrideRow = {
  targetKind: EconomicRoleTargetKind;
  targetId: string;
  economicRole: EconomicRole;
  duplicateOfKind: EconomicRoleTargetKind | null;
  duplicateOfId: string | null;
  createdAt: string;
  updatedAt: string;
};

function toOverride(row: OverrideRow): EconomicRoleOverride {
  return {
    targetKind: row.targetKind,
    targetId: row.targetId,
    economicRole: row.economicRole,
    reviewStatus: "confirmed",
    duplicateOf:
      row.duplicateOfKind && row.duplicateOfId
        ? { kind: row.duplicateOfKind, id: row.duplicateOfId }
        : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** 列出覆寫；指定 ids 時只讀取這些活動（以單一 JSON 參數綁定，避免 D1 參數上限）。 */
export async function listActivityRoleOverrides(
  db: D1Database,
  filter?: { kind: EconomicRoleTargetKind; ids: string[] },
): Promise<EconomicRoleOverride[]> {
  if (filter && filter.ids.length === 0) return [];
  const rows = await createDrizzle(db)
    .select(overrideColumns)
    .from(activityRoleOverrides)
    .where(
      filter
        ? and(
            eq(activityRoleOverrides.targetKind, filter.kind),
            sql`${activityRoleOverrides.targetId} IN (SELECT value FROM json_each(${JSON.stringify(filter.ids)}))`,
          )
        : undefined,
    )
    .orderBy(
      asc(activityRoleOverrides.targetKind),
      asc(activityRoleOverrides.targetId),
    )
    .all();
  return rows.map(toOverride);
}

export async function upsertActivityRoleOverride(
  db: D1Database,
  override: EconomicRoleOverride,
) {
  const values = {
    economicRole: override.economicRole,
    reviewStatus: "confirmed",
    duplicateOfKind: override.duplicateOf?.kind ?? null,
    duplicateOfId: override.duplicateOf?.id ?? null,
    updatedAt: override.updatedAt,
  };
  await createDrizzle(db)
    .insert(activityRoleOverrides)
    .values({
      targetKind: override.targetKind,
      targetId: override.targetId,
      createdAt: override.createdAt,
      ...values,
    })
    .onConflictDoUpdate({
      target: [
        activityRoleOverrides.targetKind,
        activityRoleOverrides.targetId,
      ],
      set: values,
    })
    .run();
  const row = await createDrizzle(db)
    .select(overrideColumns)
    .from(activityRoleOverrides)
    .where(
      and(
        eq(activityRoleOverrides.targetKind, override.targetKind),
        eq(activityRoleOverrides.targetId, override.targetId),
      ),
    )
    .get();
  return row ? toOverride(row) : override;
}

export async function deleteActivityRoleOverride(
  db: D1Database,
  kind: EconomicRoleTargetKind,
  id: string,
) {
  const result = await createDrizzle(db)
    .delete(activityRoleOverrides)
    .where(
      and(
        eq(activityRoleOverrides.targetKind, kind),
        eq(activityRoleOverrides.targetId, id),
      ),
    )
    .run();
  return result.meta.changes > 0;
}

export async function activityExists(
  db: D1Database,
  kind: EconomicRoleTargetKind,
  id: string,
) {
  const drizzle = createDrizzle(db);
  if (kind === "invoice")
    return Boolean(
      await drizzle
        .select({ id: invoices.id })
        .from(invoices)
        .where(eq(invoices.id, id))
        .get(),
    );
  return Boolean(
    await drizzle
      .select({ id: bankTransactions.id })
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.id, id),
          sql`(${bankTransactions.status} <> 'pending' OR ${bankTransactions.matchedTransactionId} IS NULL)`,
        ),
      )
      .get(),
  );
}
