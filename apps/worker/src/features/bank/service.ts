import {
  listBankAccounts,
  listBankTransactions,
  listBankTransactionsForTransferMatching,
  listBankTransactionsInRange,
  listCreditCardBills,
  listCreditCardBillsInRange,
  type BankTransactionPageRow,
  type CreditCardBillPageCursor,
} from "./repository";
import type { TransactionPageCursor } from "../investments/repository";
import type { MonthDateRange } from "../../platform/month-range";
import {
  normalizeBankAccountDisplay,
  normalizeBankTransactionDisplay,
} from "./display";
import {
  isCardPaymentText,
  resolveCalculationExclusion,
} from "./calculation-service";
import {
  resolveClassifications,
  type ClassificationResult,
} from "../classification/service";
import {
  applyEconomicRoleOverride,
  bankMerchantIdentity,
  CONNECTOR_BANK_CODES,
  deriveTransactionEconomicRole,
  economicRoleOverrideKey,
  findOwnAccount,
  isTaiwanBankCode,
  ownAccountDisplayName,
  taiwanBankCodeFromText,
  UNCATEGORIZED_CATEGORY_ID,
  type ActivitySummaryIncompleteReason,
  type EconomicRoleOverride,
} from "@taiwan-fin-hub/core";
import { loadActivityRoleOverrides } from "../activity-roles/service";
import { getOwnAccounts } from "../own-accounts/service";
import type { OwnAccountRow } from "../own-accounts/repository";
import {
  findAutomaticCreditOffsetTransactionIds,
  findAutomaticTransferTransactionIds,
  getAutomaticTransferDay,
} from "./transfer-matching";

export async function getBankPage(
  db: D1Database,
  limit: number,
  cursor?: TransactionPageCursor,
) {
  const [accounts, transactions] = await Promise.all([
    listBankAccounts(db),
    listBankTransactions(db, limit + 1, cursor),
  ]);
  const hasMore = transactions.length > limit;
  const page = transactions.slice(0, limit);
  return {
    hasMore,
    last: page.at(-1),
    accounts: accounts.map(normalizeBankAccountDisplay),
    transactions: (await presentBankTransactions(db, page, accounts))
      .transactions,
  };
}

type BankAccountRows = Awaited<ReturnType<typeof listBankAccounts>>;

export async function getBankRange(
  db: D1Database,
  range: MonthDateRange,
  days?: string[],
  accountRows?: BankAccountRows,
) {
  const { dataIssues: _dataIssues, ...result } = await loadBankRange(
    db,
    range,
    days,
    accountRows,
  );
  return result;
}

/**
 * 與 getBankRange 相同，另回報讀取時推導所依賴的資料（分類、override、
 * 自有帳戶）是否載入失敗，供收支 summary 標示不完整。
 */
export async function loadBankRange(
  db: D1Database,
  range: MonthDateRange,
  days?: string[],
  accountRows?: BankAccountRows,
) {
  const [accounts, transactions] = await Promise.all([
    accountRows ? Promise.resolve(accountRows) : listBankAccounts(db),
    listBankTransactionsInRange(db, range, days),
  ]);
  return {
    accounts: accounts.map(normalizeBankAccountDisplay),
    ...(await presentBankTransactions(db, transactions, accounts)),
  };
}

/** 系統中仍在同步的信用卡帳戶的發卡銀行代碼。 */
function syncedCardIssuerCodes(accounts: BankAccountRows) {
  const codes = new Set<string>();
  for (const account of accounts) {
    if (account.accountType !== "credit") continue;
    const code = isTaiwanBankCode(account.bankCode)
      ? account.bankCode
      : (CONNECTOR_BANK_CODES[account.connectorId] ??
        taiwanBankCodeFromText(account.institutionName));
    if (code) codes.add(code);
  }
  return codes;
}

async function presentBankTransactions(
  db: D1Database,
  transactions: BankTransactionPageRow[],
  accounts: BankAccountRows,
) {
  const dataIssues: ActivitySummaryIncompleteReason[] = [];
  // The counterpart can be on another page, so expand the set before classifying.
  const transactionsForClassification = await loadTransferCandidates(
    db,
    transactions,
  );
  let classificationMap: Map<string, ClassificationResult>;
  let classificationsReady = true;
  try {
    classificationMap = await resolveClassifications(
      db,
      transactionsForClassification.map((transaction) => ({
        id: transaction.id,
        description: transaction.description,
        counterparty: transaction.counterparty,
        sourceId: transaction.sourceId,
        amount: transaction.amount,
        // 交易自身的商家 key；已配對發票的商家規則在活動層合併。
        merchantKeys: [bankMerchantIdentity(transaction)?.merchantKey].filter(
          (key): key is string => Boolean(key),
        ),
      })),
    );
  } catch (error) {
    console.error("[classify] resolveClassifications failed:", error);
    classificationMap = new Map();
    classificationsReady = false;
    dataIssues.push("classification_unavailable");
  }

  const eligibleTransactions = transactionsForClassification.filter(
    (transaction) => {
      const classification = classificationMap.get(transaction.id);
      return (
        // An explicit include preference or user classification wins.
        transaction.calculationPreference !== 0 &&
        !isUserClassification(classification)
      );
    },
  );
  const automaticTransferIds = classificationsReady
    ? findAutomaticTransferTransactionIds(eligibleTransactions)
    : new Set<string>();
  const automaticCreditOffsetIds = classificationsReady
    ? findAutomaticCreditOffsetTransactionIds(eligibleTransactions)
    : new Set<string>();
  const [ownAccounts, roleOverrides] = await Promise.all([
    loadOwnAccounts(db, transactions, dataIssues),
    loadRoleOverrides(db, transactions, dataIssues),
  ]);
  const cardIssuers = syncedCardIssuerCodes(accounts);

  const presented = transactions.map(
    ({
      effectiveDate: _effectiveDate,
      updatedAt: _updatedAt,
      ...transaction
    }) => {
      const ownAccount = matchOwnAccount(transaction, ownAccounts);
      const ruleClassification = classificationMap.get(transaction.id);
      const classification = automaticCreditOffsetIds.has(transaction.id)
        ? {
            // 年費減免等信用卡自動沖銷：手續費歸「其他」（0067 起沒有手續費子類）。
            categoryId: "misc",
            label: "其他",
            source: "auto_offset" as const,
            excludedFromCalculation: true,
          }
        : automaticTransferIds.has(transaction.id)
          ? {
              categoryId: UNCATEGORIZED_CATEGORY_ID,
              label: "轉帳",
              source: "auto_transfer" as const,
              excludedFromCalculation: true,
            }
          : ownAccount && !isUserClassification(ruleClassification)
            ? ownAccountClassification(ownAccount, transaction.amount)
            : ruleClassification;
      const excludedFromCalculation = resolveCalculationExclusion({
        transferPeerId: transaction.transferPeerId,
        accountType: transaction.accountType,
        description: transaction.description,
        counterparty: transaction.counterparty,
        calculationPreference: transaction.calculationPreference,
        classificationExcludedFromCalculation:
          classification?.excludedFromCalculation,
        ownAccountKind: ownAccount?.kind,
      });
      // 經濟角色與自有帳戶比對相同，在讀取時推導，只有使用者 override 會持久化。
      const role = applyEconomicRoleOverride(
        deriveTransactionEconomicRole({
          amount: transaction.amount,
          isCreditAccount: transaction.accountType === "credit",
          categoryId: classification?.categoryId,
          classificationSource: classification?.source,
          classificationRuleId: classification?.ruleId,
          ruleEconomicRole: classification?.economicRole,
          merchantEconomicRole: ruleClassification?.merchantEconomicRole,
          transferHint: classification?.transferHint,
          calculationPreference:
            transaction.calculationPreference === 1
              ? "exclude"
              : transaction.calculationPreference === 0
                ? "include"
                : null,
          ownAccountKind: ownAccount?.kind,
          isCardPayment: isCardPaymentText(transaction),
          counterpartyBankCode: transaction.counterpartyBankCode,
          syncedCardIssuerCodes: cardIssuers,
          excludedFromCalculation,
          text: [transaction.description, transaction.counterparty]
            .filter(Boolean)
            .join(" "),
        }),
        roleOverrides.get(
          economicRoleOverrideKey("bank_transaction", transaction.id),
        ),
      );
      return {
        ...normalizeBankTransactionDisplay(transaction),
        excludedFromCalculation,
        ...role,
        classification,
        ownAccount: ownAccount
          ? {
              id: ownAccount.id,
              kind: ownAccount.kind,
              label: ownAccountDisplayName(ownAccount),
            }
          : undefined,
      };
    },
  );
  return { transactions: presented, dataIssues };
}

/** 使用者明確指定的分類（個別覆寫、商家規則、使用者規則）優先於系統判斷。 */
function isUserClassification(classification?: ClassificationResult) {
  return (
    classification?.source === "override" ||
    classification?.source === "merchant_rule" ||
    classification?.source === "user_rule"
  );
}

function ownAccountClassification(
  ownAccount: OwnAccountRow,
  amount: number,
): ClassificationResult {
  if (ownAccount.kind === "unsynced_card") {
    // 沒有同步的卡片看不到消費明細，轉入款項視為該卡消費，仍計入支出。
    const name = ownAccountDisplayName(ownAccount);
    return {
      categoryId: UNCATEGORIZED_CATEGORY_ID,
      label: amount < 0 ? `繳卡費（${name}）` : `卡片退款（${name}）`,
      source: "unsynced_card",
      excludedFromCalculation: false,
    };
  }
  return {
    categoryId: UNCATEGORIZED_CATEGORY_ID,
    label: "轉帳",
    source: "own_account",
    excludedFromCalculation: true,
  };
}

async function loadRoleOverrides(
  db: D1Database,
  transactions: BankTransactionPageRow[],
  dataIssues: ActivitySummaryIncompleteReason[],
): Promise<Map<string, EconomicRoleOverride>> {
  if (transactions.length === 0) return new Map();
  try {
    return await loadActivityRoleOverrides(
      db,
      "bank_transaction",
      transactions.map((transaction) => transaction.id),
    );
  } catch (error) {
    console.error("[activity-roles] load role overrides failed:", error);
    dataIssues.push("role_overrides_unavailable");
    return new Map();
  }
}

async function loadOwnAccounts(
  db: D1Database,
  transactions: BankTransactionPageRow[],
  dataIssues: ActivitySummaryIncompleteReason[],
): Promise<OwnAccountRow[]> {
  if (!transactions.some((transaction) => transaction.counterpartyBankCode))
    return [];
  try {
    return await getOwnAccounts(db);
  } catch (error) {
    console.error("[own-accounts] load own accounts failed:", error);
    dataIssues.push("own_accounts_unavailable");
    return [];
  }
}

// 以讀取時比對套用，新增或刪除自有帳戶會回溯影響所有月份，不改寫交易資料。
function matchOwnAccount(
  transaction: Pick<
    BankTransactionPageRow,
    "accountType" | "counterpartyBankCode" | "counterpartyAccountSuffix"
  >,
  ownAccounts: OwnAccountRow[],
) {
  const bankCode = transaction.counterpartyBankCode;
  const accountSuffix = transaction.counterpartyAccountSuffix;
  if (
    ownAccounts.length === 0 ||
    transaction.accountType === "credit" ||
    !isTaiwanBankCode(bankCode) ||
    !accountSuffix
  )
    return undefined;
  return findOwnAccount({ bankCode, accountSuffix }, ownAccounts);
}

async function loadTransferCandidates(
  db: D1Database,
  transactions: BankTransactionPageRow[],
) {
  if (transactions.length === 0) return transactions;

  const visibleKeys = new Set(
    transactions
      .map(transferMatchKey)
      .filter((key): key is string => key !== undefined),
  );
  if (visibleKeys.size === 0) return transactions;

  let candidates: BankTransactionPageRow[];
  try {
    candidates = await listBankTransactionsForTransferMatching(
      db,
      transactions,
      [
        ...new Set(
          transactions
            .map(getAutomaticTransferDay)
            .filter((day): day is string => day !== undefined),
        ),
      ],
    );
  } catch (error) {
    console.error("[transfer] load transfer candidates failed:", error);
    return transactions;
  }

  const byId = new Map(
    transactions.map((transaction) => [transaction.id, transaction]),
  );
  for (const candidate of candidates) {
    if (visibleKeys.has(transferMatchKey(candidate) ?? ""))
      byId.set(candidate.id, candidate);
  }
  return [...byId.values()];
}

function transferMatchKey(transaction: BankTransactionPageRow) {
  const day = getAutomaticTransferDay(transaction);
  if (!day || !Number.isFinite(transaction.amount) || transaction.amount === 0)
    return undefined;
  const currency = transaction.currency.trim().toUpperCase();
  if (!currency) return undefined;
  return `${day}\u0000${currency}\u0000${Math.abs(transaction.amount)}`;
}

export async function getCreditCardBillPage(
  db: D1Database,
  limit: number,
  cursor?: CreditCardBillPageCursor,
) {
  const rows = await listCreditCardBills(db, limit + 1, cursor);
  const hasMore = rows.length > limit;
  const bills = rows.slice(0, limit);
  return { hasMore, bills, last: bills.at(-1) };
}

export async function getCreditCardBillsRange(
  db: D1Database,
  range: MonthDateRange,
) {
  return listCreditCardBillsInRange(db, range);
}
