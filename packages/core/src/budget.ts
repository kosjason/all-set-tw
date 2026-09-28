import type {
  ActivitySummaryIncompleteReason,
  SpendingEntry,
} from "./economic-role";

/** 預算與週回顧共用的日期工具：皆以台北日期字串 YYYY-MM-DD 計算。 */
function dayToUtc(day: string) {
  return new Date(`${day}T00:00:00.000Z`);
}

export function addDays(day: string, offset: number) {
  const date = dayToUtc(day);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

/** 該日所在週的週一。 */
export function weekStartOf(day: string) {
  const weekday = dayToUtc(day).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}

export function daysInMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

const round = (value: number) => Math.round(value * 100) / 100 || 0;

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function sumAmounts(entries: readonly SpendingEntry[]) {
  return round(entries.reduce((sum, entry) => sum + entry.amount, 0));
}

// ── 週回顧 ────────────────────────────────────────────────────────────────

export const WEEKLY_BASELINE_WEEKS = 8;
/** 信用卡入帳常延遲 1–3 天；今天與前兩天的資料可能還沒到齊。 */
export const RECENT_INCOMPLETE_DAYS = 3;

export interface WeeklyLargestEntry {
  id: string;
  source: SpendingEntry["source"];
  day: string;
  displayName: string;
  amount: number;
  categoryId: string;
  pending: boolean;
}

export interface WeeklyCategoryChange {
  categoryId: string;
  amount: number;
  /** 過去各週同一段天數的平均。 */
  baseline: number;
  delta: number;
}

export interface WeeklyNewMerchant {
  merchantKey: string;
  displayName: string;
  amount: number;
  count: number;
}

export interface WeeklySourceFreshness {
  connectorId: string;
  name: string;
  lastSuccessAt: string | null;
  /** 最後成功同步距今超過 2 天，這週的資料可能少算。 */
  stale: boolean;
}

export interface WeeklyReview {
  weekStart: string;
  weekEnd: string;
  today: string;
  /** 這週已結束（整週都在今天之前）。 */
  complete: boolean;
  /** 比較的天數：已結束的週為 7，進行中為週一到今天。 */
  elapsedDays: number;
  total: number;
  pendingAmount: number;
  byDay: Array<{ day: string; amount: number }>;
  baseline: {
    /** 過去幾週的同一段天數（週一起 elapsedDays 天）。 */
    weeks: number;
    median: number | null;
  };
  /** total − baseline.median；沒有基準時為 null。 */
  difference: number | null;
  topCategoryIncreases: WeeklyCategoryChange[];
  largest: WeeklyLargestEntry[];
  newMerchants: WeeklyNewMerchant[];
  /**
   * 這天（含）之後到今天的資料可能還沒到齊：今天往前 {@link RECENT_INCOMPLETE_DAYS} 天內落在這週的
   * 部分（不早於 weekStart）。這週都在那之前時為 null。
   */
  possiblyIncompleteFrom: string | null;
  sources: WeeklySourceFreshness[];
  /** 載入資料時的問題（缺匯率、分類或 override 載入失敗等）；有值時數字可能不完整。 */
  incompleteReasons: ActivitySummaryIncompleteReason[];
}

/** 比較基準至少要有這麼多週的資料，否則不比較。 */
export const WEEKLY_MIN_BASELINE_WEEKS = 2;

/**
 * 彙整一週的消費並與過去 {@link WEEKLY_BASELINE_WEEKS} 週比較。進行中的週只和過去各週
 * 「週一到同一天」比，不拿半週比整週。entries 需涵蓋 weekStart 往前 baselineWeeks 週。
 * 資料開始（dataStart，通常是最早一筆消費）之前的週不列入基準，避免把「還沒同步」當成 0。
 */
export function summarizeWeek(
  entries: readonly SpendingEntry[],
  options: {
    weekStart: string;
    today: string;
    baselineWeeks?: number;
    sources?: WeeklySourceFreshness[];
    /** 最早有資料的日期；未提供時取 entries 中最早的一筆。 */
    dataStart?: string;
    incompleteReasons?: ActivitySummaryIncompleteReason[];
  },
): WeeklyReview {
  const { weekStart, today } = options;
  const baselineWeeks = options.baselineWeeks ?? WEEKLY_BASELINE_WEEKS;
  const weekEnd = addDays(weekStart, 6);
  const complete = weekEnd < today;
  const elapsedDays = complete
    ? 7
    : Math.max(
        1,
        Math.round(
          (dayToUtc(today).getTime() - dayToUtc(weekStart).getTime()) /
            86_400_000,
        ) + 1,
      );
  const inRange = (entry: SpendingEntry, from: string, days: number) =>
    entry.day >= from && entry.day <= addDays(from, days - 1);

  const week = entries.filter((entry) => inRange(entry, weekStart, 7));
  const comparable = week.filter((entry) =>
    inRange(entry, weekStart, elapsedDays),
  );
  const dataStart =
    options.dataStart ??
    entries.reduce<string | null>(
      (earliest, entry) =>
        earliest == null || entry.day < earliest ? entry.day : earliest,
      null,
    );
  // 資料在該週第二天之後才開始的週視為不完整，不列入基準。
  const pastStarts = Array.from({ length: baselineWeeks }, (_, index) =>
    addDays(weekStart, -7 * (index + 1)),
  ).filter((start) => dataStart != null && dataStart <= addDays(start, 1));
  const pastWeeks = pastStarts.map((start) =>
    entries.filter((entry) => inRange(entry, start, elapsedDays)),
  );
  const hasBaseline = pastWeeks.length >= WEEKLY_MIN_BASELINE_WEEKS;
  const baselineMedian = hasBaseline ? median(pastWeeks.map(sumAmounts)) : null;
  const total = sumAmounts(comparable);

  const categoryTotals = (list: readonly SpendingEntry[]) => {
    const totals = new Map<string, number>();
    for (const entry of list)
      totals.set(
        entry.categoryId,
        (totals.get(entry.categoryId) ?? 0) + entry.amount,
      );
    return totals;
  };
  const current = categoryTotals(comparable);
  const pastTotals = pastWeeks.map(categoryTotals);
  const topCategoryIncreases = (hasBaseline ? [...current] : [])
    .map(([categoryId, amount]) => {
      const baseline =
        pastTotals.reduce(
          (sum, totals) => sum + (totals.get(categoryId) ?? 0),
          0,
        ) / Math.max(pastTotals.length, 1);
      return {
        categoryId,
        amount: round(amount),
        baseline: round(baseline),
        delta: round(amount - baseline),
      };
    })
    .filter((change) => change.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 3);

  const seenBefore = new Set(
    entries
      .filter((entry) => entry.day < weekStart && entry.merchantKey)
      .map((entry) => entry.merchantKey!),
  );
  const newMerchantMap = new Map<string, WeeklyNewMerchant>();
  // 沒有足夠的過去資料時，幾乎每個商家都是「第一次」，不列。
  for (const entry of hasBaseline ? week : []) {
    if (!entry.merchantKey || seenBefore.has(entry.merchantKey)) continue;
    const existing = newMerchantMap.get(entry.merchantKey) ?? {
      merchantKey: entry.merchantKey,
      displayName: entry.displayName,
      amount: 0,
      count: 0,
    };
    existing.amount = round(existing.amount + entry.amount);
    existing.count += 1;
    newMerchantMap.set(entry.merchantKey, existing);
  }

  return {
    weekStart,
    weekEnd,
    today,
    complete,
    elapsedDays,
    total,
    pendingAmount: sumAmounts(week.filter((entry) => entry.pending)),
    byDay: Array.from({ length: 7 }, (_, index) => {
      const day = addDays(weekStart, index);
      return {
        day,
        amount: sumAmounts(week.filter((entry) => entry.day === day)),
      };
    }),
    baseline: {
      weeks: pastWeeks.length,
      median: baselineMedian == null ? null : round(baselineMedian),
    },
    difference: baselineMedian == null ? null : round(total - baselineMedian),
    topCategoryIncreases,
    largest: [...week]
      .filter((entry) => entry.amount > 0)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5)
      .map((entry) => ({
        id: entry.id,
        source: entry.source,
        day: entry.day,
        displayName: entry.displayName,
        amount: entry.amount,
        categoryId: entry.categoryId,
        pending: entry.pending,
      })),
    newMerchants: [...newMerchantMap.values()]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5),
    possiblyIncompleteFrom: (() => {
      const from = addDays(today, -(RECENT_INCOMPLETE_DAYS - 1));
      if (from > weekEnd) return null;
      return from < weekStart ? weekStart : from;
    })(),
    sources: options.sources ?? [],
    incompleteReasons: options.incompleteReasons ?? [],
  };
}

// ── 本月可花 ──────────────────────────────────────────────────────────────

export type BudgetMerchantKind = "monthly" | "annual" | "not_fixed";
export type SavingsTargetType = "amount" | "percent";

export interface BudgetSettings {
  /** 預期月收入；null 表示由近 3 個月收入推算。 */
  expectedIncome: number | null;
  savingsTargetType: SavingsTargetType;
  savingsTargetValue: number;
  /** 一年的年繳大額總額。 */
  annualReserve: number;
}

export const DEFAULT_BUDGET_SETTINGS: BudgetSettings = {
  expectedIncome: null,
  savingsTargetType: "amount",
  savingsTargetValue: 0,
  annualReserve: 0,
};

export interface BudgetMerchantDecision {
  merchantKey: string;
  kind: BudgetMerchantKind;
  displayName: string;
  expectedAmount: number | null;
}

export interface BudgetFixedMerchant {
  merchantKey: string;
  kind: "monthly" | "annual";
  displayName: string;
  /** 每月預期金額：使用者設定，否則為採用的歷史月份的中位數。 */
  expectedAmount: number;
  expectedAmountSource: "user" | "history";
  paidThisMonth: number;
}

export interface BudgetCandidate {
  merchantKey: string;
  displayName: string;
  categoryId: string;
  /** 採用的歷史月份每月的消費（舊到新，對應 BudgetSummary.historyMonths）。 */
  monthlyAmounts: number[];
  typicalAmount: number;
}

export interface BudgetSummary {
  month: string;
  today: string;
  daysLeft: number;
  /** 推算收入、固定支出金額與偵測候選所採用的完整月份（舊到新；資料明顯不完整的月份不採用）。 */
  historyMonths: string[];
  settings: BudgetSettings;
  expectedIncome: {
    amount: number | null;
    source: "settings" | "history" | "none";
  };
  savingsTarget: number;
  monthlyReserve: number;
  /** 本月已花（不含年繳商家）。 */
  spent: number;
  /** 其中每月固定商家的消費。 */
  spentFixed: number;
  /** 年繳商家本月的消費（由準備金支付，不扣可花）。 */
  spentFromReserve: number;
  /** 每月固定支出尚未扣款、需預留的部分。 */
  fixedRemaining: number;
  /** 本月還可花；預期收入不明時為 null。 */
  available: number | null;
  /** 剩餘天數平均每天可花（available ≤ 0 時為 0）。 */
  dailyAllowance: number | null;
  fixedMerchants: BudgetFixedMerchant[];
  candidates: BudgetCandidate[];
  /** 使用者標為「不是固定」的商家，可移除判斷復原。 */
  excludedMerchants: Array<{ merchantKey: string; displayName: string }>;
  /**
   * 本月消費較大、尚未判斷的商家（年繳通常只出現一次，不會成為候選；由此標成年繳或每月固定）。
   */
  largeMerchants: BudgetLargeMerchant[];
  /** 載入資料時的問題；有值時可花金額可能不準。 */
  incompleteReasons: ActivitySummaryIncompleteReason[];
  /**
   * 有標成年繳的商家，但年繳準備金是 0：年繳消費改計入本月已花，避免這筆錢哪裡都沒扣。
   */
  annualWithoutReserve: boolean;
}

export interface BudgetLargeMerchant {
  merchantKey: string;
  displayName: string;
  categoryId: string;
  amountThisMonth: number;
  count: number;
}

/** 本月大筆消費商家的門檻與列出數量。 */
export const LARGE_MERCHANT_MIN_AMOUNT = 1000;
const LARGE_MERCHANT_LIMIT = 8;

/** 各商家在各月的消費。 */
function merchantMonthlyTotals(
  entriesByMonth: ReadonlyMap<string, readonly SpendingEntry[]>,
) {
  const totals = new Map<
    string,
    {
      displayName: string;
      categoryId: string;
      months: Map<string, number>;
      counts: Map<string, number>;
    }
  >();
  for (const [month, entries] of entriesByMonth)
    for (const entry of entries) {
      if (!entry.merchantKey) continue;
      const record = totals.get(entry.merchantKey) ?? {
        displayName: entry.displayName,
        categoryId: entry.categoryId,
        months: new Map<string, number>(),
        counts: new Map<string, number>(),
      };
      record.months.set(month, (record.months.get(month) ?? 0) + entry.amount);
      record.counts.set(month, (record.counts.get(month) ?? 0) + 1);
      totals.set(entry.merchantKey, record);
    }
  return totals;
}

/** 固定支出候選的每月最低金額；排除跟著消費產生的小額費用（例如國外交易服務費）。 */
export const FIXED_CANDIDATE_MIN_AMOUNT = 100;
/** 固定支出每月通常只扣款 1–2 次；常去的店一個月會有很多筆，不列入。 */
export const FIXED_CANDIDATE_MAX_MONTHLY_COUNT = 2;

/**
 * 固定支出候選：採用的每個月份都有消費、每月至少 {@link FIXED_CANDIDATE_MIN_AMOUNT}、每月最多
 * {@link FIXED_CANDIDATE_MAX_MONTHLY_COUNT} 筆，且金額穩定（最大 ≤ 最小 × 1.5）。已由使用者判斷過的
 * 商家不再列出。
 */
export function detectFixedCandidates(
  historyByMonth: ReadonlyMap<string, readonly SpendingEntry[]>,
  historyMonths: readonly string[],
  decided: ReadonlySet<string>,
  limit = 10,
): BudgetCandidate[] {
  if (historyMonths.length < 2) return [];
  const totals = merchantMonthlyTotals(historyByMonth);
  const candidates: BudgetCandidate[] = [];
  for (const [merchantKey, record] of totals) {
    if (decided.has(merchantKey)) continue;
    const monthlyAmounts = historyMonths.map((month) =>
      round(record.months.get(month) ?? 0),
    );
    if (monthlyAmounts.some((amount) => amount < FIXED_CANDIDATE_MIN_AMOUNT))
      continue;
    if (
      historyMonths.some(
        (month) =>
          (record.counts.get(month) ?? 0) > FIXED_CANDIDATE_MAX_MONTHLY_COUNT,
      )
    )
      continue;
    const min = Math.min(...monthlyAmounts);
    const max = Math.max(...monthlyAmounts);
    if (max > min * 1.5) continue;
    candidates.push({
      merchantKey,
      displayName: record.displayName,
      categoryId: record.categoryId,
      monthlyAmounts,
      typicalAmount: round(median(monthlyAmounts) ?? 0),
    });
  }
  return candidates
    .sort((a, b) => b.typicalAmount - a.typicalAmount)
    .slice(0, limit);
}

/**
 * 本月可花 = 預期月收入 − 儲蓄目標 − 年繳準備金 ÷ 12 − 本月已花（不含年繳商家）
 *            − 每月固定支出尚未扣款的部分。
 * 信用卡以刷卡日認列消費；繳卡費不是消費，不會重複扣。
 */
export function computeBudget(input: {
  month: string;
  today: string;
  settings: BudgetSettings;
  /** 採用的歷史月份收入的中位數；沒有資料時為 null。 */
  historicalIncome: number | null;
  decisions: readonly BudgetMerchantDecision[];
  currentEntries: readonly SpendingEntry[];
  historyByMonth: ReadonlyMap<string, readonly SpendingEntry[]>;
  historyMonths: readonly string[];
  incompleteReasons?: ActivitySummaryIncompleteReason[];
}): BudgetSummary {
  const { settings, month, today } = input;
  const expectedIncome =
    settings.expectedIncome != null
      ? { amount: settings.expectedIncome, source: "settings" as const }
      : input.historicalIncome != null && input.historicalIncome > 0
        ? { amount: round(input.historicalIncome), source: "history" as const }
        : { amount: null, source: "none" as const };
  const savingsTarget = round(
    settings.savingsTargetType === "percent"
      ? ((expectedIncome.amount ?? 0) * settings.savingsTargetValue) / 100
      : settings.savingsTargetValue,
  );
  const monthlyReserve = round(settings.annualReserve / 12);

  const history = merchantMonthlyTotals(input.historyByMonth);
  const paid = new Map<string, number>();
  for (const entry of input.currentEntries)
    if (entry.merchantKey)
      paid.set(
        entry.merchantKey,
        (paid.get(entry.merchantKey) ?? 0) + entry.amount,
      );

  const fixedMerchants: BudgetFixedMerchant[] = input.decisions
    .filter(
      (
        decision,
      ): decision is BudgetMerchantDecision & {
        kind: "monthly" | "annual";
      } => decision.kind !== "not_fixed",
    )
    .map((decision) => {
      const record = history.get(decision.merchantKey);
      // 只看該商家有消費紀錄的月份（含退款沖成 0 以下的月份），沒出現的月份不算 0。
      const historical = median(
        input.historyMonths
          .filter((historyMonth) => (record?.counts.get(historyMonth) ?? 0) > 0)
          .map((historyMonth) => record!.months.get(historyMonth) ?? 0),
      );
      return {
        merchantKey: decision.merchantKey,
        kind: decision.kind,
        displayName: decision.displayName,
        expectedAmount: round(
          decision.expectedAmount ??
            (decision.kind === "monthly" ? (historical ?? 0) : 0),
        ),
        expectedAmountSource:
          decision.expectedAmount != null
            ? ("user" as const)
            : ("history" as const),
        paidThisMonth: round(paid.get(decision.merchantKey) ?? 0),
      };
    });
  const hasAnnual = fixedMerchants.some(
    (merchant) => merchant.kind === "annual",
  );
  const annualWithoutReserve = hasAnnual && settings.annualReserve <= 0;
  // 沒有年繳準備金時，年繳消費照常扣本月可花。
  const annualKeys = new Set(
    annualWithoutReserve
      ? []
      : fixedMerchants
          .filter((merchant) => merchant.kind === "annual")
          .map((merchant) => merchant.merchantKey),
  );
  const monthlyKeys = new Set(
    fixedMerchants
      .filter((merchant) => merchant.kind === "monthly")
      .map((merchant) => merchant.merchantKey),
  );
  const spentFromReserve = sumAmounts(
    input.currentEntries.filter(
      (entry) => entry.merchantKey && annualKeys.has(entry.merchantKey),
    ),
  );
  const spent = sumAmounts(
    input.currentEntries.filter(
      (entry) => !entry.merchantKey || !annualKeys.has(entry.merchantKey),
    ),
  );
  const spentFixed = sumAmounts(
    input.currentEntries.filter(
      (entry) => entry.merchantKey && monthlyKeys.has(entry.merchantKey),
    ),
  );
  const fixedRemaining = round(
    fixedMerchants
      .filter((merchant) => merchant.kind === "monthly")
      .reduce(
        (sum, merchant) =>
          sum + Math.max(merchant.expectedAmount - merchant.paidThisMonth, 0),
        0,
      ),
  );
  const dayOfMonth = Number(today.slice(8, 10));
  const daysLeft = today.startsWith(month)
    ? daysInMonth(month) - dayOfMonth + 1
    : 0;
  const available =
    expectedIncome.amount == null
      ? null
      : round(
          expectedIncome.amount -
            savingsTarget -
            monthlyReserve -
            spent -
            fixedRemaining,
        );
  const decided = new Set(
    input.decisions.map((decision) => decision.merchantKey),
  );
  const candidates = detectFixedCandidates(
    input.historyByMonth,
    input.historyMonths,
    decided,
  );
  const candidateKeys = new Set(
    candidates.map((candidate) => candidate.merchantKey),
  );
  const monthMerchants = new Map<string, BudgetLargeMerchant>();
  for (const entry of input.currentEntries) {
    if (
      !entry.merchantKey ||
      decided.has(entry.merchantKey) ||
      candidateKeys.has(entry.merchantKey)
    )
      continue;
    const merchant = monthMerchants.get(entry.merchantKey) ?? {
      merchantKey: entry.merchantKey,
      displayName: entry.displayName,
      categoryId: entry.categoryId,
      amountThisMonth: 0,
      count: 0,
    };
    merchant.amountThisMonth = round(merchant.amountThisMonth + entry.amount);
    merchant.count += 1;
    monthMerchants.set(entry.merchantKey, merchant);
  }
  return {
    month,
    today,
    daysLeft,
    historyMonths: [...input.historyMonths],
    settings,
    expectedIncome,
    savingsTarget,
    monthlyReserve,
    spent,
    spentFixed,
    spentFromReserve,
    fixedRemaining,
    available,
    dailyAllowance:
      available == null || daysLeft === 0
        ? null
        : round(Math.max(available, 0) / daysLeft),
    fixedMerchants,
    candidates,
    excludedMerchants: input.decisions
      .filter((decision) => decision.kind === "not_fixed")
      .map(({ merchantKey, displayName }) => ({ merchantKey, displayName })),
    largeMerchants: [...monthMerchants.values()]
      .filter(
        (merchant) => merchant.amountThisMonth >= LARGE_MERCHANT_MIN_AMOUNT,
      )
      .sort((a, b) => b.amountThisMonth - a.amountThisMonth)
      .slice(0, LARGE_MERCHANT_LIMIT),
    incompleteReasons: input.incompleteReasons ?? [],
    annualWithoutReserve,
  };
}
