import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  sqliteTable,
  text,
  integer,
  primaryKey,
  unique,
  uniqueIndex,
  index,
  foreignKey,
  check,
} from "drizzle-orm/sqlite-core";

// SQL migrations remain authoritative for schema shape and constraints.

export const classificationCategories = sqliteTable(
  "classification_categories",
  {
    id: text("id").notNull(),
    label: text("label").notNull(),
    sortOrder: integer("sort_order")
      .notNull()
      .default(sql`0`),
    isSystem: integer("is_system")
      .notNull()
      .default(sql`1`),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    parentId: text("parent_id").references(
      (): AnySQLiteColumn => classificationCategories.id,
    ),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    uniqueIndex("idx_classification_categories_label_nocase").on(
      sql`label COLLATE NOCASE`,
    ),
  ],
);

export const classificationOverrides = sqliteTable(
  "classification_overrides",
  {
    id: text("id").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    categoryId: text("category_id").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index("idx_classification_overrides_category").on(table.categoryId),
    unique().on(table.targetType, table.targetId),
    foreignKey({
      columns: [table.categoryId],
      foreignColumns: [classificationCategories.id],
    }),
  ],
);

export const classificationRules = sqliteTable(
  "classification_rules",
  {
    id: text("id").notNull(),
    categoryId: text("category_id"),
    economicRole: text("economic_role"),
    targetType: text("target_type"),
    field: text("field").notNull(),
    operator: text("operator").notNull(),
    pattern: text("pattern").notNull(),
    priority: integer("priority")
      .notNull()
      .default(sql`100`),
    enabled: integer("enabled")
      .notNull()
      .default(sql`1`),
    isSystem: integer("is_system")
      .notNull()
      .default(sql`0`),
    source: text("source")
      .notNull()
      .default(sql`'user'`),
    description: text("description"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    excludedFromCalculation: integer("excluded_from_calculation")
      .notNull()
      .default(sql`0`),
    amountDirection: text("amount_direction")
      .notNull()
      .default(sql`'any'`),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index("idx_classification_rules_category").on(table.categoryId),
    index("idx_classification_rules_enabled_priority").on(
      table.enabled,
      table.targetType,
      table.priority,
    ),
    foreignKey({
      columns: [table.categoryId],
      foreignColumns: [classificationCategories.id],
    }),
    check(
      "classification_rules_check_1",
      sql`
    economic_role IS NULL
    OR economic_role IN ('spending', 'income', 'own_transfer', 'investment', 'card_payment')
  `,
    ),
    check(
      "classification_rules_check_2",
      sql`excluded_from_calculation IN (0, 1)`,
    ),
    check(
      "classification_rules_check_3",
      sql`amount_direction IN ('any', 'inflow', 'outflow')`,
    ),
  ],
);

/**
 * 分類遷移紀錄（0055、0067、0069）：id 有變動的覆寫與使用者規則、因撞名改名的自訂分類、
 * 保留下來的使用者系統規則 pattern（保留原名稱與原 pattern 供人工處理）。
 */
export const classificationMigrationNotes = sqliteTable(
  "classification_migration_notes",
  {
    id: text("id").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    legacyCategoryId: text("legacy_category_id").notNull(),
    legacyLabel: text("legacy_label").notNull(),
    newCategoryId: text("new_category_id"),
    newEconomicRole: text("new_economic_role"),
    needsAttention: integer("needs_attention")
      .notNull()
      .default(sql`0`),
    createdAt: text("created_at").notNull(),
    newLabel: text("new_label"),
    legacyPattern: text("legacy_pattern"),
    newPattern: text("new_pattern"),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    check(
      "classification_migration_notes_check_1",
      sql`subject_type IN ('override', 'rule', 'category')`,
    ),
    check(
      "classification_migration_notes_check_2",
      sql`
    new_economic_role IS NULL
    OR new_economic_role IN ('spending', 'income', 'own_transfer', 'investment', 'card_payment')
  `,
    ),
    check(
      "classification_migration_notes_check_3",
      sql`needs_attention IN (0, 1)`,
    ),
  ],
);
