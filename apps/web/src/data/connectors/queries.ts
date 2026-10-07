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

// 匯入進行中時每 5 秒更新一次，結束後停止輪詢。
export const ctbcWebImportQuery = (getApi: ApiProvider) =>
  queryOptions({
    queryKey: queryKeys.ctbcWebImport,
    queryFn: () =>
      getApi().get<CtbcWebImportStatus>("/api/connectors/ctbc/web-import"),
    refetchInterval: (query) =>
      query.state.data?.available && query.state.data.running ? 5_000 : false,
  });
