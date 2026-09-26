import { sql } from "drizzle-orm";
import { bankTransactions } from "./bank";
import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
  unique,
  uniqueIndex,
  index,
  foreignKey,
  check,
} from "drizzle-orm/sqlite-core";

// SQL migrations remain authoritative for schema shape and constraints.

export const invoices = sqliteTable(
  "invoices",
  {
    id: text("id").notNull(),
    connectorId: text("connector_id").notNull(),
    sourceId: text("source_id").notNull(),
    invoiceNumber: text("invoice_number"),
    invoiceDate: text("invoice_date").notNull(),
    sellerName: text("seller_name"),
    amount: integer("amount").notNull(),
    rawPayload: text("raw_payload"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    /** 賣方統編；由 raw payload 推導的 virtual generated column（0056）。 */
    sellerBan: text("seller_ban").generatedAlwaysAs(
      sql`
    CASE
      WHEN json_valid(raw_payload)
        AND trim(COALESCE(
          json_extract(raw_payload, '$.invoice.sellerID'),
          json_extract(raw_payload, '$.invoice.sellerBan'),
          json_extract(raw_payload, '$.sellerID'),
          json_extract(raw_payload, '$.sellerBan'),
          json_extract(raw_payload, '$.detail.sellerBan'),
          ''
        )) GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
      THEN trim(COALESCE(
        json_extract(raw_payload, '$.invoice.sellerID'),
        json_extract(raw_payload, '$.invoice.sellerBan'),
        json_extract(raw_payload, '$.sellerID'),
        json_extract(raw_payload, '$.sellerBan'),
        json_extract(raw_payload, '$.detail.sellerBan')
      ))
    END
  `,
      { mode: "virtual" },
    ),
    carrierType: text("carrier_type"),
    carrierSuffix: text("carrier_suffix"),
    /** 發票幣別；由 raw payload `detail.currency` 推導，國內發票為 TWD（0066）。 */
    currency: text("currency").generatedAlwaysAs(
      sql`
    CASE
      WHEN json_valid(raw_payload)
        AND upper(trim(COALESCE(json_extract(raw_payload, '$.detail.currency'), ''))) GLOB '[A-Z][A-Z][A-Z]'
      THEN upper(trim(json_extract(raw_payload, '$.detail.currency')))
      ELSE 'TWD'
    END
  `,
      { mode: "virtual" },
    ),
    /** 明細的原幣發票總額（含小數）；由 raw payload `detail.amount` 推導（0066）。 */
    originalAmount: real("original_amount").generatedAlwaysAs(
      sql`
    CASE
      WHEN json_valid(raw_payload)
        AND trim(COALESCE(CAST(json_extract(raw_payload, '$.detail.amount') AS TEXT), '')) GLOB '*[0-9]*'
        AND trim(CAST(json_extract(raw_payload, '$.detail.amount') AS TEXT)) NOT GLOB '*[^0-9.-]*'
      THEN CAST(trim(CAST(json_extract(raw_payload, '$.detail.amount') AS TEXT)) AS REAL)
    END
  `,
      { mode: "virtual" },
    ),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    check(
      "invoices_check_1",
      sql`carrier_suffix IS NULL OR length(carrier_suffix) BETWEEN 1 AND 4`,
    ),
    index("idx_invoices_page").on(
      sql`invoice_date DESC`,
      sql`updated_at DESC`,
      sql`id DESC`,
    ),
    index("idx_invoices_invoice_date").on(table.invoiceDate),
    unique().on(table.connectorId, table.sourceId),
  ],
);

export const invoiceLineItems = sqliteTable(
  "invoice_line_items",
  {
    id: text("id").notNull(),
    invoiceId: text("invoice_id").notNull(),
    connectorId: text("connector_id").notNull(),
    invoiceSourceId: text("invoice_source_id").notNull(),
    sourceId: text("source_id").notNull(),
    lineNumber: integer("line_number").notNull(),
    description: text("description").notNull(),
    quantity: real("quantity"),
    unitPrice: integer("unit_price"),
    amount: integer("amount").notNull(),
    rawPayload: text("raw_payload"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index("idx_invoice_line_items_invoice_source").on(
      table.connectorId,
      table.invoiceSourceId,
    ),
    index("idx_invoice_line_items_invoice_id").on(table.invoiceId),
    unique().on(table.connectorId, table.invoiceSourceId, table.sourceId),
    foreignKey({
      columns: [table.invoiceId],
      foreignColumns: [invoices.id],
    }).onDelete("cascade"),
  ],
);

export const invoiceTransactionPreferences = sqliteTable(
  "invoice_transaction_preferences",
  {
    invoiceId: text("invoice_id").notNull(),
    transactionId: text("transaction_id"),
    decision: text("decision").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.invoiceId] }),
    foreignKey({
      columns: [table.invoiceId],
      foreignColumns: [invoices.id],
    }),
    foreignKey({
      columns: [table.transactionId],
      foreignColumns: [bankTransactions.id],
    }),
    index("idx_invoice_transaction_preferences_transaction").on(
      table.transactionId,
    ),
    uniqueIndex("idx_invoice_transaction_preferences_linked_transaction")
      .on(table.transactionId)
      .where(sql`decision = 'linked'`),
    check(
      "invoice_transaction_preferences_check_1",
      sql`decision IN ('linked', 'separate')`,
    ),
    check(
      "invoice_transaction_preferences_check_2",
      sql`
    (decision = 'linked' AND transaction_id IS NOT NULL)
    OR decision = 'separate'
  `,
    ),
  ],
);
