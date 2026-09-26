import type {
  ActivityExportResponse,
  ActivityItem,
  ActivityMonthSummary,
  ActivityNoteRow,
  ActivitySourceRecord,
  ActivitySummaryIncompleteReason,
  EconomicRoleOverride,
  InvoiceDedupeCounts,
} from "@taiwan-fin-hub/core";
import { infiniteQueryOptions, queryOptions } from "@tanstack/svelte-query";
import type { ApiClient } from "@/shared/api/client";
import type { BankData } from "@/data/bank/types";
import type { InvoiceSummaryRow } from "@/data/invoices/types";
import type { InvestmentTransactionRow } from "@/data/investments/types";

export interface ActivitySearchPage {
  items: ActivityItem[];
  bank: BankData;
  invoices: InvoiceSummaryRow[];
  trades: InvestmentTransactionRow[];
  nextCursor: string | null;
}

export function activitySearchQuery(
  getApi: () => ApiClient,
  q: string,
  from = "",
  to = "",
  source = "all",
  flow = "all",
  category = "",
) {
  return infiniteQueryOptions({
    queryKey: ["bank", "activity-search", q, from, to, source, flow, category],
    enabled: Boolean(q.trim()) && (!from || !to || from <= to),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ q, source, flow });
      if (category) params.set("category", category);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (pageParam) params.set("cursor", pageParam);
      return getApi().get<ActivitySearchPage>(`/api/activity/search?${params}`);
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export interface ActivitySummaryResponse {
  months: ActivityMonthSummary[];
}

export interface ActivityMonthResponse {
  month: string;
  items: ActivityItem[];
  summary: ActivityMonthSummary;
}

/**
 * 依經濟角色計算的月收支；range 為單月（YYYY-MM）或起訖月份（含，最多 12 個月）。
 * key 以 "bank" 開頭，交易、分類或計算設定變動時隨 queryKeys.bank 一起失效。
 */
export function activitySummaryQuery(
  getApi: () => ApiClient,
  range: { month: string } | { from: string; to: string },
) {
  const params = new URLSearchParams(range);
  return queryOptions({
    queryKey: ["bank", "activity-summary", params.toString()],
    queryFn: () =>
      getApi().get<ActivitySummaryResponse>(`/api/activity/summary?${params}`),
  });
}

/** 單月活動（含推導角色；已配對的發票以 duplicateOf 列出）與該月 summary。 */
export function activityMonthQuery(getApi: () => ApiClient, month: string) {
  return queryOptions({
    queryKey: ["bank", "activity-month", month],
    queryFn: () =>
      getApi().get<ActivityMonthResponse>(
        `/api/activity/items?${new URLSearchParams({ month })}`,
      ),
  });
}

export type ActivitySourceView = "bank" | "card" | "invoice";

/**
 * 交易頁「銀行／信用卡／發票」分頁：單月單一來源的紀錄與配對狀態。
 * 發票帶 matchStatus／matchedTransactionId／matchScore 與載具資訊，
 * 刷卡／銀行交易帶 matchedInvoiceId。「總帳」分頁使用 activityMonthQuery。
 */
export interface ActivitySourcesResponse {
  month: string;
  source: ActivitySourceView;
  records: ActivitySourceRecord[];
  sourceCounts: Record<ActivitySourceView, number>;
  dedupe: InvoiceDedupeCounts;
  complete: boolean;
  incompleteReasons: ActivitySummaryIncompleteReason[];
}

export function activitySourcesQuery(
  getApi: () => ApiClient,
  month: string,
  source: ActivitySourceView,
) {
  return queryOptions({
    queryKey: ["bank", "activity-sources", month, source],
    queryFn: () =>
      getApi().get<ActivitySourcesResponse>(
        `/api/activity/sources?${new URLSearchParams({ month, source })}`,
      ),
  });
}

export type {
  ActivityExportItem,
  ActivityExportResponse,
  ActivityNote,
  ActivityNoteRow,
  ActivityNoteWriteResult,
  CategorySource,
} from "@taiwan-fin-hub/core";

/**
 * 活動備註（`GET /api/activity/notes?month=`）；未指定月份時列出全部。
 * 活動列表的每筆項目已帶 note／noteTarget，這個 query 供備註總覽使用。
 */
export function activityNotesQuery(getApi: () => ApiClient, month?: string) {
  const query = month ? `?${new URLSearchParams({ month })}` : "";
  return queryOptions({
    queryKey: ["bank", "activity-notes", month ?? "all"],
    queryFn: () =>
      getApi().get<ActivityNoteRow[]>(`/api/activity/notes${query}`),
  });
}

/**
 * 給 LLM 分析用的精簡匯出（`GET /api/activity/export?from=&to=`，最多 12 個月）。
 * 不含帳號、卡號（只有末四碼）與 raw。
 */
export function activityExportQuery(
  getApi: () => ApiClient,
  range: { from: string; to: string },
) {
  const params = new URLSearchParams(range);
  return queryOptions({
    queryKey: ["bank", "activity-export", params.toString()],
    queryFn: () =>
      getApi().get<ActivityExportResponse>(`/api/activity/export?${params}`),
  });
}

export function activityRoleOverridesQuery(getApi: () => ApiClient) {
  return queryOptions({
    queryKey: ["bank", "activity-role-overrides"],
    queryFn: () =>
      getApi().get<EconomicRoleOverride[]>("/api/activity/role-overrides"),
  });
}
