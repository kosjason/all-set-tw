import { queryOptions } from "@tanstack/svelte-query";
import type {
  ActivitySummaryIncompleteReason,
  AdvanceCounterpartySummary,
} from "@taiwan-fin-hub/shared";
import type { ApiClient } from "@/shared/api/client";

/** `GET /api/activity/advances`：依對象彙總的代墊待收回（不分月份）。 */
export interface AdvancesResponse {
  /** 讀取的最早月份；沒有任何代墊時為 null。 */
  since: string | null;
  counterparties: AdvanceCounterpartySummary[];
  /** 依幣別的待收回總額：正數為別人尚欠，負數為別人多給。 */
  outstanding: Record<string, number>;
  complete: boolean;
  incompleteReasons: ActivitySummaryIncompleteReason[];
}

/**
 * key 以 "bank" 開頭：交易、角色或備註變動時隨 queryKeys.bank 一起失效。
 */
export function advancesQuery(getApi: () => ApiClient) {
  return queryOptions({
    queryKey: ["bank", "advances"],
    queryFn: () => getApi().get<AdvancesResponse>("/api/activity/advances"),
  });
}
