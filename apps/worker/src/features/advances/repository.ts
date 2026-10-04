/**
 * 最早一筆代墊／收回代墊的日期（YYYY-MM-DD，取時間戳記前 10 碼；呼叫端再往前多讀一個月
 * 以涵蓋 UTC 與台北日期的差距）。沒有任何代墊時回傳 null。
 */
export async function earliestAdvanceDay(db: D1Database) {
  const row = await db
    .prepare(
      `SELECT MIN(day) AS day FROM (
        SELECT substr(COALESCE(t.authorized_at, t.posted_date), 1, 10) AS day
        FROM activity_role_overrides o
        JOIN bank_transactions t ON t.id = o.target_id
        WHERE o.target_kind = 'bank_transaction' AND o.counterparty IS NOT NULL
        UNION ALL
        SELECT substr(i.invoice_date, 1, 10) AS day
        FROM activity_role_overrides o
        JOIN invoices i ON i.id = o.target_id
        WHERE o.target_kind = 'invoice' AND o.counterparty IS NOT NULL
      )`,
    )
    .first<{ day: string | null }>();
  return row?.day && /^\d{4}-\d{2}-\d{2}$/.test(row.day) ? row.day : null;
}
