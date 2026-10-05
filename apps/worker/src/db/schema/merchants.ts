import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  primaryKey,
  index,
  foreignKey,
  check,
} from "drizzle-orm/sqlite-core";
import { classificationCategories } from "./classification";

// SQL migrations remain authoritative for schema shape and constraints.

/** 使用者對商家的顯示名稱與商家規則（分類、經濟角色）。 */
export const merchantAliases = sqliteTable(
  "merchant_aliases",
  {
    merchantKey: text("merchant_key").notNull(),
    displayName: text("display_name"),
    categoryId: text("category_id"),
    economicRole: text("economic_role"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.merchantKey] }),
    index("idx_merchant_aliases_category").on(table.categoryId),
    foreignKey({
      columns: [table.categoryId],
      foreignColumns: [classificationCategories.id],
    }),
    check(
      "merchant_aliases_check_1",
      sql`
    merchant_key GLOB 'ban:[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
    OR (merchant_key GLOB 'name:?*' AND length(merchant_key) <= 125)
  `,
    ),
    check(
      "merchant_aliases_check_2",
      sql`display_name IS NULL OR length(trim(display_name)) > 0`,
    ),
    check(
      "merchant_aliases_check_3",
      sql`
    economic_role IS NULL
    OR economic_role IN ('spending', 'income', 'own_transfer', 'investment', 'card_payment')
  `,
    ),
  ],
);
