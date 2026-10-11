import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  index,
  foreignKey,
  check,
} from "drizzle-orm/sqlite-core";
import { classificationCategories } from "./classification";

// SQL migrations remain authoritative for schema shape and constraints.

/** 使用者對商家的顯示名稱與商家規則（分類、經濟角色、是否都付現金）。 */
export const merchantAliases = sqliteTable(
  "merchant_aliases",
  {
    merchantKey: text("merchant_key").notNull(),
    displayName: text("display_name"),
    categoryId: text("category_id"),
    economicRole: text("economic_role"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    /** 0075：這家都付現金（沒配對到交易的發票從提款扣）。 */
    paidInCash: integer("paid_in_cash", { mode: "boolean" })
      .notNull()
      .default(sql`0`),
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
    check("merchant_aliases_check_4", sql`paid_in_cash IN (0, 1)`),
  ],
);
