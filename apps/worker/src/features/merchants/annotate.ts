import {
  attributeForeignTransactionFees,
  AUTO_APPLY_SUGGESTION_SOURCES,
  bankMerchantIdentity,
  buildActivityItems,
  categoryLabel,
  economicRoleOverrideKey,
  getCategoryDefinition,
  invoiceItemsPreview,
  invoiceMerchantIdentity,
  isIncomeCategoryId,
  isUncategorizedCategoryId,
  matchInvoicesToTransactions,
  meaningfulInvoiceItems,
  suggestCategory,
  UNCATEGORIZED_CATEGORY_ID,
  type ActivityItem,
  type ActivityNote,
  type ActivityRef,
  type CategorySource,
  type ClassificationSource,
  type EconomicRole,
  type EconomicRoleFields,
  type ForeignFeeTransaction,
} from "@taiwan-fin-hub/core";
import {
  resolveClassifications,
  type ClassificationResult,
} from "../classification/service";
import { listInvoiceItems } from "../invoices/repository";
import { listClassificationCategories } from "../classification/repository";
import { loadActivityNotes } from "../activity-notes/service";
import { getInvoicesRange } from "../invoices/service";
import { getExchangeRates } from "../exchange-rates/service";
import { listInvoiceTransactionPreferences } from "../activity/repository";
import {
  listMerchantAliases,
  listOverrideHistoryRows,
  type MerchantAliasRow,
} from "./repository";

/**
 * 註記所需的交易資訊（`presentBankTransactions` 的輸出）。帳戶、金額與日期用來
 * 歸屬國外交易服務費（{@link attributeForeignTransactionFees}）；缺少時不歸屬。
 */
export interface AnnotationTransaction extends ForeignFeeTransaction {
  id: string;
  description?: string | null;
  counterparty?: string | null;
}

export interface AnnotationInvoice {
  id: string;
  sellerName?: string | null;
  sellerBan?: string | null;
  amount: number;
}

export interface MerchantAnnotationContext {
  transactions: readonly AnnotationTransaction[];
  invoices: readonly AnnotationInvoice[];
}

/** 分類來源的可信度；已配對的交易與發票取較高者（同分時以發票賣方為準）。 */
const SOURCE_RANK: Partial<Record<ClassificationSource, number>> = {
  override: 6,
  merchant_rule: 5,
  user_rule: 4,
  system_rule: 3,
  invoice: 3,
  fallback: 0,
};
/** 系統判定為非消費（互轉、自有帳戶、未同步卡片、年費減免）時不合併發票分類。 */
const NON_MERGEABLE_SOURCES = new Set<ClassificationSource>([
  "auto_transfer",
  "auto_offset",
  "own_account",
  "unsynced_card",
]);
/** 使用者或系統已確認角色時，商家規則角色不覆蓋。 */
const PROTECTED_ROLE_REASONS = new Set<EconomicRoleFields["roleReason"]>([
  "override",
  "calculation_preference",
  "own_account",
  "unsynced_card",
]);

function rank(source?: ClassificationSource) {
  return source ? (SOURCE_RANK[source] ?? -1) : 0;
}

function applyMerchantRole(item: ActivityItem, role?: EconomicRole) {
  if (!role || !item.economicRole) return;
  item.economicRole = role;
  item.reviewStatus = "confirmed";
  item.roleReason = "merchant_rule";
  if (role !== "investment") item.investmentEventKind = null;
}

/**
 * 同商家過去最常被使用者（個別覆寫）歸入的分類，key 為商家 key。
 * 交易同時計入自身與已連結發票的 key。
 */
export async function loadMerchantHistory(db: D1Database) {
  const { bankRows, invoiceRows } = await listOverrideHistoryRows(db);
  const counts = new Map<string, Map<string, number>>();
  const add = (key: string | undefined, categoryId: string) => {
    if (!key) return;
    const byCategory = counts.get(key) ?? new Map<string, number>();
    byCategory.set(categoryId, (byCategory.get(categoryId) ?? 0) + 1);
    counts.set(key, byCategory);
  };
  for (const row of bankRows) {
    const own = bankMerchantIdentity(row)?.merchantKey;
    const invoice =
      row.sellerName || row.sellerBan
        ? invoiceMerchantIdentity(row)?.merchantKey
        : undefined;
    add(own, row.categoryId);
    if (invoice !== own) add(invoice, row.categoryId);
  }
  for (const row of invoiceRows)
    add(invoiceMerchantIdentity(row)?.merchantKey, row.categoryId);
  const history = new Map<string, string>();
  for (const [key, byCategory] of counts) {
    const [best] = [...byCategory].sort(
      ([leftId, left], [rightId, right]) =>
        right - left || leftId.localeCompare(rightId),
    );
    history.set(key, best[0]);
  }
  return history;
}

async function safely<T>(label: string, load: () => Promise<T>, fallback: T) {
  try {
    return await load();
  } catch (error) {
    console.error(`[merchants] ${label} failed:`, error);
    return fallback;
  }
}

/**
 * 為活動加上商家顯示名稱、品項預覽、新分類與分類建議：
 * - 已配對的交易合併發票的分類（覆寫、商家規則、規則），以可信度較高者為準。
 * - 商家規則的角色回溯套用（已配對交易以發票的商家 key 為準）。
 * - 未分類的消費／收入提供 suggestedCategoryId 與 suggestionSource；商家歷史、商家名稱與
 *   品項關鍵字的建議直接套用成 categoryId，並以 categorySource 標示分類來源。
 * - 活動備註（note／noteTarget）；已配對的交易與發票共用。
 * 所有資料以批次查詢載入，不逐筆查詢。
 */
export async function annotateActivityItems(
  db: D1Database,
  items: ActivityItem[],
  context: MerchantAnnotationContext,
): Promise<ActivityItem[]> {
  if (items.length === 0) return items;
  const transactionById = new Map(
    context.transactions.map((transaction) => [transaction.id, transaction]),
  );
  const invoiceById = new Map(
    context.invoices.map((invoice) => [invoice.id, invoice]),
  );
  const ownKeyByTransaction = new Map<string, string>();
  for (const item of items) {
    if (item.source !== "bank" && item.source !== "card") continue;
    const transaction = transactionById.get(item.transactionId ?? item.id);
    const key = transaction
      ? bankMerchantIdentity(transaction)?.merchantKey
      : undefined;
    if (key) ownKeyByTransaction.set(item.id, key);
  }
  const invoiceIds = [
    ...new Set(
      items
        .map((item) => item.invoiceId)
        .filter((id): id is string => Boolean(id) && invoiceById.has(id!)),
    ),
  ];
  const invoiceKeys = new Map(
    invoiceIds.map((id) => [
      id,
      invoiceMerchantIdentity(invoiceById.get(id)!)?.merchantKey,
    ]),
  );
  const aliasKeys = [
    ...new Set(
      [
        ...items.map((item) => item.merchantKey),
        ...ownKeyByTransaction.values(),
      ].filter((key): key is string => Boolean(key)),
    ),
  ];

  const noteBankIds = new Set<string>();
  const noteInvoiceIds = new Set<string>();
  for (const item of items) {
    if (item.source === "investment") continue;
    if (item.source === "invoice") {
      noteInvoiceIds.add(item.invoiceId ?? item.id);
      const linked = linkedTransactionId(item);
      if (linked) noteBankIds.add(linked);
    } else {
      noteBankIds.add(item.transactionId ?? item.id);
      if (item.invoiceId) noteInvoiceIds.add(item.invoiceId);
    }
  }

  const [aliases, lineItems, invoiceClassifications, history, notes] =
    await Promise.all([
      safely("load aliases", () => listMerchantAliases(db, aliasKeys), []),
      safely("load invoice items", () => listInvoiceItems(db, invoiceIds), []),
      safely(
        "classify invoices",
        () =>
          resolveClassifications(
            db,
            invoiceIds.map((id) => {
              const invoice = invoiceById.get(id)!;
              const key = invoiceKeys.get(id);
              return {
                id,
                description: invoice.sellerName,
                counterparty: null,
                sourceId: "",
                amount: -Math.abs(invoice.amount),
                merchantKeys: key ? [key] : [],
              };
            }),
            "invoice",
          ),
        new Map<string, ClassificationResult>(),
      ),
      safely("load merchant history", () => loadMerchantHistory(db), new Map()),
      safely(
        "load activity notes",
        () =>
          loadActivityNotes(db, {
            bankTransactionIds: [...noteBankIds],
            invoiceIds: [...noteInvoiceIds],
          }),
        new Map<string, ActivityNote>(),
      ),
    ]);
  const customLabels = await loadCustomCategoryLabels(db, history);

  const aliasByKey = new Map<string, MerchantAliasRow>(
    aliases.map((alias) => [alias.merchantKey, alias]),
  );
  const itemsByInvoice = new Map<string, typeof lineItems>();
  for (const line of lineItems) {
    const group = itemsByInvoice.get(line.invoiceId) ?? [];
    group.push(line);
    itemsByInvoice.set(line.invoiceId, group);
  }

  const result = items.map((item) => ({ ...item }));
  const finalByTransaction = new Map<string, ActivityItem>();

  // 交易先處理，發票的重複項目沿用交易的最終分類。
  const order = [...result.keys()].sort(
    (left, right) =>
      Number(result[left].source === "invoice") -
      Number(result[right].source === "invoice"),
  );
  for (const index of order) {
    const item = result[index];
    if (item.source === "investment") continue;
    applyNote(item, notes);
    const ownKey = ownKeyByTransaction.get(item.id);
    const primaryKey = item.merchantKey;
    // 別名以主要 key（已配對者為發票）優先，其次交易自身的 key。
    const displayAlias = [primaryKey, ownKey]
      .map((key) => (key ? aliasByKey.get(key) : undefined))
      .find((candidate) => candidate?.displayName);
    if (displayAlias?.displayName) item.displayName = displayAlias.displayName;

    const lines = item.invoiceId
      ? (itemsByInvoice.get(item.invoiceId) ?? [])
      : [];
    if (lines.length) {
      item.itemsPreview = invoiceItemsPreview(lines);
      const names = meaningfulInvoiceItems(lines).map(({ name }) => name);
      item.searchText = [item.searchText, ...names].filter(Boolean).join(" ");
    }
    if (item.displayName)
      item.searchText = [item.searchText, item.displayName]
        .filter(Boolean)
        .join(" ");

    const invoiceClassification = item.invoiceId
      ? invoiceClassifications.get(item.invoiceId)
      : undefined;

    if (item.source === "invoice") {
      const matchedTransaction = item.duplicateOf
        ? finalByTransaction.get(item.duplicateOf.id)
        : undefined;
      if (matchedTransaction) {
        item.categoryId = matchedTransaction.categoryId;
        item.category = matchedTransaction.category;
        item.classificationSource = matchedTransaction.classificationSource;
        item.categorySource = matchedTransaction.categorySource;
      } else {
        item.categoryId =
          invoiceClassification?.categoryId ?? UNCATEGORIZED_CATEGORY_ID;
        item.category = invoiceClassification?.label ?? "未分類";
        item.classificationSource = invoiceClassification?.source ?? "fallback";
        if (
          item.roleReason === "invoice" ||
          item.roleReason === "invoice_ambiguous"
        )
          applyMerchantRole(item, invoiceClassification?.merchantEconomicRole);
      }
    } else {
      const source = item.classificationSource;
      if (
        invoiceClassification &&
        !isUncategorizedCategoryId(invoiceClassification.categoryId) &&
        !NON_MERGEABLE_SOURCES.has(source ?? "fallback") &&
        (rank(invoiceClassification.source) > rank(source) ||
          (rank(invoiceClassification.source) === rank(source) &&
            source !== "override"))
      ) {
        item.categoryId = invoiceClassification.categoryId;
        item.category = invoiceClassification.label;
        item.classificationSource =
          invoiceClassification.source === "override"
            ? "invoice"
            : invoiceClassification.source;
      }
      // 已配對發票的商家規則角色優先於交易自身文字推得的商家。
      if (
        invoiceClassification?.merchantEconomicRole &&
        item.roleReason &&
        !PROTECTED_ROLE_REASONS.has(item.roleReason)
      )
        applyMerchantRole(item, invoiceClassification.merchantEconomicRole);
      finalByTransaction.set(item.id, item);
    }

    if (!(item.source === "invoice" && item.duplicateOf && item.categorySource))
      item.categorySource = baseCategorySource(item);
    addSuggestion(item, {
      lines,
      history,
      customLabels,
      keys: [primaryKey, ownKey],
      texts: [
        item.displayName,
        item.title,
        transactionById.get(item.id)?.counterparty,
        transactionById.get(item.id)?.description,
        item.invoiceId ? invoiceById.get(item.invoiceId)?.sellerName : null,
      ],
    });
  }
  applyForeignFeeCategories(result, context.transactions);
  return result;
}

/**
 * 國外交易服務費沿用所屬國外消費的分類（例如軟體訂閱），而不是一律歸到手續費；
 * 使用者或商家規則指定的分類不改，原消費未分類時也不改。只改分類，不改金額。
 */
function applyForeignFeeCategories(
  items: ActivityItem[],
  transactions: readonly AnnotationTransaction[],
) {
  const baseOf = attributeForeignTransactionFees(transactions);
  if (!baseOf.size) return;
  const byTransaction = new Map(
    items
      .filter((item) => item.source === "bank" || item.source === "card")
      .map((item) => [item.transactionId ?? item.id, item]),
  );
  for (const [feeId, baseId] of baseOf) {
    const fee = byTransaction.get(feeId);
    if (!fee) continue;
    fee.foreignFeeOf = baseId;
    const base = byTransaction.get(baseId);
    if (
      !base?.categoryId ||
      isUncategorizedCategoryId(base.categoryId) ||
      fee.categorySource === "user" ||
      fee.categorySource === "merchant_rule"
    )
      continue;
    fee.categoryId = base.categoryId;
    fee.category = base.category;
    fee.categorySource = "rule";
    delete fee.suggestedCategoryId;
    delete fee.suggestionSource;
  }
}

/** 發票重複項目所併入的交易 id。 */
function linkedTransactionId(item: ActivityItem) {
  if (item.duplicateOf?.kind === "bank_transaction") return item.duplicateOf.id;
  return item.matchedTransactionId ?? undefined;
}

/**
 * 備註：活動自身的備註優先；已配對的交易與發票共用，自身沒有時沿用另一方。
 */
function applyNote(
  item: ActivityItem,
  notes: ReadonlyMap<string, ActivityNote>,
) {
  const own: ActivityRef =
    item.source === "invoice"
      ? { kind: "invoice", id: item.invoiceId ?? item.id }
      : { kind: "bank_transaction", id: item.transactionId ?? item.id };
  const linkedId =
    item.source === "invoice" ? linkedTransactionId(item) : item.invoiceId;
  const linked: ActivityRef | undefined = linkedId
    ? {
        kind: item.source === "invoice" ? "bank_transaction" : "invoice",
        id: linkedId,
      }
    : undefined;
  const found = [own, linked]
    .filter((ref): ref is ActivityRef => ref != null)
    .map((ref) => ({
      ref,
      note: notes.get(economicRoleOverrideKey(ref.kind, ref.id)),
    }))
    .find((candidate) => candidate.note);
  item.note = found?.note?.note ?? null;
  item.noteTarget = found ? found.ref : null;
}

/** 分類來源（尚未套用自動建議）。 */
function baseCategorySource(item: ActivityItem): CategorySource {
  if (isUncategorizedCategoryId(item.categoryId)) return "none";
  switch (item.classificationSource) {
    case "override":
    case "invoice":
      return "user";
    case "merchant_rule":
      return "merchant_rule";
    default:
      return "rule";
  }
}

/** 同商家歷史分類若是使用者自訂分類，載入其名稱（只在需要時查詢）。 */
async function loadCustomCategoryLabels(
  db: D1Database,
  history: ReadonlyMap<string, string>,
) {
  const labels = new Map<string, string>();
  if (![...history.values()].some((id) => !getCategoryDefinition(id)))
    return labels;
  const rows = await safely(
    "load category labels",
    () => listClassificationCategories(db),
    [],
  );
  for (const row of rows) labels.set(row.id, row.label);
  return labels;
}

const NO_SUGGESTION_SOURCES = new Set<ClassificationSource>([
  "auto_transfer",
  "auto_offset",
  "own_account",
  "unsynced_card",
]);

function addSuggestion(
  item: ActivityItem,
  input: {
    lines: Array<{ description: string; amount: number }>;
    history: Map<string, string>;
    customLabels: ReadonlyMap<string, string>;
    keys: Array<string | undefined>;
    texts: Array<string | null | undefined>;
  },
) {
  if (item.duplicateOf) return;
  if (
    item.classificationSource &&
    NO_SUGGESTION_SOURCES.has(item.classificationSource)
  )
    return;
  const role = item.economicRole ?? "spending";
  if (role !== "spending" && role !== "income") return;
  const uncategorized = isUncategorizedCategoryId(item.categoryId);
  const current = getCategoryDefinition(item.categoryId);
  // 只分到頂層的系統分類（如便利商店→餐飲）可建議更細的子類。
  const refinable =
    !uncategorized &&
    item.classificationSource !== "override" &&
    current?.parentId === null &&
    current.kind !== "uncategorized";
  if (!uncategorized && !refinable) return;
  const direction = role === "income" ? "inflow" : "outflow";
  const historyCategory = input.keys
    .map((key) => (key ? input.history.get(key) : undefined))
    .find(
      (categoryId) =>
        categoryId != null &&
        isIncomeCategoryId(categoryId) === (direction === "inflow"),
    );
  const suggestion = suggestCategory({
    texts: input.texts,
    items: input.lines,
    merchantHistoryCategoryId: historyCategory,
    direction,
  });
  if (!suggestion || suggestion.categoryId === item.categoryId) return;
  if (refinable) {
    const suggested = getCategoryDefinition(suggestion.categoryId);
    if (suggested?.parentId !== item.categoryId) return;
  }
  item.suggestedCategoryId = suggestion.categoryId;
  item.suggestionSource = suggestion.source;
  // 商家歷史、商家名稱與品項關鍵字的建議直接套用；覆寫、商家規則與使用者規則
  // 已在前面決定分類，不會進到這裡。
  if (AUTO_APPLY_SUGGESTION_SOURCES.has(suggestion.source)) {
    item.categoryId = suggestion.categoryId;
    item.category =
      categoryLabel(suggestion.categoryId) ??
      input.customLabels.get(suggestion.categoryId) ??
      item.category;
    item.categorySource = "auto_suggestion";
  }
}

/** `/api/bank` 交易上的商家與分類欄位。 */
export type BankTransactionAnnotation = Pick<
  ActivityItem,
  | "merchantKey"
  | "displayName"
  | "merchantPaymentMethod"
  | "itemsPreview"
  | "categoryId"
  | "suggestedCategoryId"
  | "suggestionSource"
  | "categorySource"
  | "note"
  | "noteTarget"
  | "economicRole"
  | "reviewStatus"
  | "roleReason"
  | "investmentEventKind"
>;

function shiftDay(day: string, offset: number) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

/**
 * 以交易所在日期前後各 6 天的發票完成配對後註記 `/api/bank` 的交易，
 * 讓已配對交易的商家、品項與分類與活動列表一致。
 */
export async function annotateBankTransactions<
  T extends AnnotationTransaction & {
    accountId: string;
    accountType?: string | null;
    connectorId: string;
    sourceId: string;
    amount: number;
    currency: string;
    authorizedAt?: string | null;
    postedDate?: string | null;
    status: string;
    classification?: {
      categoryId: string;
      label: string;
      source: ClassificationSource;
    };
  } & Partial<EconomicRoleFields>,
>(db: D1Database, transactions: T[]) {
  const days = transactions
    .map((transaction) =>
      (transaction.authorizedAt ?? transaction.postedDate ?? "").slice(0, 10),
    )
    .filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day))
    .sort();
  if (days.length === 0) return transactions;
  const [invoices, preferences, rates] = await Promise.all([
    safely(
      "load invoices for bank",
      () =>
        getInvoicesRange(db, {
          from: shiftDay(days[0], -6),
          to: shiftDay(days.at(-1)!, 7),
        }),
      [],
    ),
    safely(
      "load invoice preferences",
      () => listInvoiceTransactionPreferences(db),
      [],
    ),
    safely("load exchange rates", () => getExchangeRates(db), []),
  ]);
  const exchangeRates: Record<string, number> = Object.fromEntries(
    rates.map((rate) => [rate.currency, rate.rateTwd]),
  );
  const matches = matchInvoicesToTransactions(
    transactions,
    invoices,
    preferences,
    { exchangeRates },
  );
  const items = buildActivityItems(
    transactions.map((transaction) => ({
      ...transaction,
      description: transaction.description ?? null,
      counterparty: transaction.counterparty ?? null,
    })),
    [],
    [],
    new Map(),
    matches,
  );
  // 只需要交易項目；已配對的發票透過 invoiceId 帶入品項與分類。
  const annotated = await annotateActivityItems(db, items, {
    transactions,
    invoices,
  });
  const byId = new Map(annotated.map((item) => [item.id, item]));
  return transactions.map((transaction) => {
    const item = byId.get(transaction.id);
    if (!item) return transaction;
    return {
      ...transaction,
      merchantKey: item.merchantKey,
      displayName: item.displayName,
      merchantPaymentMethod: item.merchantPaymentMethod,
      itemsPreview: item.itemsPreview,
      categoryId: item.categoryId ?? UNCATEGORIZED_CATEGORY_ID,
      suggestedCategoryId: item.suggestedCategoryId,
      suggestionSource: item.suggestionSource,
      categorySource: item.categorySource ?? "none",
      note: item.note ?? null,
      noteTarget: item.noteTarget ?? null,
      ...(item.economicRole
        ? {
            economicRole: item.economicRole,
            reviewStatus: item.reviewStatus,
            roleReason: item.roleReason,
            investmentEventKind: item.investmentEventKind,
          }
        : {}),
      classification: transaction.classification
        ? {
            ...transaction.classification,
            categoryId:
              item.categoryId ?? transaction.classification.categoryId,
            label: item.category,
            source:
              item.classificationSource ?? transaction.classification.source,
          }
        : transaction.classification,
    };
  });
}
