import {
  activitySpendingEntries,
  addDays,
  computeBudget,
  connectorCatalog,
  isConnectorId,
  median,
  summarizeActivityMonths,
  summarizeWeek,
  taipeiDay,
  type BudgetMerchantDecision,
  type ActivitySummaryIncompleteReason,
  type BudgetSettings,
  type BudgetSummary,
  type SpendingEntry,
  type WeeklyReview,
  type WeeklySourceFreshness,
  WEEKLY_BASELINE_WEEKS,
} from "@taiwan-fin-hub/core";
import { loadRoleActivities, monthsBetween } from "../activity/summary-service";
import { getSyncJobs } from "../sync/schedule-service";
import {
  deleteBudgetMerchantDecision,
  earliestTransactionDay,
  listBudgetMerchantDecisions,
  readBudgetSettings,
  upsertBudgetMerchantDecision,
  writeBudgetSettings,
} from "./repository";

/** 推算預期收入與偵測固定支出所看的完整月份數。 */
export const BUDGET_HISTORY_MONTHS = 3;
/** 同步成功超過這麼久，週回顧標示該來源可能少算。 */
const STALE_SOURCE_MS = 2 * 24 * 60 * 60 * 1000;

function previousMonths(month: string, count: number) {
  const [year, monthNumber] = month.split("-").map(Number) as [number, number];
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, monthNumber - 1 - (count - index), 1));
    return date.toISOString().slice(0, 7);
  });
}

function groupByMonth(entries: readonly SpendingEntry[]) {
  const byMonth = new Map<string, SpendingEntry[]>();
  for (const entry of entries) {
    const month = entry.day.slice(0, 7);
    const list = byMonth.get(month) ?? [];
    list.push(entry);
    byMonth.set(month, list);
  }
  return byMonth;
}

export async function getBudget(
  db: D1Database,
  now = new Date(),
): Promise<BudgetSummary> {
  const today = taipeiDay(now);
  const month = today.slice(0, 7);
  const historyMonths = previousMonths(month, BUDGET_HISTORY_MONTHS);
  const [{ items, rates, dataIssues }, settings, decisions] = await Promise.all(
    [
      loadRoleActivities(db, [...historyMonths, month], {
        includeTrades: false,
        today,
      }),
      readBudgetSettings(db),
      listBudgetMerchantDecisions(db),
    ],
  );
  // 同步資料的起點可能落在最早那個月的月中；筆數不到最多那個月一半的月份視為不完整，不採用。
  const summaries = summarizeActivityMonths(items, historyMonths, rates);
  const [currentSummary] = summarizeActivityMonths(
    items,
    [month],
    rates,
    dataIssues,
  );
  const maxCount = Math.max(
    0,
    ...summaries.map((summary) => summary.activityCount),
  );
  const usableMonths = summaries
    .filter(
      (summary) =>
        summary.activityCount > 0 && summary.activityCount >= maxCount / 2,
    )
    .map((summary) => summary.month);
  const incomes = summaries
    .filter((summary) => usableMonths.includes(summary.month))
    .map((summary) => summary.income)
    .filter((income) => income > 0);
  const byMonth = groupByMonth(activitySpendingEntries(items, rates));
  return computeBudget({
    month,
    today,
    settings,
    historicalIncome: median(incomes),
    decisions,
    currentEntries: (byMonth.get(month) ?? []).filter(
      (entry) => entry.day <= today,
    ),
    historyByMonth: new Map(
      usableMonths.map((historyMonth) => [
        historyMonth,
        byMonth.get(historyMonth) ?? [],
      ]),
    ),
    historyMonths: usableMonths,
    incompleteReasons: currentSummary?.incompleteReasons ?? [],
  });
}

export async function saveBudgetSettings(
  db: D1Database,
  settings: BudgetSettings,
  now = new Date(),
) {
  await writeBudgetSettings(db, settings, now.toISOString());
  return settings;
}

export async function saveBudgetMerchant(
  db: D1Database,
  decision: BudgetMerchantDecision,
  now = new Date(),
) {
  await upsertBudgetMerchantDecision(db, decision, now.toISOString());
  return decision;
}

export async function removeBudgetMerchant(
  db: D1Database,
  merchantKey: string,
) {
  return deleteBudgetMerchantDecision(db, merchantKey);
}

/** 只看會產生消費資料（銀行、信用卡交易或發票）的來源；投資持倉落後不影響消費。 */
const SPENDING_CAPABILITIES = new Set([
  "bank_transaction",
  "credit_card_bill",
  "invoice",
]);
function producesSpending(connectorId: string) {
  return (
    isConnectorId(connectorId) &&
    (connectorCatalog[connectorId].capabilities as readonly string[]).some(
      (capability) => SPENDING_CAPABILITIES.has(capability),
    )
  );
}

async function sourceFreshness(
  db: D1Database,
  now: Date,
): Promise<WeeklySourceFreshness[]> {
  const jobs = await getSyncJobs(db);
  const byConnector = new Map<string, string | null>();
  for (const job of jobs) {
    if (!job.configured || !producesSpending(job.connectorId)) continue;
    const previous = byConnector.get(job.connectorId) ?? null;
    const current = job.lastSuccessAt ?? null;
    byConnector.set(
      job.connectorId,
      !previous
        ? current
        : !current
          ? previous
          : Date.parse(current) > Date.parse(previous)
            ? current
            : previous,
    );
  }
  return [...byConnector]
    .map(([connectorId, lastSuccessAt]) => ({
      connectorId,
      name: connectorCatalog[connectorId as keyof typeof connectorCatalog]
        .title,
      lastSuccessAt,
      stale:
        !lastSuccessAt ||
        now.getTime() - Date.parse(lastSuccessAt) > STALE_SOURCE_MS,
    }))
    .sort(
      (a, b) =>
        Number(b.stale) - Number(a.stale) ||
        a.name.localeCompare(b.name, "zh-Hant"),
    );
}

export class WeekInFutureError extends Error {}

/** weekStart 為週一（YYYY-MM-DD）；未提供時為今天所在的週。 */
export async function getWeeklyReview(
  db: D1Database,
  weekStart: string,
  now = new Date(),
): Promise<WeeklyReview> {
  const today = taipeiDay(now);
  if (weekStart > today) throw new WeekInFutureError();
  const from = addDays(weekStart, -7 * WEEKLY_BASELINE_WEEKS);
  const to = addDays(weekStart, 6);
  const months = monthsBetween(from.slice(0, 7), to.slice(0, 7));
  const [{ items, rates, dataIssues }, sources, dataStart] = await Promise.all([
    loadRoleActivities(db, months, { includeTrades: false, today }),
    sourceFreshness(db, now),
    earliestTransactionDay(db),
  ]);
  const incompleteReasons = [
    ...new Set(
      summarizeActivityMonths(items, months, rates, dataIssues).flatMap(
        (summary) => summary.incompleteReasons,
      ),
    ),
  ] as ActivitySummaryIncompleteReason[];
  const entries = activitySpendingEntries(items, rates).filter(
    (entry) => entry.day >= from && entry.day <= to && entry.day <= today,
  );
  return summarizeWeek(entries, {
    weekStart,
    today,
    sources,
    incompleteReasons,
    // 以資料庫中最早的交易日為資料起點；沒有交易時退回載入範圍內最早的消費。
    ...(dataStart ? { dataStart } : {}),
  });
}
