import { budgetMerchants, budgetSettings, createDrizzle } from "../../db";
import {
  DEFAULT_BUDGET_SETTINGS,
  type BudgetMerchantDecision,
  type BudgetMerchantKind,
  type BudgetSettings,
} from "@taiwan-fin-hub/shared";
import { eq } from "drizzle-orm";

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
    monthlyBudget: row.monthlyBudget,
    expectedIncome: row.expectedIncome,
    annualReserve: row.annualReserve,
  };
}

export async function writeBudgetSettings(
  db: D1Database,
  settings: BudgetSettings,
  now: string,
) {
  const values = {
    monthlyBudget: settings.monthlyBudget,
    expectedIncome: settings.expectedIncome,
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

/**
 * 最早一筆銀行／信用卡交易的台北日期（YYYY-MM-DD）；週回顧據此排除資料開始前的週。
 * 算式與 idx_bank_transactions_transaction_day 完全相同（時間戳加 8 小時換成台北日期），
 * 讓 MIN 走索引、不掃整張表。
 */
export async function earliestTransactionDay(
  db: D1Database,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT MIN(
        CASE
          WHEN length(authorized_at) > 10
            THEN COALESCE(
              date(authorized_at, '+8 hours'),
              substr(authorized_at, 1, 10)
            )
          ELSE substr(COALESCE(authorized_at, posted_date), 1, 10)
        END
      ) AS day FROM bank_transactions`,
    )
    .first<{ day: string | null }>();
  return row?.day ?? null;
}
