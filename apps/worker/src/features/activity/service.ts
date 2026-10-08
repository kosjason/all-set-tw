import { MANUAL_LINK_DAY_WINDOW } from "@taiwan-fin-hub/shared";
import {
  findLinkedInvoiceId,
  findMappingInvoice,
  findMappingTransaction,
  upsertInvoiceTransactionPreference,
} from "./repository";

export class MappingInvoiceNotFoundError extends Error {}
export class MappingTransactionNotFoundError extends Error {}
export class MappingTransactionUnavailableError extends Error {}
export class MappingDateMismatchError extends Error {}
export class MappingTransactionNotExpenseError extends Error {}

const taipeiDayFormatter = new Intl.DateTimeFormat("en", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function dayIndex(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return Date.UTC(year, month - 1, date) / 86_400_000;
}

function financialDay(value?: string | null) {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()))
    return value.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  const parts = Object.fromEntries(
    taipeiDayFormatter
      .formatToParts(parsed)
      .map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export async function linkInvoiceToTransaction(
  db: D1Database,
  invoiceId: string,
  transactionId: string,
) {
  const [invoice, transaction] = await Promise.all([
    findMappingInvoice(db, invoiceId),
    findMappingTransaction(db, transactionId),
  ]);
  if (!invoice) throw new MappingInvoiceNotFoundError();
  if (!transaction) throw new MappingTransactionNotFoundError();

  const invoiceDay = financialDay(invoice.invoiceDate);
  const transactionDay = financialDay(
    transaction.authorizedAt ?? transaction.postedDate?.slice(0, 10),
  );
  // 發票可能晚開（例如月費刷卡後幾天才開立），前後 MANUAL_LINK_DAY_WINDOW 天內都可連結。
  if (
    !invoiceDay ||
    !transactionDay ||
    Math.abs(dayIndex(invoiceDay) - dayIndex(transactionDay)) >
      MANUAL_LINK_DAY_WINDOW
  )
    throw new MappingDateMismatchError();

  const isExpense =
    transaction.currency === "TWD" &&
    transaction.amount !== 0 &&
    (transaction.accountType === "credit" || transaction.amount < 0);
  if (!isExpense) throw new MappingTransactionNotExpenseError();

  const linkedInvoiceId = await findLinkedInvoiceId(db, transactionId);
  if (linkedInvoiceId && linkedInvoiceId !== invoiceId)
    throw new MappingTransactionUnavailableError();

  const now = new Date().toISOString();
  await upsertInvoiceTransactionPreference(db, {
    invoiceId,
    transactionId,
    decision: "linked",
    now,
  });
  return {
    invoiceId,
    transactionId,
    decision: "linked" as const,
    updatedAt: now,
  };
}

export async function keepInvoiceSeparate(db: D1Database, invoiceId: string) {
  if (!(await findMappingInvoice(db, invoiceId)))
    throw new MappingInvoiceNotFoundError();

  const now = new Date().toISOString();
  await upsertInvoiceTransactionPreference(db, {
    invoiceId,
    transactionId: null,
    decision: "separate",
    now,
  });
  return {
    invoiceId,
    transactionId: null,
    decision: "separate" as const,
    updatedAt: now,
  };
}
