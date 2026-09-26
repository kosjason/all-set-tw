import { sql } from "drizzle-orm";
import { sqliteTable, text, primaryKey, check } from "drizzle-orm/sqlite-core";

// SQL migrations remain authoritative for schema shape and constraints.

export const activityRoleOverrides = sqliteTable(
  "activity_role_overrides",
  {
    targetKind: text("target_kind").notNull(),
    targetId: text("target_id").notNull(),
    economicRole: text("economic_role").notNull(),
    reviewStatus: text("review_status")
      .notNull()
      .default(sql`'confirmed'`),
    duplicateOfKind: text("duplicate_of_kind"),
    duplicateOfId: text("duplicate_of_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.targetKind, table.targetId] }),
    check(
      "activity_role_overrides_check_1",
      sql`target_kind IN ('bank_transaction', 'invoice')`,
    ),
    check(
      "activity_role_overrides_check_2",
      sql`
    economic_role IN ('spending', 'income', 'own_transfer', 'investment', 'card_payment', 'excluded')
  `,
    ),
    check("activity_role_overrides_check_3", sql`review_status = 'confirmed'`),
    check(
      "activity_role_overrides_check_4",
      sql`
    duplicate_of_kind IS NULL OR duplicate_of_kind IN ('bank_transaction', 'invoice')
  `,
    ),
    check(
      "activity_role_overrides_check_5",
      sql`(duplicate_of_kind IS NULL) = (duplicate_of_id IS NULL)`,
    ),
    check(
      "activity_role_overrides_check_6",
      sql`NOT (duplicate_of_kind = target_kind AND duplicate_of_id = target_id)`,
    ),
  ],
);

/** 使用者對單筆活動的備註（0063）；多型參照，不設 FK。 */
export const activityNotes = sqliteTable(
  "activity_notes",
  {
    targetKind: text("target_kind").notNull(),
    targetId: text("target_id").notNull(),
    note: text("note").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.targetKind, table.targetId] }),
    check(
      "activity_notes_check_1",
      sql`target_kind IN ('bank_transaction', 'invoice')`,
    ),
    check("activity_notes_check_2", sql`length(note) BETWEEN 1 AND 1000`),
  ],
);
