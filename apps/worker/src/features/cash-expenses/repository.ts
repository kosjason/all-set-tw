import { and, asc, desc, eq, gte, isNotNull, lt, max, sql } from "drizzle-orm";
import type { CashExpense, FrequentCashExpense } from "@taiwan-fin-hub/shared";
import { cashExpenses, createDrizzle } from "../../db";

const columns = {
  id: cashExpenses.id,
  date: cashExpenses.expenseDate,
  amount: cashExpenses.amount,
  categoryId: cashExpenses.categoryId,
  description: cashExpenses.description,
  createdAt: cashExpenses.createdAt,
  updatedAt: cashExpenses.updatedAt,
};

/** 日期在 [from, to) 的現金支出，依日期與建立時間排序。 */
export async function listCashExpensesInRange(
  db: D1Database,
  range: { from: string; to: string },
): Promise<CashExpense[]> {
  return createDrizzle(db)
    .select(columns)
    .from(cashExpenses)
    .where(
      and(
        gte(cashExpenses.expenseDate, range.from),
        lt(cashExpenses.expenseDate, range.to),
      ),
    )
    .orderBy(asc(cashExpenses.expenseDate), asc(cashExpenses.createdAt))
    .all();
}

export async function findCashExpense(
  db: D1Database,
  id: string,
): Promise<CashExpense | undefined> {
  return createDrizzle(db)
    .select(columns)
    .from(cashExpenses)
    .where(eq(cashExpenses.id, id))
    .get();
}

export async function insertCashExpense(db: D1Database, expense: CashExpense) {
  await createDrizzle(db)
    .insert(cashExpenses)
    .values({
      id: expense.id,
      expenseDate: expense.date,
      amount: expense.amount,
      categoryId: expense.categoryId,
      description: expense.description,
      createdAt: expense.createdAt,
      updatedAt: expense.updatedAt,
    })
    .run();
}

/** 更新現金支出；回傳是否找到這筆。 */
export async function updateCashExpense(db: D1Database, expense: CashExpense) {
  const result = await createDrizzle(db)
    .update(cashExpenses)
    .set({
      expenseDate: expense.date,
      amount: expense.amount,
      categoryId: expense.categoryId,
      description: expense.description,
      updatedAt: expense.updatedAt,
    })
    .where(eq(cashExpenses.id, expense.id))
    .run();
  return result.meta.changes > 0;
}

/** 刪除現金支出；回傳是否找到這筆。 */
export async function deleteCashExpense(db: D1Database, id: string) {
  const result = await createDrizzle(db)
    .delete(cashExpenses)
    .where(eq(cashExpenses.id, id))
    .run();
  return result.meta.changes > 0;
}

/**
 * 日期不早於 since、有說明的現金支出，依說明、金額與分類合併：記過越多次越前面，
 * 同次數時最近記的在前。
 */
export async function listFrequentCashExpenses(
  db: D1Database,
  since: string,
  limit: number,
): Promise<FrequentCashExpense[]> {
  const uses = sql<number>`count(*)`.mapWith(Number);
  const lastDate = max(cashExpenses.expenseDate);
  const lastCreated = max(cashExpenses.createdAt);
  const rows = await createDrizzle(db)
    .select({
      description: cashExpenses.description,
      amount: cashExpenses.amount,
      categoryId: cashExpenses.categoryId,
      uses,
      lastDate,
    })
    .from(cashExpenses)
    .where(
      and(
        isNotNull(cashExpenses.description),
        gte(cashExpenses.expenseDate, since),
      ),
    )
    .groupBy(
      cashExpenses.description,
      cashExpenses.amount,
      cashExpenses.categoryId,
    )
    .orderBy(desc(uses), desc(lastDate), desc(lastCreated))
    .limit(limit)
    .all();
  return rows.map((row) => ({
    description: row.description!,
    amount: row.amount,
    categoryId: row.categoryId,
    uses: row.uses,
    lastDate: row.lastDate!,
  }));
}
