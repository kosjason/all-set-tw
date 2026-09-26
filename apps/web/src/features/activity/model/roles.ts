import {
  TRANSFER_HINT_RULE_ID,
  type EconomicRole,
  type EconomicRoleReason,
} from "@taiwan-fin-hub/core";
import { ECONOMIC_ROLE_LABELS } from "@/data/activity/roles";
import { activitySourceLabel } from "./labels";
import type { ActivityItem } from "./types";

export {
  ECONOMIC_ROLE_CHOICES,
  ECONOMIC_ROLE_CHOICE_LABELS,
  ECONOMIC_ROLE_LABELS,
  ECONOMIC_ROLES_ASKING_REASON,
  activityNoteTarget,
  activityRoleTarget,
  roleOverridePath,
  type ActivityRoleTarget,
} from "@/data/activity/roles";

export type ActivityRoleBadgeTone =
  "income" | "investment" | "transfer" | "muted" | "review";

export interface ActivityRoleBadge {
  key: string;
  label: string;
  tone: ActivityRoleBadgeTone;
}

const ROLE_BADGE_TONE: Record<
  Exclude<EconomicRole, "spending">,
  ActivityRoleBadgeTone
> = {
  income: "income",
  investment: "investment",
  own_transfer: "transfer",
  card_payment: "muted",
  excluded: "muted",
};

export function needsReview(item: ActivityItem) {
  return item.reviewStatus === "needs_review";
}

/**
 * 列上的角色標記。消費是大多數活動的角色，不顯示以免雜訊；重複的活動只標
 * 「重複」（不計入任何金額，角色沒有意義）；待確認另加醒目的標記。
 */
export function activityRoleBadges(
  item: ActivityItem,
  options: { includeRole?: boolean } = {},
): ActivityRoleBadge[] {
  const badges: ActivityRoleBadge[] = [];
  if (item.duplicateOf)
    badges.push({ key: "duplicate", label: "重複", tone: "muted" });
  else if (
    options.includeRole !== false &&
    item.economicRole &&
    item.economicRole !== "spending"
  )
    badges.push({
      key: item.economicRole,
      label: ECONOMIC_ROLE_LABELS[item.economicRole],
      tone: ROLE_BADGE_TONE[item.economicRole],
    });
  if (needsReview(item))
    badges.push({ key: "review", label: "待確認", tone: "review" });
  return badges;
}

/** 角色標記的色調（列上 badge 與分類欄的角色 chip 共用）。 */
export function activityRoleTone(role: EconomicRole): ActivityRoleBadgeTone {
  return role === "spending" ? "muted" : ROLE_BADGE_TONE[role];
}

/**
 * 不是消費（收入、投資、轉到自己帳戶、繳卡費）的活動，分類欄改顯示角色：
 * 這些活動不計入消費分類，顯示「未分類」只會被誤認為待處理。重複的活動不適用。
 */
export function showsRoleInsteadOfCategory(item: ActivityItem) {
  return Boolean(
    item.economicRole && item.economicRole !== "spending" && !item.duplicateOf,
  );
}

/**
 * 不計入收支的活動（列上淡化並加刪除線）：舊的「排除統計計算」設定，或角色為
 * 「不計入」（使用者指定、作廢發票）。
 */
export function isExcludedActivity(item: ActivityItem) {
  return (
    Boolean(item.excludedFromCalculation) || item.economicRole === "excluded"
  );
}

/**
 * 不計入收支的活動的狀態文字：「不計入」角色顯示「不計入」（作廢發票為「發票已作廢」），
 * 轉到自己帳戶與繳卡費顯示角色名稱，其餘為「不計入收支」。
 */
export function excludedStatusLabel(item: ActivityItem) {
  if (item.economicRole === "excluded")
    return item.roleReason === "invoice_voided" ? "發票已作廢" : "不計入";
  return item.economicRole === "own_transfer" ||
    item.economicRole === "card_payment"
    ? ECONOMIC_ROLE_LABELS[item.economicRole]
    : "不計入收支";
}

/** 判定依據的中文說明；沒有角色資料時回傳 undefined。 */
export function activityRoleReasonLabel(
  item: ActivityItem,
): string | undefined {
  const reason: EconomicRoleReason | undefined = item.roleReason;
  if (!reason) return undefined;
  switch (reason) {
    case "override":
      return "你手動指定的角色";
    case "calculation_preference":
      return "依你在這筆交易設定的「是否計入收支」";
    case "own_account":
      return "對方是我的其他帳戶";
    case "unsynced_card":
      return "對方是未同步的信用卡，繳款視為消費";
    case "auto_transfer":
      return "與另一個已同步帳戶的轉帳自動配對";
    case "card_payment":
      return "繳已同步信用卡的卡費，消費已由卡片明細計入";
    case "possible_unsynced_card":
      return "像是繳卡費，但找不到對應的已同步信用卡，可能是未同步的信用卡";
    case "ewallet_topup":
      return "電子支付儲值，視為轉到自己的錢包";
    case "category":
      return `依分類「${item.category}」判斷`;
    case "excluded":
      return "已設定不計入收支，視為移轉";
    case "sign":
      return needsReview(item)
        ? "分類為轉帳，但無法確認對方是不是自己的帳戶"
        : "依金額正負判斷";
    case "invoice":
      return "未配對交易的電子發票，列為消費";
    case "invoice_matched":
      return "已與銀行／信用卡交易配對，金額以交易為準";
    case "invoice_ambiguous":
      return "附近有同金額的交易，無法確定是否為同一筆消費";
    case "invoice_voided":
      return "發票已作廢或註銷，不計入收支";
    case "invoice_repeat":
      return "同一筆消費可能重複開立發票";
    case "invoice_awaiting_card":
      return "發票載具是已同步的信用卡，等待刷卡交易入帳後合併";
    case "merchant_rule":
      return "依你為這個商家設定的規則";
    case "rule":
      return "依分類規則指定的角色";
    case "trade":
      return "投資交易明細，只列示，金流以銀行交割為準";
  }
}

/** 目前角色來自使用者覆寫，可「恢復自動判斷」。 */
export function hasRoleOverride(item: ActivityItem) {
  return item.roleReason === "override";
}

/**
 * 可能是轉到自己帳戶的轉帳：分類為轉帳而待確認，或使用者／設定判為轉到自己帳戶，
 * 且對方尚未登記在「我的其他帳戶」。提示把對方帳號加到設定，之後的轉帳即可自動判斷。
 */
export function suggestsOwnAccount(item: ActivityItem) {
  if (item.source !== "bank" || item.ownAccountTransfer) return false;
  return (
    (needsReview(item) &&
      item.classificationRuleId === TRANSFER_HINT_RULE_ID) ||
    (item.economicRole === "own_transfer" &&
      (item.roleReason === "override" || item.roleReason === "excluded"))
  );
}

/** 重複活動所併入的那筆；不在已載入資料中時回傳 undefined。 */
export function findDuplicateTarget(
  item: ActivityItem,
  items: readonly ActivityItem[],
): ActivityItem | undefined {
  const ref = item.duplicateOf;
  if (!ref) return undefined;
  return items.find((candidate) =>
    ref.kind === "invoice"
      ? candidate.source === "invoice" &&
        (candidate.invoiceId ?? candidate.id) === ref.id
      : candidate.source !== "invoice" &&
        (candidate.transactionId ?? candidate.id) === ref.id,
  );
}

/**
 * 重複活動的簡短說明，例如「已併入信用卡交易」；target 為 findDuplicateTarget
 * 的結果，找不到時依 duplicateOf 的種類說明。
 */
export function duplicateTargetLabel(
  item: ActivityItem,
  target: ActivityItem | undefined,
): string | undefined {
  const ref = item.duplicateOf;
  if (!ref) return undefined;
  if (!target)
    return ref.kind === "invoice"
      ? "已併入另一張發票"
      : "已併入銀行／信用卡交易";
  const source =
    target.source === "card"
      ? "信用卡交易"
      : target.source === "bank"
        ? "銀行交易"
        : "另一張發票";
  return `已併入${source}`;
}

/** 列上帳戶欄：發票只顯示「電子發票」（發票號碼只在明細顯示）。 */
export function activityAccountLines(item: ActivityItem): {
  primary: string;
  secondary?: string;
} {
  if (item.source === "invoice") return { primary: "電子發票" };
  return {
    primary: item.institutionName ?? activitySourceLabel(item),
    secondary: item.accountName || undefined,
  };
}
