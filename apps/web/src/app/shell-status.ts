import type { CardsSummaryResponse } from "@taiwan-fin-hub/shared";
import { connectorCatalog } from "@taiwan-fin-hub/shared";
import type { SyncJobRow } from "@/data/connectors/types";

export type SourceHealth =
  "ok" | "running" | "attention" | "unscheduled" | "never";

export interface SourceStatus {
  connectorId: SyncJobRow["connectorId"];
  name: string;
  health: SourceHealth;
  lastSuccessAt: string | null;
}

export interface SyncOverview {
  sources: SourceStatus[];
  /** 所有來源中最近一次成功同步的時間。 */
  lastSuccessAt: string | null;
  attention: number;
  unscheduled: number;
  running: boolean;
}

const HEALTH_ORDER: Record<SourceHealth, number> = {
  attention: 0,
  never: 1,
  unscheduled: 2,
  running: 3,
  ok: 4,
};

function latest(a: string | null, b: string | null) {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

/**
 * 依連接器彙總同步工作（一個連接器可能有多個 scope），只計已設定的工作。優先序：
 * 執行中 > 上次失敗或需使用者處理 > 排程全部關閉（unscheduled，只能手動同步或匯入）>
 * 從未成功 > 正常。
 */
export function summarizeSyncJobs(jobs: SyncJobRow[]): SyncOverview {
  const byConnector = new Map<SyncJobRow["connectorId"], SyncJobRow[]>();
  for (const job of jobs) {
    if (!job.configured) continue;
    const list = byConnector.get(job.connectorId) ?? [];
    list.push(job);
    byConnector.set(job.connectorId, list);
  }
  const sources = [...byConnector].map(([connectorId, list]): SourceStatus => {
    const lastSuccessAt = list.reduce<string | null>(
      (value, job) => latest(value, job.lastSuccessAt),
      null,
    );
    const scheduled = list.some((job) => job.enabled);
    const health: SourceHealth = list.some((job) => job.running)
      ? "running"
      : list.some(
            (job) =>
              job.lastStatus === "failed" ||
              job.lastStatus === "needs_user_action",
          )
        ? "attention"
        : !scheduled
          ? "unscheduled"
          : lastSuccessAt
            ? "ok"
            : "never";
    return {
      connectorId,
      name: connectorCatalog[connectorId]?.title ?? connectorId,
      health,
      lastSuccessAt,
    };
  });
  sources.sort(
    (a, b) =>
      HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health] ||
      a.name.localeCompare(b.name, "zh-TW"),
  );
  return {
    sources,
    lastSuccessAt: sources.reduce<string | null>(
      (value, source) => latest(value, source.lastSuccessAt),
      null,
    ),
    attention: sources.filter((source) => source.health === "attention").length,
    unscheduled: sources.filter((source) => source.health === "unscheduled")
      .length,
    running: jobs.some((job) => job.configured && job.running),
  };
}

export interface UpcomingCardDue {
  issuer: string;
  name: string;
  paymentDueDate: string;
  daysUntilDue: number;
  remainingAmount: number | null;
}

/**
 * 尚未繳清且截止日已知的本期帳單，依截止日由近到遠。繳款狀態不明時只在仍有未繳金額時列出。
 */
export function upcomingCardDues(
  summary: CardsSummaryResponse | undefined,
): UpcomingCardDue[] {
  return (summary?.issuers ?? [])
    .flatMap((issuer): UpcomingCardDue[] => {
      const bill = issuer.currentBill;
      if (!bill?.paymentDueDate || bill.daysUntilDue == null) return [];
      const owing =
        bill.paymentStatus === "unpaid" || bill.paymentStatus === "partial"
          ? bill.remainingAmount !== 0
          : bill.paymentStatus === "unknown" && (bill.remainingAmount ?? 0) > 0;
      if (!owing) return [];
      return [
        {
          issuer: issuer.issuer,
          name: issuer.name,
          paymentDueDate: bill.paymentDueDate,
          daysUntilDue: bill.daysUntilDue,
          remainingAmount: bill.remainingAmount,
        },
      ];
    })
    .sort((a, b) => a.daysUntilDue - b.daysUntilDue);
}
