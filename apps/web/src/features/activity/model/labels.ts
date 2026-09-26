import type { BankTransactionRow } from "@/data/bank/types";
import type { InvoiceSummaryRow } from "@/data/invoices/types";
import {
  formatCurrency,
  formatCurrencyPrecise,
} from "@/shared/format/financial";
import type { ActivityItem } from "./types";

/** 幣別不是台幣（跨境電商的外幣發票）。 */
export function isForeignCurrency(currency: string | null | undefined) {
  return Boolean(currency) && currency !== "TWD";
}

/**
 * 發票金額文字：台幣「NT$356」；外幣以原幣顯示並附台幣換算「US$10.98（≈NT$356）」，
 * 沒有換算值（缺匯率）時只顯示原幣。
 */
export function invoiceAmountText(
  amount: number,
  currency: string | null | undefined,
  amountTwd?: number | null,
) {
  if (!isForeignCurrency(currency)) return formatCurrency(amount);
  const original = formatCurrencyPrecise(amount, currency!);
  return amountTwd != null
    ? `${original}（≈${formatCurrency(Math.abs(amountTwd))}）`
    : original;
}

/**
 * 活動對應發票的台幣金額（外幣發票的換算值）：發票項目取 amountTwd，已配對發票的
 * 刷卡項目取 invoiceAmount（後端已換算）。沒有時為 undefined。
 */
export function activityInvoiceTwd(item: ActivityItem) {
  if (item.source === "invoice") return item.amountTwd ?? undefined;
  return item.invoiceCurrency ? item.invoiceAmount : undefined;
}

/** 活動來源標籤；已配對發票的銀行／信用卡活動加註「＋發票」。 */
export function activitySourceLabel(item: ActivityItem) {
  const label = {
    bank: "銀行",
    card: "信用卡",
    investment: "投資",
    invoice: "發票",
  }[item.source];
  return item.source !== "invoice" && item.invoiceId ? `${label}＋發票` : label;
}

/**
 * 已配對活動的發票總額與實付金額差（點數折抵）；缺任一金額時為 0。外幣發票的差額
 * 來自匯率，不是折抵，也為 0。
 */
export function activityInvoiceDifference(item: ActivityItem) {
  if (item.invoiceAmount == null || item.amount == null) return 0;
  if (isForeignCurrency(item.invoiceCurrency)) return 0;
  return Math.abs(item.invoiceAmount - Math.abs(item.amount));
}

/** 銀行／信用卡交易顯示用的商家名稱。 */
export function bankTransactionMerchant(transaction: BankTransactionRow) {
  // 對方帳戶（銀行＋末碼）不是商家名稱，改在明細另列。
  if (transaction.counterpartyBankCode)
    return transaction.description ?? transaction.counterparty ?? "銀行交易";
  return transaction.counterparty ?? transaction.description ?? "銀行交易";
}

/** 發票與候選交易的金額差；外幣發票（金額不是台幣）不比較，為 0。 */
export function invoiceTransactionDifference(
  invoice: InvoiceSummaryRow,
  transaction: BankTransactionRow,
) {
  if (isForeignCurrency(invoice.currency)) return 0;
  return Math.abs(invoice.amount - Math.abs(transaction.amount));
}

/**
 * 國外交易服務費的說明：「屬於 ○○ 的國外交易服務費」；○○ 為同卡的原消費（在已載入
 * 活動中找不到時省略名稱）。不是服務費時回傳 undefined。
 */
export function foreignFeeLabel(
  item: ActivityItem,
  items: readonly ActivityItem[],
) {
  if (!item.foreignFeeOf) return undefined;
  const parent = items.find(
    (candidate) =>
      candidate.source !== "invoice" &&
      (candidate.transactionId ?? candidate.id) === item.foreignFeeOf,
  );
  const name = parent ? parent.displayName?.trim() || parent.title : "";
  return name ? `屬於 ${name} 的國外交易服務費` : "國外交易服務費";
}
