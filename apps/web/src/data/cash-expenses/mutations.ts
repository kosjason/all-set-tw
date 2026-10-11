import type { CashExpense } from "@taiwan-fin-hub/shared";
import type { ApiClient } from "@/shared/api/client";

/** 新增或編輯現金支出的內容（金額為新台幣整數）。 */
export interface CashExpenseInput {
  date: string;
  amount: number;
  categoryId: string;
  description: string | null;
}

/**
 * 現金支出的 mutation options（交給 `createMutation`）。成功後請讓 `queryKeys.bank`
 * 失效：現金支出列在活動、月 summary、預算與收件匣中，並影響提款的未細分金額。
 */
export function createCashExpenseMutation(getApi: () => ApiClient) {
  return {
    mutationKey: ["cash-expense", "create"] as const,
    mutationFn: (input: CashExpenseInput) =>
      getApi().post<CashExpense>("/api/cash-expenses", input),
  };
}

export function updateCashExpenseMutation(getApi: () => ApiClient) {
  return {
    mutationKey: ["cash-expense", "update"] as const,
    mutationFn: ({ id, ...input }: CashExpenseInput & { id: string }) =>
      getApi().put<CashExpense>(
        `/api/cash-expenses/${encodeURIComponent(id)}`,
        input,
      ),
  };
}

export function deleteCashExpenseMutation(getApi: () => ApiClient) {
  return {
    mutationKey: ["cash-expense", "delete"] as const,
    mutationFn: (id: string) =>
      getApi().delete<{ success: true }>(
        `/api/cash-expenses/${encodeURIComponent(id)}`,
      ),
  };
}
