import {
  compareActivityItems,
  type ActivityItem,
  type ActivityMonthSummary,
  type CardsSummaryResponse,
} from "@taiwan-fin-hub/core";
import type { SyncJobRow } from "@/data/connectors/types";

/** 卡費提醒只在截止日前 7 天內（含逾期）且尚未繳清時出現。 */
export const CARD_DUE_REMINDER_DAYS = 7;
/** 本月頁「最近交易」的筆數。 */
export const RECENT_TRANSACTION_LIMIT = 8;

export function monthLabel(month: string) {
  return `${Number(month.slice(5))} 月`;
}

export function monthTitle(month: string) {
  return `${month.slice(0, 4)} 年 ${Number(month.slice(5))} 月`;
}

/** 月份切換：在可選月份（舊到新）中前後移動；超出範圍時回傳 null。 */
export function adjacentMonth(
  months: readonly string[],
  month: string,
  delta: -1 | 1,
): string | null {
  const index = months.indexOf(month);
  if (index < 0) return null;
  return months[index + delta] ?? null;
}

/** 最近 N 筆交易：去掉已併入其他紀錄的重複項目，新到舊。 */
export function recentTransactions(
  items: readonly ActivityItem[],
  limit = RECENT_TRANSACTION_LIMIT,
): ActivityItem[] {
  return items
    .filter((item) => !item.duplicateOf)
    .slice()
    .sort(compareActivityItems)
    .slice(0, limit);
}

/**
 * 銀行連接器固定同步最近 3 個月（含本月）；更早的月份只剩發票或零星卡片資料，
 * 收入與消費都不完整，不能畫成「超支」。
 */
export const BANK_SYNC_WINDOW_MONTHS = 3;

export interface MonthTrendPoint {
  month: string;
  income: number;
  spending: number;
  /** 收入 − 消費；負數為超支。 */
  saved: number;
  /** 早於第一個有活動的月份（或 API 沒回傳），不能當成 0。 */
  noData: boolean;
  incomplete: boolean;
  /** 早於銀行同步範圍：只有部分資料，不顯示長條與金額。 */
  outsideSyncWindow: boolean;
}

function hasActivity(summary: ActivityMonthSummary) {
  return summary.activityCount > 0 || summary.duplicateExcluded > 0;
}

function shiftMonth(month: string, delta: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year!, monthNumber! - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** 近 6 月「收入／消費」趨勢；數字直接取自 summary。 */
export function buildMonthTrend(
  summaries: readonly ActivityMonthSummary[],
  months: readonly string[],
  currentMonth: string = months.at(-1) ?? "",
): MonthTrendPoint[] {
  const firstSyncedMonth = currentMonth
    ? shiftMonth(currentMonth, -(BANK_SYNC_WINDOW_MONTHS - 1))
    : "";
  const byMonth = new Map(summaries.map((summary) => [summary.month, summary]));
  const firstActive = summaries
    .filter(hasActivity)
    .map((summary) => summary.month)
    .sort()[0];
  return months.map((month) => {
    const summary = byMonth.get(month);
    return {
      month,
      income: summary?.income ?? 0,
      spending: summary?.spending ?? 0,
      saved: summary?.saved ?? 0,
      noData: !summary || firstActive == null || month < firstActive,
      incomplete: Boolean(summary && !summary.complete),
      outsideSyncWindow: Boolean(firstSyncedMonth) && month < firstSyncedMonth,
    };
  });
}

/** 長條高度百分比；0 或負數不畫出最小高度的假長條。 */
export function trendBarHeight(value: number, max: number) {
  if (!(value > 0) || !(max > 0)) return 0;
  return Math.max(4, (value / max) * 100);
}

/** 所有已設定來源中最近一次同步成功的時間。 */
export function latestSyncSuccess(jobs: readonly SyncJobRow[]) {
  return jobs.reduce<string | undefined>((latest, job) => {
    if (!job.lastSuccessAt) return latest;
    return !latest || job.lastSuccessAt > latest ? job.lastSuccessAt : latest;
  }, undefined);
}

export interface CardDueReminder {
  issuer: string;
  name: string;
  paymentDueDate: string;
  daysUntilDue: number;
  remainingAmount: number | null;
}

/** 7 天內到期（含逾期）且未繳清的卡費；其他情況回傳 null（不顯示）。 */
export function cardDueReminder(
  summary: Pick<CardsSummaryResponse, "nextDue"> | null | undefined,
): CardDueReminder | null {
  const due = summary?.nextDue;
  if (!due) return null;
  if (due.paymentStatus !== "unpaid" && due.paymentStatus !== "partial")
    return null;
  if (due.daysUntilDue > CARD_DUE_REMINDER_DAYS) return null;
  return {
    issuer: due.issuer,
    name: due.name,
    paymentDueDate: due.paymentDueDate,
    daysUntilDue: due.daysUntilDue,
    remainingAmount: due.remainingAmount,
  };
}

export function cardDueLabel(daysUntilDue: number) {
  if (daysUntilDue < 0) return `已逾期 ${-daysUntilDue} 天`;
  if (daysUntilDue === 0) return "今天截止";
  return `${daysUntilDue} 天後截止`;
}

/**
 * 分類排行點擊後的交易頁 query：只看該分類的消費（與排行金額同一口徑），
 * 非本月時帶上月份。
 */
export function categoryTransactionsQuery(
  categoryId: string,
  month: string,
  currentMonth: string,
) {
  const params = new URLSearchParams();
  if (month !== currentMonth) params.set("month", month);
  params.set("role", "spending");
  params.set("category", categoryId);
  return params.toString();
}

/** 非本月時帶上月份的交易頁 query。 */
export function monthTransactionsQuery(
  month: string,
  currentMonth: string,
  extra: Record<string, string> = {},
) {
  const params = new URLSearchParams();
  if (month !== currentMonth) params.set("month", month);
  for (const [key, value] of Object.entries(extra)) params.set(key, value);
  return params.toString();
}

export interface InboxCounts {
  blocking: number;
  tidy: number;
}

export type PendingBanner =
  | { kind: "inbox"; count: number; blocking: boolean }
  | { kind: "review"; count: number; amount: number }
  | null;

/**
 * 條件式待處理提示條：收件匣有項目時導向待處理（有阻斷項目時以紅色提示）；
 * 收件匣為 0 或無法載入、但這個月有待確認交易時，導向交易頁的待確認篩選；
 * 都沒有就不顯示。
 */
export function pendingBanner(
  inbox: InboxCounts | undefined,
  summary: ActivityMonthSummary | undefined,
): PendingBanner {
  const count = (inbox?.blocking ?? 0) + (inbox?.tidy ?? 0);
  if (count > 0)
    return { kind: "inbox", count, blocking: (inbox?.blocking ?? 0) > 0 };
  const review = summary?.needsReview;
  if (review && review.count > 0)
    return { kind: "review", count: review.count, amount: review.amount };
  return null;
}
