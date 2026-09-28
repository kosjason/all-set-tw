import { sql } from "drizzle-orm";
import { check, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

// SQL migrations remain authoritative for schema shape and constraints.

export const budgetSettings = sqliteTable(
  "budget_settings",
  {
    id: text("id").primaryKey(),
    monthlyBudget: real("monthly_budget"),
    expectedIncome: real("expected_income"),
    annualReserve: real("annual_reserve").notNull().default(0),
    updatedAt: text("updated_at").notNull(),
  },
  () => [
    check("budget_settings_check_1", sql`id = 'default'`),
    check(
      "budget_settings_check_2",
      sql`monthly_budget IS NULL OR monthly_budget >= 0`,
    ),
    check(
      "budget_settings_check_3",
      sql`expected_income IS NULL OR expected_income >= 0`,
    ),
    check("budget_settings_check_4", sql`annual_reserve >= 0`),
  ],
);

export const budgetMerchants = sqliteTable(
  "budget_merchants",
  {
    merchantKey: text("merchant_key").primaryKey(),
    kind: text("kind").notNull(),
    displayName: text("display_name").notNull(),
    expectedAmount: real("expected_amount"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  () => [
    check(
      "budget_merchants_check_1",
      sql`length(merchant_key) BETWEEN 1 AND 200`,
    ),
    check(
      "budget_merchants_check_2",
      sql`kind IN ('monthly', 'annual', 'not_fixed')`,
    ),
    check(
      "budget_merchants_check_3",
      sql`length(display_name) BETWEEN 1 AND 200`,
    ),
    check(
      "budget_merchants_check_4",
      sql`expected_amount IS NULL OR expected_amount >= 0`,
    ),
  ],
);
