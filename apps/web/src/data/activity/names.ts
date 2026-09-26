import type { ActivityItem } from "@taiwan-fin-hub/core";

/**
 * 列表主標：商家顯示名稱（使用者別名或清理後的名稱），沒有時用原始標題。
 * 原始字串在明細的「來源名稱」顯示。交易頁與本月頁共用。
 */
export function activityDisplayName(
  item: Pick<ActivityItem, "title" | "displayName">,
) {
  return item.displayName?.trim() || item.title;
}

/**
 * 發票與已配對發票的交易的品項摘要，例如「拿鐵、可頌」（最多 3 個）；
 * 沒有品項或不是發票相關的活動回傳空字串。
 */
export function activityItemsSummary(
  item: Pick<ActivityItem, "source" | "invoiceId" | "itemsPreview">,
  limit = 3,
) {
  if (item.source !== "invoice" && !item.invoiceId) return "";
  return (item.itemsPreview ?? [])
    .map((name) => name.trim())
    .filter(Boolean)
    .slice(0, limit)
    .join("、");
}
