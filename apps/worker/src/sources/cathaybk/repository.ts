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
  /** 已經重複保存的舊列併入保留的那一列：`[重複列 id, 保留列 id]`。 */
  duplicatePairs: Array<[string, string]>;
  /** 既有列比本次多、但本次不只一筆，無法判斷哪幾列重複而略過的組數。 */
  ambiguousGroups: number;
}

/**
 * 國泰存款說明的空白格式改變後，同一筆交易會以不同的 sourceId 再寫一次（2026-09、10 月的
 * 配息與轉帳各多一筆）。依帳戶、時間、金額與正規化說明分組，把本次寫入的交易與既有列一對一
 * 對回（雙方各自依 occurrence、建立時間排序），本次寫入沿用既有列的 id 與 sourceId：
 * - 既有列比本次多、且本次這組只有一筆：多出來的舊列是重複，併入對回的那一列。
 * - 本次這組有兩筆以上時不併（無法判斷哪幾列重複），只做一對一對回。
 * - 本次比既有列多：多出來的照常新增。
 * existing 只應包含國泰存款帳戶的列。
 */
export function planCathayDepositIdentity(
  existing: readonly ExistingDepositRow[],
  records: readonly SyncWriteRecord[],
): CathayDepositIdentityPlan {
  const incomingByBase = new Map<string, number[]>();
  records.forEach((record, index) => {
    if (record.entityType !== "bank_transaction") return;
    const p = record.payload as Record<string, unknown>;
    if (!occurrenceOf(String(p.source_id))) return;
    const base = depositBaseKey(
      String(p.account_id),
      (p.posted_date as string | null) ?? null,
      Number(p.amount),
      p.description as string | null,
    );
    incomingByBase.set(base, [...(incomingByBase.get(base) ?? []), index]);
  });
  const existingByBase = new Map<string, ExistingDepositRow[]>();
  for (const row of existing) {
    if (!occurrenceOf(row.source_id)) continue;
    const base = depositBaseKey(
      row.account_id,
      row.posted_date,
      row.amount,
      row.description,
    );
    if (!incomingByBase.has(base)) continue;
    existingByBase.set(base, [...(existingByBase.get(base) ?? []), row]);
  }
  const mapped = [...records];
  const duplicatePairs: Array<[string, string]> = [];
  let ambiguousGroups = 0;
  const occurrence = (sourceId: string) => Number(occurrenceOf(sourceId));
  for (const [base, indexes] of incomingByBase) {
    const rows = (existingByBase.get(base) ?? []).sort(
      (a, b) =>
        occurrence(a.source_id) - occurrence(b.source_id) ||
        a.created_at.localeCompare(b.created_at) ||
        a.id.localeCompare(b.id),
    );
    if (rows.length === 0) continue;
    const incoming = [...indexes].sort(
      (a, b) =>
        occurrence(String(records[a]!.payload.source_id)) -
        occurrence(String(records[b]!.payload.source_id)),
    );
    incoming.forEach((recordIndex, position) => {
      const keep = rows[position];
      const record = records[recordIndex]!;
      if (!keep || keep.id === record.payload.id) return;
      mapped[recordIndex] = {
        ...record,
        recordKey: keep.id,
        payload: { ...record.payload, id: keep.id, source_id: keep.source_id },
      };
    });
    if (rows.length > incoming.length) {
      if (incoming.length === 1)
        for (const duplicate of rows.slice(1))
          duplicatePairs.push([duplicate.id, rows[0]!.id]);
      else ambiguousGroups += 1;
    }
  }
  return { records: mapped, duplicatePairs, ambiguousGroups };
}

/**
 * 寫入國泰交易前，依正規化說明對回既有的存款交易（見 {@link planCathayDepositIdentity}），
 * 並回傳併掉重複舊列的 statements，放在寫入之後執行。每組重複各自一次
 * `mergeLegacyTransactionStatements`（保留使用者的分類、角色、備註與發票關係）：同一列有
 * 三列以上重複時，一次只併一列才不會被它的一對一限制擋下。
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
  if (plan.duplicatePairs.length > 0 || plan.ambiguousGroups > 0)
    console.log(
      JSON.stringify({
        event: "cathaybk_deposit_duplicate_merge",
        candidates: plan.duplicatePairs.length,
        ambiguousGroups: plan.ambiguousGroups,
      }),
    );
  return {
    records: plan.records,
    mergeStatements: plan.duplicatePairs.flatMap((pair) =>
      mergeLegacyTransactionStatements(
        db,
        `SELECT json_extract(value, '$[0]') AS old_id,
                json_extract(value, '$[1]') AS new_id
         FROM json_each(?)`,
        [JSON.stringify([pair])],
      ),
    ),
  };
}
