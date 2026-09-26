import type { SyncNewRecordCounts, SyncResult } from "@taiwan-fin-hub/core";
import { refreshBankDepositHistory } from "../net-worth/service";
import { prepareCtbcAuthorizationWrite } from "./ctbc-authorizations";
import { persistStagedSyncWrite, type SyncWriteRecord } from "./persistence";
import {
  bankAccountRecord,
  bankBalanceSnapshotRecord,
  bankTransactionRecord,
  creditCardBillRecord,
} from "./record-mapper";
import { linkCanonicalBankAccountsStatement } from "./repository";

const CONNECTOR_ID = "ctbc";

export type CtbcSyncData = Pick<
  SyncResult<never>,
  | "bankAccounts"
  | "bankBalanceSnapshots"
  | "bankTransactions"
  | "creditCardBills"
>;

export type CtbcSyncWriteResult = {
  records: number;
  newRecords: SyncNewRecordCounts;
};

/**
 * 中信自動同步與網銀半自動匯入共用的寫入路徑：轉成 write records、配對既有授權、
 * staging promote、連結 canonical 帳戶並重建存款歷史。`finalizeStatements` 由呼叫端
 * 決定（自動同步會一併更新 cursor 與加密設定；匯入不改帳密與 cursor）。
 */
export async function writeCtbcSyncData(
  db: D1Database,
  data: CtbcSyncData,
  options: { now: string; finalizeStatements?: D1PreparedStatement[] },
): Promise<CtbcSyncWriteResult> {
  const { now } = options;
  const bankAccounts = data.bankAccounts ?? [];
  const bankBalanceSnapshots = data.bankBalanceSnapshots ?? [];
  const bankTransactions = data.bankTransactions ?? [];
  const creditCardBills = data.creditCardBills ?? [];
  console.log(
    `[sync] ${CONNECTOR_ID}/all: accounts=${bankAccounts.length} snapshots=${bankBalanceSnapshots.length} transactions=${bankTransactions.length} bills=${creditCardBills.length}`,
  );

  const records: SyncWriteRecord[] = [
    ...bankAccounts.map((account) =>
      bankAccountRecord(CONNECTOR_ID, account, now),
    ),
    ...bankBalanceSnapshots.map((snapshot) =>
      bankBalanceSnapshotRecord(CONNECTOR_ID, snapshot, now),
    ),
    ...bankTransactions.map((transaction) =>
      bankTransactionRecord(CONNECTOR_ID, transaction, now),
    ),
    ...creditCardBills.map((bill) =>
      creditCardBillRecord(CONNECTOR_ID, bill, now),
    ),
  ];

  const authorizationWrite = await prepareCtbcAuthorizationWrite(db, records);
  const newRecords = await persistStagedSyncWrite(db, {
    records: authorizationWrite.records,
    afterPromoteStatements: [
      ...authorizationWrite.afterPromoteStatements,
      ...(bankAccounts.length > 0
        ? [linkCanonicalBankAccountsStatement(db)]
        : []),
    ],
    finalizeStatements: options.finalizeStatements ?? [],
  });

  if (bankBalanceSnapshots.length > 0) {
    await refreshBankDepositHistory(db, new Date(now));
  }

  return {
    records:
      bankAccounts.length +
      bankBalanceSnapshots.length +
      bankTransactions.length +
      creditCardBills.length,
    newRecords,
  };
}
