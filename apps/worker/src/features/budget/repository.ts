import {
  budgetMerchants,
  budgetSettings,
  createDrizzle,
} from "@taiwan-fin-hub/db";
import {
  DEFAULT_BUDGET_SETTINGS,
  type BudgetMerchantDecision,
  type BudgetMerchantKind,
  type BudgetSettings,
  type SavingsTargetType,
} from "@taiwan-fin-hub/core";
import { eq, sql } from "drizzle-orm";
import { bankTransactions } from "@taiwan-fin-hub/db";

const SETTINGS_ID = "default";

export async function readBudgetSettings(
  db: D1Database,
): Promise<BudgetSettings> {
  const row = await createDrizzle(db)
    .select()
    .from(budgetSettings)
    .where(eq(budgetSettings.id, SETTINGS_ID))
    .get();
  if (!row) return DEFAULT_BUDGET_SETTINGS;
  return {
    expectedIncome: row.expectedIncome,
    savingsTargetType: row.savingsTargetType as SavingsTargetType,
    savingsTargetValue: row.savingsTargetValue,
    annualReserve: row.annualReserve,
  };
}

export async function writeBudgetSettings(
  db: D1Database,
  settings: BudgetSettings,
  now: string,
) {
  const values = {
    expectedIncome: settings.expectedIncome,
    savingsTargetType: settings.savingsTargetType,
    savingsTargetValue: settings.savingsTargetValue,
    annualReserve: settings.annualReserve,
    updatedAt: now,
  };
  await createDrizzle(db)
    .insert(budgetSettings)
    .values({ id: SETTINGS_ID, ...values })
    .onConflictDoUpdate({ target: budgetSettings.id, set: values })
    .run();
}

export async function listBudgetMerchantDecisions(
  db: D1Database,
): Promise<BudgetMerchantDecision[]> {
  const rows = await createDrizzle(db)
    .select()
    .from(budgetMerchants)
    .orderBy(budgetMerchants.displayName)
    .all();
  return rows.map((row) => ({
    merchantKey: row.merchantKey,
    kind: row.kind as BudgetMerchantKind,
    displayName: row.displayName,
    expectedAmount: row.expectedAmount,
  }));
}

export async function upsertBudgetMerchantDecision(
  db: D1Database,
  decision: BudgetMerchantDecision,
  now: string,
) {
  const values = {
    kind: decision.kind,
    displayName: decision.displayName,
    expectedAmount: decision.expectedAmount,
    updatedAt: now,
  };
  await createDrizzle(db)
    .insert(budgetMerchants)
    .values({ merchantKey: decision.merchantKey, createdAt: now, ...values })
    .onConflictDoUpdate({ target: budgetMerchants.merchantKey, set: values })
    .run();
}

export async function deleteBudgetMerchantDecision(
  db: D1Database,
  merchantKey: string,
) {
  const result = await createDrizzle(db)
    .delete(budgetMerchants)
    .where(eq(budgetMerchants.merchantKey, merchantKey))
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/** 最早一筆銀行／信用卡交易的日期（YYYY-MM-DD）；週回顧據此排除資料開始前的週。 */
export async function earliestTransactionDay(
  db: D1Database,
): Promise<string | null> {
  const row = await createDrizzle(db)
    .select({
      day: sql<
        string | null
      >`MIN(substr(COALESCE(${bankTransactions.authorizedAt}, ${bankTransactions.postedDate}), 1, 10))`,
    })
    .from(bankTransactions)
    .get();
  return row?.day ?? null;
}
