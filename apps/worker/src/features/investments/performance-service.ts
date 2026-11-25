/**
 * 投資績效的 use case：讀集保交易、持股快照、銀行扣款與收盤價快取，交給純計算
 * （performance.ts）；以及排程補抓收盤價。讀取 API 只用快取，不連外。
 */
import type { InvestmentPerformance } from "@taiwan-fin-hub/shared";
import type { Env } from "../../platform/env";
import { isDemoMode } from "../../platform/http";
import { addDays, taipeiDay } from "../net-worth/backfill";
import {
  fetchMonthPrices,
  MarketPriceUnavailableError,
  type MarketExchange,
} from "./market-prices";
import {
  computeInvestmentPerformance,
  type PerformanceHistoryInput,
  type PerformanceInput,
  type PerformancePositionInput,
  type PerformanceTransactionInput,
  type PriceBook,
} from "./performance";
import {
  deleteInvestmentOpeningCost,
  firstBankTransactionDate,
  listInvestmentBankFlows,
  listInvestmentOpeningCosts,
  listPerformancePositions,
  listPerformanceTransactions,
  listSecurityPriceMonths,
  listSecurityPrices,
  saveSecurityPriceMonth,
  upsertInvestmentOpeningCost,
  type PerformancePositionRow,
  type PerformanceTransactionRow,
  type SecurityPriceMonthRow,
} from "./repository";

/** 每次排程（每 10 分鐘）最多抓幾個月，每次間隔幾毫秒：證交所會封鎖過於頻繁的請求。 */
export const PRICE_REQUESTS_PER_TICK = 6;
export const PRICE_REQUEST_GAP_MS = 3_000;
/** 抓取失敗後多久再試。 */
export const PRICE_ERROR_RETRY_MS = 60 * 60 * 1000;
/** 尚未結束的月份多久重抓一次（補上新的交易日）。 */
export const PRICE_OPEN_MONTH_REFRESH_MS = 6 * 60 * 60 * 1000;
/** 當天沒有收盤價時，往前找最近交易日的天數。 */
export const PRICE_LOOKBACK_DAYS = 7;

type PerformanceSources = Omit<PerformanceInput, "prices" | "today"> & {
  exchanges: Map<string, MarketExchange>;
};

function toTransactions(rows: PerformanceTransactionRow[]) {
  const exchanges = new Map<string, MarketExchange>();
  const transactions: PerformanceTransactionInput[] = rows.map((row) => {
    exchanges.set(row.symbol, row.exchangeCode === "1" ? "tpex" : "twse");
    const balance = row.balanceAfter == null ? NaN : Number(row.balanceAfter);
    return {
      id: row.id,
      accountId: row.accountId,
      brokerNo: row.brokerNo,
      brokerName: row.brokerName,
      symbol: row.symbol,
      name: row.name,
      assetType: row.assetType,
      date: row.date,
      code: row.code?.trim() || null,
      direction:
        row.dbCrCode === "1" ? "out" : row.dbCrCode === "2" ? "in" : null,
      quantity: row.quantity,
      balanceAfter: Number.isFinite(balance) ? balance : null,
    };
  });
  return { transactions, exchanges };
}

/** 持股快照的 source_id 為「券商代號:帳號:代號:日期」，取出帳戶部分。 */
export function positionAccountId(row: {
  sourceId: string;
  symbol: string;
  asOfDate: string;
  brokerNo: string | null;
}) {
  const suffix = `:${row.symbol}:${row.asOfDate}`;
  if (row.sourceId.endsWith(suffix))
    return row.sourceId.slice(0, -suffix.length);
  return row.brokerNo ?? "unknown";
}

function toPositions(rows: PerformancePositionRow[]) {
  const latest: PerformancePositionInput[] = [];
  const history: PerformanceHistoryInput[] = [];
  for (const row of rows) {
    if (row.quantity == null) continue;
    const accountId = positionAccountId(row);
    if (row.marketValue != null)
      history.push({
        accountId,
        symbol: row.symbol,
        date: row.date,
        marketValue: row.marketValue,
      });
    if (row.latest && row.quantity > 0)
      latest.push({
        accountId,
        symbol: row.symbol,
        name: row.name,
        assetType:
          row.assetType === "etf" || row.assetType === "fund"
            ? row.assetType
            : "stock",
        brokerNo: row.brokerNo,
        brokerName: row.brokerName,
        quantity: row.quantity,
        marketValue: row.marketValue ?? 0,
        date: row.date,
      });
  }
  return { latest, history };
}

async function loadPerformanceSources(
  db: D1Database,
): Promise<PerformanceSources> {
  const [transactionRows, positionRows, bankFlows, bankDataSince, opening] =
    await Promise.all([
      listPerformanceTransactions(db),
      listPerformancePositions(db),
      listInvestmentBankFlows(db),
      firstBankTransactionDate(db),
      listInvestmentOpeningCosts(db),
    ]);
  const { transactions, exchanges } = toTransactions(transactionRows);
  const positions = toPositions(positionRows);
  return {
    transactions,
    positions: positions.latest,
    history: positions.history,
    bankFlows,
    bankDataSince,
    openingCosts: new Map(opening.map((row) => [row.holdingKey, row.cost])),
    exchanges,
  };
}

function monthOf(date: string) {
  return date.slice(0, 7);
}

/** 收盤價快取：當天沒有就往前找最近的交易日；月份還沒抓完（或抓取失敗）視為補抓中。 */
export function createPriceBook(
  prices: { symbol: string; tradeDate: string; close: number }[],
  months: Pick<
    SecurityPriceMonthRow,
    "symbol" | "month" | "status" | "final"
  >[],
): PriceBook {
  const bySymbol = new Map<string, Map<string, number>>();
  for (const price of prices) {
    const series = bySymbol.get(price.symbol) ?? new Map<string, number>();
    series.set(price.tradeDate, price.close);
    bySymbol.set(price.symbol, series);
  }
  const monthRows = new Map(
    months.map((row) => [`${row.symbol}:${row.month}`, row]),
  );
  return {
    close(symbol, date) {
      const series = bySymbol.get(symbol);
      if (!series) return undefined;
      for (let offset = 0; offset <= PRICE_LOOKBACK_DAYS; offset += 1) {
        const close = series.get(addDays(date, -offset));
        if (close != null) return close;
      }
      return undefined;
    },
    pending(symbol, date) {
      // 往前找的天數可能跨到上個月：兩個月份都抓完才算確定缺價。
      return [date, addDays(date, -PRICE_LOOKBACK_DAYS)].some((day) => {
        const row = monthRows.get(`${symbol}:${monthOf(day)}`);
        return !row || !row.final || row.status === "error";
      });
    },
  };
}

/** 計算需要哪些（代號, 日期）的收盤價：以「全部查不到」的價格簿跑一次計算並記錄查詢。 */
export function collectPriceNeeds(
  sources: Omit<PerformanceInput, "prices" | "today">,
  today: string,
) {
  const needs = new Map<string, { symbol: string; date: string }>();
  computeInvestmentPerformance({
    ...sources,
    today,
    prices: {
      close(symbol, date) {
        needs.set(`${symbol}:${date}`, { symbol, date });
        return undefined;
      },
      pending: () => true,
    },
  });
  return [...needs.values()];
}

export async function getInvestmentPerformance(
  db: D1Database,
  now = new Date(),
): Promise<InvestmentPerformance> {
  const [sources, prices, months] = await Promise.all([
    loadPerformanceSources(db),
    listSecurityPrices(db),
    listSecurityPriceMonths(db),
  ]);
  const { exchanges: _exchanges, ...input } = sources;
  return computeInvestmentPerformance({
    ...input,
    prices: createPriceBook(prices, months),
    today: taipeiDay(now),
  });
}

/** 依目前需要、尚未快取的月份排出要抓的清單（舊的月份先抓）。 */
export function pricesMonthsToFetch(input: {
  needs: { symbol: string; date: string }[];
  exchanges: Map<string, MarketExchange>;
  /** 已快取的「代號:日期」。 */
  cached: ReadonlySet<string>;
  months: SecurityPriceMonthRow[];
  now: Date;
}) {
  const currentMonth = monthOf(taipeiDay(input.now));
  const monthRows = new Map(
    input.months.map((row) => [`${row.symbol}:${row.month}`, row]),
  );
  const wanted = new Map<
    string,
    { symbol: string; month: string; exchange: MarketExchange }
  >();
  const due = (symbol: string, month: string) => {
    const row = monthRows.get(`${symbol}:${month}`);
    if (!row) return true;
    const age = input.now.getTime() - Date.parse(row.fetchedAt);
    if (row.status === "error") return age >= PRICE_ERROR_RETRY_MS;
    if (row.final) return false;
    return age >= PRICE_OPEN_MONTH_REFRESH_MS;
  };
  const want = (symbol: string, month: string) =>
    wanted.set(`${symbol}:${month}`, {
      symbol,
      month,
      exchange: input.exchanges.get(symbol) ?? "twse",
    });
  for (const need of input.needs) {
    const month = monthOf(need.date);
    if (month > currentMonth) continue;
    if (input.cached.has(`${need.symbol}:${need.date}`)) continue;
    if (due(need.symbol, month)) {
      want(need.symbol, month);
      continue;
    }
    // 當月已抓完仍沒有這天：往前找的日子落在上個月時，補抓上個月。
    const previous = monthOf(addDays(need.date, -PRICE_LOOKBACK_DAYS));
    if (previous !== month && due(need.symbol, previous))
      want(need.symbol, previous);
  }
  return [...wanted.values()].sort((a, b) =>
    a.month === b.month
      ? a.symbol.localeCompare(b.symbol)
      : a.month < b.month
        ? -1
        : 1,
  );
}

export async function refreshSecurityPrices(
  db: D1Database,
  options: {
    now?: Date;
    fetcher?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    maxRequests?: number;
  } = {},
) {
  const now = options.now ?? new Date();
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const [sources, prices, months] = await Promise.all([
    loadPerformanceSources(db),
    listSecurityPrices(db),
    listSecurityPriceMonths(db),
  ]);
  const { exchanges, ...input } = sources;
  const today = taipeiDay(now);
  const queue = pricesMonthsToFetch({
    needs: collectPriceNeeds(input, today),
    exchanges,
    cached: new Set(
      prices.map((price) => `${price.symbol}:${price.tradeDate}`),
    ),
    months,
    now,
  });
  const batch = queue.slice(0, options.maxRequests ?? PRICE_REQUESTS_PER_TICK);
  let fetched = 0;
  let failed = false;
  for (const [index, item] of batch.entries()) {
    if (index > 0) await sleep(PRICE_REQUEST_GAP_MS);
    const fetchedAt = new Date().toISOString();
    try {
      const result = await fetchMonthPrices(
        item.exchange,
        item.symbol,
        item.month,
        options.fetcher,
      );
      await saveSecurityPriceMonth(db, {
        ...item,
        status: result.status,
        final: item.month < monthOf(today),
        fetchedAt,
        closes: result.closes,
      });
      fetched += 1;
    } catch (error) {
      if (!(error instanceof MarketPriceUnavailableError)) throw error;
      await saveSecurityPriceMonth(db, {
        ...item,
        status: "error",
        final: false,
        fetchedAt,
        closes: [],
      });
      console.warn(
        JSON.stringify({
          event: "security_price_fetch_failed",
          exchange: item.exchange,
          symbol: item.symbol,
          month: item.month,
          reason: error.message,
        }),
      );
      // 可能被限流：這次先停，下次排程再試。
      failed = true;
      break;
    }
  }
  return { fetched, remaining: queue.length - fetched, failed };
}

/** Cron 入口：少量補抓收盤價；失敗只記錄，不影響同步排程。 */
export async function refreshScheduledSecurityPrices(
  env: Pick<Env, "DB" | "DEMO_MODE">,
  now = new Date(),
) {
  if (isDemoMode(env)) return;
  try {
    const result = await refreshSecurityPrices(env.DB, { now });
    if (result.fetched > 0 || result.failed)
      console.info(
        JSON.stringify({ event: "security_price_refresh", ...result }),
      );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "security_price_refresh_failed",
        kind: error instanceof Error ? error.name : typeof error,
      }),
    );
  }
}

export async function setInvestmentOpeningCost(
  db: D1Database,
  holdingKey: string,
  cost: number,
) {
  await upsertInvestmentOpeningCost(
    db,
    holdingKey,
    cost,
    new Date().toISOString(),
  );
}

export async function clearInvestmentOpeningCost(
  db: D1Database,
  holdingKey: string,
) {
  await deleteInvestmentOpeningCost(db, holdingKey);
}
