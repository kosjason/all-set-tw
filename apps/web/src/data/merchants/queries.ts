import { queryOptions } from "@tanstack/svelte-query";
import type { ApiClient } from "@/shared/api/client";
import type { MerchantSummaryRow } from "./types";

type ApiProvider = () => ApiClient;

/**
 * 商家清單（近 N 個月活動彙總與別名）。key 以 "bank" 開頭，
 * 交易、分類或商家規則變動時隨 queryKeys.bank 一起失效。
 */
export const merchantsQuery = (getApi: ApiProvider, query = "", months = 3) =>
  queryOptions({
    queryKey: ["bank", "merchants", query, months] as const,
    queryFn: () => {
      const params = new URLSearchParams({ months: String(months) });
      if (query.trim()) params.set("query", query.trim());
      return getApi().get<MerchantSummaryRow[]>(`/api/merchants?${params}`);
    },
  });

/** 商家 key 含 `:` 與中文，組 URL 時必須編碼。 */
export function merchantPath(merchantKey: string) {
  return `/api/merchants/${encodeURIComponent(merchantKey)}`;
}
