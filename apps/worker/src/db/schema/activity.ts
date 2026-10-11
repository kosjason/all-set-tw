import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  check,
  index,
  foreignKey,
} from "drizzle-orm/sqlite-core";
import { classificationCategories } from "./classification";

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
    counterparty: text("counterparty"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.targetKind, table.targetId] }),
    index("idx_activity_role_overrides_counterparty")
      .on(table.counterparty)
      .where(sql`counterparty IS NOT NULL`),
    check(
      "activity_role_overrides_check_1",
      sql`target_kind IN ('bank_transaction', 'invoice')`,
    ),
    check(
      "activity_role_overrides_check_2",
      sql`
    economic_role IN (
      'spending', 'income', 'own_transfer', 'investment', 'card_payment', 'excluded',
      'advance', 'reimbursement'
    )
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
    check(
      "activity_role_overrides_check_7",
      sql`
    counterparty IS NULL
    OR (counterparty = trim(counterparty) AND length(counterparty) BETWEEN 1 AND 40)
  `,
    ),
    check(
      "activity_role_overrides_check_8",
      sql`(economic_role IN ('advance', 'reimbursement')) = (counterparty IS NOT NULL)`,
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

/** 使用者手動記的現金支出（0074）；分配到提款在讀取時計算，不落地。 */
export const cashExpenses = sqliteTable(
  "cash_expenses",
  {
    id: text("id").notNull(),
    expenseDate: text("expense_date").notNull(),
    amount: integer("amount").notNull(),
    categoryId: text("category_id").notNull(),
    description: text("description"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index("idx_cash_expenses_date").on(table.expenseDate, table.createdAt),
    foreignKey({
      columns: [table.categoryId],
      foreignColumns: [classificationCategories.id],
    }),
    check(
      "cash_expenses_check_1",
      sql`
    expense_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'
    AND expense_date IS date(expense_date)
  `,
    ),
    check(
      "cash_expenses_check_2",
      sql`
    typeof(amount) = 'integer' AND amount BETWEEN 1 AND 10000000
  `,
    ),
    check(
      "cash_expenses_check_3",
      sql`
    description IS NULL
    OR (description = trim(description) AND length(description) BETWEEN 1 AND 100)
  `,
    ),
  ],
);
