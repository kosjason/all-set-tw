import type { SyncJobRow } from "./types";

export type SyncSourceStatus =
  "unconfigured" | "needs_action" | "healthy" | "not_synced";

type SyncJobStatusInput = Pick<
  SyncJobRow,
  "configured" | "lastStatus" | "lastSuccessAt"
>;

export function getSyncSourceStatus(
  job: SyncJobStatusInput | undefined,
  configured = job?.configured ?? false,
): SyncSourceStatus {
  if (!configured) return "unconfigured";
  if (job?.lastStatus === "failed" || job?.lastStatus === "needs_user_action")
    return "needs_action";
  return job?.lastSuccessAt ? "healthy" : "not_synced";
}

/**
 * 同步成功但部分資料未取得時，後端把說明保留在 lastError；
 * 失敗狀態的 lastError 另由錯誤訊息顯示，這裡只回傳成功時的警告。
 */
export function getSyncWarning(
  job: Pick<SyncJobRow, "lastStatus" | "lastError"> | undefined,
): string | undefined {
  if (job?.lastStatus !== "success") return undefined;
  return job.lastError?.trim() || undefined;
}

export function getSyncSourceStatusLabel(status: SyncSourceStatus) {
  switch (status) {
    case "unconfigured":
      return "未設定";
    case "not_synced":
      return "等待首次同步";
    case "needs_action":
      return "需要處理";
    case "healthy":
      return "正常";
  }
}

export function isActionableSyncJob(
  job: SyncJobStatusInput | undefined,
): boolean {
  return getSyncSourceStatus(job) === "needs_action";
}

export function getConfiguredSyncJobs(jobs: SyncJobRow[]) {
  return jobs.filter((job) => job.configured && job.scope === "all");
}

export function getActionableSyncJobs(jobs: SyncJobRow[]) {
  return getConfiguredSyncJobs(jobs).filter(isActionableSyncJob);
}

export function getHealthySyncJobs(jobs: SyncJobRow[]) {
  return getConfiguredSyncJobs(jobs).filter(
    (job) => getSyncSourceStatus(job) === "healthy",
  );
}

export function getPendingSyncJobs(jobs: SyncJobRow[]) {
  return getConfiguredSyncJobs(jobs).filter(
    (job) => getSyncSourceStatus(job) === "not_synced",
  );
}
