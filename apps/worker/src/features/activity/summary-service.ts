import {
  activityDateKey,
  applyEconomicRoleOverride,
  buildActivityItems,
  deduplicateBankTransactions,
  economicRoleOverrideKey,
  INVOICE_MATCH_CONTEXT_DAYS,
  matchInvoicesToTransactions,
  resolveInvoiceDedupe,
  summarizeActivityMonths,
  taipeiDay,
  type ActivityItem,
  type ActivitySourceRecord,
  type ActivitySummaryIncompleteReason,
  type EconomicRoleFields,
  type EconomicRoleOverride,
} from "@taiwan-fin-hub/core";
import { listBankAccounts } from "../bank/repository";
import { normalizeBankAccountDisplay } from "../bank/display";
import { loadBankRange } from "../bank/service";
import { getInvoicesRange } from "../invoices/service";
import { getInvestmentTransactionsRange } from "../investments/service";
import { getExchangeRates } from "../exchange-rates/service";
import { loadActivityRoleOverrides } from "../activity-roles/service";
import { listInvoiceTransactionPreferences } from "./repository";
import { annotateActivityItems } from "../merchants/annotate";

function shiftDay(day: string, offset: number) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function nextMonth(month: string) {
  const [year, value] = month.split("-").map(Number);
  return value === 12
    ? `${year + 1}-01`
    : `${year}-${String(value + 1).padStart(2, "0")}`;
}

/** 由起訖月份（含）列出 YYYY-MM。 */
export function monthsBetween(from: string, to: string) {
  const months: string[] = [];
  for (let month = from; month <= to; month = nextMonth(month))
    months.push(month);
  return months;
}

/** 已同步信用卡的末四碼，用來辨識發票的信用卡載具。 */
export function syncedCardSuffixes(
  accounts: Array<{
    accountType?: string | null;
    accountLast4?: string | null;
  }>,
) {
  return new Set(
    accounts
      .filter(
        (account) =>
          account.accountType === "credit" &&
          /^\d{4}$/u.test(account.accountLast4 ?? ""),
      )
      .map((account) => account.accountLast4!),
  );
}

/**
 * 讀取月份的活動並推導經濟角色。前後多載入發票配對所需的天數，
 * 讓跨月邊界的配對與歧義判斷看得到所有候選；輸出只保留指定月份。
 */
export async function loadRoleActivities(
  db: D1Database,
  months: string[],
  options: { includeTrades: boolean; today?: string },
) {
  const first = months[0];
  const last = months.at(-1)!;
  const range = {
    from: shiftDay(`${first}-01`, -INVOICE_MATCH_CONTEXT_DAYS),
    to: shiftDay(`${nextMonth(last)}-01`, INVOICE_MATCH_CONTEXT_DAYS),
  };
  const [accountRows, preferences, rates] = await Promise.all([
    listBankAccounts(db),
    listInvoiceTransactionPreferences(db),
    getExchangeRates(db),
  ]);
  const [bank, invoices, trades] = await Promise.all([
    loadBankRange(db, range, undefined, accountRows),
    getInvoicesRange(db, range),
    options.includeTrades
      ? getInvestmentTransactionsRange(db, {
          from: `${first}-01`,
          to: `${nextMonth(last)}-01`,
        })
      : Promise.resolve([]),
  ]);
  const accounts = accountRows.map(normalizeBankAccountDisplay);
  const accountMap = new Map(
    accounts.map((account) => [
      String(account.id),
      { ...account, id: String(account.id) },
    ]),
  );
  const transactions = deduplicateBankTransactions(
    bank.transactions.map((transaction) => ({
      ...transaction,
      accountType:
        transaction.accountType ??
        accountMap.get(transaction.accountId)?.accountType,
    })),
  );
  const exchangeRates: Record<string, number> = Object.fromEntries(
    rates.map((rate) => [rate.currency, rate.rateTwd]),
  );
  const matches = matchInvoicesToTransactions(
    transactions,
    invoices,
    preferences,
    { syncedCardSuffixes: syncedCardSuffixes(accounts), exchangeRates },
  );
  const { roles: derived, statuses } = resolveInvoiceDedupe(
    invoices,
    transactions,
    matches,
    preferences,
    { today: options.today ?? taipeiDay(new Date()) },
  );
  const dataIssues = new Set<ActivitySummaryIncompleteReason>(bank.dataIssues);
  let overrides = new Map<string, EconomicRoleOverride>();
  try {
    overrides = await loadActivityRoleOverrides(
      db,
      "invoice",
      invoices.map((invoice) => invoice.id),
    );
  } catch (error) {
    console.error("[activity-roles] load invoice overrides failed:", error);
    dataIssues.add("role_overrides_unavailable");
  }
  const invoiceRoles = new Map<string, EconomicRoleFields>(
    [...derived].map(([id, fields]) => [
      id,
      applyEconomicRoleOverride(
        fields,
        overrides.get(economicRoleOverrideKey("invoice", id)),
      ),
    ]),
  );
  const monthSet = new Set(months);
  const built = buildActivityItems(
    transactions,
    invoices,
    trades,
    accountMap,
    matches,
    {
      roles: { invoices: invoiceRoles, invoiceMatches: statuses },
      exchangeRates,
    },
  ).filter((item) => monthSet.has(activityDateKey(item).slice(0, 7)));
  // 商家名稱、品項、新分類（含已配對發票的分類與商家規則）與分類建議。
  const items = await annotateActivityItems(db, built, {
    transactions,
    invoices,
  });
  return {
    items,
    transactions,
    invoices,
    invoiceMatches: statuses,
    dataIssues: [...dataIssues],
    rates: exchangeRates,
  };
}

/** 指定月份（遞增）的活動與推導角色，不含投資交易明細；供收件匣等彙整使用。 */
export async function getRoleActivitiesForMonths(
  db: D1Database,
  months: string[],
) {
  const { items, dataIssues } = await loadRoleActivities(db, months, {
    includeTrades: false,
  });
  return { items, dataIssues };
}

export async function getActivitySummary(db: D1Database, months: string[]) {
  const { items, rates, dataIssues } = await loadRoleActivities(db, months, {
    includeTrades: false,
  });
  return {
    months: summarizeActivityMonths(items, months, rates, dataIssues),
  };
}

export async function getActivityMonth(db: D1Database, month: string) {
  const { items, rates, dataIssues } = await loadRoleActivities(db, [month], {
    includeTrades: true,
  });
  const [summary] = summarizeActivityMonths(items, [month], rates, dataIssues);
  return { month, items: items satisfies ActivityItem[], summary };
}

export const ACTIVITY_SOURCE_VIEWS = ["bank", "card", "invoice"] as const;
export type ActivitySourceView = (typeof ACTIVITY_SOURCE_VIEWS)[number];

/**
 * 單月單一來源的原始紀錄與配對狀態，供交易頁「銀行／信用卡／發票」分頁使用；
 * 「總帳」分頁沿用 {@link getActivityMonth}。已合併的發票仍列出（duplicateOf
 * 指向交易），刷卡／銀行交易以 matchedInvoiceId 指回發票。
 */
export async function getActivitySources(
  db: D1Database,
  month: string,
  source: ActivitySourceView,
) {
  const { items, invoices, invoiceMatches, rates, dataIssues } =
    await loadRoleActivities(db, [month], { includeTrades: false });
  const [summary] = summarizeActivityMonths(items, [month], rates, dataIssues);
  const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const sourceCounts: Record<ActivitySourceView, number> = {
    bank: 0,
    card: 0,
    invoice: 0,
  };
  for (const item of items)
    if (item.source !== "investment") sourceCounts[item.source] += 1;
  const records: ActivitySourceRecord[] = items
    .filter((item) => item.source === source)
    .map((item) => {
      if (item.source !== "invoice") return item;
      const invoice = invoiceById.get(item.id);
      const match = invoiceMatches.get(item.id);
      return {
        ...item,
        carrierType: invoice?.carrierType ?? null,
        carrierSuffix: invoice?.carrierSuffix ?? null,
        carrierCardSuffix: match?.carrierCardSuffix ?? null,
        awaitingOverdue: match?.awaitingOverdue ?? false,
      };
    });
  return {
    month,
    source,
    records,
    sourceCounts,
    dedupe: summary.dedupe,
    complete: summary.complete,
    incompleteReasons: summary.incompleteReasons,
  };
}
