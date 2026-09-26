import type { ActivityItem } from "./types";
import { activityDisplayAmount } from "@taiwan-fin-hub/core";
export {
  activityDisplayAmount,
  activityCashFlow,
  type ActivityFlow,
} from "@taiwan-fin-hub/core";
// 分類顏色與切片由本月頁共用，實作在 data 層。
export {
  ACTIVITY_CATEGORY_COLOR_BY_ID,
  ACTIVITY_CATEGORY_DARK_COLOR_BY_ID,
  ACTIVITY_CATEGORY_OVERFLOW_COLOR,
  INVOICE_SPENDING_CATEGORY_ID,
  buildSpendingCategorySlices,
  type ActivityCategoryRef,
  type ActivityCategorySlice,
} from "@/data/activity/categories";

export function activityAmountTwd(
  item: ActivityItem,
  rates: Record<string, number>,
): number | undefined {
  const amount = activityDisplayAmount(item);
  if (amount == null) return undefined;
  if (amount === 0) return 0;
  if (item.currency === "TWD") return amount;
  const rate = rates[item.currency];
  return rate != null && Number.isFinite(rate) && rate > 0
    ? amount * rate
    : undefined;
}
