import type { CounterpartyAccount } from "./taiwan-banks";

export interface NetWorthHistoryPoint {
  date: string; // YYYY-MM-DD
  netWorth: number;
  assetType?: "total" | "stock" | "fund";
}

export interface CreditCardBill {
  id: string;
  connectorId: string;
  accountId: string;
  sourceId: string;
  billingPeriod: string; // "2026-05"
  statementAmount?: number;
  minimumPayment?: number;
  paidAmount?: number;
  isPaid?: boolean;
  paymentDueDate?: string;
  statementClosingDate?: string;
  currency: string;
  raw?: unknown;
}

export interface Invoice {
  id: string;
  connectorId: string;
  sourceId: string;
  invoiceNumber?: string;
  /** YYYY-MM-DD when time is unknown; otherwise an ISO timestamp with timezone. */
  invoiceDate: string;
  sellerName?: string;
  amount: number;
  /** 財政部載具類別（表頭 cardType），例如 3J0002；歸戶載具為其實際類別。 */
  carrierType?: string;
  /** 載具隱碼（表頭 cardNo）末 4 碼；不保存完整隱碼。 */
  carrierSuffix?: string;
  raw?: unknown;
}

export interface InvoiceLineItem {
  id: string;
  connectorId: string;
  invoiceId: string;
  invoiceSourceId: string;
  sourceId: string;
  lineNumber: number;
  description: string;
  quantity?: number;
  unitPrice?: number;
  amount: number;
  raw?: unknown;
}

export type AssetType = "stock" | "etf" | "fund";

export interface InvestmentPosition {
  id: string;
  connectorId: string;
  sourceId: string;
  assetType: AssetType;
  symbol?: string;
  name: string;
  quantity?: number;
  marketValue?: number;
  cashBalance?: number;
  currency: string;
  asOfDate: string;
  /** 券商或分公司代碼；同一標的分屬不同券商帳戶時用來區分持倉。 */
  brokerNo?: string;
  /** 券商或分公司名稱，例如「國泰敦南」。 */
  brokerName?: string;
  raw?: unknown;
}

export interface InvestmentTransaction {
  id: string;
  connectorId: string;
  accountId: string;
  sourceId: string;
  brokerNo?: string;
  brokerAccount?: string;
  brokerName?: string;
  symbol?: string;
  name?: string;
  assetType?: AssetType | "bond" | "unknown";
  tradeDate?: string;
  postedDate?: string;
  transactionCode?: string;
  transactionName?: string;
  quantity?: number;
  price?: number;
  amount?: number;
  currency: string;
  raw?: unknown;
}

export type BankAccountType =
  | "checking"
  | "savings"
  | "credit"
  | "loan"
  | "settlement_cash"
  | "time_deposit"
  | "stored_value"
  | "unknown";

export interface BankAccount {
  id: string;
  connectorId: string;
  sourceId: string;
  institutionName?: string;
  accountName?: string;
  accountType?: BankAccountType;
  currency: string;
  openedDate?: string;
  maturityDate?: string;
  inactiveAt?: string;
  creditLimit?: number;
  raw?: unknown;
}

export interface BankBalanceSnapshot {
  id: string;
  connectorId: string;
  accountId: string;
  sourceId: string;
  balance: number;
  availableBalance?: number;
  statementBalance?: number;
  paymentDueDate?: string;
  statementClosingDate?: string;
  noPaymentNeeded?: boolean;
  currency: string;
  asOfAt: string;
  raw?: unknown;
}

export type BankTransactionStatus = "pending" | "posted";

export interface BankTransaction {
  transferPeer?: { accountId: string; sourceId: string };
  id: string;
  connectorId: string;
  accountId: string;
  sourceId: string;
  postedDate?: string;
  /** Transaction/authorization date, with a timezone only when source time is known. */
  authorizedAt?: string;
  amount: number;
  currency: string;
  description?: string;
  counterparty?: string;
  /** 可辨識時的對方金融機構代碼與帳號末五碼；不得包含完整帳號。 */
  counterpartyAccount?: CounterpartyAccount;
  status?: BankTransactionStatus;
  raw?: unknown;
}
