import {
  INVOICE_MATCH_DAY_WINDOW,
  isVoidedInvoiceStatus,
  type InvoiceMatchDetail,
  type InvoiceTransactionMatches,
  type InvoiceTransactionPreference,
  type MatchingInvoice,
  type MatchingTransaction,
} from "./activity-matching";
import type { InvoiceMatchStatus } from "./invoice-match-status";
import {
  deriveInvoiceEconomicRoles,
  type EconomicRoleFields,
  type RoleTransaction,
} from "./economic-role";

/** 信用卡載具發票等待刷卡交易的天數；超過後標示 needs_review。 */
export const INVOICE_AWAITING_CARD_DAYS = 10;

export interface InvoiceMatchInfo {
  matchStatus: InvoiceMatchStatus;
  matchedTransactionId: string | null;
  /** 0–1；手動連結為 1，未配對為 null。 */
  matchScore: number | null;
  /** 發票載具對應到的已同步信用卡末四碼。 */
  carrierCardSuffix: string | null;
  /** awaiting_card 已超過等待天數。 */
  awaitingOverdue: boolean;
}

export interface InvoiceDedupeOptions {
  dayWindow?: number;
  /** 今天（YYYY-MM-DD，台北時間）；用來判斷 awaiting_card 是否逾期。 */
  today?: string;
}

function dayIndex(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return undefined;
  return (
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) /
    86_400_000
  );
}

const TAIPEI_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** 台北時間的日期（YYYY-MM-DD）。 */
export function taipeiDay(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime()))
    return typeof value === "string" ? value.slice(0, 10) : "";
  return TAIPEI_DAY.format(date);
}

function invoiceDay(invoice: MatchingInvoice) {
  return invoice.invoiceDate.length > 10
    ? taipeiDay(invoice.invoiceDate)
    : invoice.invoiceDate.slice(0, 10);
}

function detailFor(
  invoiceId: string,
  matches: InvoiceTransactionMatches,
): InvoiceMatchDetail {
  const detail = matches.details?.get(invoiceId);
  if (detail) return detail;
  const transactionId = matches.invoiceToTransactionId.get(invoiceId);
  return transactionId
    ? { outcome: "matched", transactionId }
    : { outcome: "unmatched" };
}

/** 由配對結果推導每張發票的 matchStatus。 */
export function invoiceMatchStatuses(
  invoices: MatchingInvoice[],
  transactions: Pick<MatchingTransaction, "id" | "accountType">[],
  matches: InvoiceTransactionMatches,
  options: Pick<InvoiceDedupeOptions, "today"> = {},
) {
  const accountTypes = new Map(
    transactions.map((transaction) => [
      transaction.id,
      transaction.accountType,
    ]),
  );
  const today = options.today ? dayIndex(options.today) : undefined;
  const result = new Map<string, InvoiceMatchInfo>();
  for (const invoice of invoices) {
    const detail = detailFor(invoice.id, matches);
    const base = {
      matchedTransactionId: null,
      matchScore: null,
      carrierCardSuffix: detail.carrierCardSuffix ?? null,
      awaitingOverdue: false,
    };
    if (
      (detail.outcome === "matched" || detail.outcome === "linked") &&
      detail.transactionId
    ) {
      result.set(invoice.id, {
        ...base,
        matchStatus:
          accountTypes.get(detail.transactionId) === "credit"
            ? "matched_card"
            : "matched_bank",
        matchedTransactionId: detail.transactionId,
        matchScore: detail.score ?? null,
      });
      continue;
    }
    // 重複開立的發票：列為「疑似重複」，需要確認（角色見 deriveInvoiceEconomicRoles）。
    if (detail.outcome === "ambiguous" || detail.outcome === "repeat") {
      result.set(invoice.id, { ...base, matchStatus: "ambiguous" });
      continue;
    }
    if (detail.outcome === "unmatched" && detail.carrierCardSuffix) {
      const day = dayIndex(invoiceDay(invoice));
      result.set(invoice.id, {
        ...base,
        matchStatus: "awaiting_card",
        awaitingOverdue:
          today != null &&
          day != null &&
          today - day > INVOICE_AWAITING_CARD_DAYS,
      });
      continue;
    }
    result.set(invoice.id, { ...base, matchStatus: "unmatched" });
  }
  return result;
}

/**
 * 推導發票的經濟角色與去重狀態。角色沿用 {@link deriveInvoiceEconomicRoles}，
 * 再依配對狀態調整：
 * - ambiguous：消費、needs_review（原因 invoice_ambiguous）。
 * - awaiting_card：消費（原因 invoice_awaiting_card），逾期才 needs_review；
 *   不再因為其他帳戶有同額交易而標示歧義（載具已限定這張卡）。
 * - unmatched 但附近有同額、仍計為消費的未配對交易：改為 ambiguous。
 * - 重複開立（配對結果 repeat）：matchStatus ambiguous；角色為重複（duplicateOf
 *   指向代表這筆消費的那張發票）、needs_review（原因 invoice_repeat），不計入金額。
 * - 作廢／註銷（{@link isVoidedInvoiceStatus}）：excluded（原因 invoice_voided），
 *   matchStatus 維持 unmatched；使用者 override 仍可改回。
 */
export function resolveInvoiceDedupe<I extends MatchingInvoice>(
  invoices: I[],
  transactions: RoleTransaction[],
  matches: InvoiceTransactionMatches<I>,
  preferences: InvoiceTransactionPreference[] = [],
  options: InvoiceDedupeOptions = {},
) {
  const dayWindow = options.dayWindow ?? INVOICE_MATCH_DAY_WINDOW;
  const statuses = invoiceMatchStatuses(invoices, transactions, matches, {
    today: options.today,
  });
  const roles = deriveInvoiceEconomicRoles(
    invoices,
    transactions,
    matches,
    preferences,
    dayWindow,
  );
  for (const invoice of invoices) {
    const status = statuses.get(invoice.id)!;
    const role = roles.get(invoice.id)!;
    if (isVoidedInvoiceStatus(invoice.invoiceStatus)) {
      // 作廢／註銷的發票沒有實際消費：不計入，也不參與配對與歧義判斷。
      roles.set(invoice.id, {
        economicRole: "excluded",
        reviewStatus: "auto",
        duplicateOf: null,
        investmentEventKind: null,
        roleReason: "invoice_voided",
      });
      continue;
    }
    if (role.duplicateOf) continue;
    const confirmed = role.reviewStatus === "confirmed";
    let next: EconomicRoleFields = role;
    if (status.matchStatus === "awaiting_card")
      next = {
        ...role,
        roleReason: "invoice_awaiting_card",
        reviewStatus: confirmed
          ? "confirmed"
          : status.awaitingOverdue
            ? "needs_review"
            : "auto",
      };
    else if (status.matchStatus === "ambiguous" && !confirmed)
      next = {
        ...role,
        roleReason: "invoice_ambiguous",
        reviewStatus: "needs_review",
      };
    else if (
      status.matchStatus === "unmatched" &&
      role.roleReason === "invoice_ambiguous"
    )
      statuses.set(invoice.id, { ...status, matchStatus: "ambiguous" });
    roles.set(invoice.id, next);
  }
  return { roles, statuses };
}

export {
  addInvoiceDedupeCount,
  emptyInvoiceDedupeCounts,
  INVOICE_MATCH_STATUSES,
  type InvoiceDedupeCounts,
  type InvoiceMatchStatus,
} from "./invoice-match-status";
