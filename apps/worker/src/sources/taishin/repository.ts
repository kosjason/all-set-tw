import { mergeLegacyTransactionStatements } from "../../features/sync/transaction-merge";
import type { SyncWriteRecord } from "../../features/sync/persistence";
import { normalizeMerchantName, taishinCardText } from "./protocol";

const V2_PREFIX = "taishin:card:tx:v2:";

/**
 * 依新版規則重算台新信用卡交易的 sourceId。2026-10（上游 42ac0da）起，識別碼使用的描述會
 * 先經 `taishinCardText` 遮罩身分證字號與長串數字；之前寫入的交易以原始描述產生識別碼，
 * 同一筆交易因此得到不同的 sourceId。格式為
 * `taishin:card:tx:v2:{幣別}:{日期}:{金額}:{卡號末四碼}:{描述}:{occurrence}`，
 * 只替換描述段；無法解析時回傳 null。
 */
export function taishinMaskedSourceId(
  sourceId: string,
  description: string | null | undefined,
): string | null {
  if (!sourceId.startsWith(V2_PREFIX)) return null;
  const parts = sourceId.slice(V2_PREFIX.length).split(":");
  if (parts.length < 6) return null;
  const [currency, date, amount, last4] = parts;
  const occurrence = parts.at(-1)!;
  if (!/^\d+$/.test(occurrence) || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) {
    return null;
  }
  const identity =
    normalizeMerchantName(taishinCardText(description ?? "")) || "unknown";
  return `${V2_PREFIX}${currency}:${date}:${amount}:${last4}:${identity}:${occurrence}`;
}

type ExistingRow = {
  id: string;
  account_id: string;
  source_id: string;
  status: string;
  description: string | null;
};

/**
 * 找出以舊版識別碼保存、會被本次新版識別碼寫入取代的入帳列，回傳 `[舊列 id, 新列 id]`。
 * 只在舊列以新版規則重算的 sourceId 恰好等於本次寫入的列時成立；本次仍以舊識別碼
 * 寫入的列不算。只處理入帳列：帳單交易的識別碼取自描述，即時授權的識別碼取自消費
 * 類別（描述是店名），以描述重算會把授權誤認成入帳。
 */
export function taishinMaskedIdentityPairs(
  existing: readonly ExistingRow[],
  records: readonly SyncWriteRecord[],
): Array<[string, string]> {
  const incoming = new Map<string, string>();
  for (const record of records) {
    if (
      record.entityType !== "bank_transaction" ||
      record.payload.status !== "posted"
    )
      continue;
    const { id, account_id, source_id } = record.payload as Record<
      string,
      unknown
    >;
    if (
      typeof id === "string" &&
      typeof account_id === "string" &&
      typeof source_id === "string" &&
      source_id.startsWith(V2_PREFIX)
    ) {
      incoming.set(`${account_id}\u0000${source_id}`, id);
    }
  }
  if (incoming.size === 0) return [];
  const pairs: Array<[string, string]> = [];
  for (const row of existing) {
    if (row.status !== "posted") continue;
    if (incoming.has(`${row.account_id}\u0000${row.source_id}`)) continue;
    const masked = taishinMaskedSourceId(row.source_id, row.description);
    if (!masked || masked === row.source_id) continue;
    const target = incoming.get(`${row.account_id}\u0000${masked}`);
    if (target && target !== row.id) pairs.push([row.id, target]);
  }
  return pairs;
}

/**
 * 把舊版識別碼的台新信用卡交易併入本次以新版識別碼寫入的同一筆交易，避免同一筆消費
 * 重複計算。合併沿用 `mergeLegacyTransactionStatements`（保留使用者分類、排除、角色、
 * 備註與發票關係，設定衝突時不合併）。必須排在授權寫入之後執行。
 */
export async function prepareTaishinMaskedIdentityMerge(
  db: D1Database,
  records: readonly SyncWriteRecord[],
): Promise<D1PreparedStatement[]> {
  if (
    !records.some(
      (record) =>
        record.entityType === "bank_transaction" &&
        record.payload.status === "posted" &&
        String(record.payload.source_id).startsWith(V2_PREFIX),
    )
  )
    return [];
  const existing = await db
    .prepare(
      `SELECT id, account_id, source_id, status, description FROM bank_transactions
       WHERE connector_id = 'taishin' AND status = 'posted'
         AND source_id LIKE '${V2_PREFIX}%'`,
    )
    .all<ExistingRow>();
  const pairs = taishinMaskedIdentityPairs(existing.results ?? [], records);
  if (pairs.length === 0) return [];
  console.log(
    JSON.stringify({
      event: "taishin_masked_identity_merge",
      candidates: pairs.length,
    }),
  );
  return mergeLegacyTransactionStatements(
    db,
    `SELECT json_extract(value, '$[0]') AS old_id,
            json_extract(value, '$[1]') AS new_id
     FROM json_each(?)`,
    [JSON.stringify(pairs)],
  );
}
