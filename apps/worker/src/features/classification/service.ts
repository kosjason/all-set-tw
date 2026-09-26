export type ClassificationResult = {
  /** 新分類體系的 id；只指定角色的規則與未分類為 `other`。 */
  categoryId: string;
  label: string;
  source: ClassificationSource;
  ruleId?: string;
  excludedFromCalculation?: boolean;
  /** 規則指定的經濟角色（投資、繳卡費、電支儲值等）。 */
  economicRole?: EconomicRole;
  /** 商家規則指定的經濟角色；與分類來源無關。 */
  merchantEconomicRole?: EconomicRole;
  /** 分類或角色來自哪一個商家 key。 */
  merchantKey?: string;
  /** 符合轉帳關鍵字但無法確認對方，角色推導時標示待確認。 */
  transferHint?: boolean;
};

export type ClassifiedTransaction = {
  id: string;
  description?: string | null;
  counterparty?: string | null;
  sourceId: string;
  /** 帶正負號；發票請傳負數（支出）。 */
  amount?: number;
  /** 依序嘗試的商家 key（例如已配對發票的 key，再來是交易自身的 key）。 */
  merchantKeys?: string[];
};

export type ClassificationTargetType = "bank_transaction" | "invoice";

const ROLE_LABELS: Record<EconomicRole, string> = {
  spending: "消費",
  income: "收入",
  own_transfer: "轉帳",
  investment: "投資",
  card_payment: "繳卡費",
  excluded: "不計入",
};

function asEconomicRole(value: string | null | undefined) {
  return value && (ECONOMIC_ROLES as readonly string[]).includes(value)
    ? (value as EconomicRole)
    : undefined;
}

function categoryDisplayLabel(
  categoryId: string | null | undefined,
  label: string | null | undefined,
) {
  return label ?? categoryLabel(categoryId) ?? "未分類";
}

function matchesDirection(
  direction: string | null | undefined,
  amount?: number,
) {
  if (!direction || direction === "any") return true;
  if (typeof amount !== "number" || !Number.isFinite(amount)) return false;
  return direction === "inflow" ? amount > 0 : amount < 0;
}

export function matchesClassificationRule(
  rule: { field: string; operator: string; pattern: string },
  transaction: ClassifiedTransaction,
) {
  const anyText = [
    transaction.description,
    transaction.counterparty,
    transaction.sourceId,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const text =
    rule.field === "description"
      ? (transaction.description ?? "").toLowerCase()
      : rule.field === "counterparty"
        ? (transaction.counterparty ?? "").toLowerCase()
        : rule.field === "source_id"
          ? transaction.sourceId.toLowerCase()
          : anyText;

  if (rule.operator === "contains")
    return text.includes(rule.pattern.toLowerCase());
  if (rule.operator === "equals") return text === rule.pattern.toLowerCase();
  if (rule.operator === "starts_with")
    return text.startsWith(rule.pattern.toLowerCase());
  if (rule.operator === "regex") {
    try {
      return new RegExp(rule.pattern, "i").test(text);
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * 解析分類：個別覆寫 → 商家規則分類 → 分類規則（依優先序第一個符合者）→ 未分類。
 * 商家規則的角色另外回傳（merchantEconomicRole），不受分類來源影響。
 */
export async function resolveClassifications(
  db: D1Database,
  transactions: ClassifiedTransaction[],
  targetType: ClassificationTargetType = "bank_transaction",
): Promise<Map<string, ClassificationResult>> {
  if (transactions.length === 0) return new Map();

  // URL paths normalize backslashes, so compare override ids in their normalized form.
  const normalizeId = (id: string) => id.replace(/\\/g, "/");
  const transactionIds = [
    ...new Set(
      transactions.flatMap((transaction) => [
        transaction.id,
        normalizeId(transaction.id),
      ]),
    ),
  ];
  const merchantKeys = [
    ...new Set(
      transactions.flatMap((transaction) => transaction.merchantKeys ?? []),
    ),
  ];
  const [overrides, rules, aliases] = await Promise.all([
    listClassificationOverrides(db, transactionIds, targetType),
    listEnabledClassificationRules(db),
    merchantKeys.length
      ? listMerchantAliases(db, merchantKeys)
      : Promise.resolve([]),
  ]);

  const overrideMap = new Map(
    overrides.map((override) => [normalizeId(override.target_id), override]),
  );
  const aliasMap = new Map(aliases.map((alias) => [alias.merchantKey, alias]));
  const result = new Map<string, ClassificationResult>();

  for (const transaction of transactions) {
    const keyAliases = (transaction.merchantKeys ?? [])
      .map((key) => aliasMap.get(key))
      .filter((alias) => alias != null);
    const categoryAlias = keyAliases.find((alias) => alias.categoryId);
    const roleAlias = keyAliases.find((alias) => alias.economicRole);
    const merchantRole = roleAlias
      ? {
          merchantEconomicRole: asEconomicRole(roleAlias.economicRole),
          merchantKey: roleAlias.merchantKey,
        }
      : {};

    const override = overrideMap.get(normalizeId(transaction.id));
    if (override) {
      result.set(transaction.id, {
        categoryId: override.category_id,
        label: categoryDisplayLabel(override.category_id, override.label),
        source: "override",
        ...merchantRole,
      });
      continue;
    }
    if (categoryAlias?.categoryId) {
      result.set(transaction.id, {
        categoryId: categoryAlias.categoryId,
        label: categoryDisplayLabel(categoryAlias.categoryId, undefined),
        source: "merchant_rule",
        merchantKey: categoryAlias.merchantKey,
        ...merchantRole,
      });
      continue;
    }

    let matched: ClassificationResult | undefined;
    for (const rule of rules) {
      if (rule.target_type && rule.target_type !== targetType) continue;
      if (!matchesDirection(rule.amount_direction, transaction.amount))
        continue;
      if (!matchesClassificationRule(rule, transaction)) continue;
      const economicRole = asEconomicRole(rule.economic_role);
      matched = {
        categoryId: rule.category_id ?? UNCATEGORIZED_CATEGORY_ID,
        label: rule.category_id
          ? categoryDisplayLabel(rule.category_id, rule.label)
          : economicRole
            ? ROLE_LABELS[economicRole]
            : "轉帳",
        source: rule.is_system ? "system_rule" : "user_rule",
        ruleId: rule.id,
        excludedFromCalculation: rule.excluded_from_calculation === 1,
        ...(economicRole ? { economicRole } : {}),
        ...(!rule.category_id && !economicRole ? { transferHint: true } : {}),
        ...merchantRole,
      };
      break;
    }
    result.set(
      transaction.id,
      matched ?? {
        categoryId: UNCATEGORIZED_CATEGORY_ID,
        label: "未分類",
        source: "fallback",
        ...merchantRole,
      },
    );
  }

  return result;
}

export class ClassificationCategoryExistsError extends Error {}
export class ClassificationCategoryNotFoundError extends Error {}
export class ClassificationRuleNotFoundError extends Error {}
export class ClassificationRuleOrderError extends Error {}

/**
 * 分類清單：資料庫的分類加上 core 定義的 emoji、顏色與種類。
 * 使用者自訂分類（`user:*`）歸在「其他」之下顯示。
 */
export async function getClassificationCategories(db: D1Database) {
  const rows = await listClassificationCategories(db);
  return rows.map((row) => {
    const definition = getCategoryDefinition(row.id);
    const fallback = getCategoryDefinition(MISC_CATEGORY_ID)!;
    return {
      ...row,
      isSystem: Boolean(row.isSystem),
      parentId: row.parentId ?? null,
      topLevelId: topLevelCategoryId(row.id),
      kind: definition?.kind ?? ("spending" as const),
      emoji: definition?.emoji ?? fallback.emoji,
      color: definition?.color ?? fallback.color,
    };
  });
}

export function getClassificationMigrationNotes(db: D1Database) {
  return listClassificationMigrationNotes(db).then((rows) =>
    rows.map((row) => ({
      ...row,
      needsAttention: Boolean(row.needsAttention),
    })),
  );
}

export async function createClassificationCategory(
  db: D1Database,
  label: string,
) {
  if (await findCategoryByLabel(db, label))
    throw new ClassificationCategoryExistsError();
  const id = `user:${crypto.randomUUID()}`;
  const sortOrder = await nextCategorySortOrder(db);
  await insertClassificationCategory(db, {
    id,
    label,
    sortOrder,
    now: new Date().toISOString(),
  });
  return { id, label, sortOrder, isSystem: false };
}

export async function getClassificationRules(db: D1Database) {
  const rows = await listClassificationRules(db);
  return rows.map((row) => ({
    ...row,
    // 只指定角色（或轉帳提示）的規則沒有分類，以「未分類」呈現以相容既有介面。
    categoryId: row.categoryId ?? UNCATEGORIZED_CATEGORY_ID,
    economicRole: row.economicRole ?? null,
    enabled: Boolean(row.enabled),
    isSystem: Boolean(row.isSystem),
    excludedFromCalculation: Boolean(row.excludedFromCalculation),
  }));
}

export async function reorderClassificationRules(
  db: D1Database,
  ruleIds: string[],
) {
  const editableRuleIds = await listEditableClassificationRuleIds(db);
  const editableRuleIdSet = new Set(editableRuleIds);
  if (
    ruleIds.length !== editableRuleIds.length ||
    new Set(ruleIds).size !== ruleIds.length ||
    ruleIds.some((ruleId) => !editableRuleIdSet.has(ruleId))
  ) {
    throw new ClassificationRuleOrderError();
  }

  await updateClassificationRuleOrder(db, ruleIds, new Date().toISOString());
}

export function setClassificationOverride(
  db: D1Database,
  targetType: string,
  targetId: string,
  categoryId: string,
) {
  return upsertClassificationOverride(db, {
    targetType,
    targetId,
    categoryId,
    now: new Date().toISOString(),
  });
}

export function removeClassificationOverride(
  db: D1Database,
  targetType: string,
  targetId: string,
) {
  return deleteClassificationOverride(db, targetType, targetId);
}

export class ClassificationRuleActionRequiredError extends Error {}

export type CreateClassificationRuleInput = {
  categoryId?: string | null;
  economicRole?: EconomicRole | null;
  amountDirection?: "any" | "inflow" | "outflow";
  targetType?: string;
  field: string;
  operator: string;
  pattern: string;
  priority?: number;
  description?: string;
  excludedFromCalculation?: boolean;
};

export async function createClassificationRule(
  db: D1Database,
  input: CreateClassificationRuleInput,
) {
  if (!input.categoryId && !input.economicRole)
    throw new ClassificationRuleActionRequiredError();
  if (
    input.categoryId &&
    !(await classificationCategoryExists(db, input.categoryId))
  ) {
    throw new ClassificationCategoryNotFoundError();
  }
  const id = `user:${crypto.randomUUID()}`;
  await insertClassificationRule(db, {
    id,
    categoryId: input.categoryId ?? null,
    economicRole: input.economicRole ?? null,
    amountDirection: input.amountDirection ?? "any",
    targetType: input.targetType ?? null,
    field: input.field,
    operator: input.operator,
    pattern: input.pattern,
    priority: input.priority ?? 200,
    description: input.description ?? null,
    excludedFromCalculation: input.excludedFromCalculation ?? false,
    now: new Date().toISOString(),
  });
  return id;
}

export async function editClassificationRule(
  db: D1Database,
  ruleId: string,
  input: Parameters<typeof updateClassificationRule>[2],
) {
  if (
    input.categoryId &&
    !(await classificationCategoryExists(db, input.categoryId))
  ) {
    throw new ClassificationCategoryNotFoundError();
  }
  if (
    !(await updateClassificationRule(
      db,
      ruleId,
      input,
      new Date().toISOString(),
    ))
  ) {
    throw new ClassificationRuleNotFoundError();
  }
}

export async function removeClassificationRule(db: D1Database, ruleId: string) {
  if (!(await deleteClassificationRule(db, ruleId))) {
    throw new ClassificationRuleNotFoundError();
  }
}
import {
  categoryLabel,
  ECONOMIC_ROLES,
  getCategoryDefinition,
  MISC_CATEGORY_ID,
  topLevelCategoryId,
  UNCATEGORIZED_CATEGORY_ID,
  type ClassificationSource,
  type EconomicRole,
} from "@taiwan-fin-hub/core";
import { listMerchantAliases } from "../merchants/repository";
import {
  classificationCategoryExists,
  deleteClassificationOverride,
  deleteClassificationRule,
  findCategoryByLabel,
  insertClassificationCategory,
  insertClassificationRule,
  listClassificationCategories,
  listClassificationMigrationNotes,
  listEditableClassificationRuleIds,
  listClassificationOverrides,
  listClassificationRules,
  listEnabledClassificationRules,
  nextCategorySortOrder,
  updateClassificationRule,
  updateClassificationRuleOrder,
  upsertClassificationOverride,
} from "./repository";
