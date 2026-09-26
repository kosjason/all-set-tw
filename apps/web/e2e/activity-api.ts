import type { Page, Route } from "@playwright/test";
import {
  activityDateKey,
  buildActivityItems,
  deduplicateBankTransactions,
  deriveInvoiceEconomicRoles,
  matchInvoicesToTransactions,
  summarizeActivityMonths,
  type ActivityAccount,
  type ActivityInvoice,
  type ActivityTrade,
  type ActivityTransaction,
} from "@taiwan-fin-hub/core";

type InvoiceTransactionPreference = Parameters<
  typeof matchInvoicesToTransactions
>[2][number];

/**
 * E2E 用的活動 API 替身：`/api/activity/items` 與 `/api/activity/summary` 由同一頁面
 * 已 mock 的 `/api/bank`、`/api/invoices`、`/api/activity/invoice-mappings`、
 * `/api/investment-transactions` 組出，口徑比照 worker 的 summary-service（沒有推導
 * 角色的交易沿用「不計入者視為移轉，其餘依正負」）。因此各測試只要 mock 原始資料，
 * 活動列表與月收支就會一致；任一來源失敗時兩個端點都回 500，與後端相同。
 *
 * 在 page.route 的 catch-all 之後呼叫（後註冊的 route 優先）。替身發出的請求帶
 * `_source=activity-api`，計算頁面請求數的測試可據此排除。
 */
/**
 * 導覽列與本月頁固定會呼叫的 API：待處理收件匣（badge）與信用卡摘要（卡費提醒）。
 * 預設都是空的；個別測試可在之後註冊自己的 route 覆蓋。
 */
export async function routeNavigationApi(page: Page) {
  await page.route("**/api/inbox", (route) =>
    route.fulfill({
      json: {
        counts: { blocking: 0, tidy: 0 },
        months: [],
        items: [],
        unavailable: [],
      },
    }),
  );
  await page.route("**/api/cards/summary", (route) =>
    route.fulfill({
      json: {
        asOf: new Date().toISOString().slice(0, 10),
        currency: "TWD",
        totals: { statementBalance: 0, remainingAmount: 0, unbilledAmount: 0 },
        nextDue: null,
        issuers: [],
      },
    }),
  );
}

export async function routeActivityApi(page: Page) {
  await page.route("**/api/activity/items**", (route) =>
    respond(page, route, (url) => {
      const month = url.searchParams.get("month") ?? currentMonth();
      return { months: [month], includeItems: true };
    }),
  );
  await page.route("**/api/activity/summary**", (route) =>
    respond(page, route, (url) => {
      const month = url.searchParams.get("month");
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      const count = Number(url.searchParams.get("months") ?? 0);
      const end = to ?? month ?? currentMonth();
      const start = from ?? month ?? (count ? shiftMonth(end, 1 - count) : end);
      return { months: monthsBetween(start, end), includeItems: false };
    }),
  );
}

async function respond(
  page: Page,
  route: Route,
  plan: (url: URL) => { months: string[]; includeItems: boolean },
) {
  const url = new URL(route.request().url());
  const { months, includeItems } = plan(url);
  // _source 讓測試區分頁面自己的請求與這個替身為了組資料發出的請求。
  const range = `from=${months[0]}&to=${months.at(-1)}&_source=activity-api`;
  const sources = await page
    .evaluate(async (query) => {
      const load = async (path: string) => {
        const response = await fetch(path);
        if (!response.ok) throw new Error(`${path} ${response.status}`);
        return response.json();
      };
      try {
        const [bank, invoices, mappings, trades] = await Promise.all([
          load(`/api/bank?${query}`),
          load(`/api/invoices?${query}`),
          load("/api/activity/invoice-mappings?_source=activity-api"),
          load(`/api/investment-transactions?${query}`),
        ]);
        return { ok: true as const, bank, invoices, mappings, trades };
      } catch (error) {
        return { ok: false as const, message: String(error) };
      }
    }, range)
    .catch((error: unknown) => {
      // 測試結束、頁面關閉時替身可能仍在組資料；此時放棄回應，不讓 route
      // callback 的錯誤把已通過的測試標成失敗。
      if (page.isClosed() || /Test ended|has been closed/.test(String(error)))
        return null;
      throw error;
    });
  if (!sources) return;
  if (!sources.ok)
    return route.fulfill({
      status: 500,
      json: { error: { code: "TEST_FAILURE", message: sources.message } },
    });

  return route.fulfill({
    json: activityApiResponse(sources, months, includeItems),
  });
}

/** 由原始資料組出 items／summary 回應（與 worker summary-service 同口徑）。 */
export function activityApiResponse(
  sources: {
    bank: unknown;
    invoices: unknown;
    mappings: unknown;
    trades: unknown;
  },
  months: string[],
  includeItems: boolean,
) {
  const bank = sources.bank as {
    accounts?: ActivityAccount[];
    transactions?: ActivityTransaction[];
  };
  const accounts = new Map(
    (bank.accounts ?? []).map((account) => [account.id, account]),
  );
  const transactions = deduplicateBankTransactions(
    (bank.transactions ?? []).map((transaction) => ({
      ...transaction,
      accountType:
        transaction.accountType ??
        accounts.get(transaction.accountId)?.accountType,
    })),
  );
  const invoices = arrayOf<ActivityInvoice>(sources.invoices);
  const mappings = arrayOf<InvoiceTransactionPreference>(sources.mappings);
  const trades = includeItems ? arrayOf<ActivityTrade>(sources.trades) : [];
  const matches = matchInvoicesToTransactions(transactions, invoices, mappings);
  const invoiceRoles = deriveInvoiceEconomicRoles(
    invoices,
    transactions,
    matches,
    mappings,
  );
  const monthSet = new Set(months);
  const items = buildActivityItems(
    transactions,
    invoices,
    trades,
    accounts,
    matches,
    { roles: { invoices: invoiceRoles } },
  ).filter((item) => monthSet.has(activityDateKey(item).slice(0, 7)));
  const summaries = summarizeActivityMonths(items, months, {});
  return includeItems
    ? { month: months[0], items, summary: summaries[0] }
    : { months: summaries };
}
function arrayOf<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function currentMonth() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
    })
      .formatToParts(new Date())
      .map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}`;
}

function shiftMonth(month: string, offset: number) {
  const [year, value] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, value - 1 + offset, 1));
  return date.toISOString().slice(0, 7);
}

function monthsBetween(from: string, to: string) {
  const months: string[] = [];
  for (let month = from; month <= to; month = shiftMonth(month, 1))
    months.push(month);
  return months;
}
