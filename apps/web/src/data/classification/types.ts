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

/** 0055 遷移舊分類時 id 有變動的覆寫與使用者規則。 */
export interface ClassificationMigrationNoteRow {
  id: string;
  subjectType: "override" | "rule";
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
}
