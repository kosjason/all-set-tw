import {
  CASH_EXPENSE_AMOUNT_MAX,
  CASH_EXPENSE_DESCRIPTION_MAX,
  FREQUENT_CASH_EXPENSE_DAYS,
  FREQUENT_CASH_EXPENSE_LIMIT,
  isIncomeCategoryId,
  isUncategorizedCategoryId,
  SPENDING_TOP_LEVEL_CATEGORY_IDS,
  taipeiDay,
  type CashExpense,
} from "@taiwan-fin-hub/shared";
import { listExistingCategoryIds } from "../classification/repository";
import {
  deleteCashExpense,
  findCashExpense,
  insertCashExpense,
  listFrequentCashExpenses,
  updateCashExpense,
} from "./repository";

export class CashExpenseNotFoundError extends Error {}
export class CashExpenseCategoryError extends Error {}
export class CashExpenseInvalidError extends Error {}

export interface CashExpenseInput {
  date: string;
  amount: number;
  categoryId: string;
  description?: string | null;
}

/** 說明：NFKC、去頭尾空白、合併連續空白；空字串視為沒有說明。 */
export function normalizeCashExpenseDescription(value?: string | null) {
  const normalized = (value ?? "").normalize("NFKC").replace(/\s+/gu, " ");
  const trimmed = normalized.trim();
  return trimmed || null;
}

function isRealDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

/**
 * 檢查並正規化輸入：日期為實際存在、不晚於台北今天的日期；金額為 1–1,000 萬的整數；
 * 分類為消費分類（系統頂層消費分類或使用者自訂分類，不含收入與未分類）。
 */
async function normalizeInput(
  db: D1Database,
  input: CashExpenseInput,
  today: string,
) {
  if (!isRealDate(input.date) || input.date < "2000-01-01")
    throw new CashExpenseInvalidError("日期格式不正確。");
  if (input.date > today)
    throw new CashExpenseInvalidError("日期不能晚於今天。");
  if (
    !Number.isInteger(input.amount) ||
    input.amount < 1 ||
    input.amount > CASH_EXPENSE_AMOUNT_MAX
  )
    throw new CashExpenseInvalidError("金額必須是 1 到 1,000 萬之間的整數。");
  const description = normalizeCashExpenseDescription(input.description);
  if (description && [...description].length > CASH_EXPENSE_DESCRIPTION_MAX)
    throw new CashExpenseInvalidError(
      `說明不能超過 ${CASH_EXPENSE_DESCRIPTION_MAX} 字。`,
    );
  const categoryId = input.categoryId;
  const spending =
    SPENDING_TOP_LEVEL_CATEGORY_IDS.includes(categoryId) ||
    (categoryId.startsWith("user:") &&
      !isIncomeCategoryId(categoryId) &&
      !isUncategorizedCategoryId(categoryId));
  if (!spending) throw new CashExpenseCategoryError();
  const existing = await listExistingCategoryIds(db, [categoryId]);
  if (!existing.has(categoryId)) throw new CashExpenseCategoryError();
  return { date: input.date, amount: input.amount, categoryId, description };
}

export async function addCashExpense(
  db: D1Database,
  input: CashExpenseInput,
  now = new Date(),
): Promise<CashExpense> {
  const values = await normalizeInput(db, input, taipeiDay(now));
  const timestamp = now.toISOString();
  const expense: CashExpense = {
    id: crypto.randomUUID(),
    ...values,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await insertCashExpense(db, expense);
  return expense;
}

export async function editCashExpense(
  db: D1Database,
  id: string,
  input: CashExpenseInput,
  now = new Date(),
): Promise<CashExpense> {
  const current = await findCashExpense(db, id);
  if (!current) throw new CashExpenseNotFoundError();
  const values = await normalizeInput(db, input, taipeiDay(now));
  const expense: CashExpense = {
    ...current,
    ...values,
    updatedAt: now.toISOString(),
  };
  if (!(await updateCashExpense(db, expense)))
    throw new CashExpenseNotFoundError();
  return expense;
}

export async function removeCashExpense(db: D1Database, id: string) {
  if (!(await deleteCashExpense(db, id))) throw new CashExpenseNotFoundError();
}

/** 記帳對話框的「常用」：最近 {@link FREQUENT_CASH_EXPENSE_DAYS} 天（台北日期）記過的現金支出。 */
export async function getFrequentCashExpenses(
  db: D1Database,
  now = new Date(),
) {
  // 含今天共 90 個台北日期。
  const since = new Date(`${taipeiDay(now)}T00:00:00.000Z`);
  since.setUTCDate(since.getUTCDate() - (FREQUENT_CASH_EXPENSE_DAYS - 1));
  return {
    items: await listFrequentCashExpenses(
      db,
      since.toISOString().slice(0, 10),
      FREQUENT_CASH_EXPENSE_LIMIT,
    ),
  };
}
