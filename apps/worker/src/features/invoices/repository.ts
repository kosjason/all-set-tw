import type { ConnectorId } from "@taiwan-fin-hub/core";
import { createDrizzle, invoiceLineItems, invoices } from "@taiwan-fin-hub/db";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { MonthDateRange } from "../../platform/month-range";

// Taipei calendar day for precise timestamps; date-only TEXT stays unchanged.
const invoiceDay = sql`CASE WHEN length(${invoices.invoiceDate}) > 10
  THEN COALESCE(date(${invoices.invoiceDate}, '+8 hours'), substr(${invoices.invoiceDate}, 1, 10))
  ELSE ${invoices.invoiceDate} END`;

const invoiceSummaryColumns = {
  id: invoices.id,
  connectorId: sql<ConnectorId>`${invoices.connectorId}`,
  sourceId: invoices.sourceId,
  invoiceNumber: invoices.invoiceNumber,
  invoiceDate: invoices.invoiceDate,
  sellerName: invoices.sellerName,
  sellerBan: invoices.sellerBan,
  amount: invoices.amount,
  carrierType: invoices.carrierType,
  carrierSuffix: invoices.carrierSuffix,
  // 外幣發票（跨境電商）：幣別與明細原幣總額由 raw payload 推導（0066）；
  // 品項金額加總供明細總額也被截斷時使用（見 core preciseInvoiceAmount）。
  currency: invoices.currency,
  originalAmount: invoices.originalAmount,
  itemsAmount: sql<number | null>`CASE WHEN json_valid(${invoices.rawPayload})
    THEN (SELECT sum(CAST(json_extract(detail.value, '$.amount') AS REAL))
      FROM json_each(${invoices.rawPayload}, '$.detail.details') AS detail
      WHERE trim(CAST(json_extract(detail.value, '$.amount') AS TEXT)) GLOB '*[0-9]*'
        AND trim(CAST(json_extract(detail.value, '$.amount') AS TEXT)) NOT GLOB '*[^0-9.-]*') END`,
  // 品項描述（明細順序），判斷同一筆消費重複開立的發票；取自 raw payload，
  // 摘要查詢不讀 invoice_line_items。
  itemDescriptions: sql<
    string | null
  >`CASE WHEN json_valid(${invoices.rawPayload})
    THEN (SELECT group_concat(item.description, char(31))
      FROM (SELECT trim(CAST(json_extract(detail.value, '$.description') AS TEXT)) AS description
        FROM json_each(${invoices.rawPayload}, '$.detail.details') AS detail
        ORDER BY detail.key) AS item) END`,
  // 財政部發票狀態（開立、作廢、註銷…），來自明細 raw；作廢的發票不計入。
  invoiceStatus: sql<string | null>`CASE WHEN json_valid(${invoices.rawPayload})
    THEN NULLIF(trim(CAST(COALESCE(
      json_extract(${invoices.rawPayload}, '$.detail.invStatus'),
      json_extract(${invoices.rawPayload}, '$.invStatus'),
      json_extract(${invoices.rawPayload}, '$.invoice.invStatus')
    ) AS TEXT)), '') END`,
};

export type InvoicePageCursor = {
  invoiceDate: string;
  updatedAt: string;
  id: string;
};

export type InvoiceRow = {
  id: string;
  connectorId: ConnectorId;
  sourceId: string;
  invoiceNumber: string | null;
  invoiceDate: string;
  sellerName: string | null;
  sellerBan: string | null;
  amount: number;
  carrierType: string | null;
  carrierSuffix: string | null;
  currency: string | null;
  originalAmount: number | null;
  itemsAmount: number | null;
  itemDescriptions: string | null;
  invoiceStatus: string | null;
  updatedAt: string;
};

export type InvoiceItemRow = {
  id: string;
  invoiceId: string;
  sourceId: string;
  lineNumber: number;
  description: string;
  quantity: number | null;
  unitPrice: number | null;
  amount: number;
};

export async function listInvoices(
  db: D1Database,
  limit: number,
  cursor?: InvoicePageCursor,
) {
  return createDrizzle(db)
    .select({
      ...invoiceSummaryColumns,
      updatedAt: invoices.updatedAt,
    })
    .from(invoices)
    .where(
      cursor
        ? sql`(${invoices.invoiceDate}, ${invoices.updatedAt}, ${invoices.id}) < (${cursor.invoiceDate}, ${cursor.updatedAt}, ${cursor.id})`
        : undefined,
    )
    .orderBy(
      desc(invoices.invoiceDate),
      desc(invoices.updatedAt),
      desc(invoices.id),
    )
    .limit(limit)
    .all();
}

export async function listInvoicesInRange(
  db: D1Database,
  range: MonthDateRange,
  days?: string[],
) {
  return createDrizzle(db)
    .select({
      ...invoiceSummaryColumns,
      updatedAt: invoices.updatedAt,
    })
    .from(invoices)
    .where(
      days
        ? sql`(${invoiceDay}) IN (SELECT value FROM json_each(${JSON.stringify(days)}))`
        : and(
            sql`(${invoiceDay}) >= ${range.from}`,
            sql`(${invoiceDay}) < ${range.to}`,
          ),
    )
    .orderBy(
      desc(invoices.invoiceDate),
      desc(invoices.updatedAt),
      desc(invoices.id),
    )
    .all();
}

export async function listInvoiceItems(db: D1Database, invoiceIds: string[]) {
  if (invoiceIds.length === 0) return [];
  return createDrizzle(db)
    .select({
      id: invoiceLineItems.id,
      invoiceId: invoiceLineItems.invoiceId,
      sourceId: invoiceLineItems.sourceId,
      lineNumber: invoiceLineItems.lineNumber,
      description: invoiceLineItems.description,
      quantity: invoiceLineItems.quantity,
      unitPrice: invoiceLineItems.unitPrice,
      amount: invoiceLineItems.amount,
    })
    .from(invoiceLineItems)
    .where(
      sql`${invoiceLineItems.invoiceId} IN (SELECT value FROM json_each(${JSON.stringify(invoiceIds)}))`,
    )
    .orderBy(
      asc(invoiceLineItems.invoiceId),
      asc(invoiceLineItems.lineNumber),
      asc(invoiceLineItems.sourceId),
    )
    .all();
}

export async function findInvoice(db: D1Database, invoiceId: string) {
  return (
    (await createDrizzle(db)
      .select(invoiceSummaryColumns)
      .from(invoices)
      .where(eq(invoices.id, invoiceId))
      .limit(1)
      .get()) ?? null
  );
}
