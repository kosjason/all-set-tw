import type { BudgetSummary, WeeklyReview } from "@taiwan-fin-hub/core";
import { queryOptions } from "@tanstack/svelte-query";
import type { ApiClient } from "@/shared/api/client";
import { queryKeys } from "@/shared/api/query-keys";

export type {
  BudgetCandidate,
  BudgetFixedMerchant,
  BudgetMerchantKind,
  BudgetSettings,
  BudgetSummary,
  SavingsTargetType,
  WeeklyReview,
} from "@taiwan-fin-hub/core";

type ApiProvider = () => ApiClient;

/** 本月可花、固定支出與候選（`GET /api/budget`）。 */
export const budgetQuery = (getApi: ApiProvider) =>
  queryOptions({
    queryKey: queryKeys.budget,
    queryFn: () => getApi().get<BudgetSummary>("/api/budget"),
  });

/** 一週的消費回顧；weekStart 為週一（`GET /api/budget/week?start=`）。 */
export const weeklyReviewQuery = (getApi: ApiProvider, weekStart: string) =>
  queryOptions({
    queryKey: queryKeys.weeklyReview(weekStart),
    queryFn: () =>
      getApi().get<WeeklyReview>(
        `/api/budget/week?start=${encodeURIComponent(weekStart)}`,
      ),
  });
