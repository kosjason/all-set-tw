import {
  bankAccounts,
  bankBalanceSnapshots,
  bankTransactions,
  createDrizzle,
  creditCardBills,
  syncJobs,
} from "@taiwan-fin-hub/db";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

export type CreditAccountRow = {
  id: string;
  connectorId: string;
  sourceId: string;
  institutionName: string | null;
  accountName: string | null;
  bankCode: string | null;
  accountLast4: string | null;
  currency: string;
  /** raw_payload 中的卡片清單（中信 `cards`、台新 `cardLast4s`）；只取需要的欄位，不讀整份 payload。 */
  rawCards: string | null;
  rawCardLast4s: string | null;
};

/** 仍在使用中的主要信用卡帳戶。 */
export async function listCreditAccounts(
  db: D1Database,
): Promise<CreditAccountRow[]> {
  return createDrizzle(db)
    .select({
      id: bankAccounts.id,
      connectorId: bankAccounts.connectorId,
      sourceId: bankAccounts.sourceId,
      institutionName: bankAccounts.institutionName,
      accountName: bankAccounts.accountName,
      bankCode: bankAccounts.bankCode,
      accountLast4: bankAccounts.accountLast4,
      currency: bankAccounts.currency,
      rawCards: sql<
        string | null
      >`CASE WHEN json_valid(${bankAccounts.rawPayload}) THEN json_extract(${bankAccounts.rawPayload}, '$.cards') END`,
      rawCardLast4s: sql<
        string | null
      >`CASE WHEN json_valid(${bankAccounts.rawPayload}) THEN json_extract(${bankAccounts.rawPayload}, '$.cardLast4s') END`,
    })
    .from(bankAccounts)
    .where(
      and(
        eq(bankAccounts.accountType, "credit"),
        isNull(bankAccounts.canonicalAccountId),
        isNull(bankAccounts.inactiveAt),
      ),
    )
    .orderBy(bankAccounts.connectorId, bankAccounts.sourceId)
    .all();
}

export type CardBillRow = {
  id: string;
  connectorId: string;
  accountId: string;
  billingPeriod: string;
  statementAmount: number | null;
  minimumPayment: number | null;
  paidAmount: number | null;
  isPaid: number | null;
  paymentDueDate: string | null;
  statementClosingDate: string | null;
  currency: string;
  updatedAt: string;
};

/** 指定信用卡帳戶的帳單，新到舊。 */
export async function listBillsForAccounts(
  db: D1Database,
  accountIds: string[],
): Promise<CardBillRow[]> {
  if (accountIds.length === 0) return [];
  return createDrizzle(db)
    .select({
      id: creditCardBills.id,
      connectorId: creditCardBills.connectorId,
      accountId: creditCardBills.accountId,
      billingPeriod: creditCardBills.billingPeriod,
      statementAmount: creditCardBills.statementAmount,
      minimumPayment: creditCardBills.minimumPayment,
      paidAmount: creditCardBills.paidAmount,
      isPaid: creditCardBills.isPaid,
      paymentDueDate: creditCardBills.paymentDueDate,
      statementClosingDate: creditCardBills.statementClosingDate,
      currency: creditCardBills.currency,
      updatedAt: creditCardBills.updatedAt,
    })
    .from(creditCardBills)
    .where(inArray(creditCardBills.accountId, accountIds))
    .orderBy(
      desc(creditCardBills.billingPeriod),
      creditCardBills.accountId,
      creditCardBills.id,
    )
    .all();
}

export type CardSnapshotRow = {
  accountId: string;
  statementBalance: number | null;
  paymentDueDate: string | null;
  statementClosingDate: string | null;
  noPaymentNeeded: number | null;
  asOfAt: string;
};

/** 每個信用卡帳戶最新一筆餘額快照（帳單資料的備援與更新時間）。 */
export async function listLatestCardSnapshots(
  db: D1Database,
  accountIds: string[],
): Promise<CardSnapshotRow[]> {
  if (accountIds.length === 0) return [];
  return createDrizzle(db)
    .select({
      accountId: bankBalanceSnapshots.accountId,
      statementBalance: bankBalanceSnapshots.statementBalance,
      paymentDueDate: bankBalanceSnapshots.paymentDueDate,
      statementClosingDate: bankBalanceSnapshots.statementClosingDate,
      noPaymentNeeded: bankBalanceSnapshots.noPaymentNeeded,
      asOfAt: bankBalanceSnapshots.asOfAt,
    })
    .from(bankBalanceSnapshots)
    .where(
      and(
        inArray(bankBalanceSnapshots.accountId, accountIds),
        eq(
          bankBalanceSnapshots.id,
          sql`(
            SELECT latest.id FROM bank_balance_snapshots latest
            WHERE latest.account_id = ${bankBalanceSnapshots.accountId}
            ORDER BY latest.as_of_at DESC, latest.updated_at DESC
            LIMIT 1
          )`,
        ),
      ),
    )
    .all();
}

export type ConnectorSyncStatusRow = {
  connectorId: string;
  scope: string;
  enabled: number;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  updatedAt: string;
};

export async function listConnectorSyncStatuses(
  db: D1Database,
  connectorIds?: string[],
): Promise<ConnectorSyncStatusRow[]> {
  if (connectorIds && connectorIds.length === 0) return [];
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
    .where(
      connectorIds ? inArray(syncJobs.connectorId, connectorIds) : undefined,
    )
    .orderBy(syncJobs.connectorId, syncJobs.scope)
    .all();
}

/**
 * 交易 raw_payload 中的卡片末四碼（台新、中信多卡共用一個帳戶時用來分卡）。
 * 只取該欄位，不讀整份 payload。
 */
export async function listTransactionCardLast4(
  db: D1Database,
  transactionIds: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  // D1 單一 statement 的綁定參數有上限，分批查詢。
  for (let index = 0; index < transactionIds.length; index += 90) {
    const chunk = transactionIds.slice(index, index + 90);
    const rows = await createDrizzle(db)
      .select({
        id: bankTransactions.id,
        cardLast4: sql<
          string | null
        >`CASE WHEN json_valid(${bankTransactions.rawPayload}) THEN json_extract(${bankTransactions.rawPayload}, '$.cardLast4') END`,
      })
      .from(bankTransactions)
      .where(inArray(bankTransactions.id, chunk))
      .all();
    for (const row of rows) {
      const last4 = String(row.cardLast4 ?? "").match(/^\d{4}$/)?.[0];
      if (last4) result.set(row.id, last4);
    }
  }
  return result;
}
