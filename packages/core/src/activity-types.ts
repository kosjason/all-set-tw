import type { CategorySuggestionSource } from "./category-suggestions";
import type { ActivityRef, EconomicRoleFields } from "./economic-role";
import type { InvoiceMatchStatus } from "./invoice-match-status";
import type { MerchantPaymentMethod } from "./merchant";

/**
 * 分類來源：個別覆寫 → 商家規則 → 使用者規則 → 系統規則；已配對的交易可沿用
 * 發票的分類（invoice）。其餘為讀取時的系統判斷。
 */
export type ClassificationSource =
  | "override"
  | "merchant_rule"
  | "user_rule"
  | "system_rule"
  | "invoice"
  | "auto_transfer"
  | "auto_offset"
  | "own_account"
  | "unsynced_card"
  | "fallback";

export const CATEGORY_SOURCES = [
  "user",
  "merchant_rule",
  "rule",
  "auto_suggestion",
  "none",
] as const;
export type CategorySource = (typeof CATEGORY_SOURCES)[number];

export interface ActivityItem {
  id: string;
  source: "bank" | "card" | "investment" | "invoice";
  date: string;
  /** Only true when the selected source value contains a reliable timestamp. */
  dateHasTime?: boolean;
  title: string;
  subtitle: string;
  searchText?: string;
  institutionName?: string;
  accountName?: string;
  /** 原幣金額（currency）；外幣發票為含小數的原幣金額。 */
  amount?: number;
  currency: string;
  /**
   * 依系統匯率換算的新台幣金額（正負與 amount 相同，四捨五入到分）；TWD 項目等於
   * amount。缺匯率為 null（summary 標示 missing_exchange_rates）；未載入匯率的
   * 呼叫端不提供。
   */
  amountTwd?: number | null;
  /** 分類顯示名稱；非消費的活動為角色說明（如「轉帳」「繳卡費」）。 */
  category: string;
  /**
   * 新分類體系的 id（見 categories.ts）；`other` 代表未分類。
   * 非消費活動（轉帳、繳卡費、投資）沒有消費分類，為 `other` 或未提供。
   */
  categoryId?: string;
  /** 商家規則的 key（`ban:<統編>` 或 `name:<正規化名稱>`）；已配對的交易以發票為準。 */
  merchantKey?: string;
  /** 商家顯示名稱：使用者別名，否則為清理後的名稱。 */
  displayName?: string;
  /** 清理後的商家預設名稱（不含使用者別名）。 */
  merchantName?: string;
  merchantPaymentMethod?: MerchantPaymentMethod;
  /** 發票（或已配對發票）前 3 個品項名稱，已去除數量與單位。 */
  itemsPreview?: string[];
  /**
   * 分類建議（merchant_history、merchant_keywords、item_keywords）。這三種來源的建議
   * 會直接套用成 categoryId（categorySource = auto_suggestion），此時兩者相同。
   */
  suggestedCategoryId?: string;
  suggestionSource?: CategorySuggestionSource;
  /**
   * categoryId 的來源：user（個別覆寫）→ merchant_rule（商家規則）→ rule（使用者或
   * 系統規則）→ auto_suggestion（自動套用的分類建議，前端標「自動」）→ none（未分類）。
   */
  categorySource?: CategorySource;
  /**
   * 使用者備註（最多 1000 字）。已配對的交易與發票共用：自身沒有備註時沿用另一方。
   * 沒有備註為 null。
   */
  note?: string | null;
  /** note 實際存放的活動；沒有備註為 null。編輯時仍以活動自身為目標。 */
  noteTarget?: ActivityRef | null;
  /** 可辨識的轉帳對方帳戶（已遮罩），含方向箭頭。 */
  counterpartyAccount?: string;
  /** 對方帳戶符合「我的其他帳戶」；own_account 不計收支，unsynced_card 仍計入。 */
  ownAccountTransfer?: {
    kind: "own_account" | "unsynced_card";
    label: string;
    marker: string;
  };
  classificationPattern?: string;
  classificationSource?: ClassificationSource;
  classificationRuleId?: string;
  transactionId?: string;
  excludedFromCalculation?: boolean;
  invoiceId?: string;
  /**
   * 發票金額。發票項目為原幣（同 amount）；刷卡／銀行項目為已配對發票的台幣
   * 金額（外幣發票為換算值，缺匯率時省略）。
   */
  invoiceAmount?: number;
  /** 刷卡／銀行項目已配對外幣發票時：發票幣別（例如 USD）。 */
  invoiceCurrency?: string;
  /** 刷卡／銀行項目已配對外幣發票時：發票原幣金額（例如 10.98）。 */
  invoiceOriginalAmount?: number;
  /**
   * 國外交易服務費所屬的原消費交易 id（同卡、相近日期、金額相符）；費用列沿用
   * 該消費的分類。不是費用或找不到原消費時省略。
   */
  foreignFeeOf?: string;
  status: string;
  /** 經濟角色（讀取時推導並套用使用者 override）；舊的前端自建項目可能沒有。 */
  economicRole?: EconomicRoleFields["economicRole"];
  reviewStatus?: EconomicRoleFields["reviewStatus"];
  duplicateOf?: EconomicRoleFields["duplicateOf"];
  investmentEventKind?: EconomicRoleFields["investmentEventKind"];
  roleReason?: EconomicRoleFields["roleReason"];
  /** 發票的去重狀態；只有伺服器推導的發票項目才有。 */
  matchStatus?: InvoiceMatchStatus;
  /** 發票已合併的交易 id；未合併為 null。 */
  matchedTransactionId?: string | null;
  /** 配對分數 0–1（手動連結為 1）；未配對為 null。 */
  matchScore?: number | null;
  /** 刷卡／銀行交易已合併的發票 id；沒有為 null。 */
  matchedInvoiceId?: string | null;
}

/**
 * 「銀行／信用卡／發票」分頁的單筆紀錄：活動項目加上發票載具資訊。
 * 發票的 carrierCardSuffix 表示載具對應到的已同步信用卡末四碼。
 */
export interface ActivitySourceRecord extends ActivityItem {
  carrierType?: string | null;
  carrierSuffix?: string | null;
  carrierCardSuffix?: string | null;
  /** awaiting_card 已超過等待天數（需要確認）。 */
  awaitingOverdue?: boolean;
}
