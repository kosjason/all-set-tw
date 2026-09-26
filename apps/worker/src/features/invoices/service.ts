import {
  findInvoice,
  listInvoiceItems,
  listInvoices,
  listInvoicesInRange,
  type InvoicePageCursor,
  type InvoiceRow,
} from "./repository";
import type { MonthDateRange } from "../../platform/month-range";
import {
  normalizeInvoiceCurrency,
  preciseInvoiceAmount,
} from "@taiwan-fin-hub/core";

/** 品項描述的正規化簽章：去除空白差異、不分大小寫，依行號串接。 */
function invoiceItemsKey(descriptions: string | null) {
  if (!descriptions) return undefined;
  const key = descriptions
    .split("\u001f")
    .map((description) =>
      description.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim(),
    )
    .filter(Boolean)
    .join("\u001f");
  return key || undefined;
}

export class InvoiceNotFoundError extends Error {}

export async function getInvoicePage(
  db: D1Database,
  limit: number,
  cursor?: InvoicePageCursor,
) {
  const rows = await listInvoices(db, limit + 1, cursor);
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  return {
    hasMore,
    last: page.at(-1),
    invoices: page.map(presentInvoiceSummary),
  };
}

export async function getInvoicesRange(
  db: D1Database,
  range: MonthDateRange,
  days?: string[],
) {
  const rows = await listInvoicesInRange(db, range, days);
  return rows.map(presentInvoiceSummary);
}

export async function getInvoiceDetail(db: D1Database, invoiceId: string) {
  const invoice = await findInvoice(db, invoiceId);
  if (!invoice) throw new InvoiceNotFoundError();
  const items = await listInvoiceItems(db, [invoiceId]);
  return presentInvoice(
    invoice,
    items.map(({ invoiceId: _invoiceId, ...item }) => item),
  );
}

function presentInvoice<T extends Omit<InvoiceRow, "updatedAt"> | InvoiceRow>(
  invoice: T,
  items: unknown[],
) {
  return {
    ...presentInvoiceSummary(invoice),
    items,
  };
}

function presentInvoiceSummary<
  T extends Omit<InvoiceRow, "updatedAt"> | InvoiceRow,
>(invoice: T) {
  const {
    updatedAt: _updatedAt,
    originalAmount,
    itemsAmount,
    itemDescriptions,
    ...presented
  } = invoice as InvoiceRow;
  const currency = normalizeInvoiceCurrency(invoice.currency);
  return {
    ...presented,
    // 外幣發票：amount 為含小數的原幣金額，currency 為幣別（國內發票為 TWD）。
    currency,
    amount: preciseInvoiceAmount({
      amount: invoice.amount,
      currency,
      detailAmount: originalAmount,
      itemsAmount,
    }),
    itemsKey: invoiceItemsKey(itemDescriptions),
    invoiceNumber: invoice.invoiceNumber ?? undefined,
    sellerName: invoice.sellerName ?? undefined,
    carrierType: invoice.carrierType ?? undefined,
    carrierSuffix: invoice.carrierSuffix ?? undefined,
    sellerBan: invoice.sellerBan ?? undefined,
    invoiceStatus: invoice.invoiceStatus ?? undefined,
  };
}
