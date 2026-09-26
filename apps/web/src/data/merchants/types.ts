import type { EconomicRole, MerchantPaymentMethod } from "@taiwan-fin-hub/core";

/** `GET /api/merchants` 的一筆商家。 */
export interface MerchantSummaryRow {
  /** `ban:<統編>` 或 `name:<正規化名稱>`。 */
  merchantKey: string;
  /** 使用者別名，否則為清理後的名稱。 */
  displayName: string;
  /** 清理後的預設名稱（不含別名）；近期沒有活動時為 null。 */
  defaultName: string | null;
  /** 近 N 個月（預設 3）計入的活動筆數，不含重複。 */
  activityCount: number;
  /** 近 N 個月 TWD 消費淨額。 */
  spending: number;
  topCategoryId: string | null;
  paymentMethods: MerchantPaymentMethod[];
  alias: MerchantAlias | null;
}

export interface MerchantAlias {
  displayName: string | null;
  /** 商家規則的分類（回溯套用到該商家所有活動）。 */
  categoryId: string | null;
  /** 商家規則的角色（回溯套用）。 */
  economicRole: EconomicRole | null;
  updatedAt: string;
}

/** `PUT /api/merchants/:merchantKey` body；省略的欄位保留原值，null 清除。 */
export interface MerchantUpdateRequest {
  displayName?: string | null;
  categoryId?: string | null;
  economicRole?: EconomicRole | null;
}

export interface MerchantUpdateResponse {
  merchantKey: string;
  alias: MerchantAlias | null;
}

/** `POST /api/activity/categorize` body。 */
export interface CategorizeRequest {
  targets: Array<{
    kind: "bank_transaction" | "invoice";
    id: string;
    /** 個別指定；省略時使用 body 的 categoryId。 */
    categoryId?: string | null;
    /** 活動的 merchantKey（applyToMerchant 時使用）。 */
    merchantKey?: string;
  }>;
  /** null 移除個別覆寫（回到自動分類）。 */
  categoryId?: string | null;
  /** true 時寫入商家規則並移除這些活動的個別覆寫。 */
  applyToMerchant?: boolean;
}

export interface CategorizeResponse {
  updated: number;
  merchantRules: Array<{ merchantKey: string; categoryId: string | null }>;
}
