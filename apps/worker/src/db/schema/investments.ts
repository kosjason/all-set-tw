import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
  unique,
  index,
  check,
} from "drizzle-orm/sqlite-core";

// SQL migrations remain authoritative for schema shape and constraints.

export const investmentPositions = sqliteTable(
  "investment_positions",
  {
    id: text("id").notNull(),
    connectorId: text("connector_id").notNull(),
    sourceId: text("source_id").notNull(),
    assetType: text("asset_type").notNull(),
    symbol: text("symbol"),
    name: text("name").notNull(),
    quantity: real("quantity"),
    marketValue: integer("market_value"),
    cashBalance: integer("cash_balance"),
    currency: text("currency")
      .notNull()
      .default(sql`'TWD'`),
    asOfDate: text("as_of_date").notNull(),
    rawPayload: text("raw_payload"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    brokerNo: text("broker_no"),
    brokerName: text("broker_name"),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index("idx_investment_positions_page").on(
      sql`as_of_date DESC`,
      sql`asset_type ASC`,
      sql`name ASC`,
      sql`id ASC`,
    ),
    index("idx_investment_positions_latest_scope").on(
      table.connectorId,
      table.assetType,
      sql`as_of_date DESC`,
    ),
    index("idx_investment_positions_asset_type").on(table.assetType),
    index("idx_investment_positions_as_of_date").on(table.asOfDate),
    unique().on(table.connectorId, table.sourceId, table.asOfDate),
    check(
      "investment_positions_check_1",
      sql`asset_type IN ('stock', 'etf', 'fund')`,
    ),
  ],
);

export const investmentTransactions = sqliteTable(
  "investment_transactions",
  {
    id: text("id").notNull(),
    connectorId: text("connector_id").notNull(),
    accountId: text("account_id").notNull(),
    sourceId: text("source_id").notNull(),
    brokerNo: text("broker_no"),
    brokerAccount: text("broker_account"),
    brokerName: text("broker_name"),
    symbol: text("symbol"),
    name: text("name"),
    assetType: text("asset_type"),
    tradeDate: text("trade_date"),
    postedDate: text("posted_date"),
    transactionCode: text("transaction_code"),
    transactionName: text("transaction_name"),
    quantity: real("quantity"),
    price: real("price"),
    amount: integer("amount"),
    currency: text("currency")
      .notNull()
      .default(sql`'TWD'`),
    rawPayload: text("raw_payload"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    effectiveDate: text("effective_date").generatedAlwaysAs(
      sql`COALESCE(trade_date, posted_date, '')`,
      { mode: "virtual" },
    ),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index("idx_investment_transactions_effective_updated").on(
      sql`effective_date DESC`,
      sql`updated_at DESC`,
      sql`id DESC`,
    ),
    index("idx_investment_transactions_symbol").on(table.symbol),
    index("idx_investment_transactions_trade_date").on(table.tradeDate),
    unique().on(table.connectorId, table.accountId, table.sourceId),
    check(
      "investment_transactions_check_1",
      sql`asset_type IN ('stock', 'etf', 'fund', 'bond', 'unknown')`,
    ),
  ],
);

/** 證交所／櫃買中心每日收盤價快取（0076）；排程補抓，讀取 API 不連外。 */
export const securityPrices = sqliteTable(
  "security_prices",
  {
    symbol: text("symbol").notNull(),
    tradeDate: text("trade_date").notNull(),
    close: real("close").notNull(),
    exchange: text("exchange").notNull(),
    fetchedAt: text("fetched_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.symbol, table.tradeDate] }),
    check("security_prices_check_1", sql`length(symbol) BETWEEN 1 AND 20`),
    check(
      "security_prices_check_2",
      sql`
    trade_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'
    AND trade_date IS date(trade_date)
  `,
    ),
    check("security_prices_check_3", sql`close > 0`),
    check("security_prices_check_4", sql`exchange IN ('twse', 'tpex')`),
  ],
);

/** 每檔每月的收盤價抓取紀錄（0076）。 */
export const securityPriceMonths = sqliteTable(
  "security_price_months",
  {
    symbol: text("symbol").notNull(),
    month: text("month").notNull(),
    exchange: text("exchange").notNull(),
    status: text("status").notNull(),
    final: integer("final", { mode: "boolean" })
      .notNull()
      .default(sql`0`),
    fetchedAt: text("fetched_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.symbol, table.month] }),
    check(
      "security_price_months_check_1",
      sql`length(symbol) BETWEEN 1 AND 20`,
    ),
    check(
      "security_price_months_check_2",
      sql`
    month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'
    AND date(month || '-01') IS NOT NULL
  `,
    ),
    check("security_price_months_check_3", sql`exchange IN ('twse', 'tpex')`),
    check(
      "security_price_months_check_4",
      sql`status IN ('ok', 'empty', 'error')`,
    ),
    check("security_price_months_check_5", sql`final IN (0, 1)`),
  ],
);

/** 使用者填的期初成本（0076），key 為「券商代號:帳號:代號」。 */
export const investmentOpeningCosts = sqliteTable(
  "investment_opening_costs",
  {
    holdingKey: text("holding_key").notNull(),
    cost: integer("cost").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.holdingKey] }),
    check(
      "investment_opening_costs_check_1",
      sql`length(holding_key) BETWEEN 1 AND 100`,
    ),
    check(
      "investment_opening_costs_check_2",
      sql`
    typeof(cost) = 'integer' AND cost BETWEEN 1 AND 10000000000
  `,
    ),
  ],
);
