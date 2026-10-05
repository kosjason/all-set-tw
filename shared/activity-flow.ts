import type { ActivityItem } from "./activity-types";
export type ActivityFlow = "income" | "expense";
export function activityDisplayAmount(item: ActivityItem) {
  if (item.amount == null) return undefined;
  return item.source === "invoice" ? -Math.abs(item.amount) : item.amount;
}

/**
 * 以新台幣表示的帶正負號金額（發票為負數）：TWD 項目為原金額，外幣項目採
 * `amountTwd`；缺匯率或未提供時回傳 undefined。
 */
export function activitySignedAmountTwd(item: ActivityItem) {
  if (item.currency === "TWD") return activityDisplayAmount(item);
  if (item.amountTwd == null) return undefined;
  return item.source === "invoice" ? -Math.abs(item.amountTwd) : item.amountTwd;
}

export function activityCashFlow(item: ActivityItem): ActivityFlow | null {
  if (
    item.amount == null ||
    (item.source !== "bank" &&
      item.source !== "card" &&
      item.source !== "invoice")
  )
    return null;
  const amount = activityDisplayAmount(item);
  if (amount == null) return null;
  if (amount > 0) return "income";
  if (amount < 0) return "expense";
  return null;
}
