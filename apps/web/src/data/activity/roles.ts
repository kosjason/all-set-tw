import type {
  ActivityItem,
  EconomicRole,
  EconomicRoleTargetKind,
} from "@taiwan-fin-hub/core";

/** 經濟角色的中文名稱（交易頁、收件匣共用）。 */
export const ECONOMIC_ROLE_LABELS: Readonly<Record<EconomicRole, string>> = {
  spending: "消費",
  income: "收入",
  own_transfer: "轉到自己帳戶",
  investment: "投資",
  card_payment: "繳卡費",
  excluded: "不計入",
};

/** 使用者可選的角色（列上快速選擇與明細「這筆是…」共用順序）；「不計入」放最後。 */
export const ECONOMIC_ROLE_CHOICES: readonly EconomicRole[] = [
  "spending",
  "income",
  "own_transfer",
  "investment",
  "card_payment",
  "excluded",
];

/** 選單上的角色文字：「不計入」補上說明，其餘同 {@link ECONOMIC_ROLE_LABELS}。 */
export const ECONOMIC_ROLE_CHOICE_LABELS: Readonly<
  Record<EconomicRole, string>
> = {
  ...ECONOMIC_ROLE_LABELS,
  excluded: "不計入（未實際付款、已作廢）",
};

/**
 * 會改變收支金額、選擇時先問原因的角色：轉到自己帳戶、不計入（不算消費）與收入。
 * 原因選填，會和 override 一起存成備註。
 */
export const ECONOMIC_ROLES_ASKING_REASON: ReadonlySet<EconomicRole> = new Set([
  "own_transfer",
  "excluded",
  "income",
]);

export interface ActivityRoleTarget {
  targetKind: EconomicRoleTargetKind;
  targetId: string;
}

/** 可覆寫角色的對象；投資交易明細等不支援覆寫時回傳 null。 */
export function activityRoleTarget(
  item: Pick<ActivityItem, "source" | "id" | "transactionId" | "invoiceId">,
): ActivityRoleTarget | null {
  if (item.source === "bank" || item.source === "card")
    return {
      targetKind: "bank_transaction",
      targetId: item.transactionId ?? item.id,
    };
  if (item.source === "invoice")
    return { targetKind: "invoice", targetId: item.invoiceId ?? item.id };
  return null;
}

/**
 * 備註要寫到哪一筆：已配對的交易與發票共用備註，備註已存在另一方時（`noteTarget`）
 * 編輯那一筆，避免同一筆消費出現兩份備註；還沒有備註時寫到活動自身。
 * 不支援備註的活動（投資交易明細）回傳 null。
 */
export function activityNoteTarget(
  item: Pick<
    ActivityItem,
    "source" | "id" | "transactionId" | "invoiceId" | "noteTarget"
  >,
): ActivityRoleTarget | null {
  const own = activityRoleTarget(item);
  if (!own) return null;
  if (item.noteTarget)
    return { targetKind: item.noteTarget.kind, targetId: item.noteTarget.id };
  return own;
}

/** `PUT`／`DELETE /api/activity/role-overrides/:targetKind/:targetId`。 */
export function roleOverridePath(target: ActivityRoleTarget) {
  return `/api/activity/role-overrides/${target.targetKind}/${encodeURIComponent(target.targetId)}`;
}
