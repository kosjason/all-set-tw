import type { ActivityItem } from "@taiwan-fin-hub/core";
export type { ActivityItem } from "@taiwan-fin-hub/core";

export interface PendingCalculationUpdate {
  item: ActivityItem;
  categoryId: string;
  applyRule: boolean;
  pattern: string;
  operator: "contains" | "equals";
}

export interface CalculationUpdateInput {
  transactionId: string;
  categoryId: string;
  originalCategoryId: string;
  applyRule: boolean;
  ruleId?: string;
  pattern: string;
  operator: "contains" | "equals";
}
