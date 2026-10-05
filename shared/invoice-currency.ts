/**
 * 外幣電子發票。跨境電商（境外電商）開立的發票以原幣計價：財政部明細帶有
 * `currency`（例如 USD），`invoices.amount` 與清單 API 的金額是截斷成整數的
 * 原幣金額（US$10.98 存成 10），不是新台幣。國內發票沒有幣別，視為 TWD。
 */

export const INVOICE_BASE_CURRENCY = "TWD";

/** 正規化發票幣別：三碼英文字母取大寫，其餘視為 TWD。 */
export function normalizeInvoiceCurrency(value?: string | null) {
  const code = value?.normalize("NFKC").trim().toUpperCase();
  return code && /^[A-Z]{3}$/u.test(code) ? code : INVOICE_BASE_CURRENCY;
}

/** 發票是否以外幣計價。 */
export function isForeignCurrencyInvoice(invoice: {
  currency?: string | null;
}) {
  return normalizeInvoiceCurrency(invoice.currency) !== INVOICE_BASE_CURRENCY;
}

const roundCents = (value: number) => Math.round(value * 100) / 100 || 0;

function parseAmount(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/,/gu, "");
  if (!/^-?\d+(?:\.\d+)?$/u.test(text)) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * 外幣發票的精確原幣金額。國內（TWD）發票直接回傳 `amount`。
 *
 * - 明細總額（`detail.amount`）有小數時採用它：它是發票總額，含品項外的稅額
 *   （例如品項 US$5、含稅總額 US$5.25）。
 * - 明細總額也是整數時，若品項金額加總有小數，且與整數金額一致（截斷後相同），
 *   改用品項加總（總額被截斷的情況）。
 * - 其餘依序採用明細總額、`amount`。
 */
export function preciseInvoiceAmount(input: {
  amount: number;
  currency?: string | null;
  /** 明細的發票總額（`detail.amount`）。 */
  detailAmount?: unknown;
  /** 明細品項金額加總（`detail.details[].amount`）。 */
  itemsAmount?: unknown;
}) {
  if (!isForeignCurrencyInvoice(input)) return input.amount;
  const detail = parseAmount(input.detailAmount);
  if (detail != null && !Number.isInteger(detail)) return roundCents(detail);
  const items = parseAmount(input.itemsAmount);
  const whole = detail ?? input.amount;
  if (
    items != null &&
    !Number.isInteger(roundCents(items)) &&
    Math.trunc(roundCents(items)) === Math.trunc(whole)
  )
    return roundCents(items);
  return detail != null ? roundCents(detail) : input.amount;
}

/**
 * 發票金額換算成新台幣（未四捨五入）。TWD 發票回傳原金額；外幣缺少有效匯率時
 * 回傳 undefined（呼叫端視為缺匯率，與 summary 的 missingCurrencies 一致）。
 */
export function invoiceAmountTwd(
  invoice: { amount: number; currency?: string | null },
  rates?: Readonly<Record<string, number>>,
) {
  const currency = normalizeInvoiceCurrency(invoice.currency);
  if (currency === INVOICE_BASE_CURRENCY || invoice.amount === 0)
    return invoice.amount;
  const rate = rates?.[currency];
  return rate != null && Number.isFinite(rate) && rate > 0
    ? invoice.amount * rate
    : undefined;
}
