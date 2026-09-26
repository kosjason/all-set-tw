import type { ActivityMonthSummary } from "@taiwan-fin-hub/core";

/** 本月頁的發票去重摘要（summary `dedupe`）。 */
export interface MonthDedupeCounts {
  /** 已併入刷卡或銀行交易、不另計金額的發票張數。 */
  merged: number;
  /** 沒有對應交易、單獨計為消費的發票張數。 */
  unmatched: number;
  /** 信用卡載具、等待刷卡交易入帳的發票張數。 */
  awaitingCard: number;
  /** 候選不唯一、需要確認的發票張數。 */
  ambiguous: number;
}

/**
 * summary 的發票去重計數；舊版 API 沒有 `dedupe`，或這個月沒有任何發票時
 * 回傳 null（不顯示）。
 */
export function monthDedupeCounts(
  summary: ActivityMonthSummary | undefined,
): MonthDedupeCounts | null {
  const dedupe = summary?.dedupe;
  if (!dedupe) return null;
  const counts = {
    merged: dedupe.invoicesMerged ?? 0,
    unmatched: dedupe.invoicesUnmatched ?? 0,
    awaitingCard: dedupe.invoicesAwaitingCard ?? 0,
    ambiguous: dedupe.invoicesAmbiguous ?? 0,
  };
  return Object.values(counts).some((value) => value > 0) ? counts : null;
}
