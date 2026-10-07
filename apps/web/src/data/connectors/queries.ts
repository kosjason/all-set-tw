import { queryOptions } from "@tanstack/svelte-query";
import type { ApiClient } from "@/shared/api/client";
import { queryKeys } from "@/shared/api/query-keys";
import type {
  ConnectorSettings,
  CtbcWebImportStatus,
  SyncJobRow,
  SyncScheduleSettings,
} from "./types";

type ApiProvider = () => ApiClient;

export const syncJobsQuery = (getApi: ApiProvider) =>
  queryOptions({
    queryKey: queryKeys.syncJobs,
    queryFn: () => getApi().get<SyncJobRow[]>("/api/sync-jobs"),
  });

export const syncScheduleQuery = (getApi: ApiProvider) =>
  queryOptions({
    queryKey: queryKeys.syncSchedule,
    queryFn: () => getApi().get<SyncScheduleSettings>("/api/sync-schedule"),
  });

export const connectorSettingsQuery = (
  getApi: ApiProvider,
  connectorId: string,
) =>
  queryOptions({
    queryKey: queryKeys.connectorSettings(connectorId),
    queryFn: () =>
      getApi().get<ConnectorSettings>(
        `/api/connectors/${connectorId}/settings`,
      ),
  });

// 匯入進行中時每 5 秒更新一次，結束後停止輪詢。資料來源頁同時掛著桌面與手機兩個
// 面板，轉換偵測放在 queryFn（同一次 fetch 只會執行一次），避免重複重新讀取。
export const ctbcWebImportQuery = (getApi: ApiProvider) =>
  queryOptions({
    queryKey: queryKeys.ctbcWebImport,
    queryFn: async ({ client, queryKey }) => {
      const previous = client.getQueryData<CtbcWebImportStatus>(queryKey);
      const next = await getApi().get<CtbcWebImportStatus>(
        "/api/connectors/ctbc/web-import",
      );
      const wasRunning = previous?.available === true && previous.running;
      const isRunning = next.available === true && next.running;
      if (wasRunning && !isRunning) {
        // 匯入結束：結果已由匯入工具寫入，重新讀取同步狀態與帳務資料。
        for (const key of [
          queryKeys.syncJobs,
          queryKeys.latestSyncReport,
          queryKeys.summary,
          queryKeys.bank,
          queryKeys.bills,
          queryKeys.exchangeRates,
          queryKeys.netWorthHistory,
        ])
          void client.invalidateQueries({ queryKey: key });
      }
      return next;
    },
    refetchInterval: (query) =>
      query.state.data?.available && query.state.data.running ? 5_000 : false,
  });
