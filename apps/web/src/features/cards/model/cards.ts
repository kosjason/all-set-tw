import type {
  CardDataSource,
  CardEstimatedReason,
  CardPaymentStatus,
  CardSummaryCard,
  CurrentCardBill,
} from "@taiwan-fin-hub/core";

/** 截止日在幾天內且尚未繳清時醒目提示。 */
export const DUE_SOON_DAYS = 7;

export type DueUrgency = "overdue" | "soon" | "normal" | "settled" | "unknown";

/**
 * 截止日的提示程度：
 * - settled：已繳清。
 * - unknown：沒有截止日或繳款狀態不明。
 * - overdue：已過截止日仍未繳清。
 * - soon：未繳清且 7 天內到期（含今天）。
 * - normal：其餘未繳清。
 */
export function dueUrgency(
  bill: Pick<CurrentCardBill, "paymentStatus" | "daysUntilDue"> | null,
): DueUrgency {
  if (!bill) return "unknown";
  if (bill.paymentStatus === "paid") return "settled";
  if (bill.paymentStatus === "unknown" || bill.daysUntilDue == null)
    return "unknown";
  if (bill.daysUntilDue < 0) return "overdue";
  if (bill.daysUntilDue <= DUE_SOON_DAYS) return "soon";
  return "normal";
}

export function isDueHighlighted(urgency: DueUrgency) {
  return urgency === "soon" || urgency === "overdue";
}

export function countdownLabel(daysUntilDue: number | null) {
  if (daysUntilDue == null) return "截止日未提供";
  if (daysUntilDue === 0) return "今天到期";
  if (daysUntilDue < 0) return `已逾期 ${-daysUntilDue} 天`;
  return `還有 ${daysUntilDue} 天`;
}

export const PAYMENT_STATUS_LABELS: Record<CardPaymentStatus, string> = {
  paid: "已繳",
  partial: "部分繳",
  unpaid: "未繳",
  unknown: "狀態不明",
};

export const ESTIMATED_REASON_LABELS: Record<CardEstimatedReason, string> = {
  manual_import: "資料來自網銀半自動匯入",
  statement_from_transactions: "應繳金額由刷卡明細推估",
  closing_date_unknown: "結帳日不明，未出帳自本月起算",
};

export function sourceModeLabel(source: Pick<CardDataSource, "mode">) {
  return source.mode === "manual_import" ? "半自動匯入" : "自動同步";
}

/**
 * 「查看明細」連到交易頁的信用卡分頁，並依卡片末四碼篩選（`card=`，與交易頁
 * `features/activity/model/url-state.ts` 的格式相同）。沒有末四碼（多卡共用帳戶
 * 無法歸卡的消費）時只開信用卡分頁，列表仍依卡片分組。
 * 交易頁以月份瀏覽，未出帳起日早於本月時，上個月的部分要切換月份查看。
 */
export function cardActivityHash(card: Pick<CardSummaryCard, "last4">) {
  const params = new URLSearchParams({ tab: "card" });
  if (card.last4 && /^\d{4}$/.test(card.last4)) params.set("card", card.last4);
  return `#/transactions?${params.toString()}`;
}

/** 由 `#/cards?issuer=…` 取出發卡行；不是信用卡頁或沒有帶入時回傳空字串。 */
export function cardsHashIssuer(hash: string) {
  const normalized = hash.replace(/^#\/?/, "");
  const queryStart = normalized.indexOf("?");
  const route = queryStart < 0 ? normalized : normalized.slice(0, queryStart);
  if (route !== "cards" || queryStart < 0) return "";
  const issuer = new URLSearchParams(normalized.slice(queryStart + 1)).get(
    "issuer",
  );
  return issuer && /^[a-z][a-z0-9_-]{0,31}$/.test(issuer) ? issuer : "";
}
