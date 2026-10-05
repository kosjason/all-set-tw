import type {
  BankAccount,
  BankBalanceSnapshot,
  BankTransaction,
  ConnectorId,
  CreditCardBill,
  InvestmentTransaction,
  InvoiceLineItem,
  NetWorthHistoryPoint,
} from "@taiwan-fin-hub/shared";

export interface SyncResult<TResult> {
  records: TResult[];
  cursor?: string;
  invoiceLineItems?: Array<
    Omit<InvoiceLineItem, "id" | "connectorId" | "invoiceId">
  >;
  bankAccounts?: Array<Omit<BankAccount, "id" | "connectorId">>;
  bankBalanceSnapshots?: Array<Omit<BankBalanceSnapshot, "id" | "connectorId">>;
  bankTransactions?: Array<Omit<BankTransaction, "id" | "connectorId">>;
  creditCardBills?: Array<Omit<CreditCardBill, "id" | "connectorId">>;
  investmentTransactions?: Array<
    Omit<InvestmentTransaction, "id" | "connectorId">
  >;
  netWorthHistory?: NetWorthHistoryPoint[];
  /**
   * 同步成功但部分資料未取得時的使用者可讀說明（正體中文），例如來源暫時忙碌
   * 而略過的明細。有值時同步仍算成功，但會保留在同步工作狀態提示使用者。
   */
  warnings?: string[];
}

export interface Connector<TConfig, TResult> {
  id: ConnectorId;
  name: string;
  sync(config: TConfig, cursor?: string): Promise<SyncResult<TResult>>;
}
