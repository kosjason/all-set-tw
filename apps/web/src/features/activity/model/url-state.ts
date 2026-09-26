import { ECONOMIC_ROLES, type EconomicRole } from "@taiwan-fin-hub/core";
import type { ActivityCategoryFilter } from "./filter";
import {
  DEFAULT_ACTIVITY_SORT,
  isActivitySortMode,
  type ActivitySortMode,
} from "./sort";

export type ActivitySearchTime = "all" | "year" | "12months" | "custom";

/**
 * 交易頁分頁：總帳（去重後，所有數字只從這裡算）與三個來源的原始紀錄。
 * 來源分頁只列該來源的紀錄，不顯示消費合計。
 */
export type TransactionTab = "ledger" | "bank" | "card" | "invoice";

/** 角色篩選：全部，或經濟角色之一（消費、收入、投資、轉到自己帳戶、繳卡費）。 */
export type ActivityRoleFilter = "all" | EconomicRole;

/** `activity=<source>:<id>`：由收件匣、信用卡頁連到的單筆活動（開啟明細）。 */
export interface ActivityTarget {
  source: "bank" | "card" | "invoice" | "investment";
  id: string;
}

/**
 * 交易頁可分享、可重新整理還原的檢視狀態，存放於 hash query
 * （例如 `#/transactions?month=2026-09&tab=card&role=spending`）。
 * 預設值不寫入網址，未篩選時網址維持 `#/transactions`。
 */
export interface ActivityViewState {
  /** YYYY-MM；空字串代表預設（本月）。 */
  month: string;
  /** 已送出的全歷史搜尋字串；空字串代表月報模式。 */
  query: string;
  tab: TransactionTab;
  role: ActivityRoleFilter;
  /** 分類 id（含 `invoice`、`investment`）；空字串代表全部分類。 */
  categoryId: string;
  /** 由舊版分類圖表點選的分類（依標籤與收支方向）；只由網址還原。 */
  slice: ActivityCategoryFilter | null;
  uncategorized: boolean;
  /** 只看待確認（`reviewStatus = needs_review`）的活動。 */
  review: boolean;
  /** 信用卡末四碼（信用卡頁「查看明細」）。 */
  card: string;
  /** 要直接開啟明細的活動；開啟後由頁面清除。 */
  activity: ActivityTarget | null;
  sort: ActivitySortMode;
  /** 搜尋模式的時間範圍。 */
  time: ActivitySearchTime;
  from: string;
  to: string;
}

export const ACTIVITY_ROUTE = "transactions";
export const ACTIVITY_ROUTE_HASH = `#/${ACTIVITY_ROUTE}`;

export const TRANSACTION_TABS: readonly TransactionTab[] = [
  "ledger",
  "bank",
  "card",
  "invoice",
];
const ROLE_FILTERS: readonly ActivityRoleFilter[] = ["all", ...ECONOMIC_ROLES];
const TIMES: readonly ActivitySearchTime[] = [
  "all",
  "year",
  "12months",
  "custom",
];
const ACTIVITY_SOURCES: readonly ActivityTarget["source"][] = [
  "bank",
  "card",
  "invoice",
  "investment",
];
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CARD_PATTERN = /^\d{4}$/;

export function defaultActivityViewState(): ActivityViewState {
  return {
    month: "",
    query: "",
    tab: "ledger",
    role: "all",
    categoryId: "",
    slice: null,
    uncategorized: false,
    review: false,
    card: "",
    activity: null,
    sort: DEFAULT_ACTIVITY_SORT,
    time: "all",
    from: "",
    to: "",
  };
}

function oneOf<T extends string>(
  value: string | null,
  options: readonly T[],
  fallback: T,
): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

function parseSlice(value: string | null): ActivityCategoryFilter | null {
  if (!value) return null;
  const separator = value.indexOf(":");
  if (separator < 0) return null;
  const flow = value.slice(0, separator);
  const category = value.slice(separator + 1).trim();
  if ((flow !== "income" && flow !== "expense") || !category) return null;
  return { flow, category };
}

function parseActivityTarget(value: string | null): ActivityTarget | null {
  if (!value) return null;
  const separator = value.indexOf(":");
  if (separator < 0) return null;
  const source = value.slice(0, separator);
  const id = value.slice(separator + 1).trim();
  if (!ACTIVITY_SOURCES.includes(source as ActivityTarget["source"]) || !id)
    return null;
  return { source: source as ActivityTarget["source"], id: id.slice(0, 200) };
}

/** 舊網址的 `flow=`（收入／支出）對應到角色篩選。 */
function legacyFlowRole(value: string | null): ActivityRoleFilter {
  if (value === "income") return "income";
  if (value === "expense") return "spending";
  return "all";
}

/**
 * 解析 `#/transactions?…`。不是交易頁路由時回傳 null；未知或不合法的值一律
 * 回到預設，避免手改網址造成錯誤畫面。舊參數 `source=`（改為分頁）與
 * `flow=`（改為角色）仍可讀取。
 */
export function parseActivityHash(hash: string): ActivityViewState | null {
  const normalized = hash.replace(/^#\/?/, "");
  const queryStart = normalized.indexOf("?");
  const route = queryStart < 0 ? normalized : normalized.slice(0, queryStart);
  if (route !== ACTIVITY_ROUTE) return null;
  const params = new URLSearchParams(
    queryStart < 0 ? "" : normalized.slice(queryStart + 1),
  );
  const state = defaultActivityViewState();
  const month = params.get("month") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const sort = params.get("sort");
  const slice = parseSlice(params.get("slice"));
  const legacySource = params.get("source");
  const card = (params.get("card") ?? "").trim();
  const tab = oneOf(
    params.get("tab") ??
      (legacySource === "bank" ||
      legacySource === "card" ||
      legacySource === "invoice"
        ? legacySource
        : null),
    TRANSACTION_TABS,
    CARD_PATTERN.test(card) ? "card" : "ledger",
  );
  return {
    ...state,
    month: MONTH_PATTERN.test(month) ? month : "",
    query: (params.get("q") ?? "").trim().slice(0, 200),
    tab,
    role: slice
      ? slice.flow === "expense"
        ? "spending"
        : "income"
      : params.has("role")
        ? oneOf(params.get("role"), ROLE_FILTERS, "all")
        : legacyFlowRole(params.get("flow")),
    categoryId: (params.get("category") ?? "").trim(),
    slice,
    uncategorized: params.get("uncategorized") === "1",
    review: params.get("review") === "1",
    card: CARD_PATTERN.test(card) ? card : "",
    activity: parseActivityTarget(params.get("activity")),
    sort: isActivitySortMode(sort) ? sort : DEFAULT_ACTIVITY_SORT,
    time: oneOf(params.get("time"), TIMES, "all"),
    from: DATE_PATTERN.test(from) ? from : "",
    to: DATE_PATTERN.test(to) ? to : "",
  };
}

/**
 * 產生交易頁 hash；與預設相同的欄位（含等於 `defaultMonth` 的月份）省略。
 * 搜尋模式才寫入時間範圍；自訂日期只在 `time=custom` 時寫入。
 */
export function activityHash(
  state: ActivityViewState,
  defaultMonth = "",
): string {
  const params = new URLSearchParams();
  if (state.month && state.month !== defaultMonth)
    params.set("month", state.month);
  const query = state.query.trim();
  if (query) params.set("q", query);
  if (state.tab !== "ledger") params.set("tab", state.tab);
  if (state.slice)
    params.set("slice", `${state.slice.flow}:${state.slice.category}`);
  else if (state.role !== "all") params.set("role", state.role);
  if (state.categoryId) params.set("category", state.categoryId);
  if (state.uncategorized) params.set("uncategorized", "1");
  if (state.review) params.set("review", "1");
  if (state.card) params.set("card", state.card);
  if (state.activity)
    params.set("activity", `${state.activity.source}:${state.activity.id}`);
  if (state.sort !== DEFAULT_ACTIVITY_SORT) params.set("sort", state.sort);
  if (query && state.time !== "all") {
    params.set("time", state.time);
    if (state.time === "custom") {
      if (state.from) params.set("from", state.from);
      if (state.to) params.set("to", state.to);
    }
  }
  const search = params.toString();
  return search ? `${ACTIVITY_ROUTE_HASH}?${search}` : ACTIVITY_ROUTE_HASH;
}
