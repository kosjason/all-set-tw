import { queryOptions } from "@tanstack/svelte-query";
import type { FrequentCashExpense } from "@taiwan-fin-hub/shared";
import type { ApiClient } from "@/shared/api/client";

/**
 * 記帳對話框的「常用」（`GET /api/cash-expenses/frequent`）。key 以 "bank" 開頭，
 * 新增、編輯或刪除現金支出後隨 queryKeys.bank 一起失效。
 */
export const frequentCashExpensesQuery = (getApi: () => ApiClient) =>
  queryOptions({
    queryKey: ["bank", "cash-expenses", "frequent"] as const,
    queryFn: () =>
      getApi().get<{ items: FrequentCashExpense[] }>(
        "/api/cash-expenses/frequent",
      ),
    staleTime: 60_000,
  });
