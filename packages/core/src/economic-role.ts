import {
  INVOICE_MATCH_DAY_WINDOW,
  invoiceTransactionDayGap,
  isForeignTransactionFee,
  isStoredValueTopUp,
  type InvoiceTransactionMatches,
  type InvoiceTransactionPreference,
  type MatchingInvoice,
  type MatchingTransaction,
} from "./activity-matching";
import { activityDateKey } from "./activity-list";
import { isForeignCurrencyInvoice } from "./invoice-currency";
import {
  isIncomeCategoryId,
  topLevelCategoryId,
  UNCATEGORIZED_CATEGORY_ID,
} from "./categories";
import type { ActivityItem } from "./activity-types";
import {
  addInvoiceDedupeCount,
  emptyInvoiceDedupeCounts,
  type InvoiceDedupeCounts,
} from "./invoice-match-status";
import {
  isTaiwanBankCode,
  taiwanBankCodeFromText,
  type OwnAccountKind,
} from "./taiwan-banks";

/**
 * 活動的經濟角色；在讀取時推導，不改寫交易本身。
 * - spending：消費（含退款，退款以正數沖減消費）
 * - income：收入
 * - own_transfer：自有帳戶間移轉（含電支儲值），以及被排除計算而沒有其他角色依據者
 * - investment：投資
 * - card_payment：繳已同步信用卡的卡費（銀行端扣款與卡片端入帳）
 * - excluded：不計入（沒有實際付款、已退款作廢、測試等）；列表仍列出，但不計入
 *   summary 的任何收支欄位，只另計 excludedAmount／excludedCount。
 */
export const ECONOMIC_ROLES = [
  "spending",
  "income",
  "own_transfer",
  "investment",
  "card_payment",
  "excluded",
] as const;
export type EconomicRole = (typeof ECONOMIC_ROLES)[number];

/**
 * 分類規則與商家規則可指定的角色（不含 excluded：「不計入」只針對個別活動，
 * 由 override 或作廢發票判定）。
 */
export const RULE_ECONOMIC_ROLES = [
  "spending",
  "income",
  "own_transfer",
  "investment",
  "card_payment",
] as const satisfies readonly EconomicRole[];
export type RuleEconomicRole = (typeof RULE_ECONOMIC_ROLES)[number];

export const ECONOMIC_ROLE_LABELS: Readonly<Record<EconomicRole, string>> = {
  spending: "消費",
  income: "收入",
  own_transfer: "轉到自己帳戶",
  investment: "投資",
  card_payment: "繳卡費",
  excluded: "不計入",
};

export const REVIEW_STATUSES = ["auto", "confirmed", "needs_review"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export type InvestmentEventKind = "buy" | "sell" | "dividend";

/** 可以被覆寫或被指為重複來源的活動種類。 */
export const ECONOMIC_ROLE_TARGET_KINDS = [
  "bank_transaction",
  "invoice",
] as const;
export type EconomicRoleTargetKind =
  (typeof ECONOMIC_ROLE_TARGET_KINDS)[number];

export interface ActivityRef {
  kind: EconomicRoleTargetKind;
  id: string;
}

/** 角色的判定依據，供畫面說明與除錯；不影響金額。 */
export type EconomicRoleReason =
  | "override"
  | "calculation_preference"
  | "own_account"
  | "unsynced_card"
  | "auto_transfer"
  | "card_payment"
  /** 銀行端繳卡費，但無法確認付給已同步的信用卡：可能是未同步的卡。 */
  | "possible_unsynced_card"
  | "ewallet_topup"
  /** 使用者的商家規則指定了角色。 */
  | "merchant_rule"
  /** 分類規則指定了角色（如投資、薪資）。 */
  | "rule"
  | "category"
  | "excluded"
  | "sign"
  | "invoice"
  | "invoice_matched"
  | "invoice_ambiguous"
  /** 發票載具是已同步的信用卡，等待該卡交易同步後合併。 */
  | "invoice_awaiting_card"
  /** 發票狀態不是有效開立（作廢、註銷等），自動不計入。 */
  | "invoice_voided"
  /**
   * 同一筆消費可能重複開立發票（同賣方、同品項、同原幣金額、24 小時內），
   * 付款只對應到其中一張；其餘暫不計入，待使用者確認。
   */
  | "invoice_repeat"
  | "trade";

export interface EconomicRoleFields {
  economicRole: EconomicRole;
  reviewStatus: ReviewStatus;
  /** 被判定為另一筆活動的重複時指向那筆；重複的活動不計入任何金額。 */
  duplicateOf: ActivityRef | null;
  investmentEventKind: InvestmentEventKind | null;
  roleReason: EconomicRoleReason;
}

export interface EconomicRoleOverride {
  targetKind: EconomicRoleTargetKind;
  targetId: string;
  economicRole: EconomicRole;
  reviewStatus: "confirmed";
  duplicateOf: ActivityRef | null;
  createdAt: string;
  updatedAt: string;
}

export const CREDIT_CARD_PAYMENT_RULE_ID = "system:bank:creditcard-payment";
export const EWALLET_TOP_UP_RULE_ID = "system:bank:ewallet-topup";
/** 轉帳提示規則：沒有分類也沒有角色，符合時依正負推導並標示待確認。 */
export const TRANSFER_HINT_RULE_ID = "system:bank:transfer-keywords";

/** 推導銀行／信用卡交易角色所需的訊號，由 API 端組裝。 */
export interface TransactionRoleSignals {
  amount: number;
  isCreditAccount: boolean;
  /** 新分類體系的分類 id；收入子類（income.*）推導為收入。 */
  categoryId?: string | null;
  classificationSource?: ActivityItem["classificationSource"];
  /** 符合的分類規則或個別覆寫所指定的角色（如投資、薪資、繳卡費）。 */
  ruleEconomicRole?: EconomicRole | null;
  /** 使用者商家規則指定的角色。 */
  merchantEconomicRole?: EconomicRole | null;
  /**
   * 符合「轉帳」關鍵字但無法確認對方：可能是未登記的自有帳戶，也可能是給別人的錢，
   * 依正負推導並標示待確認。
   */
  transferHint?: boolean;
  classificationRuleId?: string | null;
  /** 使用者對個別交易的「計入／不計入」設定；未設定為 null。 */
  calculationPreference?: "include" | "exclude" | null;
  ownAccountKind?: OwnAccountKind | null;
  /** 描述文字判定為繳信用卡費（銀行端扣款或卡片端繳款入帳）。 */
  isCardPayment?: boolean;
  /** 既有「不計入收支」的最終結果（excludedFromCalculation）。 */
  excludedFromCalculation?: boolean;
  /** 描述與對方名稱，用於判斷投資事件（如股利）。 */
  text?: string | null;
  /** 交易對手的金融機構代碼（可辨識時）。 */
  counterpartyBankCode?: string | null;
  /**
   * 系統中已同步信用卡的發卡銀行代碼。銀行端繳卡費只有在推得的發卡銀行
   * 屬於此集合時才視為繳已同步的卡；未提供時一律無法確認。
   */
  syncedCardIssuerCodes?: ReadonlySet<string>;
}

const DIVIDEND_TEXT = /股利|股息|配息|除息|dividend/i;
const BUY_TEXT = /買進|買入|申購|定期定額|buy/i;
const SELL_TEXT = /賣出|贖回|sell/i;

function roleFields(
  economicRole: EconomicRole,
  roleReason: EconomicRoleReason,
  reviewStatus: ReviewStatus = "auto",
  investmentEventKind: InvestmentEventKind | null = null,
): EconomicRoleFields {
  return {
    economicRole,
    reviewStatus,
    duplicateOf: null,
    investmentEventKind,
    roleReason,
  };
}

/** 依金額正負推導：信用卡的正數是退款（沖減消費），不是收入。 */
function signedRole(signals: TransactionRoleSignals): EconomicRole {
  if (signals.amount > 0 && !signals.isCreditAccount) return "income";
  return "spending";
}

function bankInvestmentEventKind(signals: TransactionRoleSignals) {
  // 銀行端的證券交割可能是買賣相抵後的淨額，只有股利可從文字可靠判斷。
  return signals.amount > 0 && DIVIDEND_TEXT.test(signals.text ?? "")
    ? ("dividend" as const)
    : null;
}

/** 信用卡端的貸項：繳款入帳（非退款、回饋）。 */
const CREDIT_PAYMENT_TEXT = /繳款|扣繳|自扣|還款|payment/i;
const CREDIT_REFUND_TEXT = /退款|退貨|退費|折讓|回饋|refund|cashback/i;

function isCardPaymentSignal(signals: TransactionRoleSignals) {
  if (
    signals.isCardPayment === true ||
    signals.ruleEconomicRole === "card_payment" ||
    signals.classificationRuleId === CREDIT_CARD_PAYMENT_RULE_ID
  )
    return true;
  const text = signals.text ?? "";
  return (
    signals.isCreditAccount &&
    signals.amount > 0 &&
    CREDIT_PAYMENT_TEXT.test(text) &&
    !CREDIT_REFUND_TEXT.test(text)
  );
}

/** 由對方銀行代碼或描述文字推得的發卡銀行代碼。 */
export function cardPaymentIssuerCode(
  signals: Pick<TransactionRoleSignals, "counterpartyBankCode" | "text">,
) {
  return isTaiwanBankCode(signals.counterpartyBankCode)
    ? signals.counterpartyBankCode
    : taiwanBankCodeFromText(signals.text);
}

/**
 * 信用卡端的繳款入帳一定屬於已同步的卡；存款端的繳卡費要能推得發卡銀行，
 * 且該銀行在系統中有已同步的信用卡帳戶，才確認是繳已同步的卡。
 */
function isSyncedCardPayment(signals: TransactionRoleSignals) {
  if (signals.isCreditAccount) return true;
  const issuer = cardPaymentIssuerCode(signals);
  return issuer != null && signals.syncedCardIssuerCodes?.has(issuer) === true;
}

/**
 * 推導銀行／信用卡交易的經濟角色（不含使用者 override，override 由
 * {@link applyEconomicRoleOverride} 套用）。優先順序：
 * 個別計算設定 → 自有帳戶 → 商家規則角色 → 自動互轉 → 系統規則（繳卡費、電支儲值）→
 * 規則角色（投資、收入、轉帳）與收入分類 → 其他排除 → 金額正負。
 */
export function deriveTransactionEconomicRole(
  signals: TransactionRoleSignals,
): EconomicRoleFields {
  const isInvestment = signals.ruleEconomicRole === "investment";

  if (signals.calculationPreference === "exclude")
    return roleFields(
      isCardPaymentSignal(signals) ? "card_payment" : "own_transfer",
      "calculation_preference",
      "confirmed",
    );
  if (signals.calculationPreference === "include")
    return isInvestment
      ? roleFields(
          "investment",
          "calculation_preference",
          "confirmed",
          bankInvestmentEventKind(signals),
        )
      : roleFields(signedRole(signals), "calculation_preference", "confirmed");

  if (signals.ownAccountKind === "own_account")
    return roleFields("own_transfer", "own_account");
  // 未同步卡片看不到消費明細，繳款是唯一的消費紀錄。
  if (signals.ownAccountKind === "unsynced_card")
    return roleFields("spending", "unsynced_card");

  // 商家規則是使用者對整個商家的明確決定，回溯套用到該商家所有交易。
  if (signals.merchantEconomicRole)
    return roleFields(
      signals.merchantEconomicRole,
      "merchant_rule",
      "confirmed",
      signals.merchantEconomicRole === "investment"
        ? bankInvestmentEventKind(signals)
        : null,
    );

  if (signals.classificationSource === "auto_transfer")
    return roleFields("own_transfer", "auto_transfer");
  if (isCardPaymentSignal(signals))
    return isSyncedCardPayment(signals)
      ? roleFields("card_payment", "card_payment")
      : roleFields("card_payment", "possible_unsynced_card", "needs_review");
  if (signals.classificationRuleId === EWALLET_TOP_UP_RULE_ID)
    return roleFields("own_transfer", "ewallet_topup");
  if (isInvestment)
    return roleFields(
      "investment",
      "category",
      "auto",
      bankInvestmentEventKind(signals),
    );
  if (
    signals.ruleEconomicRole === "income" ||
    isIncomeCategoryId(signals.categoryId)
  )
    return roleFields("income", "category");
  if (signals.ruleEconomicRole === "own_transfer")
    return roleFields("own_transfer", "rule");
  if (signals.ruleEconomicRole === "spending")
    return roleFields("spending", "rule");
  if (signals.excludedFromCalculation)
    return roleFields("own_transfer", "excluded");

  // 符合轉帳關鍵字、但對方不是已登記的自有帳戶：可能是未同步的自有帳戶，
  // 也可能真的是給別人的錢，交給使用者確認。
  return roleFields(
    signedRole(signals),
    "sign",
    signals.transferHint ? "needs_review" : "auto",
  );
}

/** 投資交易（集保、券商）只能從交易名稱判斷事件種類。 */
export function tradeInvestmentEventKind(trade: {
  transactionName?: string | null;
  transactionCode?: string | null;
}): InvestmentEventKind | null {
  const text = `${trade.transactionName ?? ""} ${trade.transactionCode ?? ""}`;
  if (DIVIDEND_TEXT.test(text)) return "dividend";
  if (SELL_TEXT.test(text)) return "sell";
  if (BUY_TEXT.test(text)) return "buy";
  return null;
}

export function tradeEconomicRole(trade: {
  transactionName?: string | null;
  transactionCode?: string | null;
}): EconomicRoleFields {
  return roleFields(
    "investment",
    "trade",
    "auto",
    tradeInvestmentEventKind(trade),
  );
}

/**
 * 套用使用者 override：角色與 reviewStatus=confirmed 以 override 為準。
 * override 未指定 duplicateOf 時保留推導出的重複關係（例如已配對的發票）；
 * 要讓已配對的發票單獨計算，應使用發票配對的「分開記錄」。
 * 重複開立（invoice_repeat）的發票亦同：override 只確認角色，要計入消費應使用
 * 「分開記錄」（該張即退出重複開立的判斷）。
 */
export function applyEconomicRoleOverride(
  fields: EconomicRoleFields,
  override?: Pick<EconomicRoleOverride, "economicRole" | "duplicateOf"> | null,
): EconomicRoleFields {
  if (!override) return fields;
  return {
    economicRole: override.economicRole,
    reviewStatus: "confirmed",
    duplicateOf: override.duplicateOf ?? fields.duplicateOf,
    investmentEventKind:
      override.economicRole === "investment"
        ? fields.investmentEventKind
        : null,
    roleReason: "override",
  };
}

export function economicRoleOverrideKey(
  kind: EconomicRoleTargetKind,
  id: string,
) {
  return `${kind}\u0000${id}`;
}

export type RoleTransaction = MatchingTransaction &
  Pick<EconomicRoleFields, "economicRole" | "duplicateOf">;

/**
 * 推導發票角色（尚未套用 override）：
 * - 已與交易配對：duplicateOf 指向該交易，金額以交易為準。
 * - 使用者選擇「分開記錄」：消費，已確認。
 * - 重複開立（配對結果 repeat）：duplicateOf 指向代表這筆消費的發票（已配對者，
 *   沒有付款紀錄時為第一張），needs_review，原因 invoice_repeat，不計入金額。
 * - 其餘未配對：消費；若 ±3 天內有同金額、仍計為消費且未配對的交易
 *   （配對無法唯一決定），標示 needs_review。外幣發票的金額不是台幣，不做此判斷。
 */
export function deriveInvoiceEconomicRoles<I extends MatchingInvoice>(
  invoices: I[],
  transactions: RoleTransaction[],
  matches: InvoiceTransactionMatches<I>,
  preferences: InvoiceTransactionPreference[] = [],
  dayWindow = INVOICE_MATCH_DAY_WINDOW,
): Map<string, EconomicRoleFields> {
  const decisions = new Map(
    preferences.map((preference) => [preference.invoiceId, preference]),
  );
  const unmatchedSpending = transactions.filter(
    (transaction) =>
      !matches.transactionToInvoice.has(transaction.id) &&
      transaction.economicRole === "spending" &&
      transaction.duplicateOf == null &&
      transaction.currency === "TWD" &&
      transaction.amount < 0 &&
      !isStoredValueTopUp(transaction) &&
      !isForeignTransactionFee(transaction),
  );
  const result = new Map<string, EconomicRoleFields>();
  for (const invoice of invoices) {
    const decision = decisions.get(invoice.id);
    const transactionId = matches.invoiceToTransactionId.get(invoice.id);
    if (transactionId) {
      result.set(invoice.id, {
        ...roleFields(
          "spending",
          "invoice_matched",
          decision?.decision === "linked" ? "confirmed" : "auto",
        ),
        duplicateOf: { kind: "bank_transaction", id: transactionId },
      });
      continue;
    }
    if (decision?.decision === "separate") {
      result.set(invoice.id, roleFields("spending", "invoice", "confirmed"));
      continue;
    }
    const detail = matches.details?.get(invoice.id);
    if (detail?.outcome === "repeat" && detail.repeatOf) {
      result.set(invoice.id, {
        ...roleFields("spending", "invoice_repeat", "needs_review"),
        duplicateOf: { kind: "invoice", id: detail.repeatOf },
      });
      continue;
    }
    const ambiguous =
      !isForeignCurrencyInvoice(invoice) &&
      unmatchedSpending.some((transaction) => {
        if (Math.abs(transaction.amount) !== invoice.amount) return false;
        const gap = invoiceTransactionDayGap(invoice, transaction);
        return gap != null && gap <= dayWindow;
      });
    result.set(
      invoice.id,
      ambiguous
        ? roleFields("spending", "invoice_ambiguous", "needs_review")
        : roleFields("spending", "invoice"),
    );
  }
  return result;
}

export interface ActivityMonthSummary {
  /** YYYY-MM（台北時間）。 */
  month: string;
  currency: "TWD";
  income: number;
  spending: number;
  /** 投資淨流出（買進減賣出、股利）。 */
  investment: number;
  /** 轉到自己帳戶的流出總額（自有帳戶間的流入不另計）。 */
  ownTransfer: number;
  /** 繳已同步信用卡卡費的流出總額。 */
  cardPayment: number;
  /** income − spending。 */
  saved: number;
  needsReview: { count: number; amount: number };
  /** 判定為重複而不計入的金額（絕對值加總）。 */
  duplicateExcluded: number;
  /** 角色為「不計入」（excluded）的金額（絕對值加總，TWD）；不計入其他任何欄位。 */
  excludedAmount: number;
  /** 角色為「不計入」的活動筆數（含缺匯率者）。 */
  excludedCount: number;
  /**
   * 頂層消費分類 id → 消費淨額（新分類體系；`other` 為未分類，使用者自訂分類
   * 歸入 `misc`）。
   */
  spendingByCategory: Record<string, number>;
  /** 指定的分類 id（子類，或只指定到頂層時為頂層 id）→ 消費淨額。 */
  spendingBySubcategory: Record<string, number>;
  /** 有任何 incompleteReasons 時為 false。 */
  complete: boolean;
  /** 缺匯率的外幣；這些金額不計入任何欄位。 */
  missingCurrencies: string[];
  incompleteReasons: ActivitySummaryIncompleteReason[];
  /** 此月份計入的活動筆數（不含重複、不計入與投資交易明細）。 */
  activityCount: number;
  /** 發票與刷卡／銀行交易的去重結果（依發票日期歸月）。 */
  dedupe: InvoiceDedupeCounts;
}

/**
 * 月 summary 不完整的原因：
 * - missing_exchange_rates：有外幣缺匯率。
 * - classification_unavailable：分類規則載入失敗，角色只能依正負推導。
 * - role_overrides_unavailable：使用者 override 載入失敗，未套用。
 * - own_accounts_unavailable：「我的其他帳戶」載入失敗，互轉未排除。
 */
export const ACTIVITY_SUMMARY_INCOMPLETE_REASONS = [
  "missing_exchange_rates",
  "classification_unavailable",
  "role_overrides_unavailable",
  "own_accounts_unavailable",
] as const;
export type ActivitySummaryIncompleteReason =
  (typeof ACTIVITY_SUMMARY_INCOMPLETE_REASONS)[number];

export type SummaryActivity = Pick<
  ActivityItem,
  | "source"
  | "date"
  | "dateHasTime"
  | "amount"
  | "currency"
  | "categoryId"
  | "excludedFromCalculation"
  | "matchStatus"
> &
  Partial<
    Pick<EconomicRoleFields, "economicRole" | "reviewStatus" | "duplicateOf">
  >;

/** 沒有 matchStatus 的舊項目由 duplicateOf 與 roleReason 推得。 */
function invoiceSummaryStatus(item: SummaryActivity) {
  if (item.matchStatus) return item.matchStatus;
  if (item.duplicateOf) return "matched_bank" as const;
  return item.reviewStatus === "needs_review"
    ? ("ambiguous" as const)
    : ("unmatched" as const);
}

/** 沒有推導角色的舊項目沿用既有口徑：不計入者視為移轉，其餘依正負。 */
function effectiveRole(item: SummaryActivity, amount: number): EconomicRole {
  if (item.economicRole) return item.economicRole;
  if (item.excludedFromCalculation) return "own_transfer";
  return amount > 0 ? "income" : "spending";
}

function signedAmount(item: SummaryActivity) {
  if (item.amount == null) return undefined;
  // 發票金額為正數，代表支出。
  return item.source === "invoice" ? -Math.abs(item.amount) : item.amount;
}

function toTwd(
  amount: number,
  currency: string,
  rates: Readonly<Record<string, number>>,
) {
  if (amount === 0 || currency === "TWD") return amount;
  const rate = rates[currency];
  return rate != null && Number.isFinite(rate) && rate > 0
    ? amount * rate
    : undefined;
}

const round = (value: number) => Math.round(value * 100) / 100 || 0;

/**
 * 依經濟角色彙總月份收支。只計入銀行、信用卡與發票；投資交易明細
 * （集保、券商）只列示，金流以銀行端交割為準，避免雙算。
 */
export function summarizeActivityMonths(
  items: SummaryActivity[],
  months: string[],
  rates: Readonly<Record<string, number>>,
  /** 載入資料時發生的問題；套用到所有月份。 */
  dataIssues: readonly ActivitySummaryIncompleteReason[] = [],
): ActivityMonthSummary[] {
  const summaries = new Map(
    months.map((month) => [
      month,
      {
        month,
        currency: "TWD" as const,
        income: 0,
        spending: 0,
        investment: 0,
        ownTransfer: 0,
        cardPayment: 0,
        saved: 0,
        needsReview: { count: 0, amount: 0 },
        duplicateExcluded: 0,
        excludedAmount: 0,
        excludedCount: 0,
        spendingByCategory: {} as Record<string, number>,
        spendingBySubcategory: {} as Record<string, number>,
        complete: true,
        missingCurrencies: [] as string[],
        incompleteReasons: [] as ActivitySummaryIncompleteReason[],
        activityCount: 0,
        dedupe: emptyInvoiceDedupeCounts(),
      },
    ]),
  );
  for (const item of items) {
    if (
      item.source !== "bank" &&
      item.source !== "card" &&
      item.source !== "invoice"
    )
      continue;
    const summary = summaries.get(activityDateKey(item).slice(0, 7));
    if (!summary) continue;
    // 不計入：不進任何收支、重複、待確認或去重欄位，也不因缺匯率而標示不完整。
    if (item.economicRole === "excluded") {
      summary.excludedCount += 1;
      const signed = signedAmount(item);
      const amount =
        signed == null ? undefined : toTwd(signed, item.currency, rates);
      if (amount != null) summary.excludedAmount += Math.abs(amount);
      continue;
    }
    if (item.source === "invoice")
      addInvoiceDedupeCount(summary.dedupe, invoiceSummaryStatus(item));
    const signed = signedAmount(item);
    if (signed == null) continue;
    const amount = toTwd(signed, item.currency, rates);
    // 重複項目不計入任何金額，缺匯率也不影響完整性。
    if (amount == null && item.duplicateOf) continue;
    if (amount == null) {
      if (!summary.missingCurrencies.includes(item.currency))
        summary.missingCurrencies.push(item.currency);
      continue;
    }
    if (item.duplicateOf) {
      summary.duplicateExcluded += Math.abs(amount);
      continue;
    }
    summary.activityCount += 1;
    if (item.reviewStatus === "needs_review") {
      summary.needsReview.count += 1;
      summary.needsReview.amount += Math.abs(amount);
    }
    switch (effectiveRole(item, amount)) {
      case "income":
        summary.income += amount;
        break;
      case "spending": {
        summary.spending -= amount;
        const categoryId = item.categoryId ?? UNCATEGORIZED_CATEGORY_ID;
        const topLevel = topLevelCategoryId(categoryId);
        summary.spendingByCategory[topLevel] =
          (summary.spendingByCategory[topLevel] ?? 0) - amount;
        summary.spendingBySubcategory[categoryId] =
          (summary.spendingBySubcategory[categoryId] ?? 0) - amount;
        break;
      }
      case "investment":
        summary.investment -= amount;
        break;
      case "own_transfer":
        if (amount < 0) summary.ownTransfer -= amount;
        break;
      case "card_payment":
        if (amount < 0) summary.cardPayment -= amount;
        break;
    }
  }
  return months.map((month) => {
    const summary = summaries.get(month)!;
    return {
      ...summary,
      income: round(summary.income),
      spending: round(summary.spending),
      investment: round(summary.investment),
      ownTransfer: round(summary.ownTransfer),
      cardPayment: round(summary.cardPayment),
      saved: round(summary.income - summary.spending),
      needsReview: {
        count: summary.needsReview.count,
        amount: round(summary.needsReview.amount),
      },
      duplicateExcluded: round(summary.duplicateExcluded),
      excludedAmount: round(summary.excludedAmount),
      spendingByCategory: roundValues(summary.spendingByCategory),
      spendingBySubcategory: roundValues(summary.spendingBySubcategory),
      missingCurrencies: [...summary.missingCurrencies].sort(),
      ...completeness(summary.missingCurrencies, dataIssues),
    };
  });
}

function roundValues(values: Record<string, number>) {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, round(value)]),
  );
}

function completeness(
  missingCurrencies: string[],
  dataIssues: readonly ActivitySummaryIncompleteReason[],
) {
  const reasons = new Set<ActivitySummaryIncompleteReason>(dataIssues);
  if (missingCurrencies.length) reasons.add("missing_exchange_rates");
  const incompleteReasons = ACTIVITY_SUMMARY_INCOMPLETE_REASONS.filter(
    (reason) => reasons.has(reason),
  );
  return { complete: incompleteReasons.length === 0, incompleteReasons };
}
