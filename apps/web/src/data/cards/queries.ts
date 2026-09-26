import type {
  CardBillsResponse,
  CardsSummaryResponse,
} from "@taiwan-fin-hub/core";
import { queryOptions } from "@tanstack/svelte-query";
import type { ApiClient } from "@/shared/api/client";
import { queryKeys } from "@/shared/api/query-keys";

export type {
  CardBill,
  CardBillsResponse,
  CardIssuerSummary,
  CardPaymentStatus,
  CardEstimatedReason,
  CardSummaryCard,
  CardsSummaryResponse,
  CurrentCardBill,
} from "@taiwan-fin-hub/core";

type ApiProvider = () => ApiClient;

/** 依發卡行分組的本期帳單、繳款狀態與未出帳（`GET /api/cards/summary`）。 */
export const cardsSummaryQuery = (getApi: ApiProvider) =>
  queryOptions({
    queryKey: queryKeys.cardsSummary,
    queryFn: () => getApi().get<CardsSummaryResponse>("/api/cards/summary"),
  });

/** 發卡行近 12 期帳單（`GET /api/cards/:issuer/bills`）。 */
export const cardBillsQuery = (getApi: ApiProvider, issuer: string) =>
  queryOptions({
    queryKey: queryKeys.cardBills(issuer),
    queryFn: () =>
      getApi().get<CardBillsResponse>(
        `/api/cards/${encodeURIComponent(issuer)}/bills`,
      ),
  });
