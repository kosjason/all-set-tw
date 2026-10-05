import { mergeLegacyTransactionStatements } from "../../features/sync/transaction-merge";
import { reconcileSingleCardSummaryAccountStatements } from "../../features/sync/card-reconciliation";

// 國泰早期把所有卡片交易寫在 credit:cathaybk:main；拆成實體卡後交易
// sourceId 不變，但 upsert 以帳戶區分，會在實體卡新增同一筆交易。
// 1. 摘要帳戶中已由實體卡以相同 sourceId 取得的交易併入實體卡（保留使用者設定）。
// 2. 只有一張實體卡時，比照玉山把摘要帳戶的快照、帳單與剩餘交易併回該卡。
export function reconcileCathayCardAccountStatements(db: D1Database) {
  return [
    ...mergeLegacyTransactionStatements(
      db,
      `
      SELECT shadow.id AS old_id, canonical.id AS new_id
      FROM bank_transactions shadow
      JOIN bank_accounts summary
        ON summary.id = shadow.account_id
       AND summary.connector_id = 'cathaybk'
       AND summary.source_id = 'credit:cathaybk:main'
      JOIN bank_transactions canonical
        ON canonical.connector_id = shadow.connector_id
       AND canonical.source_id = shadow.source_id
      JOIN bank_accounts card
        ON card.id = canonical.account_id
       AND card.connector_id = 'cathaybk'
       AND card.account_type = 'credit'
       AND card.source_id LIKE 'credit:cathaybk:%'
       AND card.source_id <> 'credit:cathaybk:main'
      WHERE shadow.connector_id = 'cathaybk'`,
    ),
    ...reconcileSingleCardSummaryAccountStatements(db, "cathaybk"),
  ];
}
