import { activityCashFlow } from "@taiwan-fin-hub/core";
import type { ActivityCategoryFilter } from "./filter";
import {
  ECONOMIC_ROLE_LABELS,
  needsReview,
  showsRoleInsteadOfCategory,
} from "./roles";
import type { ActivityItem } from "./types";
import type {
  ActivityRoleFilter,
  ActivityViewState,
  TransactionTab,
} from "./url-state";

/** 「未分類」分類 id。 */
export const UNCATEGORIZED_CATEGORY_ID = "other";

/**
 * 需要補分類的活動：可重新分類的銀行／信用卡消費。角色不是消費（收入、投資、
 * 轉到自己帳戶、繳卡費）或已判為重複的活動不列入，分類欄也改顯示角色。
 */
export function isUncategorizedActivity(item: ActivityItem) {
  return (
    Boolean(item.transactionId) &&
    !showsRoleInsteadOfCategory(item) &&
    !item.duplicateOf &&
    (item.categoryId ?? UNCATEGORIZED_CATEGORY_ID) === UNCATEGORIZED_CATEGORY_ID
  );
}

/** 「只看未分類」在共用篩選之後套用，不改變收支加總的語義。 */
export function filterUncategorized(items: ActivityItem[], enabled: boolean) {
  return enabled ? items.filter(isUncategorizedActivity) : items;
}

/** 「只看待確認」在共用篩選之後套用。 */
export function filterNeedsReview(items: ActivityItem[], enabled: boolean) {
  return enabled ? items.filter(needsReview) : items;
}

/**
 * 分類切片（舊版分類圖表的網址 `slice=`）：列表只列該角色、未被判為重複的
 * 活動，與 summary 金額一致。沒有角色資料的活動（舊資料）沿用依正負判斷的
 * 收支方向。
 */
export function filterCategorySlice(
  items: ActivityItem[],
  slice: ActivityCategoryFilter | null,
) {
  if (!slice) return items;
  const role = slice.flow === "expense" ? "spending" : "income";
  return items.filter(
    (item) =>
      item.category === slice.category &&
      !item.duplicateOf &&
      (item.economicRole
        ? item.economicRole === role
        : activityCashFlow(item) === slice.flow),
  );
}

/**
 * 角色篩選。沒有角色資料的活動（舊資料）依正負推回消費／收入；
 * 其他角色無法由正負判斷，不列入。
 */
export function filterRole(items: ActivityItem[], role: ActivityRoleFilter) {
  if (role === "all") return items;
  return items.filter((item) => {
    if (item.economicRole) return item.economicRole === role;
    const flow = activityCashFlow(item);
    return (
      (role === "spending" && flow === "expense") ||
      (role === "income" && flow === "income")
    );
  });
}

/**
 * 分頁過濾：
 * - 總帳：去重後的列表，已併入另一筆紀錄的重複項目（例如已對應刷卡的發票）不列出，
 *   避免同一筆消費出現兩次；它們仍可在「發票」分頁看到。
 * - 銀行／信用卡／發票：只列該來源的原始紀錄（含重複項目）。
 */
export function filterTab(items: ActivityItem[], tab: TransactionTab) {
  if (tab === "ledger") return items.filter((item) => !item.duplicateOf);
  return items.filter((item) => item.source === tab);
}

/**
 * 依信用卡末四碼篩選信用卡紀錄。`cardLast4` 由交易 id 查出（多卡共用帳戶以交易
 * 的卡片末四碼、單卡帳戶以帳戶末四碼）；查不到末四碼的紀錄不列入。
 */
export function filterCard(
  items: ActivityItem[],
  card: string,
  cardLast4: (item: ActivityItem) => string | undefined,
) {
  if (!card) return items;
  return items.filter(
    (item) => item.source === "card" && cardLast4(item) === card,
  );
}

export const TRANSACTION_TAB_LABELS: Record<TransactionTab, string> = {
  ledger: "總帳",
  bank: "銀行",
  card: "信用卡",
  invoice: "發票",
};

export const ACTIVITY_ROLE_FILTER_LABELS: Record<ActivityRoleFilter, string> = {
  all: "全部角色",
  ...ECONOMIC_ROLE_LABELS,
};

/** 角色篩選選單的順序。 */
export const ACTIVITY_ROLE_FILTERS: readonly ActivityRoleFilter[] = [
  "all",
  "spending",
  "income",
  "investment",
  "own_transfer",
  "card_payment",
  "excluded",
];

export const ACTIVITY_SEARCH_TIME_LABELS = {
  all: "全部時間",
  year: "今年",
  "12months": "最近 12 個月",
  custom: "自訂日期",
} as const;

/** 分類選單額外提供的非交易分類（沿用搜尋篩選的既有選項）。 */
export const ACTIVITY_EXTRA_CATEGORY_OPTIONS = [
  { id: "invoice", label: "發票" },
  { id: "investment", label: "投資活動" },
];

export type ActivityFilterChipKey =
  | "text"
  | "role"
  | "category"
  | "slice"
  | "uncategorized"
  | "review"
  | "card"
  | "time";

export interface ActivityFilterChip {
  key: ActivityFilterChipKey;
  label: string;
}

/**
 * 已套用、可一鍵清除的篩選。`text` 是月報模式的即時搜尋字；搜尋模式的
 * 關鍵字由搜尋框清除，不列為 chip。分頁不算篩選。
 */
export function activityFilterChips(
  state: ActivityViewState,
  options: {
    searching: boolean;
    text: string;
    categoryLabel: (id: string) => string | undefined;
  },
): ActivityFilterChip[] {
  const chips: ActivityFilterChip[] = [];
  const text = options.text.trim();
  if (!options.searching && text)
    chips.push({ key: "text", label: `搜尋：${text}` });
  if (options.searching && state.time !== "all")
    chips.push({
      key: "time",
      label:
        state.time === "custom"
          ? `${state.from || "不限起日"} ～ ${state.to || "不限迄日"}`
          : ACTIVITY_SEARCH_TIME_LABELS[state.time],
    });
  if (state.slice)
    chips.push({
      key: "slice",
      label: `${state.slice.flow === "expense" ? "消費" : "收入"} · ${state.slice.category}`,
    });
  else if (state.role !== "all")
    chips.push({ key: "role", label: ACTIVITY_ROLE_FILTER_LABELS[state.role] });
  if (state.categoryId)
    chips.push({
      key: "category",
      label: `分類：${options.categoryLabel(state.categoryId) ?? state.categoryId}`,
    });
  if (state.card)
    chips.push({ key: "card", label: `卡片末四碼 ${state.card}` });
  if (state.uncategorized)
    chips.push({ key: "uncategorized", label: "未分類" });
  if (state.review) chips.push({ key: "review", label: "待確認" });
  return chips;
}

/** 清除單一 chip 對應的欄位（`text` 由頁面自行處理）。 */
export function clearActivityFilter(
  state: ActivityViewState,
  key: ActivityFilterChipKey,
): ActivityViewState {
  switch (key) {
    case "role":
      return { ...state, role: "all" };
    case "slice":
      return { ...state, slice: null, role: "all" };
    case "category":
      return { ...state, categoryId: "" };
    case "card":
      return { ...state, card: "" };
    case "uncategorized":
      return { ...state, uncategorized: false };
    case "review":
      return { ...state, review: false };
    case "time":
      return { ...state, time: "all", from: "", to: "" };
    case "text":
      return state;
  }
}

/** 清除全部篩選；月份、分頁、排序與搜尋字保留。 */
export function clearActivityFilters(
  state: ActivityViewState,
): ActivityViewState {
  return {
    ...state,
    role: "all",
    slice: null,
    categoryId: "",
    card: "",
    uncategorized: false,
    review: false,
    time: "all",
    from: "",
    to: "",
  };
}
