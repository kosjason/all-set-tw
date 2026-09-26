import type { ActivityRef } from "@taiwan-fin-hub/core";
import {
  activityRoleTarget,
  type ActivityRoleTarget,
} from "@/data/activity/roles";
import type { CategorizeRequest } from "@/data/merchants/types";
import type { ActivityItem } from "./types";

/**
 * 改分類要寫到哪一筆（`POST /api/activity/categorize` 支援交易與發票）：
 * - 銀行／信用卡交易（含已配對發票的交易）：交易本身。
 * - 未配對的發票（現金、電支付款的發票永遠配不到交易）：發票本身。
 * - 已併入交易的發票（重複項目）：寫到它併入的那筆交易。發票重複項目沿用交易的最終
 *   分類、交易的個別覆寫優先，因此兩邊永遠一致，不會出現交易與發票分類不同。
 * 投資交易明細不支援，回傳 null。
 */
export function categorizeTarget(
  item: ActivityItem,
): ActivityRoleTarget | null {
  const own = activityRoleTarget(item);
  if (!own) return null;
  const ref: ActivityRef | null | undefined = item.duplicateOf;
  return ref ? { targetKind: ref.kind, targetId: ref.id } : own;
}

/** 可以改分類的活動（見 {@link categorizeTarget}）。 */
export function canCategorize(item: ActivityItem) {
  return categorizeTarget(item) != null;
}

/** 改一筆的 categorize body；applyToMerchant 時一併記住商家（寫入商家規則）。 */
export function categorizeRequest(
  item: ActivityItem,
  categoryId: string,
  applyToMerchant = false,
): CategorizeRequest {
  const target = categorizeTarget(item);
  if (!target) throw new Error("此活動不支援調整分類。");
  return {
    targets: [
      {
        kind: target.targetKind,
        id: target.targetId,
        ...(item.merchantKey ? { merchantKey: item.merchantKey } : {}),
      },
    ],
    categoryId,
    applyToMerchant,
  };
}

/**
 * 同一商家的其他活動中，套用商家規則後會一起改變的筆數：目前載入的月份內
 * 同 merchantKey（發票為 `ban:<統編>`）、不是重複項目、沒有被使用者個別覆寫
 * （`categorySource = user`）的活動。
 */
export function merchantSiblingCount(
  items: readonly ActivityItem[],
  item: ActivityItem,
) {
  if (!item.merchantKey) return 0;
  const self = categorizeTarget(item);
  return items.filter((candidate) => {
    if (candidate.merchantKey !== item.merchantKey) return false;
    if (candidate.duplicateOf || candidate.categorySource === "user")
      return false;
    const target = categorizeTarget(candidate);
    return !(
      target &&
      self &&
      target.targetKind === self.targetKind &&
      target.targetId === self.targetId
    );
  }).length;
}

/** 改完分類後詢問是否套用到同商家並記住的文字。 */
export function merchantPromptText(
  item: ActivityItem,
  categoryLabel: string,
  count: number,
) {
  const name = item.displayName?.trim() || item.title;
  return count > 0
    ? `將『${name}』的其他 ${count} 筆也設為「${categoryLabel}」，並記住這個商家？`
    : `記住『${name}』，之後的交易也設為「${categoryLabel}」？`;
}
