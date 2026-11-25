/**
 * 證交所（上市）與櫃買中心（上櫃）的個股日成交資訊：一次取一檔一個月的收盤價。
 * 純解析與抓取（fetch 可注入），不存取 D1。
 *
 * 價格為當時的實際成交價（未還原除權息與分割），與集保當時的股數相乘即為當時的金額。
 */
import { z } from "zod";

export type MarketExchange = "twse" | "tpex";

export type DailyClose = { date: string; close: number };

export type MonthPrices =
  | { status: "ok"; closes: DailyClose[] }
  /** 交易所明確回覆這個月沒有資料（尚未上市、停止交易或未來月份）。 */
  | { status: "empty"; closes: [] };

/** 回應不是預期格式（被限流、改版、網路錯誤）：不能當成「沒有資料」快取。 */
export class MarketPriceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketPriceUnavailableError";
  }
}

const REQUEST_TIMEOUT_MS = 15_000;
const TWSE_NO_DATA = "沒有符合條件的資料";

const twseSchema = z.object({
  stat: z.string(),
  data: z.array(z.array(z.string())).optional(),
  fields: z.array(z.string()).optional(),
});

const tpexSchema = z.object({
  stat: z.string(),
  tables: z
    .array(
      z.object({
        fields: z.array(z.string()),
        data: z.array(z.array(z.string())),
      }),
    )
    .min(1),
});

function monthParts(month: string) {
  const match = /^(\d{4})-(\d{2})$/u.exec(month);
  if (!match) throw new RangeError(`Invalid month: ${month}`);
  return { year: match[1]!, month: match[2]! };
}

export function twseMonthUrl(symbol: string, month: string) {
  const parts = monthParts(month);
  const query = new URLSearchParams({
    date: `${parts.year}${parts.month}01`,
    stockNo: symbol,
    response: "json",
  });
  return `https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?${query}`;
}

export function tpexMonthUrl(symbol: string, month: string) {
  const parts = monthParts(month);
  const query = new URLSearchParams({
    code: symbol,
    date: `${parts.year}/${parts.month}/01`,
    response: "json",
  });
  return `https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock?${query}`;
}

/** 民國日期「114/12/01」轉成「2025-12-01」。 */
export function rocDate(value: string) {
  const match = /^(\d{2,3})\/(\d{1,2})\/(\d{1,2})$/u.exec(value.trim());
  if (!match) return undefined;
  const year = Number(match[1]) + 1911;
  return `${year}-${match[2]!.padStart(2, "0")}-${match[3]!.padStart(2, "0")}`;
}

function parseClose(value: string | undefined) {
  if (value == null) return undefined;
  const number = Number(value.replace(/,/gu, ""));
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function closesFrom(
  fields: string[],
  rows: string[][],
  month: string,
): DailyClose[] {
  const normalized = fields.map((field) => field.replace(/\s+/gu, ""));
  const dateIndex = normalized.findIndex((field) => field === "日期");
  const closeIndex = normalized.findIndex(
    (field) => field === "收盤價" || field === "收盤",
  );
  if (dateIndex < 0 || closeIndex < 0)
    throw new MarketPriceUnavailableError("價格欄位與預期不同");
  const closes: DailyClose[] = [];
  for (const row of rows) {
    const date = rocDate(row[dateIndex] ?? "");
    // 日期格式或月份不對代表回應改版，不能當成沒有資料快取。
    if (!date || !date.startsWith(month))
      throw new MarketPriceUnavailableError("價格日期格式與預期不同");
    const raw = (row[closeIndex] ?? "").trim();
    const close = parseClose(raw);
    if (close != null) closes.push({ date, close });
    // 當天沒有成交時收盤價為「--」，略過；其他無法解析的值視為改版。
    else if (!/^-*$/u.test(raw))
      throw new MarketPriceUnavailableError("收盤價格式與預期不同");
  }
  return closes;
}

export function parseTwseMonth(body: unknown, month: string): MonthPrices {
  const parsed = twseSchema.safeParse(body);
  if (!parsed.success)
    throw new MarketPriceUnavailableError("證交所回應格式不符");
  if (parsed.data.stat.includes(TWSE_NO_DATA))
    return { status: "empty", closes: [] };
  if (parsed.data.stat !== "OK" || !parsed.data.fields || !parsed.data.data)
    throw new MarketPriceUnavailableError("證交所沒有回傳價格");
  const closes = closesFrom(parsed.data.fields, parsed.data.data, month);
  return closes.length
    ? { status: "ok", closes }
    : { status: "empty", closes: [] };
}

export function parseTpexMonth(body: unknown, month: string): MonthPrices {
  const parsed = tpexSchema.safeParse(body);
  if (!parsed.success || parsed.data.stat.toLowerCase() !== "ok")
    throw new MarketPriceUnavailableError("櫃買中心回應格式不符");
  const table = parsed.data.tables[0]!;
  const closes = closesFrom(table.fields, table.data, month);
  return closes.length
    ? { status: "ok", closes }
    : { status: "empty", closes: [] };
}

export async function fetchMonthPrices(
  exchange: MarketExchange,
  symbol: string,
  month: string,
  fetcher: typeof fetch = fetch,
): Promise<MonthPrices> {
  const url =
    exchange === "twse"
      ? twseMonthUrl(symbol, month)
      : tpexMonthUrl(symbol, month);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let body: unknown;
  try {
    const response = await fetcher(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok)
      throw new MarketPriceUnavailableError(`HTTP ${response.status}`);
    body = await response.json();
  } catch (error) {
    if (error instanceof MarketPriceUnavailableError) throw error;
    throw new MarketPriceUnavailableError(
      error instanceof Error ? error.name : "fetch failed",
    );
  } finally {
    clearTimeout(timeout);
  }
  return exchange === "twse"
    ? parseTwseMonth(body, month)
    : parseTpexMonth(body, month);
}
