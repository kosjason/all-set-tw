import {
  bankAccounts,
  connectorSettings,
  createDrizzle,
  syncJobs,
} from "@taiwan-fin-hub/db";
import { and, eq, isNull } from "drizzle-orm";

export type InboxSyncJobRow = {
  connectorId: string;
  scope: string;
  enabled: number;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  updatedAt: string;
};

/** 有最近結果的同步工作；錯誤訊息是已整理過、設定頁也會顯示的使用者可讀文字。 */
export async function listSyncJobResults(
  db: D1Database,
): Promise<InboxSyncJobRow[]> {
  return createDrizzle(db)
    .select({
      connectorId: syncJobs.connectorId,
      scope: syncJobs.scope,
      enabled: syncJobs.enabled,
      lastRunAt: syncJobs.lastRunAt,
      lastSuccessAt: syncJobs.lastSuccessAt,
      lastStatus: syncJobs.lastStatus,
      lastError: syncJobs.lastError,
      updatedAt: syncJobs.updatedAt,
    })
    .from(syncJobs)
    .orderBy(syncJobs.connectorId, syncJobs.scope)
    .all();
}

export async function listConfiguredConnectorIds(db: D1Database) {
  const rows = await createDrizzle(db)
    .select({ connectorId: connectorSettings.connectorId })
    .from(connectorSettings)
    .all();
  return new Set(rows.map((row) => row.connectorId));
}

/** 是否已有此來源寫入的有效帳戶（中信可能只靠匯入建立資料）。 */
export async function hasActiveAccounts(db: D1Database, connectorId: string) {
  const row = await createDrizzle(db)
    .select({ id: bankAccounts.id })
    .from(bankAccounts)
    .where(
      and(
        eq(bankAccounts.connectorId, connectorId),
        isNull(bankAccounts.canonicalAccountId),
        isNull(bankAccounts.inactiveAt),
      ),
    )
    .limit(1)
    .get();
  return Boolean(row);
}
