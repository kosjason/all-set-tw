import {
  parseActivitySearch,
  type ParsedActivitySearch,
} from "@taiwan-fin-hub/core";
import { createDrizzle } from "@taiwan-fin-hub/db";
import { sql, type SQL } from "drizzle-orm";

export interface ActivitySearchInput {
  q: string;
  from?: string;
  to?: string;
  source?: "all" | "bank" | "card" | "invoice";
  flow?: "all" | "income" | "expense";
  category?: string;
}

/** 使用者商家別名符合查詢文字時，額外比對的統編與名稱片段。 */
export interface ActivitySearchMerchantMatches {
  sellerBans: string[];
  nameNeedles: string[];
}

const COMPARATORS = new Set([">", ">=", "<", "<=", "="]);

function amountCondition(column: SQL, search: ParsedActivitySearch) {
  if (search.amounts.length === 0) return sql`1`;
  return sql.join(
    search.amounts.map((condition) => {
      // Operators come from a fixed parser whitelist, never raw user input.
      if (!COMPARATORS.has(condition.op)) throw new Error("Invalid operator.");
      return sql`abs(${column}) ${sql.raw(condition.op)} ${condition.value}`;
    }),
    sql` AND `,
  );
}

/** 文字條件與金額條件的組合：單一數字為「金額相等或文字包含」，其餘全部都要符合。 */
function combine(text: SQL, amount: SQL, search: ParsedActivitySearch) {
  if (search.numberOrText) return sql`((${text}) OR (${amount}))`;
  return sql`((${search.text ? text : sql`1`}) AND (${amount}))`;
}

/** Read bounded candidate days; full same-day context preserves invoice matching. */
export async function findActivitySearchDays(
  db: D1Database,
  input: ActivitySearchInput,
  matchingAccountIds: string[] = [],
  beforeDay?: string,
  inclusive = false,
  options: {
    search?: ParsedActivitySearch;
    merchants?: ActivitySearchMerchantMatches;
  } = {},
) {
  const search = options.search ?? parseActivitySearch(input.q);
  const merchants = options.merchants ?? { sellerBans: [], nameNeedles: [] };
  const q = search.text;
  const from = input.from ?? null;
  const to = input.to ?? null;
  const before = beforeDay ?? null;
  const matchingIds = JSON.stringify(matchingAccountIds);
  const sellerBans = JSON.stringify(merchants.sellerBans);
  const nameNeedles = JSON.stringify(merchants.nameNeedles);
  const inclusiveFlag = inclusive ? 1 : 0;

  const bankText = sql`(
    instr(lower(COALESCE(txn.description, '') || ' ' || COALESCE(txn.counterparty, '') || ' ' ||
      COALESCE(account.institution_name, '') || ' ' || COALESCE(account.account_name, '') || ' ' ||
      COALESCE(account.account_last4, '') || ' 銀行 信用卡'), ${q}) > 0
    OR account.id IN (SELECT value FROM json_each(${matchingIds}))
    OR EXISTS (SELECT 1 FROM classification_categories WHERE instr(lower(label), ${q}) > 0)
    OR EXISTS (SELECT 1 FROM json_each(${nameNeedles}) needle
      WHERE instr(lower(replace(COALESCE(txn.description, '') || COALESCE(txn.counterparty, ''), ' ', '')), needle.value) > 0)
    OR EXISTS (SELECT 1 FROM activity_notes note
      WHERE note.target_kind = 'bank_transaction' AND note.target_id = txn.id
        AND instr(lower(note.note), ${q}) > 0)
  )`;
  const invoiceText = sql`(
    instr(lower(COALESCE(seller_name, '') || ' ' || COALESCE(invoice_number, '') || ' 電子發票'), ${q}) > 0
    OR seller_ban IN (SELECT value FROM json_each(${sellerBans}))
    OR EXISTS (SELECT 1 FROM json_each(${nameNeedles}) needle
      WHERE instr(lower(replace(COALESCE(seller_name, ''), ' ', '')), needle.value) > 0)
    OR EXISTS (SELECT 1 FROM invoice_line_items line
      WHERE line.invoice_id = invoices.id AND instr(lower(line.description), ${q}) > 0)
    OR EXISTS (SELECT 1 FROM activity_notes note
      WHERE note.target_kind = 'invoice' AND note.target_id = invoices.id
        AND instr(lower(note.note), ${q}) > 0)
  )`;
  const tradeText = sql`instr(lower(COALESCE(name, '') || ' ' || COALESCE(symbol, '') || ' ' ||
    COALESCE(transaction_name, '') || ' ' || COALESCE(transaction_code, '') || ' 投資'), ${q}) > 0`;

  // UNION ALL + DISTINCT keeps cross-source day dedupe; the bank CASE must
  // stay identical to idx_bank_transactions_transaction_day.
  const rows = await createDrizzle(db).all<{ day: string }>(sql`
    WITH candidates AS (
      SELECT CASE WHEN length(txn.authorized_at) > 10
        THEN COALESCE(date(txn.authorized_at, '+8 hours'), substr(txn.authorized_at, 1, 10))
        ELSE substr(COALESCE(txn.authorized_at, txn.posted_date), 1, 10) END AS day
      FROM bank_transactions txn
      JOIN bank_accounts account ON account.id = txn.account_id
      WHERE account.canonical_account_id IS NULL AND (txn.status <> 'pending' OR txn.matched_transaction_id IS NULL)
        AND ${combine(bankText, amountCondition(sql`txn.amount`, search), search)}
      UNION ALL
      SELECT CASE WHEN length(invoice_date) > 10
        THEN COALESCE(date(invoice_date, '+8 hours'), substr(invoice_date, 1, 10))
        ELSE invoice_date END AS day
      FROM invoices
      WHERE ${combine(invoiceText, amountCondition(sql`amount`, search), search)}
      UNION ALL
      SELECT substr(effective_date, 1, 10) AS day FROM investment_transactions
      WHERE ${combine(tradeText, amountCondition(sql`amount`, search), search)}
    )
    SELECT DISTINCT day FROM candidates
    WHERE day IS NOT NULL AND day != ''
      AND (${from} IS NULL OR day >= ${from}) AND (${to} IS NULL OR day <= ${to})
      AND (${before} IS NULL OR day < ${before} OR (${inclusiveFlag} = 1 AND day = ${before}))
    ORDER BY day DESC LIMIT 33
  `);
  return rows.map((row) => row.day);
}
