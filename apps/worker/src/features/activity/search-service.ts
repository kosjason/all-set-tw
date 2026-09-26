import {
  activityDateKey,
  applyEconomicRoleOverride,
  buildActivityItems,
  economicRoleOverrideKey,
  compareActivityItems,
  deduplicateBankTransactions,
  filterActivities,
  isActivityDateTime,
  matchInvoicesToTransactions,
  parseActivitySearch,
  resolveInvoiceDedupe,
  taipeiDay,
  type ActivityItem,
  type ActivityOrderKey,
} from "@taiwan-fin-hub/core";
import { listBankAccounts } from "../bank/repository";
import { normalizeBankAccountDisplay } from "../bank/display";
import { getBankRange } from "../bank/service";
import { getInvoicesRange } from "../invoices/service";
import { getInvestmentTransactionsRange } from "../investments/service";
import { encodePageCursor } from "../../platform/http";
import { listInvoiceTransactionPreferences } from "./repository";
import { loadActivityRoleOverrides } from "../activity-roles/service";
import { annotateActivityItems } from "../merchants/annotate";
import { syncedCardSuffixes } from "./summary-service";
import {
  findActivitySearchDays,
  type ActivitySearchInput,
  type ActivitySearchMerchantMatches,
} from "./search-repository";
import { listMerchantAliases } from "../merchants/repository";
import { getExchangeRates } from "../exchange-rates/service";

const PAGE_SIZE = 30;

/** 商家別名符合查詢文字時，改以該商家的統編／正規化名稱比對原始資料。 */
async function findAliasMatches(
  db: D1Database,
  text: string,
): Promise<ActivitySearchMerchantMatches> {
  const result: ActivitySearchMerchantMatches = {
    sellerBans: [],
    nameNeedles: [],
  };
  if (!text) return result;
  let aliases: Awaited<ReturnType<typeof listMerchantAliases>> = [];
  try {
    aliases = await listMerchantAliases(db);
  } catch (error) {
    console.error("[merchants] load aliases for search failed:", error);
    return result;
  }
  for (const alias of aliases) {
    if (
      !alias.displayName ||
      !alias.displayName.normalize("NFKC").toLowerCase().includes(text)
    )
      continue;
    if (alias.merchantKey.startsWith("ban:"))
      result.sellerBans.push(alias.merchantKey.slice(4));
    else result.nameNeedles.push(alias.merchantKey.slice(5));
  }
  return result;
}
const DAY_BATCH_SIZE = 32;
export async function searchActivity(
  db: D1Database,
  input: ActivitySearchInput,
  cursor?: ActivityOrderKey,
) {
  const search = parseActivitySearch(input.q);
  const [accountRows, preferences, merchantMatches, rates] = await Promise.all([
    listBankAccounts(db),
    listInvoiceTransactionPreferences(db),
    findAliasMatches(db, search.text),
    getExchangeRates(db),
  ]);
  const exchangeRates: Record<string, number> = Object.fromEntries(
    rates.map((rate) => [rate.currency, rate.rateTwd]),
  );
  const accounts = accountRows.map(normalizeBankAccountDisplay);
  const cardSuffixes = syncedCardSuffixes(accounts);
  const today = taipeiDay(new Date());
  const accountMap = new Map(
    accounts.map((account) => [
      String(account.id),
      { ...account, id: String(account.id) },
    ]),
  );
  const matchingAccountIds = search.text
    ? accounts
        .filter((account) =>
          [account.institutionName, account.accountName, account.accountLast4]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(search.text),
        )
        .map((account) => String(account.id))
    : [];
  const bankTransactions: Awaited<
    ReturnType<typeof getBankRange>
  >["transactions"] = [];
  const invoices: Awaited<ReturnType<typeof getInvoicesRange>> = [];
  const trades: Awaited<ReturnType<typeof getInvestmentTransactionsRange>> = [];
  const matches: ActivityItem[] = [];
  let beforeDay = cursor ? activityDateKey(cursor) : undefined;
  let inclusive = Boolean(cursor);
  while (matches.length <= PAGE_SIZE) {
    const candidates = await findActivitySearchDays(
      db,
      input,
      matchingAccountIds,
      beforeDay,
      inclusive,
      { search, merchants: merchantMatches },
    );
    const days = candidates.slice(0, DAY_BATCH_SIZE);
    if (!days.length) break;
    const range = { from: days.at(-1)!, to: days[0] }; // Exact day selection is used below.
    const [bank, invoiceBatch, tradeBatch] = await Promise.all([
      getBankRange(db, range, days, accountRows),
      getInvoicesRange(db, range, days),
      getInvestmentTransactionsRange(db, range, days),
    ]);
    const transactions = deduplicateBankTransactions(bank.transactions);
    // Search batches hold only matching days, so cross-day pairing would depend
    // on which neighbours happen to match; keep search to same-day pairs.
    const invoiceMatches = matchInvoicesToTransactions(
      transactions,
      invoiceBatch,
      preferences,
      { dayWindow: 0, syncedCardSuffixes: cardSuffixes, exchangeRates },
    );
    // 搜尋只載入命中的日子，歧義判斷與配對一樣限定同日。
    const invoiceOverrides = await loadActivityRoleOverrides(
      db,
      "invoice",
      invoiceBatch.map((invoice) => invoice.id),
    );
    const dedupe = resolveInvoiceDedupe(
      invoiceBatch,
      transactions,
      invoiceMatches,
      preferences,
      { dayWindow: 0, today },
    );
    const invoiceRoles = new Map(
      [...dedupe.roles].map(([id, fields]) => [
        id,
        applyEconomicRoleOverride(
          fields,
          invoiceOverrides.get(economicRoleOverrideKey("invoice", id)),
        ),
      ]),
    );
    const items = await annotateActivityItems(
      db,
      buildActivityItems(
        transactions,
        invoiceBatch,
        tradeBatch,
        accountMap,
        invoiceMatches,
        {
          roles: {
            invoices: invoiceRoles,
            includeMatchedInvoices: false,
            invoiceMatches: dedupe.statuses,
          },
          exchangeRates,
        },
      ),
      { transactions, invoices: invoiceBatch },
    );
    matches.push(
      ...filterActivities(items, {
        month: "",
        search: input.q,
        from: input.from,
        to: input.to,
        source: input.source ?? "all",
        flow: input.flow ?? "all",
        categoryId: input.category,
        category: null,
      }).filter((item) => !cursor || compareActivityItems(item, cursor) > 0),
    );
    bankTransactions.push(...transactions);
    invoices.push(...invoiceBatch);
    trades.push(...tradeBatch);
    if (candidates.length <= DAY_BATCH_SIZE) break;
    beforeDay = days.at(-1);
    inclusive = false;
  }
  matches.sort(compareActivityItems);
  const items = matches.slice(0, PAGE_SIZE);
  const last = items.at(-1);
  const selectedDays = new Set(items.map(activityDateKey));
  return {
    items,
    bank: {
      accounts,
      transactions: bankTransactions.filter((t) =>
        selectedDays.has(
          activityDateKey({
            date: t.authorizedAt ?? t.postedDate ?? "",
            dateHasTime: isActivityDateTime(t.authorizedAt ?? undefined),
            source: "bank",
          }),
        ),
      ),
    },
    invoices: invoices.filter((i) =>
      selectedDays.has(
        activityDateKey({ date: i.invoiceDate, source: "invoice" }),
      ),
    ),
    trades: trades.filter((t) =>
      selectedDays.has(
        activityDateKey({
          date: t.tradeDate ?? t.postedDate ?? "",
          source: "investment",
        }),
      ),
    ),
    nextCursor:
      matches.length > PAGE_SIZE && last
        ? encodePageCursor({
            id: last.id,
            source: last.source,
            date: last.date,
            dateHasTime: last.dateHasTime,
          })
        : null,
  };
}
