import {
  CATEGORY_DEFINITIONS,
  categoryLabel,
  getCategoryDefinition,
  UNCATEGORIZED_CATEGORY_ID,
} from "@taiwan-fin-hub/core";

/**
 * 消費分類的顏色與排行（summary `spendingByCategory` → 圖表資料）。
 * 本月頁的分類排行與交易頁共用；原本位於 features/activity/model/chart.ts。
 */

export interface ActivityCategorySlice {
  categoryId: string;
  /** 顯示名稱，也是點選後篩選列表的分類名稱。 */
  category: string;
  amount: number;
  percentage: number;
  color: string;
  /** 系統分類的 emoji；自訂或未知分類為空字串。 */
  emoji: string;
}

/**
 * Colors follow the category, never its monthly rank, so a category keeps its
 * color across months. 顏色正本在 `packages/core` 的 `categories.ts`：七個有色消費分類
 * 使用經 CVD 驗證的類別色板，「其他」「未分類」與收入為中性色。
 * 淺色模式有三色對背景低於 3:1，圖例與排行必須保留文字標籤。
 */
export const ACTIVITY_CATEGORY_COLOR_BY_ID: Readonly<Record<string, string>> =
  Object.fromEntries(
    CATEGORY_DEFINITIONS.map((category) => [category.id, category.color.light]),
  );
/** 深色模式的對應色（同一實體、為深色背景調整的色階）。 */
export const ACTIVITY_CATEGORY_DARK_COLOR_BY_ID: Readonly<
  Record<string, string>
> = Object.fromEntries(
  CATEGORY_DEFINITIONS.map((category) => [category.id, category.color.dark]),
);
/** Categories without a fixed color (unknown ids) share a light gray and are listed last. */
export const ACTIVITY_CATEGORY_OVERFLOW_COLOR = "#c3c9cb";

export interface ActivityCategoryRef {
  id: string;
  label: string;
  /** 分類 API 提供；舊版回應沒有時以 core 的系統分類補上。 */
  emoji?: string;
  kind?: string;
  parentId?: string | null;
}

/** 舊版 summary 以來源代表未分類發票的 key；新版發票已有分類 id。 */
export const INVOICE_SPENDING_CATEGORY_ID = "invoice";

function sliceLabel(labels: Map<string, string>, categoryId: string) {
  return (
    labels.get(categoryId) ??
    categoryLabel(categoryId) ??
    (categoryId === INVOICE_SPENDING_CATEGORY_ID ? "發票" : categoryId)
  );
}

function positiveEntries(spendingByCategory: Readonly<Record<string, number>>) {
  return Object.entries(spendingByCategory).filter(([, amount]) => amount > 0);
}

/**
 * 由 summary API 的 `spendingByCategory`（分類 id → 消費淨額）建立圓餅切片。
 * 分類名稱取自分類選項，其次為 `packages/core` 的系統分類；淨額不為正（退款大於
 * 消費）的分類不畫。
 */
export function buildSpendingCategorySlices(
  spendingByCategory: Readonly<Record<string, number>>,
  categories: readonly ActivityCategoryRef[] = [],
): ActivityCategorySlice[] {
  const labels = new Map(categories.map((row) => [row.id, row.label]));
  const entries = positiveEntries(spendingByCategory);
  const total = entries.reduce((sum, [, amount]) => sum + amount, 0);
  const slices = entries.map(([categoryId, amount]) => {
    const fixed = ACTIVITY_CATEGORY_COLOR_BY_ID[categoryId];
    return {
      slice: {
        categoryId,
        category: sliceLabel(labels, categoryId),
        amount,
        percentage: total === 0 ? 0 : (amount / total) * 100,
        color: fixed ?? ACTIVITY_CATEGORY_OVERFLOW_COLOR,
        emoji: getCategoryDefinition(categoryId)?.emoji ?? "",
      },
      // Hued categories first, then neutral ones (人情、其他), then 未分類,
      // then unknown gray ones, so gray slices sit together at the end.
      group: !fixed
        ? 3
        : categoryId === UNCATEGORIZED_CATEGORY_ID
          ? 2
          : getCategoryDefinition(categoryId)?.color.neutral
            ? 1
            : 0,
    };
  });

  return slices
    .sort((a, b) => a.group - b.group || b.slice.amount - a.slice.amount)
    .map(({ slice }) => slice);
}

/**
 * 水平長條排行：與圓餅同一組資料與顏色，但純粹依金額由大到小排列；
 * `barPercent` 以最大的分類為 100%。
 */
export function buildSpendingCategoryRanking(
  spendingByCategory: Readonly<Record<string, number>>,
  categories: readonly ActivityCategoryRef[] = [],
): (ActivityCategorySlice & { barPercent: number })[] {
  const slices = buildSpendingCategorySlices(spendingByCategory, categories)
    .slice()
    .sort((a, b) => b.amount - a.amount);
  const max = slices[0]?.amount ?? 0;
  return slices.map((slice) => ({
    ...slice,
    barPercent: max > 0 ? (slice.amount / max) * 100 : 0,
  }));
}

export interface ActivityCategoryOption {
  id: string;
  label: string;
  /** 自訂分類或舊資料沒有 emoji。 */
  emoji?: string;
}

/** 分類 chip 與選單的文字：「🍜 餐飲」；沒有 emoji 時只有名稱。 */
export function categoryOptionText(option: { label: string; emoji?: string }) {
  return option.emoji ? `${option.emoji} ${option.label}` : option.label;
}

/**
 * 消費分類選單：單層的 8 個系統分類（core 的順序），後面接使用者自訂分類。收入子類與
 * 「未分類」不列出（收入由角色表達；未分類不是可選的答案）。分類 API 的名稱優先，
 * 缺 emoji 時以 core 的系統分類補上；API 還沒回來時直接用 core。
 */
export function spendingCategoryOptions(
  rows: readonly ActivityCategoryRef[] = [],
): ActivityCategoryOption[] {
  const labels = new Map(rows.map((row) => [row.id, row]));
  const system = CATEGORY_DEFINITIONS.filter(
    (category) => category.kind === "spending" && category.parentId === null,
  ).map((category) => ({
    id: category.id,
    label: labels.get(category.id)?.label ?? category.label,
    emoji: labels.get(category.id)?.emoji || category.emoji,
  }));
  const custom = rows
    .filter(
      (row) =>
        row.id.startsWith("user:") &&
        (row.kind === undefined || row.kind === "spending"),
    )
    .map((row) => ({ id: row.id, label: row.label, emoji: row.emoji ?? "" }));
  return [...system, ...custom];
}

/** 活動目前分類的顯示：先找選單，其次 core 系統分類，最後用活動自帶的名稱。 */
export function activityCategoryDisplay(
  categoryId: string | undefined,
  fallbackLabel: string,
  options: readonly ActivityCategoryOption[],
): ActivityCategoryOption {
  // 沒有分類 id 的活動（投資、舊資料）沿用活動自帶的名稱。
  if (!categoryId)
    return { id: UNCATEGORIZED_CATEGORY_ID, label: fallbackLabel, emoji: "" };
  const id = categoryId;
  const option = options.find((candidate) => candidate.id === id);
  if (option) return option;
  const definition = getCategoryDefinition(id);
  return {
    id,
    label: definition?.label ?? fallbackLabel,
    emoji: definition?.emoji ?? "",
  };
}
