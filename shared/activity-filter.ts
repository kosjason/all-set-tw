import { activityCashFlow, type ActivityFlow } from "./activity-flow";
import { activityDateKey } from "./activity-list";
import type { ActivityItem } from "./activity-types";
import { topLevelCategoryId } from "./categories";
import { matchesActivitySearch, parseActivitySearch } from "./activity-search";

export type ActivityFlowFilter = "all" | ActivityFlow;
export type ActivitySourceFilter = "all" | "bank" | "card" | "invoice";

export interface ActivityCategoryFilter {
  flow: ActivityFlow;
  category: string;
}

export interface ActivityListFilters {
  month: string;
  flow: ActivityFlowFilter;
  source: ActivitySourceFilter;
  search: string;
  category: ActivityCategoryFilter | null;
  from?: string;
  to?: string;
  categoryId?: string;
}

export function filterActivities(
  items: ActivityItem[],
  filters: ActivityListFilters,
) {
  const normalizedSearch = filters.search.trim().toLowerCase();
  const parsedSearch = normalizedSearch
    ? parseActivitySearch(filters.search)
    : undefined;

  return items.filter((item) => {
    const itemFlow = activityCashFlow(item);
    const matchesFlow = filters.flow === "all" || itemFlow === filters.flow;
    const matchesSource =
      filters.source === "all" ||
      item.source === filters.source ||
      (filters.source === "invoice" && Boolean(item.invoiceId));
    // 文字比對標題、商家名稱、品項與帳戶；也支援金額語法（125、>1000、100-200）。
    const matchesSearch =
      !parsedSearch || matchesActivitySearch(item, parsedSearch);
    const matchesCategory =
      !filters.category ||
      (item.category === filters.category.category &&
        itemFlow === filters.category.flow);

    return (
      activityDateKey(item).startsWith(filters.month) &&
      (!filters.from || activityDateKey(item) >= filters.from) &&
      (!filters.to || activityDateKey(item) <= filters.to) &&
      (!filters.categoryId ||
        matchesCategoryFilter(item, filters.categoryId)) &&
      matchesFlow &&
      matchesSource &&
      matchesSearch &&
      matchesCategory
    );
  });
}

/** 分類篩選：子類相同，或篩選值為頂層且活動分類屬於該頂層。 */
function matchesCategoryFilter(item: ActivityItem, categoryId: string) {
  const itemCategoryId = item.categoryId ?? item.source;
  if (itemCategoryId === categoryId) return true;
  return (
    item.categoryId != null &&
    !categoryId.includes(".") &&
    topLevelCategoryId(item.categoryId) === categoryId
  );
}
