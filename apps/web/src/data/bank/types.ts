import type {
  CategorySuggestionSource,
  ClassificationSource,
  ConnectorId,
  EconomicRole,
  EconomicRoleFields,
  MerchantPaymentMethod,
} from "@taiwan-fin-hub/core";

export interface BankAccountRow {
  id: string;
  connectorId: ConnectorId;
  sourceId: string;
  institutionName?: string;
  accountName?: string;
  accountType?: string;
  currency: string;
  bankCode?: string;
  accountLast4?: string;
  balance?: number | null;
  availableBalance?: number;
  paymentDueDate?: string;
  statementClosingDate?: string;
  asOfAt?: string;
  openedDate?: string;
  maturityDate?: string;
}

/** API 讀取時推導的經濟角色；見 docs/002「活動經濟角色與月收支 summary」。 */
export interface BankTransactionRow extends Partial<EconomicRoleFields> {
  id: string;
  connectorId: ConnectorId;
  accountId: string;
  accountSourceId?: string;
  accountName?: string;
  institutionName?: string;
  accountType?: string;
  bankCode?: string;
  accountLast4?: string;
  sourceId: string;
  postedDate?: string;
  authorizedAt?: string;
  amount: number;
  currency: string;
  description?: string;
  counterparty?: string;
  /** 對方金融機構代碼；只在可由來源辨識時提供。 */
  counterpartyBankCode?: string | null;
  /** 對方帳號末五碼；不含完整帳號。 */
  counterpartyAccountSuffix?: string | null;
  status: "pending" | "posted";
  /** 對方帳戶符合「我的其他帳戶」。 */
  ownAccount?: {
    id: string;
    kind: "own_account" | "unsynced_card";
    label: string;
  };
  excludedFromCalculation: boolean;
  classification?: {
    /** 新分類體系 id；`other` 為未分類。 */
    categoryId: string;
    label: string;
    source: ClassificationSource;
    ruleId?: string;
    excludedFromCalculation?: boolean;
    /** 規則指定的角色（投資、繳卡費、電支儲值）。 */
    economicRole?: EconomicRole;
    merchantEconomicRole?: EconomicRole;
    merchantKey?: string;
    transferHint?: boolean;
  };
  /** 商家 key（已配對發票者以發票為準）；見 docs/002「商家模型與消費分類」。 */
  merchantKey?: string;
  /** 使用者別名，否則為清理後的商家名稱。 */
  displayName?: string;
  merchantPaymentMethod?: MerchantPaymentMethod;
  /** 已配對發票的前 3 個品項名稱。 */
  itemsPreview?: string[];
  /** 最終分類（含已配對發票的分類與商家規則）；`other` 為未分類。 */
  categoryId?: string;
  suggestedCategoryId?: string;
  suggestionSource?: CategorySuggestionSource;
}

export interface CreditCardBillRow {
  id: string;
  connectorId: ConnectorId;
  accountId: string;
  accountSourceId?: string;
  sourceId: string;
  billingPeriod: string;
  statementAmount?: number;
  minimumPayment?: number;
  paidAmount?: number;
  isPaid?: number;
  paymentDueDate?: string;
  statementClosingDate?: string;
  currency: string;
}

export interface BankData {
  accounts: BankAccountRow[];
  transactions: BankTransactionRow[];
}
