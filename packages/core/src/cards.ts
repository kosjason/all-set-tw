/**
 * 信用卡頁 API 契約（`GET /api/cards/summary`、`GET /api/cards/:issuer/bills`）。
 * 金額皆為正數（應繳、已繳、未出帳消費），幣別見各欄位。
 */

/**
 * 帳單繳款狀態：
 * - paid：已繳清（或本期不需繳款）。
 * - partial：已繳部分金額，但未達應繳總額。
 * - unpaid：看得到應繳金額，結帳日之後沒有任何繳款。
 * - unknown：應繳金額不明且來源沒有提供已繳旗標，無法判斷。
 */
export const CARD_PAYMENT_STATUSES = [
  "paid",
  "partial",
  "unpaid",
  "unknown",
] as const;
export type CardPaymentStatus = (typeof CARD_PAYMENT_STATUSES)[number];

/**
 * 資料為推估的原因：
 * - manual_import：來源為半自動匯入（例如中信網銀），更新時間取決於使用者上次匯入。
 * - statement_from_transactions：來源沒有帳單總額，以兩次結帳日之間的刷卡明細加總推估。
 * - closing_date_unknown：不知道結帳日，未出帳以本月（台北時間）起算。
 */
export const CARD_ESTIMATED_REASONS = [
  "manual_import",
  "statement_from_transactions",
  "closing_date_unknown",
] as const;
export type CardEstimatedReason = (typeof CARD_ESTIMATED_REASONS)[number];

/** 與帳單配對的繳款：存款端扣款（bank）或信用卡端繳款入帳（card）。 */
export interface CardBillPayment {
  transactionId: string;
  /** YYYY-MM-DD（台北日期）。 */
  date: string;
  amount: number;
  side: "bank" | "card";
  description: string | null;
}

export interface CardBill {
  /** YYYY-MM。 */
  billingPeriod: string;
  currency: string;
  /** 本期應繳總額；來源未提供且無法推估時為 null。 */
  statementBalance: number | null;
  /** statementBalance 是否由刷卡明細推估。 */
  statementEstimated: boolean;
  minimumPayment: number | null;
  paymentDueDate: string | null;
  statementClosingDate: string | null;
  /**
   * 已繳金額：來源提供的已繳金額與結帳日之後配對到的繳款取較大者。
   * 存款端扣款與卡片端入帳是同一筆錢，兩邊分別加總後取較大者，不相加。
   */
  paidAmount: number;
  /** 尚未繳的金額；應繳金額不明時為 null。 */
  remainingAmount: number | null;
  paymentStatus: CardPaymentStatus;
  /** 已繳是否達最低應繳；最低應繳不明時為 null。 */
  minimumPaid: boolean | null;
  payments: CardBillPayment[];
}

export interface CurrentCardBill extends CardBill {
  /** 距截止日天數（台北日期；當天為 0，逾期為負數）；截止日不明時為 null。 */
  daysUntilDue: number | null;
}

/** 交易頁的篩選條件；前端依交易頁 hash query 格式組成連結。 */
export interface CardActivityFilter {
  /** 交易頁搜尋字（帳戶名稱）。 */
  q: string;
  source: "card";
  /** 未出帳起日（YYYY-MM-DD，含）；不知道結帳日時為本月 1 日。 */
  from: string;
}

export interface CardUnbilledSummary {
  /** 未出帳起日（上期結帳日隔天，YYYY-MM-DD）。 */
  since: string;
  /** 未出帳消費淨額（TWD，含待入帳；退款沖減）。 */
  amount: number;
  /** 其中仍為待入帳（pending）的金額。 */
  pendingAmount: number;
  transactionCount: number;
  /** 缺匯率而未計入的外幣。 */
  missingCurrencies: string[];
}

export interface CardSummaryCard {
  /** 穩定 key：帳戶 id 加末四碼。 */
  key: string;
  accountId: string;
  last4: string | null;
  name: string;
  unbilledAmount: number;
  pendingAmount: number;
  transactionCount: number;
  /**
   * 只有一張卡對應一個帳戶時可以精準篩到該卡；多張卡共用帳戶（台新、中信）
   * 時交易頁只能篩到整個發卡行帳戶。
   */
  activityFilter: CardActivityFilter;
  activityFilterExact: boolean;
}

export interface CardDataSource {
  connectorId: string;
  name: string;
  mode: "sync" | "manual_import";
  lastSuccessAt: string | null;
  lastStatus: string | null;
}

export interface CardIssuerSummary {
  /** 發卡行代號，等同資料來源 connectorId（例如 cathaybk）。 */
  issuer: string;
  name: string;
  bankCode: string | null;
  /** 多張卡共用同一張帳單（例如國泰）。 */
  combinedStatement: boolean;
  currentBill: CurrentCardBill | null;
  unbilled: CardUnbilledSummary;
  cards: CardSummaryCard[];
  source: CardDataSource;
  /** 此發卡行資料最後更新時間（同步成功、餘額快照或帳單更新的最新者）。 */
  lastUpdatedAt: string | null;
  estimated: boolean;
  estimatedReasons: CardEstimatedReason[];
}

export interface CardsSummaryResponse {
  /** 計算基準日（台北日期）。 */
  asOf: string;
  currency: "TWD";
  totals: {
    /** 各發卡行本期應繳總額加總（TWD，不明者不計）。 */
    statementBalance: number;
    /** 各發卡行尚未繳金額加總。 */
    remainingAmount: number;
    unbilledAmount: number;
  };
  /** 最近一個尚未繳清的截止日；沒有時為 null。 */
  nextDue: {
    issuer: string;
    name: string;
    paymentDueDate: string;
    daysUntilDue: number;
    remainingAmount: number | null;
    paymentStatus: CardPaymentStatus;
  } | null;
  issuers: CardIssuerSummary[];
}

export interface CardBillsResponse {
  issuer: string;
  name: string;
  estimated: boolean;
  estimatedReasons: CardEstimatedReason[];
  /** 新到舊，最多 12 期。 */
  bills: CardBill[];
}
