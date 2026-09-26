import { activityAmountTwd } from "./chart";
import {
  activityDateKey,
  compareActivityItems,
  groupActivitiesByDate,
} from "./list";
import type { ActivityItem } from "./types";

export type ActivitySortMode =
  "date-desc" | "date-asc" | "amount-desc" | "amount-asc";

export const ACTIVITY_SORT_OPTIONS: { id: ActivitySortMode; label: string }[] =
  [
    { id: "date-desc", label: "日期（新→舊）" },
    { id: "date-asc", label: "日期（舊→新）" },
    { id: "amount-desc", label: "金額（大→小）" },
    { id: "amount-asc", label: "金額（小→大）" },
  ];

export const DEFAULT_ACTIVITY_SORT: ActivitySortMode = "date-desc";

export function activitySortLabel(mode: ActivitySortMode) {
  return (
    ACTIVITY_SORT_OPTIONS.find((option) => option.id === mode)?.label ??
    ACTIVITY_SORT_OPTIONS[0]!.label
  );
}

/**
 * A rendered section of the activity list. Date sorts produce one section per
 * day (with a header); amount sorts produce a single flat section without a
 * date header, so each row must show its own date.
 */
export interface ActivityListSection {
  key: string;
  dateKey: string | null;
  items: ActivityItem[];
}

export interface ActivityListView {
  grouped: boolean;
  sections: ActivityListSection[];
}

/**
 * Magnitude used by amount sorts: the absolute TWD value, so a NT$5,000
 * expense and a NT$5,000 income rank the same. Returns undefined when the
 * amount is missing or a foreign currency has no exchange rate.
 */
export function activitySortMagnitude(
  item: ActivityItem,
  rates: Record<string, number>,
) {
  const amount = activityAmountTwd(item, rates);
  return amount == null || !Number.isFinite(amount)
    ? undefined
    : Math.abs(amount);
}

function compareDateAsc(left: ActivityItem, right: ActivityItem) {
  // Items without a date stay last in both directions.
  const leftMissing = !activityDateKey(left);
  const rightMissing = !activityDateKey(right);
  if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;
  return -compareActivityItems(left, right);
}

export function sortActivities(
  items: ActivityItem[],
  mode: ActivitySortMode,
  rates: Record<string, number>,
): ActivityItem[] {
  if (mode === "date-desc") return [...items].sort(compareActivityItems);
  if (mode === "date-asc") return [...items].sort(compareDateAsc);

  const direction = mode === "amount-desc" ? -1 : 1;
  const magnitudes = new Map(
    items.map((item) => [item, activitySortMagnitude(item, rates)]),
  );
  return [...items].sort((left, right) => {
    const leftAmount = magnitudes.get(left);
    const rightAmount = magnitudes.get(right);
    if (leftAmount == null || rightAmount == null) {
      if (leftAmount != null) return -1;
      if (rightAmount != null) return 1;
    } else if (leftAmount !== rightAmount) {
      return (leftAmount - rightAmount) * direction;
    }
    // Ties (and unknown amounts) fall back to date desc, then source + id.
    return compareActivityItems(left, right);
  });
}

export function isActivitySortMode(value: unknown): value is ActivitySortMode {
  return ACTIVITY_SORT_OPTIONS.some((option) => option.id === value);
}

/** 可從表頭切換排序的欄位。 */
export type ActivitySortColumn = "date" | "amount";

/** 目前排序作用在哪一欄。 */
export function activitySortColumn(mode: ActivitySortMode): ActivitySortColumn {
  return mode.startsWith("amount") ? "amount" : "date";
}

/**
 * 表頭 `aria-sort` 值：只有目前排序的欄位回傳方向，其他欄位回傳 undefined
 * （不輸出屬性，避免多個欄位同時宣告排序）。
 */
export function activitySortDirection(
  mode: ActivitySortMode,
  column: ActivitySortColumn,
): "ascending" | "descending" | undefined {
  if (activitySortColumn(mode) !== column) return undefined;
  return mode.endsWith("asc") ? "ascending" : "descending";
}

/**
 * 點擊表頭：同一欄時反轉方向；換欄時從「新→舊」或「大→小」開始。
 * 與工具列排序選單共用同一個排序值。
 */
export function toggleActivitySort(
  mode: ActivitySortMode,
  column: ActivitySortColumn,
): ActivitySortMode {
  if (activitySortColumn(mode) !== column) return `${column}-desc`;
  return mode.endsWith("desc") ? `${column}-asc` : `${column}-desc`;
}

export function buildActivityListView(
  items: ActivityItem[],
  mode: ActivitySortMode,
  rates: Record<string, number>,
): ActivityListView {
  const sorted = sortActivities(items, mode, rates);
  if (mode === "date-desc" || mode === "date-asc")
    return {
      grouped: true,
      sections: groupActivitiesByDate(sorted).map((group) => ({
        key: group.dateKey,
        dateKey: group.dateKey,
        items: group.items,
      })),
    };
  return {
    grouped: false,
    sections: sorted.length
      ? [{ key: mode, dateKey: null, items: sorted }]
      : [],
  };
}
