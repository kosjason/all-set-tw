import type { ApiClient } from "@/shared/api/client";

/**
 * 期初持股成本的 mutation options（交給 `createMutation`）。成功後請讓
 * `queryKeys.investmentPerformance` 失效。key 為持股的「券商代號:帳號:代號」。
 */
export function setOpeningCostMutation(getApi: () => ApiClient) {
  return {
    mutationKey: ["investment-opening-cost", "set"] as const,
    mutationFn: ({ key, cost }: { key: string; cost: number }) =>
      getApi().put<{ success: true }>(
        `/api/investments/opening-costs/${encodeURIComponent(key)}`,
        { cost },
      ),
  };
}

export function clearOpeningCostMutation(getApi: () => ApiClient) {
  return {
    mutationKey: ["investment-opening-cost", "clear"] as const,
    mutationFn: (key: string) =>
      getApi().delete<{ success: true }>(
        `/api/investments/opening-costs/${encodeURIComponent(key)}`,
      ),
  };
}
