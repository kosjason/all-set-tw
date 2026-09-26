import {
  bankTransactions,
  classificationOverrides,
  createDrizzle,
  invoiceTransactionPreferences,
  invoices,
  merchantAliases,
} from "@taiwan-fin-hub/db";
import { and, eq, ne, sql } from "drizzle-orm";

export type MerchantAliasRow = {
  merchantKey: string;
  displayName: string | null;
  categoryId: string | null;
  economicRole: string | null;
  createdAt: string;
  updatedAt: string;
};

const aliasColumns = {
  merchantKey: merchantAliases.merchantKey,
  displayName: merchantAliases.displayName,
  categoryId: merchantAliases.categoryId,
  economicRole: merchantAliases.economicRole,
  createdAt: merchantAliases.createdAt,
  updatedAt: merchantAliases.updatedAt,
};

/** 指定 key 的商家別名與規則；未提供 keys 時列出全部。 */
export async function listMerchantAliases(
  db: D1Database,
  keys?: string[],
): Promise<MerchantAliasRow[]> {
  if (keys && keys.length === 0) return [];
  return createDrizzle(db)
    .select(aliasColumns)
    .from(merchantAliases)
    .where(
      keys
        ? sql`${merchantAliases.merchantKey} IN (SELECT value FROM json_each(${JSON.stringify([...new Set(keys)])}))`
        : undefined,
    )
    .orderBy(merchantAliases.merchantKey)
    .all();
}

export async function findMerchantAlias(db: D1Database, merchantKey: string) {
  return (
    (await createDrizzle(db)
      .select(aliasColumns)
      .from(merchantAliases)
      .where(eq(merchantAliases.merchantKey, merchantKey))
      .get()) ?? null
  );
}

export type MerchantAliasInput = {
  merchantKey: string;
  displayName?: string | null;
  categoryId?: string | null;
  economicRole?: string | null;
};

/**
 * Upsert 別名；undefined 欄位保留既有值。回傳 statement 供呼叫端組成 batch。
 */
export function merchantAliasUpsertStatement(
  db: D1Database,
  input: MerchantAliasInput,
  now: string,
) {
  const set: Partial<
    Record<"displayName" | "categoryId" | "economicRole", string | null>
  > & {
    updatedAt: string;
  } = { updatedAt: now };
  if (input.displayName !== undefined) set.displayName = input.displayName;
  if (input.categoryId !== undefined) set.categoryId = input.categoryId;
  if (input.economicRole !== undefined) set.economicRole = input.economicRole;
  return createDrizzle(db)
    .insert(merchantAliases)
    .values({
      merchantKey: input.merchantKey,
      displayName: input.displayName ?? null,
      categoryId: input.categoryId ?? null,
      economicRole: input.economicRole ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({ target: merchantAliases.merchantKey, set });
}

export async function upsertMerchantAlias(
  db: D1Database,
  input: MerchantAliasInput,
  now: string,
) {
  await merchantAliasUpsertStatement(db, input, now).run();
  return findMerchantAlias(db, input.merchantKey);
}

export async function deleteMerchantAlias(db: D1Database, merchantKey: string) {
  const result = await createDrizzle(db)
    .delete(merchantAliases)
    .where(eq(merchantAliases.merchantKey, merchantKey))
    .run();
  return result.meta.changes === 1;
}

/**
 * 使用者個別分類覆寫與其活動文字，供計算「同商家過去最常用的分類」。
 * 已連結發票的交易一併帶出發票賣方，讓商家 key 與列表一致。
 */
export async function listOverrideHistoryRows(db: D1Database) {
  const database = createDrizzle(db);
  const [bankRows, invoiceRows] = await Promise.all([
    database
      .select({
        categoryId: classificationOverrides.categoryId,
        description: bankTransactions.description,
        counterparty: bankTransactions.counterparty,
        sellerName: invoices.sellerName,
        sellerBan: invoices.sellerBan,
      })
      .from(classificationOverrides)
      .innerJoin(
        bankTransactions,
        eq(bankTransactions.id, classificationOverrides.targetId),
      )
      .leftJoin(
        invoiceTransactionPreferences,
        and(
          eq(invoiceTransactionPreferences.transactionId, bankTransactions.id),
          eq(invoiceTransactionPreferences.decision, "linked"),
        ),
      )
      .leftJoin(
        invoices,
        eq(invoices.id, invoiceTransactionPreferences.invoiceId),
      )
      .where(
        and(
          eq(classificationOverrides.targetType, "bank_transaction"),
          ne(classificationOverrides.categoryId, "other"),
        ),
      )
      .all(),
    database
      .select({
        categoryId: classificationOverrides.categoryId,
        sellerName: invoices.sellerName,
        sellerBan: invoices.sellerBan,
      })
      .from(classificationOverrides)
      .innerJoin(invoices, eq(invoices.id, classificationOverrides.targetId))
      .where(
        and(
          eq(classificationOverrides.targetType, "invoice"),
          ne(classificationOverrides.categoryId, "other"),
        ),
      )
      .all(),
  ]);
  return { bankRows, invoiceRows };
}

/** 批次分類的目標：交易文字（含已連結發票）與發票賣方。 */
export async function listCategorizeTargets(
  db: D1Database,
  transactionIds: string[],
  invoiceIds: string[],
) {
  const database = createDrizzle(db);
  const [transactionRows, invoiceRows] = await Promise.all([
    transactionIds.length
      ? database
          .select({
            id: bankTransactions.id,
            description: bankTransactions.description,
            counterparty: bankTransactions.counterparty,
            sellerName: invoices.sellerName,
            sellerBan: invoices.sellerBan,
          })
          .from(bankTransactions)
          .leftJoin(
            invoiceTransactionPreferences,
            and(
              eq(
                invoiceTransactionPreferences.transactionId,
                bankTransactions.id,
              ),
              eq(invoiceTransactionPreferences.decision, "linked"),
            ),
          )
          .leftJoin(
            invoices,
            eq(invoices.id, invoiceTransactionPreferences.invoiceId),
          )
          .where(
            sql`${bankTransactions.id} IN (SELECT value FROM json_each(${JSON.stringify(transactionIds)}))`,
          )
          .all()
      : Promise.resolve([]),
    invoiceIds.length
      ? database
          .select({
            id: invoices.id,
            sellerName: invoices.sellerName,
            sellerBan: invoices.sellerBan,
          })
          .from(invoices)
          .where(
            sql`${invoices.id} IN (SELECT value FROM json_each(${JSON.stringify(invoiceIds)}))`,
          )
          .all()
      : Promise.resolve([]),
  ]);
  return { transactionRows, invoiceRows };
}

export function runBatch(
  db: D1Database,
  statements: Array<{ run: () => Promise<unknown> }>,
) {
  if (statements.length === 0) return Promise.resolve();
  const database = createDrizzle(db);
  const [first, ...rest] = statements as unknown as Parameters<
    typeof database.batch
  >[0];
  return database.batch([first, ...rest]);
}
