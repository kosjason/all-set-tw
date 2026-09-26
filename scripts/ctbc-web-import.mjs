// 中國信託網銀半自動匯入工具。
//
// 使用者自行在一般 Chrome 視窗登入中信網銀；本工具只透過 Chrome DevTools Protocol
// 讀取該已登入頁面送出的第一個網銀 API 請求作為模板，並在同一頁面內以 XHR 唯讀查詢
// 資料，再送到 Worker `POST /api/connectors/ctbc/import`。
//
// 刻意不做：自動填寫帳密、偽裝瀏覽器、隱藏 webdriver、改 UA 或任何繞過防機器人的手段。
// Console 只輸出 resource 名稱、回應代碼、筆數與匯入結果；不輸出也不寫檔帳號、金額、
// 姓名、token 或 seed。

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_WORKER_URL = "http://localhost:8797";
export const DEFAULT_DEBUG_PORT = 9333;
export const DEFAULT_LOGIN_URL = "https://www.ctbcbank.com/twrbc/";
export const DEFAULT_LOGIN_TIMEOUT_MINUTES = 10;

export const EBMW_RESOURCE_PATH =
  "/IB/api/adapters/IB_Adapter/resource/ebmwResource";

export const RESOURCES = {
  depositOverview: "/twrbc-deposit/qu001/010",
  depositInit: "/twrbc-deposit/qu002/010",
  depositTransactions: "/twrbc-deposit/qu002/011",
  creditCardBills: "/twrbc-card/qu002/010",
  // 網銀帳單頁選取月份時送出 {curCode, month}，month 為 billData 的鍵（例如 "2026/08"）。
  creditCardMonthBills: "/twrbc-card/qu002/011",
  // 帳單明細分頁：{curCode, month, pageNum}。
  creditCardMonthBillsPage: "/twrbc-card/qu002/016",
  unbilledInit: "/twrbc-card/qu006/010",
  unbilled: "/twrbc-card/qu006/011",
  unbilledPage: "/twrbc-card/qu006/015",
  realtime: "/twrbc-card/qu041/010",
  realtimePage: "/twrbc-card/qu041/015",
  logout: "/twrbc-general/ot002/010",
};

const LOGIN_RESOURCE_PATTERN = /\/ot001\//;
const PER_REQUEST_BODY_FIELDS = new Set([
  "resource",
  "rqData",
  "trackingIxd",
  "txnIxd",
  "clientTime",
]);
const TEMPLATE_HEADER_NAMES = [
  "accept",
  "content-type",
  "x-auth-token",
  "x-channel-id",
  "x-requested-with",
];
const DEPOSIT_HISTORY_MONTHS = 3;
export const STATEMENT_DETAIL_MONTHS = 3;
const MAX_PAGES = 20;
const REQUEST_TIMEOUT_MS = 45_000;

export class CtbcWebImportError extends Error {
  constructor(message) {
    super(message);
    this.name = "CtbcWebImportError";
  }
}

// ---------------------------------------------------------------------------
// 純函式：參數、模板、請求組裝、輸出遮罩
// ---------------------------------------------------------------------------

export function parseArgs(argv, env = {}) {
  const options = {
    workerUrl: DEFAULT_WORKER_URL,
    port: DEFAULT_DEBUG_PORT,
    loginUrl: DEFAULT_LOGIN_URL,
    loginTimeoutMinutes: DEFAULT_LOGIN_TIMEOUT_MINUTES,
    dryRun: false,
    help: false,
    accessClientId: env.CF_ACCESS_CLIENT_ID?.trim() || undefined,
    accessClientSecret: env.CF_ACCESS_CLIENT_SECRET?.trim() || undefined,
  };
  const valueOf = (index, name) => {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new CtbcWebImportError(`${name} 需要參數值。`);
    }
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const [flag, inline] = argv[index].split(/=(.*)/s, 2);
    const read = () => {
      if (inline !== undefined) return inline;
      const value = valueOf(index, flag);
      index += 1;
      return value;
    };
    switch (flag) {
      case "--worker":
        options.workerUrl = read().replace(/\/+$/, "");
        break;
      case "--port":
        options.port = Number(read());
        break;
      case "--login-url":
        options.loginUrl = read();
        break;
      case "--timeout":
        options.loginTimeoutMinutes = Number(read());
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "-h":
      case "--help":
        options.help = true;
        break;
      default:
        throw new CtbcWebImportError(`不支援的參數：${flag}`);
    }
  }
  if (!Number.isInteger(options.port) || options.port < 1024) {
    throw new CtbcWebImportError("--port 必須是 1024 以上的整數。");
  }
  if (
    !Number.isFinite(options.loginTimeoutMinutes) ||
    options.loginTimeoutMinutes <= 0
  ) {
    throw new CtbcWebImportError("--timeout 必須是正數（分鐘）。");
  }
  assertHttpUrl(options.workerUrl, "--worker");
  const loginUrl = assertHttpUrl(options.loginUrl, "--login-url");
  if (loginUrl.protocol !== "https:" || !isCtbcHost(loginUrl.hostname)) {
    throw new CtbcWebImportError(
      "--login-url 必須是 ctbcbank.com 的 https 網址。",
    );
  }
  if (Boolean(options.accessClientId) !== Boolean(options.accessClientSecret)) {
    throw new CtbcWebImportError(
      "CF_ACCESS_CLIENT_ID 與 CF_ACCESS_CLIENT_SECRET 必須同時設定。",
    );
  }
  return options;
}

export const USAGE = `用法：node scripts/ctbc-web-import.mjs [選項]

  --worker <url>      Worker 位址（預設 ${DEFAULT_WORKER_URL}）
  --port <port>       Chrome 遠端除錯埠（預設 ${DEFAULT_DEBUG_PORT}，僅監聽本機）
  --login-url <url>   開啟的中信網銀頁面（預設 ${DEFAULT_LOGIN_URL}）
  --timeout <分鐘>    等待登入的時間（預設 ${DEFAULT_LOGIN_TIMEOUT_MINUTES}）
  --dry-run           只查詢並顯示筆數，不送到 Worker

環境變數 CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET：Worker 受 Cloudflare Access
保護時使用的 service token。`;

function assertHttpUrl(value, name) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new CtbcWebImportError(`${name} 不是有效網址。`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CtbcWebImportError(`${name} 必須是 http 或 https 網址。`);
  }
  return url;
}

function isCtbcHost(hostname) {
  return hostname === "ctbcbank.com" || hostname.endsWith(".ctbcbank.com");
}

export function isEbmwResourceUrl(value) {
  try {
    const url = new URL(value);
    return isCtbcHost(url.hostname) && url.pathname === EBMW_RESOURCE_PATH;
  } catch {
    return false;
  }
}

/** 只保留重送 API 所需的 header；Cookie、UA 與防機器人 header 由瀏覽器自行處理。 */
export function pickTemplateHeaders(headers) {
  const picked = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    const lower = name.toLowerCase();
    if (TEMPLATE_HEADER_NAMES.includes(lower) && typeof value === "string") {
      picked[canonicalHeaderName(lower)] = value;
    }
  }
  return picked;
}

function canonicalHeaderName(lower) {
  if (lower === "x-auth-token") return "x-auth-token";
  return lower.replace(
    /(^|-)([a-z])/g,
    (_, dash, char) => dash + char.toUpperCase(),
  );
}

/**
 * 從頁面登入後自己送出的 API 請求建立模板。登入請求（ot001）一律忽略，
 * 其 body 含加密帳密，不解析也不保存。
 */
export function extractRequestTemplate(url, postData, headers) {
  if (!isEbmwResourceUrl(url) || typeof postData !== "string") return null;
  let body;
  try {
    body = JSON.parse(postData);
  } catch {
    return null;
  }
  if (!isRecord(body)) return null;
  if (typeof body.resource !== "string") return null;
  if (LOGIN_RESOURCE_PATTERN.test(body.resource)) return null;
  if (typeof body.seed !== "string" || body.seed.length === 0) return null;
  const pickedHeaders = pickTemplateHeaders(headers);
  if (!pickedHeaders["x-auth-token"]) return null;
  const templateBody = {};
  for (const [key, value] of Object.entries(body)) {
    templateBody[key] = PER_REQUEST_BODY_FIELDS.has(key) ? null : value;
  }
  return {
    origin: new URL(url).origin,
    body: templateBody,
    clientTimeType: typeof body.clientTime === "number" ? "number" : "string",
    headers: pickedHeaders,
  };
}

/** 依模板組 body；每次只替換 resource、rqData、trackingIxd、txnIxd、clientTime。 */
export function buildRequestBody(
  template,
  resource,
  rqData,
  { now = Date.now(), uuid = () => crypto.randomUUID() } = {},
) {
  const body = {
    ...template.body,
    resource,
    rqData,
    trackingIxd: uuid(),
    txnIxd: uuid(),
    clientTime: template.clientTimeType === "number" ? now : String(now),
  };
  return body;
}

/** 網銀請求在 console 上只允許顯示這三個欄位，其餘一律不輸出。 */
export function formatResourceLog(resource, code, count) {
  const safeResource = /^\/twrbc-[a-z]+\/[a-z]{2}\d{3}\/\d{3}$/.test(resource)
    ? resource
    : "[resource]";
  const safeCode = /^[A-Za-z0-9]{1,8}$/.test(String(code ?? ""))
    ? String(code)
    : "?";
  const safeCount =
    Number.isInteger(count) && count >= 0 ? ` 筆數=${count}` : "";
  return `  ${safeResource} code=${safeCode}${safeCount}`;
}

/** Worker 或例外訊息可能夾帶識別資訊；遮蔽長數字、網址與 token 形狀字串。 */
export function redactMessage(value) {
  return String(value ?? "")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/[A-Za-z0-9+/_=-]{24,}/g, "[redacted]")
    .replace(/\d[\d,.-]{4,}\d/g, "[redacted]")
    .replace(/\b[A-Z][12]\d{8}\b/g, "[redacted]")
    .slice(0, 300);
}

/** 帳單月份只允許輸出 YYYY/MM 形狀，其餘一律遮蔽。 */
export function formatStatementMonth(month) {
  return /^\d{4}\/?\d{2}$/.test(String(month)) ? String(month) : "[month]";
}

export function responseCode(response) {
  if (!isRecord(response)) return "?";
  return stringValue(response.code || response.statusCode) || "?";
}

export function isResourceSuccess(response) {
  if (!isRecord(response)) return false;
  const code = stringValue(response.code);
  const statusCode = stringValue(response.statusCode);
  const system = stringValue(response.sys || response.systemId);
  if (code === "8888" || (system === "ESB" && code === "9201")) return true;
  if (response.success === false) return false;
  if (code && code !== "0000") return false;
  if (statusCode && statusCode !== "0000") return false;
  return true;
}

/**
 * 存款明細查詢參數的嘗試順序。實測頁面自己的 `{accountId, type:"m0"}` 有資料，
 * 同參數手動重送卻回 H404，因此依序嘗試：頁面實際送出的參數（若有觀察到）、
 * m0/m1/m2、dateRanges 的 YYYYMMDD、dateRanges 的 YYYY/MM/DD、自行推算的月份區間。
 */
export function depositQueryStrategies(
  accountId,
  { dateRanges = [], observedQuery, now = new Date() } = {},
) {
  const strategies = [];
  if (isRecord(observedQuery)) {
    strategies.push({
      name: "observed",
      requests: [{ ...observedQuery, accountId }],
    });
  }
  strategies.push({
    name: "type-month",
    requests: ["m0", "m1", "m2"]
      .slice(0, DEPOSIT_HISTORY_MONTHS)
      .map((type) => ({ accountId, type })),
  });
  const ranges = normalizeDateRanges(dateRanges).slice(
    0,
    DEPOSIT_HISTORY_MONTHS,
  );
  if (ranges.length > 0) {
    strategies.push({
      name: "custom-yyyymmdd",
      requests: ranges.map((range) =>
        customQuery(accountId, range.startDate, range.endDate),
      ),
    });
    strategies.push({
      name: "custom-slash",
      requests: ranges.map((range) =>
        customQuery(
          accountId,
          slashDate(range.startDate),
          slashDate(range.endDate),
        ),
      ),
    });
  }
  strategies.push({
    name: "custom-computed",
    requests: monthlyRanges(DEPOSIT_HISTORY_MONTHS, now).map((range) =>
      customQuery(accountId, range.startDate, range.endDate),
    ),
  });
  return strategies;
}

/**
 * 需要補抓明細的帳單月份：每個幣別取最近 `limit` 期。帳單首頁 `qu002/010`
 * 只附最新一期明細，其他月份只有 summary，須逐月以 `qu002/011` 查詢；
 * 已有明細但標示分頁且筆數不足者也列入，以便補抓後續分頁。
 */
export function statementMonthsToFetch(
  creditCards,
  limit = STATEMENT_DETAIL_MONTHS,
) {
  const billData = recordValue(responseData(creditCards).billData);
  const months = [];
  for (const [currency, currencyValue] of Object.entries(billData)) {
    if (!isRecord(currencyValue)) continue;
    const keys = Object.keys(currencyValue)
      .filter((key) => isRecord(currencyValue[key]))
      .sort((left, right) => right.localeCompare(left))
      .slice(0, limit);
    for (const month of keys) {
      const group = currencyValue[month];
      const bills = arrayValue(group.bills);
      if (bills.length === 0 || needsMorePages(group, bills.length)) {
        months.push({ currency, month, hasBills: bills.length > 0 });
      }
    }
  }
  return months;
}

/**
 * 帳單月份明細的參數嘗試順序。網銀前端送出 `{curCode, month}`，month 與
 * billData 的鍵相同（`YYYY/MM`）；若伺服器改用無分隔格式，再試 `YYYYMM`。
 */
export function statementDetailQueries(currency, month) {
  const queries = [{ curCode: currency, month }];
  const compact = month.replace(/\D/g, "");
  if (compact !== month) queries.push({ curCode: currency, month: compact });
  return queries;
}

function needsMorePages(group, loadedCount) {
  const displayPaging =
    group.displayPaging === true || group.displayPaging === "Y";
  const totalRows = numberValue(group.totalRow);
  return displayPaging && totalRows != null && totalRows > loadedCount;
}

function customQuery(accountId, startDate, endDate) {
  return { accountId, startDate, endDate, keyWord: "", type: "custom" };
}

function normalizeDateRanges(value) {
  return arrayValue(value)
    .flatMap((range) => {
      if (!isRecord(range)) return [];
      const startDate = compactDigits(range.firstDateYYYYMMDD);
      const endDate = compactDigits(range.lastDateYYYYMMDD);
      return startDate && endDate ? [{ startDate, endDate }] : [];
    })
    .sort((left, right) => right.startDate.localeCompare(left.startDate));
}

function compactDigits(value) {
  const digits = stringValue(value).replace(/\D/g, "");
  return digits.length === 8 ? digits : "";
}

function slashDate(compact) {
  return `${compact.slice(0, 4)}/${compact.slice(4, 6)}/${compact.slice(6, 8)}`;
}

export function monthlyRanges(months, now = new Date()) {
  const taipeiNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const ranges = [];
  for (let offset = 0; offset < months; offset += 1) {
    const start = new Date(
      Date.UTC(taipeiNow.getUTCFullYear(), taipeiNow.getUTCMonth() - offset, 1),
    );
    const end =
      offset === 0
        ? taipeiNow
        : new Date(
            Date.UTC(
              taipeiNow.getUTCFullYear(),
              taipeiNow.getUTCMonth() - offset + 1,
              0,
            ),
          );
    ranges.push({ startDate: compactDate(start), endDate: compactDate(end) });
  }
  return ranges;
}

function compactDate(date) {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// 資料收集（以注入的 call 執行，方便以假資料測試）
// ---------------------------------------------------------------------------

/**
 * 依序查詢網銀 resource 並組成 Worker 匯入 API 的 `CtbcPayloads`。
 * `call(resource, rqData)` 回傳已解析的回應物件。
 */
export async function collectCtbcPayloads(call, options = {}) {
  const log = options.log ?? (() => {});
  const now = options.now ?? new Date();
  const observedDepositQuery = options.observedDepositQuery ?? (() => null);

  const request = async (resource, rqData, countOf) => {
    const response = await call(resource, rqData);
    const count = countOf ? countOf(response) : undefined;
    log(formatResourceLog(resource, responseCode(response), count));
    return response;
  };
  const required = async (resource, rqData, countOf) => {
    const response = await request(resource, rqData, countOf);
    if (!isResourceSuccess(response)) {
      throw new CtbcWebImportError(
        `${resource} 查詢失敗（code=${responseCode(response)}），未匯入任何資料。`,
      );
    }
    return response;
  };

  const depositOverview = await required(
    RESOURCES.depositOverview,
    {},
    (response) => extractDepositAccountIds(response).length,
  );
  const deposit = await collectDepositTransactions(
    request,
    extractDepositAccountIds(depositOverview),
    { now, observedDepositQuery },
  );
  const creditCardOverview = await required(RESOURCES.creditCardBills, {});
  const statements = await collectStatementDetails(request, creditCardOverview);
  const creditCards = statements.creditCards;
  const unbilled = await collectUnbilled(required);
  const realtime = await collectPagedCardItems(
    required,
    RESOURCES.realtime,
    RESOURCES.realtimePage,
    {},
  );

  return {
    payloads: {
      depositOverview,
      depositTransactions: { rsData: { detailList: deposit.transactions } },
      creditCards,
      unbilled,
      realtime,
    },
    depositTransactionsUnavailable: deposit.unavailable,
    depositStrategy: deposit.strategy,
    statementMonthsUnavailable: statements.unavailableMonths,
  };
}

/**
 * 逐月補抓已出帳帳單明細並併回 `qu002/010` 回應的 billData。查詢失敗不中止
 * 匯入：該月份只保留帳單總額，並回報月份供使用者確認。
 */
async function collectStatementDetails(request, creditCardOverview) {
  const creditCards = structuredClone(creditCardOverview);
  const billData = recordValue(responseData(creditCards).billData);
  const unavailableMonths = [];
  const billCount = (response) =>
    arrayValue(responseData(response).bills).length;
  for (const { currency, month, hasBills } of statementMonthsToFetch(
    creditCardOverview,
  )) {
    const target = billData[currency][month];
    let group = hasBills ? target : null;
    if (!group) {
      for (const rqData of statementDetailQueries(currency, month)) {
        const response = await request(
          RESOURCES.creditCardMonthBills,
          rqData,
          billCount,
        );
        const data = responseData(response);
        if (isResourceSuccess(response) && Array.isArray(data.bills)) {
          group = { ...data, month: rqData.month };
          break;
        }
      }
    }
    if (!group) {
      unavailableMonths.push(month);
      continue;
    }
    const bills = [...arrayValue(group.bills)];
    const pageCount = numberValue(group.pageCount) ?? 0;
    const totalRows = numberValue(group.totalRow) ?? bills.length;
    if (needsMorePages(group, bills.length) && pageCount > 0) {
      const totalPages = Math.min(MAX_PAGES, Math.ceil(totalRows / pageCount));
      for (let pageNum = 2; pageNum <= totalPages; pageNum += 1) {
        const page = await request(
          RESOURCES.creditCardMonthBillsPage,
          { curCode: currency, month: group.month ?? month, pageNum },
          billCount,
        );
        if (!isResourceSuccess(page)) break;
        bills.push(...arrayValue(responseData(page).bills));
      }
    }
    billData[currency][month] = {
      ...target,
      ...(group === target
        ? {}
        : pick(group, ["totalRow", "pageCount", "displayPaging"])),
      // 首頁已有的 summary 欄位為準；月份回應只補上缺少的欄位。
      summary: {
        ...recordValue(group.summary),
        ...recordValue(target.summary),
      },
      bills,
    };
  }
  return { creditCards, unavailableMonths };
}

function pick(value, keys) {
  return Object.fromEntries(
    keys.filter((key) => key in value).map((key) => [key, value[key]]),
  );
}

async function collectDepositTransactions(
  request,
  accountIds,
  { now, observedDepositQuery },
) {
  const transactions = [];
  let workingStrategy = null;
  let anySuccess = false;

  for (const accountId of accountIds) {
    const firstInit = await request(RESOURCES.depositInit, { accountId });
    if (!isResourceSuccess(firstInit)) continue;
    const initData = responseData(firstInit);
    const queryAccountId = selectTransactionAccountId(firstInit, accountId);
    const strategies = orderStrategies(
      depositQueryStrategies(queryAccountId, {
        dateRanges: arrayValue(initData.dateRanges),
        observedQuery: observedDepositQuery(),
        now,
      }),
      workingStrategy,
    );
    for (let index = 0; index < strategies.length; index += 1) {
      if (index > 0) {
        // 每種參數組合前都照頁面流程重新選取帳戶，避免伺服器端選取狀態不一致。
        const init = await request(RESOURCES.depositInit, { accountId });
        if (!isResourceSuccess(init)) continue;
      }
      const strategy = strategies[index];
      let strategySucceeded = false;
      const strategyItems = [];
      for (const rqData of strategy.requests) {
        const items = await queryDepositPages(request, rqData);
        if (items === null) continue;
        strategySucceeded = true;
        strategyItems.push(...items);
      }
      if (!strategySucceeded) continue;
      anySuccess = true;
      workingStrategy = strategy.name;
      for (const item of strategyItems) {
        transactions.push({ ...item, sourceAccountId: accountId });
      }
      break;
    }
  }

  return {
    transactions,
    unavailable: accountIds.length > 0 && !anySuccess,
    strategy: workingStrategy,
  };
}

function orderStrategies(strategies, preferredName) {
  if (!preferredName) return strategies;
  return [
    ...strategies.filter((strategy) => strategy.name === preferredName),
    ...strategies.filter((strategy) => strategy.name !== preferredName),
  ];
}

/** 回傳該查詢的明細；非 0000 視為此參數組合無效並回傳 null。 */
async function queryDepositPages(request, rqData) {
  const items = [];
  let pageRequest = rqData;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await request(
      RESOURCES.depositTransactions,
      pageRequest,
      (value) => arrayValue(responseData(value).detailList).length,
    );
    if (stringValue(response?.code) !== "0000") {
      return page === 0 ? null : items;
    }
    const data = responseData(response);
    const detailList = arrayValue(data.detailList).filter(isRecord);
    items.push(...detailList);
    const nextKey = stringValue(data.nextKey).trim();
    if (!nextKey || detailList.length === 0) break;
    pageRequest = { ...rqData, nextKey };
  }
  return items;
}

async function collectUnbilled(required) {
  const initial = await required(RESOURCES.unbilledInit, {});
  const currencies = extractCurrencyCodes(responseData(initial));
  const allItems = [];
  // cardInfos 列出有未出帳消費的卡片與未出帳合計，解析器用來決定要建立哪些卡片帳戶。
  const cardInfos = [];
  for (const currency of currencies.length ? currencies : ["TWD"]) {
    const response = await collectPagedCardItems(
      required,
      RESOURCES.unbilled,
      RESOURCES.unbilledPage,
      { curCode: currency },
    );
    const data = responseData(response);
    for (const item of arrayValue(data.allItems)) {
      allItems.push(
        isRecord(item) ? { ...item, sourceCurrency: currency } : item,
      );
    }
    cardInfos.push(...arrayValue(data.cardInfos).filter(isRecord));
  }
  return { rsData: { allItems, cardInfos } };
}

async function collectPagedCardItems(
  required,
  initialResource,
  pageResource,
  rqData,
) {
  const itemCount = (response) =>
    arrayValue(responseData(response).allItems).length;
  const initial = await required(initialResource, rqData, itemCount);
  const data = responseData(initial);
  const allItems = [...arrayValue(data.allItems)];
  const pageCount = numberValue(data.pageCount) ?? 100;
  const totalRows = numberValue(data.totalRow) ?? allItems.length;
  const displayPaging =
    data.displayPaging === true || data.displayPaging === "Y";
  const totalPages = displayPaging
    ? Math.min(MAX_PAGES, Math.max(1, Math.ceil(totalRows / pageCount)))
    : 1;
  for (let pageNum = 2; pageNum <= totalPages; pageNum += 1) {
    const page = await required(pageResource, { pageNum }, itemCount);
    allItems.push(...arrayValue(responseData(page).allItems));
  }
  return { rsData: { ...data, allItems } };
}

export function extractDepositAccountIds(payload) {
  const twd = recordValue(responseData(payload).twdAcctSummaryResponse);
  const demand = recordValue(twd.demDepBalSummaryResponse);
  return arrayValue(demand.infoList).flatMap((value) => {
    if (!isRecord(value)) return [];
    const accountId = stringValue(value.accountId).trim();
    return accountId ? [accountId] : [];
  });
}

function selectTransactionAccountId(payload, requestedAccountId) {
  const data = responseData(payload);
  const selected = stringValue(data.accountId).trim();
  const selections = [
    ...arrayValue(data.accountSelections),
    ...arrayValue(data.accountInfoList),
    ...arrayValue(data.selectList),
  ].flatMap((value) => {
    if (!isRecord(value)) return [];
    const accountId = stringValue(value.accountId ?? value.acctId).trim();
    return accountId ? [accountId] : [];
  });
  return (
    selections.find((value) => value === selected) ??
    selections.find((value) => value === requestedAccountId) ??
    selections[0] ??
    (selected || requestedAccountId)
  );
}

function extractCurrencyCodes(data) {
  const values = [
    ...arrayValue(data.curOptions),
    ...arrayValue(data.curDataList),
  ];
  return Array.from(
    new Set(
      values.flatMap((value) => {
        if (!isRecord(value)) return [];
        const code = stringValue(value.curCode).trim().toUpperCase();
        return code ? [code === "NTD" ? "TWD" : code] : [];
      }),
    ),
  );
}

export function summarizePayloads(result) {
  const { payloads } = result;
  return {
    depositAccounts: extractDepositAccountIds(payloads.depositOverview).length,
    depositTransactions: arrayValue(
      responseData(payloads.depositTransactions).detailList,
    ).length,
    statementItems: Object.values(
      recordValue(responseData(payloads.creditCards).billData),
    )
      .flatMap((currencyValue) => Object.values(recordValue(currencyValue)))
      .reduce(
        (total, group) => total + arrayValue(recordValue(group).bills).length,
        0,
      ),
    unbilledItems: arrayValue(responseData(payloads.unbilled).allItems).length,
    realtimeItems: arrayValue(responseData(payloads.realtime).allItems).length,
  };
}

// ---------------------------------------------------------------------------
// Chrome DevTools Protocol
// ---------------------------------------------------------------------------

class CdpConnection {
  #socket;
  #nextId = 1;
  #pending = new Map();
  #listeners = new Map();

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener(
        "error",
        () => reject(new CtbcWebImportError("無法連線 Chrome 除錯介面。")),
        { once: true },
      );
    });
    return new CdpConnection(socket);
  }

  constructor(socket) {
    this.#socket = socket;
    socket.addEventListener("message", (event) => this.#onMessage(event));
    socket.addEventListener("close", () => {
      for (const { reject } of this.#pending.values()) {
        reject(new CtbcWebImportError("Chrome 除錯連線已中斷。"));
      }
      this.#pending.clear();
    });
  }

  send(method, params = {}, sessionId, timeoutMs = 60_000) {
    const id = this.#nextId++;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new CtbcWebImportError(`Chrome 指令逾時：${method}`));
      }, timeoutMs);
      this.#pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.#socket.send(JSON.stringify(message));
    });
  }

  on(method, handler) {
    const handlers = this.#listeners.get(method) ?? [];
    handlers.push(handler);
    this.#listeners.set(method, handlers);
  }

  close() {
    try {
      this.#socket.close();
    } catch {
      // Already closed.
    }
  }

  #onMessage(event) {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (message.id !== undefined) {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      if (message.error) {
        pending.reject(
          new CtbcWebImportError(
            `Chrome 指令失敗（${redactMessage(message.error.message)}）。`,
          ),
        );
      } else {
        pending.resolve(message.result ?? {});
      }
      return;
    }
    for (const handler of this.#listeners.get(message.method) ?? []) {
      handler(message.params ?? {}, message.sessionId);
    }
  }
}

/** 監看所有分頁的網銀 API 請求，取得登入後模板並記住頁面自己的存款明細查詢參數。 */
class RequestTemplateWatcher {
  #cdp;
  #attached = new Set();
  #ownTrackingIds = new Set();
  #waiters = [];
  template = null;
  templateSessionId = null;
  observedDepositQuery = null;

  constructor(cdp) {
    this.#cdp = cdp;
  }

  async start() {
    this.#cdp.on("Target.targetCreated", ({ targetInfo }) =>
      this.#attach(targetInfo),
    );
    this.#cdp.on("Network.requestWillBeSent", (params, sessionId) =>
      this.#onRequest(params, sessionId),
    );
    await this.#cdp.send("Target.setDiscoverTargets", { discover: true });
    const { targetInfos = [] } = await this.#cdp.send("Target.getTargets");
    await Promise.all(targetInfos.map((info) => this.#attach(info)));
  }

  markOwnRequest(trackingIxd) {
    this.#ownTrackingIds.add(trackingIxd);
  }

  waitForTemplate(timeoutMs) {
    if (this.template) return Promise.resolve(this.template);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new CtbcWebImportError("等待登入逾時，未匯入任何資料。"));
      }, timeoutMs);
      this.#waiters.push((template) => {
        clearTimeout(timer);
        resolve(template);
      });
    });
  }

  async #attach(targetInfo) {
    if (targetInfo?.type !== "page" || this.#attached.has(targetInfo.targetId))
      return;
    this.#attached.add(targetInfo.targetId);
    try {
      const { sessionId } = await this.#cdp.send("Target.attachToTarget", {
        targetId: targetInfo.targetId,
        flatten: true,
      });
      await this.#cdp.send("Network.enable", {}, sessionId);
    } catch {
      // 分頁可能已關閉；不影響其他分頁。
    }
  }

  async #onRequest(params, sessionId) {
    const request = params.request;
    if (!request || request.method !== "POST") return;
    if (!isEbmwResourceUrl(request.url)) return;
    let postData = request.postData;
    if (postData === undefined && request.hasPostData) {
      try {
        ({ postData } = await this.#cdp.send(
          "Network.getRequestPostData",
          { requestId: params.requestId },
          sessionId,
        ));
      } catch {
        return;
      }
    }
    if (typeof postData !== "string") return;
    let body;
    try {
      body = JSON.parse(postData);
    } catch {
      return;
    }
    if (!isRecord(body) || typeof body.resource !== "string") return;
    if (LOGIN_RESOURCE_PATTERN.test(body.resource)) return;
    if (this.#ownTrackingIds.has(body.trackingIxd)) return;

    if (
      body.resource === RESOURCES.depositTransactions &&
      isRecord(body.rqData)
    ) {
      const { nextKey: _nextKey, ...query } = body.rqData;
      this.observedDepositQuery = query;
    }
    if (this.template) return;
    const template = extractRequestTemplate(
      request.url,
      postData,
      request.headers,
    );
    if (!template) return;
    this.template = template;
    this.templateSessionId = sessionId;
    for (const waiter of this.#waiters.splice(0)) waiter(template);
  }
}

/** 在已登入的頁面內以 XHR 發出請求，讓頁面既有的安全機制照常處理。 */
class PageApiSession {
  #cdp;
  #watcher;
  #sessionId;
  #template;

  constructor(cdp, watcher) {
    this.#cdp = cdp;
    this.#watcher = watcher;
    this.#sessionId = watcher.templateSessionId;
    this.#template = {
      ...watcher.template,
      headers: { ...watcher.template.headers },
    };
  }

  async call(resource, rqData) {
    const body = buildRequestBody(this.#template, resource, rqData);
    this.#watcher.markOwnRequest(body.trackingIxd);
    const expression = inPageXhrExpression(
      `${this.#template.origin}${EBMW_RESOURCE_PATH}`,
      this.#template.headers,
      JSON.stringify(body),
    );
    const evaluated = await this.#cdp.send(
      "Runtime.evaluate",
      { expression, awaitPromise: true, returnByValue: true },
      this.#sessionId,
      REQUEST_TIMEOUT_MS + 15_000,
    );
    if (evaluated.exceptionDetails) {
      throw new CtbcWebImportError(`${resource} 頁面內請求失敗。`);
    }
    const result = evaluated.result?.value;
    if (!isRecord(result) || result.status !== 200) {
      throw new CtbcWebImportError(
        `${resource} 請求失敗（HTTP ${isRecord(result) ? Number(result.status) || 0 : 0}）。`,
      );
    }
    if (typeof result.authToken === "string" && result.authToken) {
      this.#template.headers["x-auth-token"] = result.authToken;
    }
    try {
      const parsed = JSON.parse(String(result.text));
      if (isRecord(parsed)) return parsed;
    } catch {
      // Fall through.
    }
    throw new CtbcWebImportError(
      `${resource} 回應不是預期格式（可能已登出或被安全機制阻擋），未匯入任何資料。`,
    );
  }
}

function inPageXhrExpression(url, headers, body) {
  return `new Promise((resolve) => {
  const xhr = new XMLHttpRequest();
  xhr.open("POST", ${JSON.stringify(url)}, true);
  const headers = ${JSON.stringify(headers)};
  for (const name of Object.keys(headers)) xhr.setRequestHeader(name, headers[name]);
  xhr.timeout = ${REQUEST_TIMEOUT_MS};
  xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText, authToken: xhr.getResponseHeader("x-auth-token") });
  xhr.onerror = () => resolve({ status: 0 });
  xhr.ontimeout = () => resolve({ status: 0 });
  xhr.send(${JSON.stringify(body)});
})`;
}

// ---------------------------------------------------------------------------
// 流程
// ---------------------------------------------------------------------------

async function waitForDebugger(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return await response.json();
    } catch {
      // Chrome 尚未就緒。
    }
    await sleep(500);
  }
  throw new CtbcWebImportError("Chrome 未在時間內開啟除錯介面。");
}

async function assertPortFree(port) {
  try {
    await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(1_000),
    });
  } catch {
    return;
  }
  throw new CtbcWebImportError(
    `127.0.0.1:${port} 已有程式使用，請以 --port 指定其他埠。`,
  );
}

function launchChrome(options, profileDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "open",
      [
        "-na",
        "Google Chrome",
        "--args",
        `--user-data-dir=${profileDir}`,
        `--remote-debugging-port=${options.port}`,
        "--no-first-run",
        options.loginUrl,
      ],
      { stdio: "ignore" },
    );
    child.once("error", () =>
      reject(new CtbcWebImportError("無法啟動 Google Chrome。")),
    );
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new CtbcWebImportError("無法啟動 Google Chrome。")),
    );
  });
}

async function closeChrome(browser, profileDir) {
  if (browser) {
    try {
      await browser.send("Browser.close", {}, undefined, 5_000);
    } catch {
      // 連線可能已中斷；下方以 profile 路徑結束程序。
    }
    browser.close();
  }
  await new Promise((resolve) => {
    const child = spawn(
      "pkill",
      ["-f", "--", `--user-data-dir=${profileDir}`],
      {
        stdio: "ignore",
      },
    );
    child.once("error", resolve);
    child.once("exit", resolve);
  });
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(profileDir, { recursive: true, force: true });
      return true;
    } catch {
      await sleep(500);
    }
  }
  return false;
}

async function postImport(options, result) {
  const headers = { "Content-Type": "application/json" };
  if (options.accessClientId && options.accessClientSecret) {
    headers["CF-Access-Client-Id"] = options.accessClientId;
    headers["CF-Access-Client-Secret"] = options.accessClientSecret;
  }
  let response;
  try {
    response = await fetch(`${options.workerUrl}/api/connectors/ctbc/import`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        payloads: result.payloads,
        depositTransactionsUnavailable: result.depositTransactionsUnavailable,
      }),
      redirect: "manual",
    });
  } catch {
    throw new CtbcWebImportError("無法連線 Worker，未匯入任何資料。");
  }
  let json = null;
  try {
    json = await response.json();
  } catch {
    // 非 JSON（例如 Access 登入頁）。
  }
  return { status: response.status, json };
}

export function formatImportResult({ status, json }) {
  if (status === 200 && json?.success === true) {
    const lines = [
      `匯入成功：records=${Number(json.records) || 0}，新增交易=${Number(json.newRecords?.bankTransactions) || 0}`,
    ];
    for (const warning of arrayValue(json.warnings)) {
      lines.push(`警告：${redactMessage(warning)}`);
    }
    return { ok: true, lines };
  }
  const code = /^[A-Z0-9_]{1,64}$/.test(stringValue(json?.error?.code))
    ? json.error.code
    : "UNKNOWN";
  const message = redactMessage(json?.error?.message ?? "");
  const hint =
    status === 302 || status === 401 || status === 403
      ? "（請確認 Cloudflare Access service token）"
      : "";
  return {
    ok: false,
    lines: [`匯入失敗：HTTP ${status} ${code} ${message}${hint}`.trim()],
  };
}

async function run(argv) {
  let options;
  try {
    options = parseArgs(argv, process.env);
  } catch (error) {
    console.error(safeErrorText(error));
    console.error(USAGE);
    return 2;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }

  try {
    await assertPortFree(options.port);
  } catch (error) {
    console.error(safeErrorText(error));
    return 1;
  }
  const profileDir = await mkdtemp(path.join(tmpdir(), "ctbc-web-import-"));
  let browser = null;
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    const removed = await closeChrome(browser, profileDir);
    if (!removed) console.error("無法刪除暫存 Chrome profile，請手動刪除。");
  };
  const onSignal = () => {
    console.error("已中斷，正在關閉 Chrome…");
    void cleanup().finally(() => process.exit(130));
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    await launchChrome(options, profileDir);
    const version = await waitForDebugger(options.port, 30_000);
    browser = await CdpConnection.connect(version.webSocketDebuggerUrl);
    const watcher = new RequestTemplateWatcher(browser);
    await watcher.start();

    console.log("請在剛開啟的 Chrome 視窗自行登入中國信託網銀。");
    await watcher.waitForTemplate(options.loginTimeoutMinutes * 60_000);
    console.log("已偵測到登入，開始唯讀查詢；完成前請勿操作該視窗。");
    await sleep(3_000);

    const session = new PageApiSession(browser, watcher);
    let result;
    try {
      result = await collectCtbcPayloads(
        (resource, rqData) => session.call(resource, rqData),
        {
          log: (line) => console.log(line),
          observedDepositQuery: () => watcher.observedDepositQuery,
        },
      );
    } finally {
      try {
        const response = await session.call(RESOURCES.logout, {});
        console.log(
          formatResourceLog(RESOURCES.logout, responseCode(response)),
        );
      } catch {
        console.log(formatResourceLog(RESOURCES.logout, "failed"));
      }
    }

    const summary = summarizePayloads(result);
    console.log(
      `查詢完成：存款帳戶=${summary.depositAccounts} 存款交易=${summary.depositTransactions} 已出帳明細=${summary.statementItems} 未出帳=${summary.unbilledItems} 即時消費=${summary.realtimeItems}`,
    );
    if (result.statementMonthsUnavailable?.length) {
      console.log(
        `帳單明細未取得的月份：${result.statementMonthsUnavailable.map((month) => formatStatementMonth(month)).join("、")}（僅匯入帳單總額）。`,
      );
    }
    if (result.depositTransactionsUnavailable) {
      console.log(
        "depositTransactionsUnavailable：存款交易明細未取得，仍匯入餘額與信用卡資料。",
      );
    }
    if (options.dryRun) {
      console.log("--dry-run：未送到 Worker。");
      return 0;
    }

    const formatted = formatImportResult(await postImport(options, result));
    for (const line of formatted.lines) {
      (formatted.ok ? console.log : console.error)(line);
    }
    return formatted.ok ? 0 : 1;
  } catch (error) {
    console.error(safeErrorText(error));
    return 1;
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    await cleanup();
  }
}

function safeErrorText(error) {
  // 自訂錯誤訊息只含 resource 與 code；其他例外只輸出類型，避免帶出資料。
  if (error instanceof CtbcWebImportError) return redactMessage(error.message);
  return `未預期的錯誤（${error instanceof Error ? error.name : typeof error}）。`;
}

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function responseData(response) {
  return recordValue(isRecord(response) ? response.rsData : undefined);
}

function numberValue(value) {
  if (typeof value === "number")
    return Number.isFinite(value) ? value : undefined;
  const text = stringValue(value).trim();
  if (!text) return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function recordValue(value) {
  return isRecord(value) ? value : {};
}

function stringValue(value) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  process.exitCode = await run(process.argv.slice(2));
}
