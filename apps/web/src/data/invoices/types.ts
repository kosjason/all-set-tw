import type { ConnectorId } from "@taiwan-fin-hub/core";

export interface InvoiceLineItemRow {
  id: string;
  invoiceId?: string;
  sourceId: string;
  lineNumber: number;
  description: string;
  quantity?: number;
  unitPrice?: number;
  amount: number;
}

export interface InvoiceSummaryRow {
  id: string;
  connectorId: ConnectorId;
  sourceId: string;
  invoiceDate: string;
  invoiceNumber?: string;
  sellerName?: string;
  /** 賣方統編（可由電子發票資料辨識時）。 */
  sellerBan?: string;
  /** 發票金額（原幣）；外幣發票（跨境電商）為含小數的原幣金額，例如 10.98。 */
  amount: number;
  /** 發票幣別；國內發票為 TWD，跨境電商可能是 USD 等外幣。 */
  currency?: string;
  /** 財政部載具類別，例如 3J0002（手機條碼）；歸戶載具為其實際類別。 */
  carrierType?: string;
  /** 載具隱碼末 4 碼。 */
  carrierSuffix?: string;
}

export interface InvoiceRow extends InvoiceSummaryRow {
  items: InvoiceLineItemRow[];
}

export interface InvoiceTransactionPreference {
  invoiceId: string;
  transactionId: string | null;
  decision: "linked" | "separate";
  updatedAt: string;
}
