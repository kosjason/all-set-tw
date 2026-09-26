/**
 * 發票與刷卡／銀行交易的去重狀態（讀取時推導）：
 * - matched_card：已與信用卡交易合併，金額以刷卡為準。
 * - matched_bank：已與存款帳戶交易（簽帳金融卡、轉帳、電支扣款）合併。
 * - awaiting_card：發票載具是已同步的信用卡，但該卡交易尚未出現；暫時計入
 *   消費，刷卡交易同步進來後自動合併。超過 {@link INVOICE_AWAITING_CARD_DAYS}
 *   天仍未出現則標示需要確認。
 * - unmatched：沒有對應交易（現金、未同步的付款方式，或使用者選擇分開記錄）。
 * - ambiguous：有多筆候選但分數差距不足，未自動合併，需要確認。
 */
export const INVOICE_MATCH_STATUSES = [
  "matched_card",
  "matched_bank",
  "awaiting_card",
  "unmatched",
  "ambiguous",
] as const;
export type InvoiceMatchStatus = (typeof INVOICE_MATCH_STATUSES)[number];

export interface InvoiceDedupeCounts {
  /** 已與刷卡或銀行交易合併、不另計金額的發票數。 */
  invoicesMerged: number;
  /** 沒有對應交易、單獨計為消費的發票數。 */
  invoicesUnmatched: number;
  /** 信用卡載具、等待刷卡交易的發票數（暫時計入消費）。 */
  invoicesAwaitingCard: number;
  /** 候選不唯一、需要確認的發票數。 */
  invoicesAmbiguous: number;
}

export function emptyInvoiceDedupeCounts(): InvoiceDedupeCounts {
  return {
    invoicesMerged: 0,
    invoicesUnmatched: 0,
    invoicesAwaitingCard: 0,
    invoicesAmbiguous: 0,
  };
}

export function addInvoiceDedupeCount(
  counts: InvoiceDedupeCounts,
  status: InvoiceMatchStatus,
) {
  switch (status) {
    case "matched_card":
    case "matched_bank":
      counts.invoicesMerged += 1;
      break;
    case "awaiting_card":
      counts.invoicesAwaitingCard += 1;
      break;
    case "ambiguous":
      counts.invoicesAmbiguous += 1;
      break;
    case "unmatched":
      counts.invoicesUnmatched += 1;
      break;
  }
}
