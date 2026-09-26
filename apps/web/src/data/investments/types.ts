import type { ConnectorId } from "@taiwan-fin-hub/core";

export interface InvestmentRow {
  id: string;
  assetType: "stock" | "etf" | "fund";
  symbol?: string;
  name: string;
  quantity?: number;
  marketValue?: number;
  cashBalance?: number;
  currency: string;
  asOfDate: string;
  /** 券商代碼；同一標的分屬不同券商帳戶時用來區分。 */
  brokerNo?: string | null;
  brokerName?: string | null;
}

export interface InvestmentTransactionRow {
  id: string;
  connectorId: ConnectorId;
  accountId: string;
  sourceId: string;
  brokerNo?: string;
  brokerAccount?: string;
  brokerName?: string;
  symbol?: string;
  name?: string;
  assetType?: "stock" | "etf" | "fund" | "bond" | "unknown";
  tradeDate?: string;
  postedDate?: string;
  transactionCode?: string;
  transactionName?: string;
  quantity?: number;
  price?: number;
  amount?: number;
  currency: string;
}
