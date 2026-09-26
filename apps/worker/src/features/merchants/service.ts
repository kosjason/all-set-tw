import {
  activitySignedAmountTwd,
  bankMerchantIdentity,
  currentActivityMonthKey,
  invoiceMerchantIdentity,
  isMerchantKey,
  UNCATEGORIZED_CATEGORY_ID,
  type ActivityItem,
  type EconomicRole,
  type MerchantPaymentMethod,
} from "@taiwan-fin-hub/core";
import {
  classificationOverrideStatements,
  listExistingCategoryIds,
} from "../classification/repository";
import { loadRoleActivities, monthsBetween } from "../activity/summary-service";
import {
  deleteMerchantAlias,
  findMerchantAlias,
  listCategorizeTargets,
  listMerchantAliases,
  merchantAliasUpsertStatement,
  runBatch,
  upsertMerchantAlias,
  type MerchantAliasRow,
} from "./repository";

export class MerchantNotFoundError extends Error {}
export class MerchantKeyInvalidError extends Error {}
export class MerchantCategoryNotFoundError extends Error {}
export class CategorizeTargetNotFoundError extends Error {
  constructor(readonly missing: Array<{ kind: string; id: string }>) {
    super("Activity was not found.");
  }
}
export class CategorizeCategoryRequiredError extends Error {}

export interface MerchantSummary {
  merchantKey: string;
  /** 使用者別名，否則為最近一筆活動的清理後名稱。 */
  displayName: string;
  /** 清理後的預設名稱（不含別名）。 */
  defaultName: string | null;
  /** 近 N 個月計入的活動筆數（不含重複）。 */
  activityCount: number;
  /** 近 N 個月消費淨額（TWD 以外幣別不換算、只計 TWD）。 */
  spending: number;
  /** 近 N 個月最常見的分類（未分類為 other）。 */
  topCategoryId: string | null;
  paymentMethods: MerchantPaymentMethod[];
  alias: {
    displayName: string | null;
    categoryId: string | null;
    economicRole: EconomicRole | null;
    updatedAt: string;
  } | null;
}

function presentAlias(alias: MerchantAliasRow | undefined) {
  if (!alias) return null;
  return {
    displayName: alias.displayName,
    categoryId: alias.categoryId,
    economicRole: alias.economicRole as EconomicRole | null,
    updatedAt: alias.updatedAt,
  };
}

/** 以台北時間本月為終點的最近 N 個月（YYYY-MM）。 */
function recentMonths(count: number) {
  const current = currentActivityMonthKey();
  const [year, month] = current.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - count, 1));
  return monthsBetween(start.toISOString().slice(0, 7), current);
}

/**
 * 列出近 N 個月出現過的商家（以活動列表同一套商家 key 彙總），加上已設定別名或規則
 * 但近期沒有活動的商家。query 比對顯示名稱、預設名稱與 key。
 */
export async function listMerchants(
  db: D1Database,
  options: { query?: string; months?: number } = {},
) {
  const months = recentMonths(options.months ?? 3);
  const [{ items }, aliases] = await Promise.all([
    loadRoleActivities(db, months, { includeTrades: false }),
    listMerchantAliases(db),
  ]);
  const aliasByKey = new Map(
    aliases.map((alias) => [alias.merchantKey, alias]),
  );
  const groups = new Map<
    string,
    {
      items: ActivityItem[];
      defaultName: string | null;
      paymentMethods: Set<MerchantPaymentMethod>;
    }
  >();
  for (const item of items) {
    if (!item.merchantKey || item.duplicateOf) continue;
    const group = groups.get(item.merchantKey) ?? {
      items: [],
      defaultName: null,
      paymentMethods: new Set(),
    };
    group.items.push(item);
    if (item.merchantPaymentMethod)
      group.paymentMethods.add(item.merchantPaymentMethod);
    groups.set(item.merchantKey, group);
  }
  const summaries: MerchantSummary[] = [];
  for (const [merchantKey, group] of groups) {
    const alias = aliasByKey.get(merchantKey);
    const latest = group.items[0];
    const categoryCounts = new Map<string, number>();
    let spending = 0;
    for (const item of group.items) {
      const categoryId = item.categoryId ?? UNCATEGORIZED_CATEGORY_ID;
      categoryCounts.set(categoryId, (categoryCounts.get(categoryId) ?? 0) + 1);
      // 外幣（例如外幣發票）以系統匯率換算成台幣；缺匯率者不計入。
      const amount = activitySignedAmountTwd(item);
      if (item.economicRole === "spending" && amount != null)
        spending -= amount;
    }
    const [topCategory] = [...categoryCounts].sort(
      ([leftId, left], [rightId, right]) =>
        right - left || leftId.localeCompare(rightId),
    );
    const defaultName = defaultMerchantName(latest);
    summaries.push({
      merchantKey,
      displayName: alias?.displayName ?? defaultName ?? merchantKey,
      defaultName,
      activityCount: group.items.length,
      spending: Math.round(spending * 100) / 100 || 0,
      topCategoryId: topCategory?.[0] ?? null,
      paymentMethods: [...group.paymentMethods].sort(),
      alias: presentAlias(alias),
    });
  }
  for (const alias of aliases) {
    if (groups.has(alias.merchantKey)) continue;
    summaries.push({
      merchantKey: alias.merchantKey,
      displayName: alias.displayName ?? alias.merchantKey.replace(/^\w+:/, ""),
      defaultName: null,
      activityCount: 0,
      spending: 0,
      topCategoryId: null,
      paymentMethods: [],
      alias: presentAlias(alias),
    });
  }
  const query = options.query?.normalize("NFKC").trim().toLowerCase();
  return summaries
    .filter(
      (summary) =>
        !query ||
        [summary.displayName, summary.defaultName, summary.merchantKey]
          .filter(Boolean)
          .join(" ")
          .normalize("NFKC")
          .toLowerCase()
          .includes(query),
    )
    .sort(
      (left, right) =>
        right.spending - left.spending ||
        right.activityCount - left.activityCount ||
        left.displayName.localeCompare(right.displayName, "zh-TW"),
    );
}

function defaultMerchantName(item: ActivityItem) {
  return item.merchantName ?? null;
}

export interface MerchantUpdateInput {
  displayName?: string | null;
  categoryId?: string | null;
  economicRole?: EconomicRole | null;
}

/**
 * 設定商家別名與商家規則。分類或角色會在讀取時回溯套用到該商家所有活動，
 * 不改寫原始交易；個別覆寫仍優先於商家規則。
 */
export async function updateMerchant(
  db: D1Database,
  merchantKey: string,
  input: MerchantUpdateInput,
) {
  if (!isMerchantKey(merchantKey)) throw new MerchantKeyInvalidError();
  const categoryId =
    input.categoryId === UNCATEGORIZED_CATEGORY_ID ? null : input.categoryId;
  if (
    categoryId &&
    !(await listExistingCategoryIds(db, [categoryId])).has(categoryId)
  )
    throw new MerchantCategoryNotFoundError();
  const displayName =
    input.displayName === undefined
      ? undefined
      : input.displayName?.trim() || null;
  const alias = await upsertMerchantAlias(
    db,
    {
      merchantKey,
      displayName,
      categoryId,
      economicRole: input.economicRole,
    },
    new Date().toISOString(),
  );
  return { merchantKey, alias: presentAlias(alias ?? undefined) };
}

export async function removeMerchant(db: D1Database, merchantKey: string) {
  if (!(await deleteMerchantAlias(db, merchantKey)))
    throw new MerchantNotFoundError();
}

export async function getMerchant(db: D1Database, merchantKey: string) {
  const alias = await findMerchantAlias(db, merchantKey);
  if (!alias) throw new MerchantNotFoundError();
  return { merchantKey, alias: presentAlias(alias) };
}

export interface CategorizeTarget {
  kind: "bank_transaction" | "invoice";
  id: string;
  /** 個別指定的分類；未提供時使用 body 的 categoryId。 */
  categoryId?: string | null;
  /** 活動列表上的 merchantKey；未提供時由伺服器推導。 */
  merchantKey?: string;
}

export interface CategorizeInput {
  targets: CategorizeTarget[];
  categoryId?: string | null;
  applyToMerchant?: boolean;
}

/**
 * 批次指定分類或接受建議：
 * - applyToMerchant = false：為每筆活動寫入個別覆寫（categoryId 為 null 時移除覆寫）。
 * - applyToMerchant = true：寫入商家規則（回溯套用到該商家所有活動），並移除這些活動
 *   既有的個別覆寫，讓商家規則生效。
 * 所有寫入在同一個 D1 batch。
 */
export async function categorizeActivities(
  db: D1Database,
  input: CategorizeInput,
) {
  const targets = input.targets.map((target) => ({
    ...target,
    categoryId:
      target.categoryId !== undefined ? target.categoryId : input.categoryId,
  }));
  if (targets.some((target) => target.categoryId === undefined))
    throw new CategorizeCategoryRequiredError();
  const normalize = (categoryId: string | null | undefined) =>
    categoryId === UNCATEGORIZED_CATEGORY_ID && input.applyToMerchant
      ? null
      : (categoryId ?? null);
  const categoryIds = [
    ...new Set(
      targets
        .map((target) => normalize(target.categoryId))
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const [existing, rows] = await Promise.all([
    listExistingCategoryIds(db, categoryIds),
    listCategorizeTargets(
      db,
      targets
        .filter((target) => target.kind === "bank_transaction")
        .map((target) => target.id),
      targets
        .filter((target) => target.kind === "invoice")
        .map((target) => target.id),
    ),
  ]);
  if (categoryIds.some((id) => !existing.has(id)))
    throw new MerchantCategoryNotFoundError();
  const transactionById = new Map(
    rows.transactionRows.map((row) => [row.id, row]),
  );
  const invoiceById = new Map(rows.invoiceRows.map((row) => [row.id, row]));
  const missing = targets.filter((target) =>
    target.kind === "bank_transaction"
      ? !transactionById.has(target.id)
      : !invoiceById.has(target.id),
  );
  if (missing.length)
    throw new CategorizeTargetNotFoundError(
      missing.map(({ kind, id }) => ({ kind, id })),
    );

  const now = new Date().toISOString();
  const merchantRules = new Map<string, string | null>();
  const overrides: Array<{
    targetType: string;
    targetId: string;
    categoryId: string | null;
  }> = [];
  for (const target of targets) {
    const categoryId = normalize(target.categoryId);
    if (!input.applyToMerchant) {
      overrides.push({
        targetType: target.kind,
        targetId: target.id,
        categoryId,
      });
      continue;
    }
    const merchantKey =
      target.merchantKey && isMerchantKey(target.merchantKey)
        ? target.merchantKey
        : targetMerchantKey(target, transactionById, invoiceById);
    if (!merchantKey) {
      // 推不出商家的活動只能個別覆寫。
      overrides.push({
        targetType: target.kind,
        targetId: target.id,
        categoryId,
      });
      continue;
    }
    merchantRules.set(merchantKey, categoryId);
    overrides.push({
      targetType: target.kind,
      targetId: target.id,
      categoryId: null,
    });
  }
  await runBatch(db, [
    ...classificationOverrideStatements(db, overrides, now),
    ...[...merchantRules].map(([merchantKey, categoryId]) =>
      merchantAliasUpsertStatement(db, { merchantKey, categoryId }, now),
    ),
  ]);
  return {
    updated: targets.length,
    merchantRules: [...merchantRules].map(([merchantKey, categoryId]) => ({
      merchantKey,
      categoryId,
    })),
  };
}

function targetMerchantKey(
  target: CategorizeTarget,
  transactions: Map<
    string,
    {
      description: string | null;
      counterparty: string | null;
      sellerName: string | null;
      sellerBan: string | null;
    }
  >,
  invoices: Map<
    string,
    { sellerName: string | null; sellerBan: string | null }
  >,
) {
  if (target.kind === "invoice")
    return invoiceMerchantIdentity(invoices.get(target.id)!)?.merchantKey;
  const row = transactions.get(target.id)!;
  if (row.sellerName || row.sellerBan) {
    const key = invoiceMerchantIdentity(row)?.merchantKey;
    if (key) return key;
  }
  return bankMerchantIdentity(row)?.merchantKey;
}
