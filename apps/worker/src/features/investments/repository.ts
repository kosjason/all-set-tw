import {
  createDrizzle,
  investmentOpeningCosts,
  investmentPositions,
  investmentTransactions,
  securityPriceMonths,
  securityPrices,
} from "../../db";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { MonthDateRange } from "../../platform/month-range";

const investmentTransactionColumns = {
  id: investmentTransactions.id,
  connectorId: investmentTransactions.connectorId,
  accountId: investmentTransactions.accountId,
  sourceId: investmentTransactions.sourceId,
  brokerNo: investmentTransactions.brokerNo,
  brokerAccount: investmentTransactions.brokerAccount,
  brokerName: investmentTransactions.brokerName,
  symbol: investmentTransactions.symbol,
  name: investmentTransactions.name,
  assetType: investmentTransactions.assetType,
  tradeDate: investmentTransactions.tradeDate,
  postedDate: investmentTransactions.postedDate,
  transactionCode: investmentTransactions.transactionCode,
  transactionName: investmentTransactions.transactionName,
  quantity: investmentTransactions.quantity,
  price: investmentTransactions.price,
  amount: investmentTransactions.amount,
  currency: investmentTransactions.currency,
  effectiveDate: sql<string>`${investmentTransactions.effectiveDate}`,
  updatedAt: investmentTransactions.updatedAt,
};

export type InvestmentPageCursor = {
  asOfDate: string;
  assetType: string;
  name: string;
  id: string;
};

export type TransactionPageCursor = {
  effectiveDate: string;
  updatedAt: string;
  id: string;
};

export type InvestmentPositionRow = {
  id: string;
  assetType: string;
  symbol: string | null;
  name: string;
  quantity: number | null;
  marketValue: number | null;
  cashBalance: number | null;
  currency: string;
  asOfDate: string;
  brokerNo: string | null;
  brokerName: string | null;
};

export async function listLatestInvestmentPositions(
  db: D1Database,
  limit: number,
  cursor?: InvestmentPageCursor,
) {
  return createDrizzle(db)
    .select({
      id: investmentPositions.id,
      assetType: investmentPositions.assetType,
      symbol: investmentPositions.symbol,
      name: investmentPositions.name,
      quantity: investmentPositions.quantity,
      marketValue: investmentPositions.marketValue,
      cashBalance: investmentPositions.cashBalance,
      currency: investmentPositions.currency,
      asOfDate: investmentPositions.asOfDate,
      brokerNo: investmentPositions.brokerNo,
      brokerName: investmentPositions.brokerName,
    })
    .from(investmentPositions)
    .where(
      and(
        // Latest as_of_date is per connector + asset type, not a global max.
        eq(
          investmentPositions.asOfDate,
          sql`(
            SELECT MAX(p2.as_of_date)
            FROM investment_positions p2
            WHERE p2.connector_id = ${investmentPositions.connectorId}
              AND p2.asset_type = ${investmentPositions.assetType}
          )`,
        ),
        cursor
          ? sql`(
              ${investmentPositions.asOfDate} < ${cursor.asOfDate}
              OR (
                ${investmentPositions.asOfDate} = ${cursor.asOfDate}
                AND (${investmentPositions.assetType}, ${investmentPositions.name}, ${investmentPositions.id})
                  > (${cursor.assetType}, ${cursor.name}, ${cursor.id})
              )
            )`
          : undefined,
      ),
    )
    .orderBy(
      desc(investmentPositions.asOfDate),
      asc(investmentPositions.assetType),
      asc(investmentPositions.name),
      asc(investmentPositions.id),
    )
    .limit(limit)
    .all();
}

export async function listInvestmentTransactions(
  db: D1Database,
  limit: number,
  cursor?: TransactionPageCursor,
) {
  return createDrizzle(db)
    .select(investmentTransactionColumns)
    .from(investmentTransactions)
    .where(
      cursor
        ? sql`(${investmentTransactions.effectiveDate}, ${investmentTransactions.updatedAt}, ${investmentTransactions.id}) < (${cursor.effectiveDate}, ${cursor.updatedAt}, ${cursor.id})`
        : undefined,
    )
    .orderBy(
      desc(investmentTransactions.effectiveDate),
      desc(investmentTransactions.updatedAt),
      desc(investmentTransactions.id),
    )
    .limit(limit)
    .all();
}

export async function listInvestmentTransactionsInRange(
  db: D1Database,
  range: MonthDateRange,
  days?: string[],
) {
  return createDrizzle(db)
    .select(investmentTransactionColumns)
    .from(investmentTransactions)
    .where(
      days
        ? sql`substr(${investmentTransactions.effectiveDate}, 1, 10) IN (SELECT value FROM json_each(${JSON.stringify(days)}))`
        : and(
            sql`${investmentTransactions.effectiveDate} >= ${range.from}`,
            sql`${investmentTransactions.effectiveDate} < ${range.to}`,
          ),
    )
    .orderBy(
      desc(investmentTransactions.effectiveDate),
      desc(investmentTransactions.updatedAt),
      desc(investmentTransactions.id),
    )
    .all();
}

// ---- 投資績效 ----

/** 集保交易：異動後餘額、借貸別與上市櫃別在 raw payload 的欄位。 */
export type PerformanceTransactionRow = {
  id: string;
  accountId: string;
  brokerNo: string | null;
  brokerName: string | null;
  symbol: string;
  name: string | null;
  assetType: string | null;
  date: string;
  code: string | null;
  dbCrCode: string | null;
  quantity: number;
  balanceAfter: string | null;
  exchangeCode: string | null;
};

export async function listPerformanceTransactions(db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT id, account_id AS accountId, broker_no AS brokerNo, broker_name AS brokerName,
              trim(symbol) AS symbol, name, asset_type AS assetType,
              substr(COALESCE(trade_date, posted_date), 1, 10) AS date,
              transaction_code AS code,
              json_extract(raw_payload, '$.fields.dbCRCode') AS dbCrCode,
              quantity,
              CAST(json_extract(raw_payload, '$.fields.txnPBBal') AS TEXT) AS balanceAfter,
              json_extract(raw_payload, '$.fields.stockExcg') AS exchangeCode
         FROM investment_transactions
        WHERE connector_id = 'tdcc'
          AND symbol IS NOT NULL AND trim(symbol) <> ''
          AND quantity IS NOT NULL
          AND COALESCE(trade_date, posted_date) IS NOT NULL
        ORDER BY date, id`,
    )
    .all<PerformanceTransactionRow>();
  return results;
}

export type PerformancePositionRow = {
  sourceId: string;
  symbol: string;
  name: string;
  assetType: string;
  brokerNo: string | null;
  brokerName: string | null;
  quantity: number | null;
  marketValue: number | null;
  asOfDate: string;
  date: string;
  latest: number;
};

/** 集保每天的持股快照；latest = 1 為該連接器與資產類型最新一天。 */
export async function listPerformancePositions(db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT p.source_id AS sourceId, trim(p.symbol) AS symbol, p.name, p.asset_type AS assetType,
              p.broker_no AS brokerNo, p.broker_name AS brokerName,
              p.quantity, p.market_value AS marketValue, p.as_of_date AS asOfDate,
              substr(p.as_of_date, 1, 10) AS date,
              p.as_of_date = (
                SELECT MAX(p2.as_of_date) FROM investment_positions p2
                 WHERE p2.connector_id = p.connector_id AND p2.asset_type = p.asset_type
              ) AS latest
         FROM investment_positions p
        WHERE p.connector_id = 'tdcc'
          AND p.symbol IS NOT NULL AND trim(p.symbol) <> ''
        ORDER BY p.as_of_date`,
    )
    .all<PerformancePositionRow>();
  return results;
}

/** 定期定額扣款與配息入帳（台幣）。 */
export async function listInvestmentBankFlows(db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT substr(posted_date, 1, 10) AS date, amount, description
         FROM bank_transactions
        WHERE currency = 'TWD'
          AND posted_date IS NOT NULL
          AND description IS NOT NULL
          AND (
            description LIKE '%證券定期%'
            OR description LIKE '%配息%'
            OR description LIKE '%收益分配%'
            OR description LIKE '%股息%'
            OR description LIKE '%股利%'
          )
        ORDER BY posted_date, id`,
    )
    .all<{ date: string; amount: number; description: string }>();
  return results;
}

export async function firstBankTransactionDate(db: D1Database) {
  const row = await db
    .prepare(
      "SELECT MIN(substr(posted_date, 1, 10)) AS date FROM bank_transactions WHERE posted_date IS NOT NULL",
    )
    .first<{ date: string | null }>();
  return row?.date ?? null;
}

export async function listSecurityPrices(db: D1Database) {
  return createDrizzle(db)
    .select({
      symbol: securityPrices.symbol,
      tradeDate: securityPrices.tradeDate,
      close: securityPrices.close,
    })
    .from(securityPrices)
    .all();
}

export type SecurityPriceMonthRow = {
  symbol: string;
  month: string;
  status: string;
  final: boolean;
  fetchedAt: string;
};

export async function listSecurityPriceMonths(
  db: D1Database,
): Promise<SecurityPriceMonthRow[]> {
  return createDrizzle(db)
    .select({
      symbol: securityPriceMonths.symbol,
      month: securityPriceMonths.month,
      status: securityPriceMonths.status,
      final: securityPriceMonths.final,
      fetchedAt: securityPriceMonths.fetchedAt,
    })
    .from(securityPriceMonths)
    .all();
}

/** 寫入一個月的收盤價與抓取紀錄（同一批次）。 */
export async function saveSecurityPriceMonth(
  db: D1Database,
  input: {
    symbol: string;
    month: string;
    exchange: "twse" | "tpex";
    status: "ok" | "empty" | "error";
    final: boolean;
    fetchedAt: string;
    closes: { date: string; close: number }[];
  },
) {
  const statements = input.closes.map((price) =>
    db
      .prepare(
        `INSERT INTO security_prices (symbol, trade_date, close, exchange, fetched_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (symbol, trade_date) DO UPDATE SET
           close = excluded.close, exchange = excluded.exchange, fetched_at = excluded.fetched_at`,
      )
      .bind(
        input.symbol,
        price.date,
        price.close,
        input.exchange,
        input.fetchedAt,
      ),
  );
  // 抓取失敗不覆蓋先前成功的紀錄，只更新時間供重試間隔使用。
  statements.push(
    db
      .prepare(
        `INSERT INTO security_price_months (symbol, month, exchange, status, final, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (symbol, month) DO UPDATE SET
           exchange = excluded.exchange,
           status = CASE WHEN excluded.status = 'error' AND security_price_months.status <> 'error'
                         THEN security_price_months.status ELSE excluded.status END,
           final = CASE WHEN excluded.status = 'error' THEN security_price_months.final ELSE excluded.final END,
           fetched_at = excluded.fetched_at`,
      )
      .bind(
        input.symbol,
        input.month,
        input.exchange,
        input.status,
        input.final ? 1 : 0,
        input.fetchedAt,
      ),
  );
  await db.batch(statements);
}

export async function listInvestmentOpeningCosts(db: D1Database) {
  return createDrizzle(db)
    .select({
      holdingKey: investmentOpeningCosts.holdingKey,
      cost: investmentOpeningCosts.cost,
    })
    .from(investmentOpeningCosts)
    .all();
}

export async function upsertInvestmentOpeningCost(
  db: D1Database,
  holdingKey: string,
  cost: number,
  now: string,
) {
  await createDrizzle(db)
    .insert(investmentOpeningCosts)
    .values({ holdingKey, cost, updatedAt: now })
    .onConflictDoUpdate({
      target: investmentOpeningCosts.holdingKey,
      set: { cost, updatedAt: now },
    })
    .run();
}

export async function deleteInvestmentOpeningCost(
  db: D1Database,
  holdingKey: string,
) {
  await createDrizzle(db)
    .delete(investmentOpeningCosts)
    .where(eq(investmentOpeningCosts.holdingKey, holdingKey))
    .run();
}
