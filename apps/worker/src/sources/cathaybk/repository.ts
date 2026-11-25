import type { SyncWriteRecord } from "../../features/sync/persistence";
import { mergeLegacyTransactionStatements } from "../../features/sync/transaction-merge";
import { normalizeCathayDescription } from "./protocol";
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

type ExistingDepositRow = {
  id: string;
  account_id: string;
  source_id: string;
  posted_date: string | null;
  amount: number;
  description: string | null;
  created_at: string;
};

/** sourceId 結尾的 occurrence（同帳戶、同時間、同金額、同說明的第幾筆）。 */
function occurrenceOf(sourceId: string) {
  return /:(\d+)$/.exec(sourceId)?.[1] ?? null;
}

function depositBaseKey(
  accountId: string,
  postedDate: string | null,
  amount: number,
  description: string | null,
) {
  return [
    accountId,
    postedDate ?? "",
    amount,
    normalizeCathayDescription(description),
  ].join("\u0000");
}

export interface CathayDepositIdentityPlan {
  /** 改用既有列 id 的寫入紀錄。 */
  records: SyncWriteRecord[];
  /** 已經重複保存的舊列併入最早那一列：`[重複列 id, 保留列 id]`。 */
  duplicatePairs: Array<[string, string]>;
}

/**
 * 國泰存款說明的空白格式改變後，同一筆交易會以不同的 sourceId 再寫一次（2026-09、10 月的
 * 配息與轉帳各多一筆）。依帳戶、時間、金額、正規化說明與 occurrence 找回既有的列：
 * 1. 本次寫入的列沿用既有列的 id 與 sourceId，不再新增一筆。
 * 2. 既有列已經重複時，併入最早建立的那一列。只在本次這組交易只有一筆時才併，
 *    銀行確實有兩筆相同交易（occurrence 2 以上）時不動。
 * existing 只應包含國泰存款帳戶的列。
 */
export function planCathayDepositIdentity(
  existing: readonly ExistingDepositRow[],
  records: readonly SyncWriteRecord[],
): CathayDepositIdentityPlan {
  const incomingPerBase = new Map<string, number>();
  for (const record of records) {
    if (record.entityType !== "bank_transaction") continue;
    const p = record.payload as Record<string, unknown>;
    const base = depositBaseKey(
      String(p.account_id),
      (p.posted_date as string | null) ?? null,
      Number(p.amount),
      p.description as string | null,
    );
    incomingPerBase.set(base, (incomingPerBase.get(base) ?? 0) + 1);
  }
  const groups = new Map<string, ExistingDepositRow[]>();
  for (const row of existing) {
    const occurrence = occurrenceOf(row.source_id);
    if (!occurrence) continue;
    const base = depositBaseKey(
      row.account_id,
      row.posted_date,
      row.amount,
      row.description,
    );
    if (!incomingPerBase.has(base)) continue;
    const key = `${base}\u0000${occurrence}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const keepByKey = new Map<string, ExistingDepositRow>();
  const duplicatePairs: Array<[string, string]> = [];
  for (const [key, group] of groups) {
    group.sort(
      (a, b) =>
        a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
    );
    const keep = group[0]!;
    keepByKey.set(key, keep);
    const base = key.slice(0, key.lastIndexOf("\u0000"));
    if (group.length > 1 && incomingPerBase.get(base) === 1)
      for (const duplicate of group.slice(1))
        duplicatePairs.push([duplicate.id, keep.id]);
  }
  const mapped = records.map((record) => {
    if (record.entityType !== "bank_transaction") return record;
    const p = record.payload as Record<string, unknown>;
    const occurrence = occurrenceOf(String(p.source_id));
    if (!occurrence) return record;
    const keep = keepByKey.get(
      `${depositBaseKey(
        String(p.account_id),
        (p.posted_date as string | null) ?? null,
        Number(p.amount),
        p.description as string | null,
      )}\u0000${occurrence}`,
    );
    if (!keep || keep.id === p.id) return record;
    return {
      ...record,
      recordKey: keep.id,
      payload: { ...p, id: keep.id, source_id: keep.source_id },
    };
  });
  return { records: mapped, duplicatePairs };
}

/**
 * 寫入國泰交易前，依正規化說明對回既有的存款交易（見 {@link planCathayDepositIdentity}），
 * 並回傳併掉重複舊列的 statements（沿用 `mergeLegacyTransactionStatements`，保留使用者的
 * 分類、角色、備註與發票關係），放在寫入之後執行。
 */
export async function prepareCathayDepositIdentity(
  db: D1Database,
  records: readonly SyncWriteRecord[],
) {
  const dates = records
    .filter((record) => record.entityType === "bank_transaction")
    .map((record) => record.payload.posted_date)
    .filter((date): date is string => typeof date === "string")
    .sort();
  if (dates.length === 0)
    return {
      records: [...records],
      mergeStatements: [] as D1PreparedStatement[],
    };
  const existing = await db
    .prepare(
      `SELECT t.id, t.account_id, t.source_id, t.posted_date, t.amount, t.description, t.created_at
       FROM bank_transactions t
       JOIN bank_accounts a ON a.id = t.account_id
       WHERE t.connector_id = 'cathaybk' AND a.account_type <> 'credit'
         AND t.posted_date >= ? AND t.posted_date <= ?`,
    )
    .bind(dates[0], dates.at(-1))
    .all<ExistingDepositRow>();
  const plan = planCathayDepositIdentity(existing.results ?? [], records);
  if (plan.duplicatePairs.length > 0)
    console.log(
      JSON.stringify({
        event: "cathaybk_deposit_duplicate_merge",
        candidates: plan.duplicatePairs.length,
      }),
    );
  return {
    records: plan.records,
    mergeStatements:
      plan.duplicatePairs.length === 0
        ? []
        : mergeLegacyTransactionStatements(
            db,
            `SELECT json_extract(value, '$[0]') AS old_id,
                    json_extract(value, '$[1]') AS new_id
             FROM json_each(?)`,
            [JSON.stringify(plan.duplicatePairs)],
          ),
  };
}
