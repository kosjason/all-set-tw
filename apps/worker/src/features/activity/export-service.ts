import {
  activityDateKey,
  categoryLabel,
  summarizeActivityMonths,
  UNCATEGORIZED_CATEGORY_ID,
  type ActivityExportItem,
  type ActivityExportResponse,
  type ActivityItem,
} from "@taiwan-fin-hub/core";
import { loadRoleActivities, monthsBetween } from "./summary-service";

/**
 * 帳號、卡號與交易序號只保留末四碼：分段的卡號（4-4-4-x）與 5 碼以上的連續數字
 * 改為「…末四碼」。
 */
export function maskLongDigits(text: string) {
  return text
    .replace(
      /末[一二三四五六七八九十\d]{1,2}碼\s*(\d{5,})/gu,
      (_match, digits: string) => `末四碼 ${digits.slice(-4)}`,
    )
    .replace(/\d{4}(?:[- ]\d{4}){2}[- ]\d{1,4}/gu, (match) => {
      const digits = match.replace(/\D/gu, "");
      return `…${digits.slice(-4)}`;
    })
    .replace(/\d{5,}/gu, (match) => `…${match.slice(-4)}`);
}

function accountLabel(item: ActivityItem) {
  if (item.source === "invoice") return "電子發票";
  const parts = [item.institutionName, item.accountName]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  const label = [...new Set(parts)].join(" ");
  return maskLongDigits(label || (item.source === "card" ? "信用卡" : "銀行"));
}

function round(value: number) {
  return Math.round(value * 100) / 100 || 0;
}

function signedAmountTwd(
  item: ActivityItem,
  rates: Readonly<Record<string, number>>,
) {
  if (item.amount == null) return null;
  const signed =
    item.source === "invoice" ? -Math.abs(item.amount) : item.amount;
  if (item.currency === "TWD" || signed === 0) return round(signed);
  const rate = rates[item.currency];
  return rate != null && Number.isFinite(rate) && rate > 0
    ? round(signed * rate)
    : null;
}

/** 單筆活動 → LLM 用的精簡欄位；不含帳號、卡號、raw 與內部 id。 */
export function toActivityExportItem(
  item: ActivityItem,
  rates: Readonly<Record<string, number>>,
): ActivityExportItem | null {
  if (item.source === "investment") return null;
  const categoryId = item.categoryId ?? UNCATEGORIZED_CATEGORY_ID;
  const exported: ActivityExportItem = {
    date: activityDateKey(item),
    source: item.source,
    amountTwd: signedAmountTwd(item, rates),
    currency: item.currency,
    displayName: maskLongDigits(item.displayName ?? item.title),
    categoryId,
    categoryLabel: categoryLabel(categoryId) ?? item.category,
    categorySource: item.categorySource ?? "none",
    economicRole: item.economicRole ?? null,
    reviewStatus: item.reviewStatus ?? null,
    note: item.note ?? null,
    itemsPreview: item.itemsPreview ?? [],
    account: accountLabel(item),
  };
  if (item.currency !== "TWD" && item.amount != null)
    exported.originalAmount =
      item.source === "invoice" ? -Math.abs(item.amount) : item.amount;
  return exported;
}

/**
 * 給 LLM 分析用的月份活動與每月 summary。已配對發票的重複項目不另列（金額以交易為準，
 * 品項已併入交易的 itemsPreview）；投資交易明細不列（金流以銀行交割為準）。
 */
export async function exportActivity(
  db: D1Database,
  from: string,
  to: string,
  now = new Date(),
): Promise<ActivityExportResponse> {
  const months = monthsBetween(from, to);
  const { items, rates, dataIssues } = await loadRoleActivities(db, months, {
    includeTrades: false,
  });
  return {
    from,
    to,
    currency: "TWD",
    generatedAt: now.toISOString(),
    months: summarizeActivityMonths(items, months, rates, dataIssues),
    items: items
      .filter((item) => !item.duplicateOf)
      .map((item) => toActivityExportItem(item, rates))
      .filter((item): item is ActivityExportItem => item != null)
      .sort(
        (left, right) =>
          left.date.localeCompare(right.date) ||
          left.displayName.localeCompare(right.displayName, "zh-Hant"),
      ),
  };
}
