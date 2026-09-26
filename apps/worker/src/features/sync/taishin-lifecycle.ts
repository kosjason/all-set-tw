import {
  pairTaishinTransactions,
  taishinPreferredAuthorizedAt,
  taishinTransactionMatchKind,
} from "@taiwan-fin-hub/connectors";
import type { SyncWriteRecord } from "./persistence";
import { mergeLegacyTransactionStatements } from "./transaction-merge";

const SOURCE_PREFIX = "taishin:card:tx:";
/** 超過此天數仍無入帳明細的即時消費照常保留，只記錄數量供觀察。 */
export const TAISHIN_STALE_PENDING_DAYS = 14;

type Row = {
  id: string;
  account_id: string;
  source_id: string;
  status: string;
  authorized_at: string | null;
  amount: number;
  currency: string;
  description: string | null;
  raw_payload: string | null;
};

export type TaishinLifecycleLink = {
  pending: string;
  posted: string;
  authorizedAt?: string;
};

const candidate = (row: Row) => ({
  authorizedAt: row.authorized_at ?? undefined,
  amount: row.amount,
  currency: row.currency,
  description: row.description,
  raw: parseRaw(row.raw_payload),
});

function parseRaw(value: string | null): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value || "{}");
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * 以已存資料加上本次寫入，找出已被入帳明細取代的台新即時消費（pending）。
 * 規則與 parser 相同（{@link taishinTransactionMatchKind}，一對一唯一）。
 * 已存的 pending 不論是否仍在即時清單，都會在寫入後併入對應的入帳明細並
 * 刪除；本次仍要寫入的 pending 則直接不寫。
 */
export function matchTaishinLifecycle(rows: readonly Row[]) {
  const pending = rows.filter((row) => row.status === "pending");
  const posted = rows.filter((row) => row.status === "posted");
  return pairTaishinTransactions(pending, posted, (left, right) =>
    left.account_id === right.account_id
      ? taishinTransactionMatchKind(candidate(left), candidate(right))
      : undefined,
  ).map(([pendingRow, postedRow]): TaishinLifecycleLink => ({
    pending: pendingRow.id,
    posted: postedRow.id,
    authorizedAt: taishinPreferredAuthorizedAt(
      postedRow.authorized_at ?? undefined,
      pendingRow.authorized_at ?? undefined,
    ),
  }));
}

export async function prepareTaishinLifecycleWrite(
  db: D1Database,
  records: SyncWriteRecord[],
  now = new Date(),
) {
  const stored = (
    await db
      .prepare(
        `SELECT id, account_id, source_id, status, authorized_at, amount, currency, description, raw_payload
         FROM bank_transactions
         WHERE connector_id = 'taishin' AND source_id LIKE '${SOURCE_PREFIX}%'`,
      )
      .all<Row>()
  ).results;
  const incoming = records.filter(
    (record) =>
      record.entityType === "bank_transaction" &&
      String(record.payload.source_id).startsWith(SOURCE_PREFIX),
  );
  const storedIds = new Set(stored.map((row) => row.id));
  const rows = new Map(stored.map((row) => [row.id, row]));
  for (const record of incoming) {
    const row = record.payload as unknown as Row;
    const previous = rows.get(row.id);
    // Promotion never downgrades a posted row back to pending.
    rows.set(row.id, {
      ...row,
      status: previous?.status === "posted" ? "posted" : row.status,
    });
  }

  const links = matchTaishinLifecycle([...rows.values()]);
  const replacedPending = new Set(links.map((link) => link.pending));
  const storedLinks = links.filter((link) => storedIds.has(link.pending));
  const linksJson = JSON.stringify(storedLinks);

  const staleBefore = new Date(
    now.getTime() - TAISHIN_STALE_PENDING_DAYS * 86_400_000,
  )
    .toISOString()
    .slice(0, 10);
  const stalePending = [...rows.values()].filter(
    (row) =>
      row.status === "pending" &&
      !replacedPending.has(row.id) &&
      (row.authorized_at ?? "").slice(0, 10) < staleBefore,
  ).length;
  console.log(
    `[sync] taishin lifecycle: replaced_pending=${links.length} stored_replaced=${storedLinks.length} stale_pending=${stalePending}`,
  );

  return {
    links,
    records: records.filter(
      (record) =>
        !(
          incoming.includes(record) &&
          replacedPending.has(String(record.payload.id)) &&
          rows.get(String(record.payload.id))?.status === "pending"
        ),
    ),
    afterPromoteStatements:
      storedLinks.length === 0
        ? []
        : [
            // 入帳明細只有日期；同一消費日時補上即時消費的時間。
            db
              .prepare(
                `UPDATE bank_transactions SET authorized_at = json_extract(link.value, '$.authorizedAt')
                 FROM json_each(?) link
                 WHERE bank_transactions.connector_id = 'taishin'
                   AND bank_transactions.id = json_extract(link.value, '$.posted')
                   AND bank_transactions.status = 'posted'
                   AND length(json_extract(link.value, '$.authorizedAt')) > 10
                   AND length(COALESCE(bank_transactions.authorized_at, '')) <= 10`,
              )
              .bind(linksJson),
            // 保留使用者對即時消費的分類、計算偏好、角色覆寫與發票連結後刪除副本；
            // 兩邊設定互相衝突時不合併，兩筆都保留。
            ...mergeLegacyTransactionStatements(
              db,
              `SELECT pending.id AS old_id, posted.id AS new_id
               FROM json_each(?) link
               JOIN bank_transactions pending
                 ON pending.id = json_extract(link.value, '$.pending')
                AND pending.connector_id = 'taishin' AND pending.status = 'pending'
               JOIN bank_transactions posted
                 ON posted.id = json_extract(link.value, '$.posted')
                AND posted.connector_id = 'taishin' AND posted.status = 'posted'`,
              [linksJson],
            ),
          ],
  };
}
