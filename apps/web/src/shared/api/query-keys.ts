export const queryKeys = {
  runtime: ["runtime"] as const,
  summary: ["summary"] as const,
  bank: ["bank"] as const,
  bankRange: (from: string, to: string) => ["bank", "range", from, to] as const,
  bills: ["creditCardBills"] as const,
  billsRange: (from: string, to: string) =>
    ["creditCardBills", "range", from, to] as const,
  // 卡片與收件匣由交易推導，key 以 "bank" 開頭，交易、分類或同步變動時一起失效。
  cardsSummary: ["bank", "cards", "summary"] as const,
  cardBills: (issuer: string) => ["bank", "cards", "bills", issuer] as const,
  inbox: ["bank", "inbox"] as const,
  investments: ["investments"] as const,
  investmentTransactions: ["investment-transactions"] as const,
  investmentTransactionsRange: (from: string, to: string) =>
    ["investment-transactions", "range", from, to] as const,
  invoices: ["invoices"] as const,
  invoicesRange: (from: string, to: string) =>
    ["invoices", "range", from, to] as const,
  invoiceDetail: (invoiceId: string) =>
    ["invoices", "detail", invoiceId] as const,
  invoiceTransactionMappings: ["invoice-transaction-mappings"] as const,
  manualAssets: ["manualAssets"] as const,
  exchangeRates: ["exchange-rates"] as const,
  netWorthHistory: ["netWorthHistory"] as const,
  syncJobs: ["sync-jobs"] as const,
  latestSyncReport: ["sync-reports", "latest"] as const,
  syncReportActivities: (batchId: string) =>
    ["sync-reports", batchId, "activities"] as const,
  syncSchedule: ["sync-schedule"] as const,
  notifications: ["notifications"] as const,
  classificationCategories: ["classification-categories"] as const,
  classificationRules: ["classification-rules"] as const,
  ownAccounts: ["own-accounts"] as const,
  connectorSettings: (id: string) => ["connector-settings", id] as const,
  manualAssetHistory: (id: string) => ["manualAssetHistory", id] as const,
};
