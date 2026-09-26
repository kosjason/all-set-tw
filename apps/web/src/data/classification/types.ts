import type {
  CategoryColor,
  CategoryKind,
  EconomicRole,
} from "@taiwan-fin-hub/core";

export interface ClassificationRuleRow {
  id: string;
  /** 只指定角色（或轉帳提示）的規則沒有分類，回傳 `other`（未分類）。 */
  categoryId: string;
  economicRole: EconomicRole | null;
  /** any／inflow（只套用流入）／outflow（只套用流出）。 */
  amountDirection: "any" | "inflow" | "outflow";
  targetType: string;
  field: string;
  operator: string;
  pattern: string;
  priority: number;
  enabled: boolean;
  isSystem: boolean;
  excludedFromCalculation: boolean;
  description?: string;
  createdAt?: string;
}

export interface ClassificationCategoryRow {
  id: string;
  label: string;
  sortOrder: number;
  isSystem: boolean;
  /** 子類的頂層 id；頂層與使用者自訂分類為 null。 */
  parentId: string | null;
  /** 所屬頂層（使用者自訂分類歸入 misc，未分類為 other）。 */
  topLevelId: string;
  kind: CategoryKind;
  emoji: string;
  /** 依分類固定的顏色（淺色／深色），子類沿用頂層顏色。 */
  color: CategoryColor;
}

/** 分類遷移紀錄：id 有變動的覆寫與規則、改名的自訂分類、保留的自訂系統規則 pattern。 */
export interface ClassificationMigrationNoteRow {
  id: string;
  subjectType: "override" | "rule" | "category";
  subjectId: string;
  targetType: string | null;
  targetId: string | null;
  legacyCategoryId: string;
  legacyLabel: string;
  newCategoryId: string | null;
  newEconomicRole: EconomicRole | null;
  /** 對應不到而歸入「其他」，需要人工處理。 */
  needsAttention: boolean;
  createdAt: string;
  /** 自訂分類因與系統分類撞名而改名後的名稱（legacyLabel 為原名）。 */
  newLabel: string | null;
  /** 保留下來的使用者 pattern（系統規則被使用者改過）。 */
  legacyPattern: string | null;
  /** 未套用的新版預設 pattern；規則已轉為使用者規則時為 NULL。 */
  newPattern: string | null;
}
