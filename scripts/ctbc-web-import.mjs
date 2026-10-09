// 中國信託網銀半自動匯入工具。
//
// 使用者自行在一般 Chrome 視窗登入中信網銀；本工具只透過 Chrome DevTools Protocol
// 讀取該已登入頁面送出的第一個網銀 API 請求作為模板，並在同一頁面內以 XHR 唯讀查詢
// 資料，再送到 Worker `POST /api/connectors/ctbc/import`。
//
// 刻意不做：自動填寫帳密、偽裝瀏覽器、隱藏 webdriver、改 UA 或任何繞過防機器人的手段。
// `--profile` 指定固定的 Chrome profile 時，使用者可在其中安裝密碼管理器自行填入帳密；
// 本工具本身仍不讀取或填寫任何登入欄位。
// Console 只輸出 resource 名稱、回應代碼、筆數與匯入結果；不輸出也不寫檔帳號、金額、
// 姓名、token 或 seed。

import { spawn } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readlink,
  rm,
} from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_WORKER_URL = "http://localhost:8797";
export const DEFAULT_DEBUG_PORT = 9333;
export const DEFAULT_LOGIN_URL = "https://www.ctbcbank.com/twrbc/";
export const DEFAULT_LOGIN_TIMEOUT_MINUTES = 10;
/**
 * 登入後預設不等使用者點明細頁，頁面靜止就開始查詢。實測（2026-10）等待期間網銀閒置太久
 * 會被自動登出，之後查詢一律 9992、整次匯入失敗；信用卡最新一期、未出帳與即時消費工具
 * 自己就查得到。補舊帳單月份或存款明細時才用 `--deposit-wait` 指定等待秒數。
 */
export const DEFAULT_DEPOSIT_WAIT_SECONDS = 0;
/** 網銀回這些代碼表示登入已失效（閒置被登出，或同時操作網銀造成 token 失效）。 */
const SESSION_LOST_CODES = new Set(["9992", "9994"]);

const MAX_DEPOSIT_WAIT_SECONDS = 600;

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

/**
 * 錯誤訊息用的查詢名稱。資源路徑（如 `/twrbc-deposit/qu001/010`）會被遮蔽規則當成
 * token 擋掉，使用者只看到「[redacted]」。
 */
const RESOURCE_LABELS = {
  [RESOURCES.depositOverview]: "存款總覽",
  [RESOURCES.depositInit]: "存款帳戶",
  [RESOURCES.depositTransactions]: "存款明細",
  [RESOURCES.creditCardBills]: "信用卡帳單",
  [RESOURCES.creditCardMonthBills]: "信用卡帳單月份明細",
  [RESOURCES.creditCardMonthBillsPage]: "信用卡帳單明細分頁",
  [RESOURCES.unbilledInit]: "未出帳消費",
  [RESOURCES.unbilled]: "未出帳消費明細",
  [RESOURCES.unbilledPage]: "未出帳消費分頁",
  [RESOURCES.realtime]: "即時消費",
  [RESOURCES.realtimePage]: "即時消費分頁",
  [RESOURCES.logout]: "登出",
};

function resourceLabel(resource) {
  return RESOURCE_LABELS[resource] ?? "網銀查詢";
}
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
    profileDir: undefined,
    depositWaitSeconds: DEFAULT_DEPOSIT_WAIT_SECONDS,
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
      case "--profile":
        options.profileDir = read();
        break;
      case "--deposit-wait": {
        const value = read();
        options.depositWaitSeconds = /^\d{1,3}$/.test(value)
          ? Number(value)
          : Number.NaN;
        break;
      }
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
  if (
    !Number.isInteger(options.depositWaitSeconds) ||
    options.depositWaitSeconds < 0 ||
    options.depositWaitSeconds > MAX_DEPOSIT_WAIT_SECONDS
  ) {
    throw new CtbcWebImportError(
      `--deposit-wait 必須是 0 到 ${MAX_DEPOSIT_WAIT_SECONDS} 的整數（秒）。`,
    );
  }
  if (options.profileDir !== undefined) {
    if (!path.isAbsolute(options.profileDir)) {
      throw new CtbcWebImportError("--profile 必須是絕對路徑。");
    }
    // 去掉結尾斜線與 ..，避免 lstat 跟著連結走，也讓 Chrome 與 pkill 用同一字串。
    options.profileDir = path.resolve(options.profileDir);
  }
  assertWorkerUrl(options.workerUrl);
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
  --profile <目錄>    使用固定的 Chrome profile（絕對路徑），結束後保留，可在其中安裝
                      密碼管理器；未指定時使用暫存 profile 並於結束時刪除
  --deposit-wait <秒> 補舊帳單月份或存款明細時才用：登入後等使用者在網銀點開明細
                      （信用卡帳單月份或存款交易明細）的秒數，看到明細才開始查詢，
                      逾時照常繼續。網銀閒置約 10 分鐘會自動登出，建議 300 以內
                      （預設 ${DEFAULT_DEPOSIT_WAIT_SECONDS}：登入後頁面靜止就開始查詢）
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

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** 銀行資料只能送到 HTTPS，或本機 loopback 的 HTTP（開發用）。 */
function assertWorkerUrl(value) {
  const url = assertHttpUrl(value, "--worker");
  if (url.protocol === "http:" && !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new CtbcWebImportError(
      "--worker 必須是 https 網址；只有本機（localhost）可以用 http。",
    );
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

const DIAGNOSTIC_SKIPPED_HEADERS =
  /^(cookie|user-agent|accept-language|accept-encoding|origin|referer|host|content-length|connection)$|^sec-/;

/**
 * 頁面自己的存款明細請求與工具模板的差異，只回傳欄位名稱、不含任何值，供 H404 診斷：
 * body 中值不同或只有一方有的欄位（不含每次都會換的欄位）、工具沒帶的標頭、網址參數名稱。
 */
export function describeEnvelopeDiff(template, url, body, headers) {
  const name = (value) => String(value).slice(0, 40);
  const templateBody = isRecord(template?.body) ? template.body : {};
  const pageBody = isRecord(body) ? body : {};
  const bodyKeys = [];
  for (const key of new Set([
    ...Object.keys(pageBody),
    ...Object.keys(templateBody),
  ])) {
    if (PER_REQUEST_BODY_FIELDS.has(key)) continue;
    if (!(key in pageBody)) bodyKeys.push(`${name(key)}(頁面沒有)`);
    else if (!(key in templateBody)) bodyKeys.push(`${name(key)}(工具沒有)`);
    else if (stableJson(pageBody[key]) !== stableJson(templateBody[key])) {
      bodyKeys.push(`${name(key)}(值不同)`);
    }
  }
  const templateHeaders = new Set(
    Object.keys(template?.headers ?? {}).map((header) => header.toLowerCase()),
  );
  const headerNames = Object.keys(isRecord(headers) ? headers : {})
    .map((header) => header.toLowerCase())
    .filter(
      (header) =>
        !templateHeaders.has(header) &&
        !DIAGNOSTIC_SKIPPED_HEADERS.test(header),
    )
    .map(name)
    .sort();
  let queryNames = [];
  try {
    queryNames = [...new Set(new URL(url).searchParams.keys())].map(name);
  } catch {
    // 網址解析失敗時不列參數。
  }
  return {
    bodyKeys: bodyKeys.slice(0, 20),
    headerNames: headerNames.slice(0, 20),
    queryNames: queryNames.slice(0, 20),
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
 * `pageDeposits()` 回傳使用者點進存款明細頁時、頁面自己查詢得到的回應
 * （`{ rqData, response }` 陣列），與工具重送的結果合併。
 */
export async function collectCtbcPayloads(call, options = {}) {
  const log = options.log ?? (() => {});
  const now = options.now ?? new Date();
  const observedDepositQuery = options.observedDepositQuery ?? (() => null);
  const pageDeposits = options.pageDeposits ?? (() => []);
  const pageCardBills = options.pageCardBills ?? (() => []);
  /** 沒有頁面存款明細時也重送（只供測試查詢策略；實測重送一律 H404）。 */
  const alwaysReplayDeposits = options.alwaysReplayDeposits === true;

  const request = async (resource, rqData, countOf) => {
    const response = await call(resource, rqData);
    const count = countOf ? countOf(response) : undefined;
    log(formatResourceLog(resource, responseCode(response), count));
    return response;
  };
  const required = async (resource, rqData, countOf) => {
    const response = await request(resource, rqData, countOf);
    if (!isResourceSuccess(response)) {
      const code = responseCode(response);
      throw new CtbcWebImportError(
        SESSION_LOST_CODES.has(code)
          ? `中信網銀登入已失效（code=${code}），可能是登入後閒置太久被自動登出，或同時在操作網銀；未匯入任何資料。請重新匯入，登入後不要操作視窗。`
          : `中信網銀查詢「${resourceLabel(resource)}」失敗（code=${code}），未匯入任何資料。`,
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
    extractDepositAccounts(depositOverview),
    { now, observedDepositQuery, pageDeposits, alwaysReplayDeposits, log },
  );
  const creditCardOverview = await required(RESOURCES.creditCardBills, {});
  const statements = await collectStatementDetails(
    request,
    creditCardOverview,
    pageCardBills(),
    log,
  );
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
    statementMonthsIncomplete: statements.incompleteMonths,
  };
}

function sameStatementMonth(left, right) {
  return (
    stringValue(left).replace(/\D/g, "") ===
    stringValue(right).replace(/\D/g, "")
  );
}

/**
 * 頁面自己查到的帳單月份明細：使用者在網銀帳單頁切到該月份時，頁面送出
 * `qu002/011 {curCode, month}`（分頁 `qu002/016 {…, pageNum}`）。
 * - `first`：該月最後一次成功且含 `bills` 的第 1 頁（月份沿用頁面送出的格式，供補查分頁）。
 * - `pages`：第 2 頁以後依 pageNum 收下，同頁以最後一次為準。已出帳帳單內容不會變，
 *   跨次瀏覽的分頁可以合併。
 * 請求沒帶 curCode 時，只在 `allowMissingCurrency`（該月只有一個幣別）時採用，避免同一批
 * 明細寫進多個幣別。
 */
export function pageStatementGroup(
  captures,
  currency,
  month,
  { allowMissingCurrency = false } = {},
) {
  const matches = (capture, resource) =>
    capture.resource === resource &&
    isResourceSuccess(capture.response) &&
    sameStatementMonth(capture.rqData?.month, month) &&
    (capture.rqData?.curCode == null
      ? allowMissingCurrency
      : stringValue(capture.rqData.curCode) === currency);
  const firstCapture = captures
    .filter(
      (capture) =>
        matches(capture, RESOURCES.creditCardMonthBills) &&
        Array.isArray(responseData(capture.response).bills),
    )
    .at(-1);
  const pages = new Map();
  for (const capture of captures) {
    if (!matches(capture, RESOURCES.creditCardMonthBillsPage)) continue;
    const pageNum = numberValue(capture.rqData.pageNum);
    const bills = responseData(capture.response).bills;
    if (pageNum != null && pageNum >= 2 && Array.isArray(bills))
      pages.set(pageNum, bills);
  }
  if (!firstCapture && pages.size === 0) return null;
  return {
    first: firstCapture
      ? {
          ...responseData(firstCapture.response),
          month: stringValue(firstCapture.rqData.month) || month,
        }
      : null,
    pages,
  };
}

/**
 * 逐月補抓已出帳帳單明細並併回 `qu002/010` 回應的 billData。優先採用使用者在網銀
 * 帳單頁看過的月份與分頁（{@link pageStatementGroup}，工具重送常被拒絕；最新一期首頁
 * 已附第 1 頁時也採用頁面的分頁），其餘才由工具查詢。查詢失敗不中止匯入：沒有明細的
 * 月份只保留帳單總額並回報；分頁沒收齊的月份照樣匯入已取得的明細，另外回報。
 */
async function collectStatementDetails(
  request,
  creditCardOverview,
  pageCardBills = [],
  log = () => {},
) {
  const creditCards = structuredClone(creditCardOverview);
  const billData = recordValue(responseData(creditCards).billData);
  const unavailableMonths = [];
  const incompleteMonths = [];
  const billCount = (response) =>
    arrayValue(responseData(response).bills).length;
  const currenciesOf = (month) =>
    Object.values(billData).filter(
      (value) => isRecord(value) && isRecord(value[month]),
    ).length;
  for (const { currency, month, hasBills } of statementMonthsToFetch(
    creditCardOverview,
  )) {
    const target = billData[currency][month];
    const page = pageStatementGroup(pageCardBills, currency, month, {
      allowMissingCurrency: currenciesOf(month) === 1,
    });
    let group = hasBills ? target : null;
    const capturedPages = page?.pages ?? new Map();
    if (!group && page?.first) {
      group = page.first;
      log(
        `信用卡帳單 ${formatStatementMonth(month)}：使用頁面查詢結果 ${arrayValue(group.bills).length} 筆`,
      );
    }
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
      // 工具補查失敗一次後不再對後面的頁送請求，但頁面已收下的頁照樣加入。
      let replayFailed = false;
      for (let pageNum = 2; pageNum <= totalPages; pageNum += 1) {
        const captured = capturedPages.get(pageNum);
        if (captured) {
          bills.push(...captured);
          continue;
        }
        if (replayFailed) continue;
        const replay = await request(
          RESOURCES.creditCardMonthBillsPage,
          { curCode: currency, month: group.month ?? month, pageNum },
          billCount,
        );
        if (!isResourceSuccess(replay)) {
          replayFailed = true;
          continue;
        }
        bills.push(...arrayValue(responseData(replay).bills));
      }
      if (needsMorePages(group, bills.length)) incompleteMonths.push(month);
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
  // 頁面查到帳單、卻對不上 billData 任何月份或幣別時列出（只有月份與幣別），供真實帳號
  // 驗收時排查格式差異；看的是不需要補的月份不算。
  const unmatched = pageCardBills.filter(
    (capture) =>
      capture.resource === RESOURCES.creditCardMonthBills &&
      isResourceSuccess(capture.response) &&
      Array.isArray(responseData(capture.response).bills) &&
      !Object.entries(billData).some(
        ([currency, months]) =>
          isRecord(months) &&
          (capture.rqData?.curCode == null ||
            stringValue(capture.rqData.curCode) === currency) &&
          Object.keys(months).some((month) =>
            sameStatementMonth(capture.rqData?.month, month),
          ),
      ),
  );
  if (unmatched.length > 0) {
    const seen = [
      ...new Set(
        unmatched.map(
          (capture) =>
            `${formatStatementMonth(stringValue(capture.rqData?.month))}/${/^[A-Z]{3}$/.test(stringValue(capture.rqData?.curCode)) ? capture.rqData.curCode : "?"}`,
        ),
      ),
    ];
    log(`頁面帳單查詢對不上帳單月份或幣別：${seen.join("、")}`);
  }
  return { creditCards, unavailableMonths, incompleteMonths };
}

function pick(value, keys) {
  return Object.fromEntries(
    keys.filter((key) => key in value).map((key) => [key, value[key]]),
  );
}

async function collectDepositTransactions(
  request,
  accounts,
  { now, observedDepositQuery, pageDeposits, alwaysReplayDeposits, log },
) {
  const transactions = [];
  let workingStrategy = null;
  let usedPageResults = false;
  let missingWithBalance = 0;
  let missing = 0;
  let missingZeroBalance = 0;
  // 使用者有在明細頁查看時，其他帳戶也不重送：工具重送一律 H404（差在頁面網址的防護參數，
  // 工具不重現），只會對網銀多送注定失敗的請求。
  const pageSeen =
    pageDepositDetailLists(
      pageDeposits(),
      accounts.map((account) => account.accountId),
      { anyAccount: true },
    ).length > 0;
  // 使用者這次沒在網銀點開存款明細：不重送注定 H404 的查詢（每個帳戶十幾個請求，排在
  // 信用卡查詢之前，徒增時間與風控風險），只更新餘額，也不帶「部分資料未取得」警告。
  if (!pageSeen && observedDepositQuery() == null && !alwaysReplayDeposits) {
    if (accounts.length > 0)
      log("存款明細：這次沒有在網銀點開存款明細，只更新存款餘額。");
    return { transactions: [], unavailable: false, strategy: null };
  }

  for (const { accountId, balance } of accounts) {
    const firstInit = await request(RESOURCES.depositInit, { accountId });
    const initOk = isResourceSuccess(firstInit);
    const queryAccountId = initOk
      ? selectTransactionAccountId(firstInit, accountId)
      : accountId;
    let items = null;

    const pageLists = pageDepositDetailLists(pageDeposits(), [
      accountId,
      queryAccountId,
    ]);
    if (pageLists.length > 0) {
      items = mergeDepositDetailLists(pageLists);
      usedPageResults = true;
      log(`存款明細：使用頁面查詢結果 ${items.length} 筆`);
    }

    const strategies =
      items === null && initOk && !pageSeen
        ? orderStrategies(
            depositQueryStrategies(queryAccountId, {
              dateRanges: arrayValue(responseData(firstInit).dateRanges),
              observedQuery: observedDepositQuery(),
              now,
            }),
            workingStrategy,
          )
        : [];
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
        const pageItems = await queryDepositPages(request, rqData);
        if (pageItems === null) continue;
        strategySucceeded = true;
        strategyItems.push(...pageItems);
      }
      if (!strategySucceeded) continue;
      workingStrategy = strategy.name;
      items = strategyItems;
      break;
    }

    if (items === null) {
      missing += 1;
      // 餘額為 0 的帳戶不算遺漏，避免閒置帳戶讓每次匯入都帶警告。
      if (balance === 0) missingZeroBalance += 1;
      else missingWithBalance += 1;
      continue;
    }
    for (const item of items) {
      transactions.push({ ...item, sourceAccountId: accountId });
    }
  }
  if (missingWithBalance > 0 && missing < accounts.length) {
    log(
      `存款明細：${missingWithBalance} 個有餘額（或餘額不明）的帳戶未取得（未在明細頁查看）`,
    );
  }
  if (missingZeroBalance > 0 && missing < accounts.length) {
    log(
      `存款明細：${missingZeroBalance} 個餘額為 0 的帳戶未取得明細（不列為警告）`,
    );
  }

  return {
    transactions,
    // 全部帳戶都沒取得，或有餘額的帳戶沒取得時，匯入結果帶「部分資料未取得」警告。
    unavailable:
      accounts.length > 0 &&
      (missing === accounts.length || missingWithBalance > 0),
    strategy: workingStrategy ?? (usedPageResults ? "page" : null),
  };
}

/**
 * 頁面自己的存款明細查詢回應中，屬於指定帳戶（總覽帳號或明細頁帳號）的明細；
 * 只採用 code 0000 的回應，每個回應（含分頁）各自為一份清單。
 */
export function pageDepositDetailLists(
  captures,
  accountIds,
  { anyAccount = false } = {},
) {
  const wanted = new Set(
    accountIds.map((value) => stringValue(value).trim()).filter(Boolean),
  );
  return arrayValue(captures).flatMap((capture) => {
    if (!isRecord(capture) || !isRecord(capture.rqData)) return [];
    if (
      !anyAccount &&
      !wanted.has(stringValue(capture.rqData.accountId).trim())
    ) {
      return [];
    }
    if (stringValue(capture.response?.code) !== "0000") return [];
    return [
      arrayValue(responseData(capture.response).detailList).filter(isRecord),
    ];
  });
}

/**
 * 合併同一帳戶多份明細清單。同一筆紀錄出現在不同清單只算一次；同一份清單內
 * 完全相同的多筆（例如同日同額）保留，取各清單中出現次數的最大值。
 */
export function mergeDepositDetailLists(lists) {
  const kept = new Map();
  const merged = [];
  for (const list of lists) {
    const seen = new Map();
    for (const item of list) {
      const key = stableJson(item);
      const count = (seen.get(key) ?? 0) + 1;
      seen.set(key, count);
      if (count > (kept.get(key) ?? 0)) {
        kept.set(key, count);
        merged.push(item);
      }
    }
  }
  return merged;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
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

/** 存款總覽的帳戶與餘額；餘額去掉千分位、貨幣符號與空白後仍無法解析時為 null。 */
export function extractDepositAccounts(payload) {
  const twd = recordValue(responseData(payload).twdAcctSummaryResponse);
  const demand = recordValue(twd.demDepBalSummaryResponse);
  return arrayValue(demand.infoList).flatMap((value) => {
    if (!isRecord(value)) return [];
    const accountId = stringValue(value.accountId).trim();
    if (!accountId) return [];
    const text =
      typeof value.balance === "number"
        ? String(value.balance)
        : stringValue(value.balance).replace(/NT\$|[$,\s]/gi, "");
    const balance = text ? Number(text) : Number.NaN;
    return [{ accountId, balance: Number.isFinite(balance) ? balance : null }];
  });
}

export function extractDepositAccountIds(payload) {
  return extractDepositAccounts(payload).map((account) => account.accountId);
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

/**
 * 追蹤網銀請求與回應的 x-auth-token。事件一到就配發遞增序號，只有序號較新的 token
 * 能覆蓋目前值，避免分類較慢的舊請求蓋掉較新的回應 token。請求以
 * 「CDP session + requestId」識別；分類前先到的回應 token 暫存，分類後套用或丟棄。
 */
export class AuthTokenTracker {
  #seq = 0;
  #current = null;
  #currentSeq = -1;
  /** key → null（已送出、尚未分類）或 page／own／ignored。 */
  #kinds = new Map();
  #pending = new Map();
  #finishedBeforeClassify = new Set();

  get current() {
    return this.#current;
  }

  /** 事件抵達時同步呼叫，取得排序用序號。 */
  nextSeq() {
    this.#seq += 1;
    return this.#seq;
  }

  /** 記錄一個 token；未指定序號時視為目前最新。 */
  note(token, seq = this.nextSeq()) {
    if (!token || seq <= this.#currentSeq) return;
    this.#current = token;
    this.#currentSeq = seq;
  }

  /** 網銀請求事件抵達時同步登記，之後的回應與結束事件才會被追蹤。 */
  begin(key) {
    this.#kinds.set(key, null);
  }

  /** kind：page（頁面自己的網銀請求）、own（工具發出）、ignored（登入或無關請求）。 */
  classify(key, kind, requestToken, requestSeq) {
    this.#kinds.set(key, kind);
    if (kind === "page") this.note(requestToken, requestSeq);
    const pending = this.#pending.get(key);
    this.#pending.delete(key);
    if (pending && kind !== "ignored") this.note(pending.token, pending.seq);
    if (this.#finishedBeforeClassify.delete(key)) this.#kinds.delete(key);
  }

  response(key, token, seq) {
    if (!token || !this.#kinds.has(key)) return;
    const kind = this.#kinds.get(key);
    if (kind === null) {
      this.#pending.set(key, { token, seq });
    } else if (kind !== "ignored") {
      this.note(token, seq);
    }
  }

  /** 請求結束（完成或失敗）時清除關聯資料；尚未分類時保留暫存的回應 token 到分類完成。 */
  finished(key) {
    if (!this.#kinds.has(key)) return;
    if (this.#kinds.get(key) === null) {
      this.#finishedBeforeClassify.add(key);
      return;
    }
    this.#kinds.delete(key);
    this.#pending.delete(key);
  }
}

/**
 * 監看所有分頁的網銀 API 請求，取得登入後模板、記住頁面自己的存款明細查詢參數，
 * 並取回頁面自己的存款明細回應。
 */
export class RequestTemplateWatcher {
  #cdp;
  #attached = new Set();
  #ownTrackingIds = new Set();
  #waiters = [];
  /** 尚在解析 body 的網銀請求；期間完成載入的記在 #finishedWhileClassifying。 */
  #classifying = new Set();
  #finishedWhileClassifying = new Set();
  /**
   * 已確認是頁面明細查詢（存款明細、信用卡帳單月份與分頁）、等待載入完成的請求：
   * key → `{ resource, rqData }`。
   */
  #pendingCaptures = new Map();
  template = null;
  templateSessionId = null;
  observedDepositQuery = null;
  /** 頁面自己的存款明細查詢與回應：`{ rqData, response }`。 */
  pageDeposits = [];
  /**
   * 頁面自己的信用卡帳單月份明細（`qu002/011`）與分頁（`qu002/016`）查詢與回應：
   * `{ resource, rqData, response }`。工具重送這兩個查詢會被中信拒絕（9999），
   * 使用者在網銀帳單頁切換月份時，直接收下頁面得到的結果。
   */
  pageCardBills = [];
  /** 使用者在網銀帳單頁看過的月份（`{curCode, month}` 的 month，原樣保留）。 */
  observedCardBillMonths = new Set();
  /** 頁面存款明細請求與工具模板的差異（只有欄位名稱，供診斷 H404）。 */
  depositEnvelopeDiff = null;
  /** 頁面自己送出的網銀 resource（只有路徑，依首次出現順序，最多 40 個）。 */
  pageResources = [];
  /** 頁面尚未完成的網銀請求與最後一次活動時間；工具開始查詢前要等頁面靜止。 */
  #pageInFlight = new Set();
  #lastPageActivity = 0;
  /** 進行中的頁面存款回應擷取數；擷取完成前不算頁面靜止。 */
  #capturing = 0;
  /** 頁面與工具最新的 x-auth-token；使用者操作頁面時 token 可能更新。 */
  tokens = new AuthTokenTracker();

  constructor(cdp) {
    this.#cdp = cdp;
  }

  async start() {
    this.#cdp.on("Target.targetCreated", ({ targetInfo }) =>
      this.#attach(targetInfo),
    );
    // 分頁關閉時進行中的請求可能收不到結束事件；清掉該 session 的追蹤，免得一直等頁面靜止。
    this.#cdp.on("Target.detachedFromTarget", ({ sessionId }) => {
      const prefix = `${sessionId ?? ""}:`;
      for (const key of [...this.#pageInFlight]) {
        if (key.startsWith(prefix)) this.#pageInFlight.delete(key);
      }
      for (const key of [...this.#pendingCaptures.keys()]) {
        if (key.startsWith(prefix)) this.#pendingCaptures.delete(key);
      }
    });
    this.#cdp.on("Network.requestWillBeSent", (params, sessionId) =>
      this.#onRequest(params, sessionId, this.tokens.nextSeq()),
    );
    this.#cdp.on("Network.responseReceived", (params, sessionId) =>
      this.#onResponse(params, sessionId, this.tokens.nextSeq()),
    );
    for (const event of ["Network.loadingFinished", "Network.loadingFailed"]) {
      this.#cdp.on(event, (params, sessionId) => {
        const key = requestKey(sessionId, params.requestId);
        this.tokens.finished(key);
        this.#onLoadingDone(key, params.requestId, sessionId, event);
      });
    }
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

  /** 使用者已在頁面看過存款交易明細或信用卡帳單月份明細。 */
  get observedDetailPage() {
    return (
      Boolean(this.observedDepositQuery) || this.observedCardBillMonths.size > 0
    );
  }

  /**
   * 等使用者在網銀點開明細（信用卡帳單月份或存款交易明細）；看到頁面的查詢即回傳
   * true，逾時或中斷回傳 false。
   */
  async waitForDetailPage(timeoutMs, shouldStop = () => false) {
    const deadline = Date.now() + timeoutMs;
    while (!this.observedDetailPage && !shouldStop()) {
      if (Date.now() >= deadline) return false;
      await sleep(250);
    }
    return this.observedDetailPage;
  }

  #onResponse(params, sessionId, seq) {
    if (!isEbmwResourceUrl(params.response?.url ?? "")) return;
    this.tokens.response(
      requestKey(sessionId, params.requestId),
      headerValue(params.response?.headers, "x-auth-token"),
      seq,
    );
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

  /** 頁面明細查詢載入完成後取回回應；載入失敗則放棄。 */
  #onLoadingDone(key, requestId, sessionId, event) {
    if (this.#pageInFlight.delete(key)) this.#lastPageActivity = Date.now();
    const pending = this.#pendingCaptures.get(key);
    if (pending !== undefined) {
      this.#pendingCaptures.delete(key);
      if (event === "Network.loadingFinished") {
        void this.#capturePage(requestId, sessionId, pending);
      }
    } else if (
      event === "Network.loadingFinished" &&
      this.#classifying.has(key)
    ) {
      this.#finishedWhileClassifying.add(key);
    }
  }

  async #capturePage(requestId, sessionId, { resource, rqData }) {
    this.#capturing += 1;
    try {
      const { body = "", base64Encoded } = await this.#cdp.send(
        "Network.getResponseBody",
        { requestId },
        sessionId,
      );
      const response = JSON.parse(
        base64Encoded ? Buffer.from(body, "base64").toString("utf8") : body,
      );
      if (!isRecord(response)) return;
      if (resource === RESOURCES.depositTransactions)
        this.pageDeposits.push({ rqData, response });
      else this.pageCardBills.push({ resource, rqData, response });
    } catch {
      // 取不到頁面的回應時，這次就沒有該查詢的頁面結果。
    } finally {
      this.#capturing -= 1;
      this.#lastPageActivity = Date.now();
    }
  }

  /**
   * 等頁面靜止：沒有進行中的頁面請求，且最後一次活動已過 `quietMs`。最多等 `maxMs`，
   * 避免使用者還在操作時工具就送出查詢、兩邊搶用會輪替的 x-auth-token。
   */
  async waitForQuiet(quietMs, maxMs, shouldStop = () => false) {
    const deadline = Date.now() + maxMs;
    while (!shouldStop() && Date.now() < deadline) {
      if (
        this.#pageInFlight.size === 0 &&
        this.#classifying.size === 0 &&
        this.#capturing === 0 &&
        Date.now() - this.#lastPageActivity >= quietMs
      ) {
        return true;
      }
      await sleep(250);
    }
    return false;
  }

  /**
   * 等頁面自己的存款明細回應擷取完成；有可採用（0000）的回應時回傳 true，
   * 逾時或中斷回傳 false。
   */
  async waitForPageDeposit(timeoutMs, shouldStop = () => false) {
    const deadline = Date.now() + timeoutMs;
    const usable = () =>
      this.pageDeposits.some(
        (capture) => stringValue(capture.response?.code) === "0000",
      );
    while (!shouldStop() && Date.now() < deadline) {
      if (this.#capturing === 0 && usable()) return true;
      await sleep(250);
    }
    return this.#capturing === 0 && usable();
  }

  async #onRequest(params, sessionId, seq) {
    const request = params.request;
    if (!request || !isEbmwResourceUrl(request.url)) return;
    const key = requestKey(sessionId, params.requestId);
    this.tokens.begin(key);
    this.#classifying.add(key);
    // 工具自己的請求在分類後移除；其餘（頁面、登入）都算頁面活動。
    this.#pageInFlight.add(key);
    this.#lastPageActivity = Date.now();
    try {
      await this.#classifyRequest(params, sessionId, seq, key);
    } finally {
      this.#classifying.delete(key);
      this.#finishedWhileClassifying.delete(key);
    }
  }

  /** 頁面明細查詢：已載入完成就立即擷取，否則等載入完成。 */
  #scheduleCapture(key, requestId, sessionId, pending) {
    if (this.#finishedWhileClassifying.has(key)) {
      void this.#capturePage(requestId, sessionId, pending);
    } else if (this.#pageInFlight.has(key)) {
      this.#pendingCaptures.set(key, pending);
    }
    // 其餘情況是分類期間就載入失敗或分頁已 detach，不擷取。
  }

  async #classifyRequest(params, sessionId, seq, key) {
    const request = params.request;
    const ignore = () => this.tokens.classify(key, "ignored");
    if (request.method !== "POST") return ignore();
    let postData = request.postData;
    if (postData === undefined && request.hasPostData) {
      try {
        ({ postData } = await this.#cdp.send(
          "Network.getRequestPostData",
          { requestId: params.requestId },
          sessionId,
        ));
      } catch {
        return ignore();
      }
    }
    if (typeof postData !== "string") return ignore();
    let body;
    try {
      body = JSON.parse(postData);
    } catch {
      return ignore();
    }
    if (!isRecord(body) || typeof body.resource !== "string") return ignore();
    if (LOGIN_RESOURCE_PATTERN.test(body.resource)) return ignore();
    if (this.#ownTrackingIds.has(body.trackingIxd)) {
      this.#pageInFlight.delete(key);
      this.tokens.classify(key, "own");
      return;
    }
    this.tokens.classify(
      key,
      "page",
      headerValue(request.headers, "x-auth-token"),
      seq,
    );
    const resourceName = /^\/[a-z0-9-]+\/[a-z0-9]+\/\d+$/i.test(body.resource)
      ? body.resource
      : "[其他]";
    if (
      this.pageResources.length < 40 &&
      !this.pageResources.includes(resourceName)
    ) {
      this.pageResources.push(resourceName);
    }

    if (
      body.resource === RESOURCES.depositTransactions &&
      isRecord(body.rqData)
    ) {
      const { nextKey: _nextKey, ...query } = body.rqData;
      this.observedDepositQuery = query;
      if (this.template) {
        this.depositEnvelopeDiff ??= describeEnvelopeDiff(
          this.template,
          request.url,
          body,
          request.headers,
        );
      }
      this.#scheduleCapture(key, params.requestId, sessionId, {
        resource: body.resource,
        rqData: body.rqData,
      });
    }
    if (
      (body.resource === RESOURCES.creditCardMonthBills ||
        body.resource === RESOURCES.creditCardMonthBillsPage) &&
      isRecord(body.rqData)
    ) {
      const month = stringValue(body.rqData.month);
      if (month) this.observedCardBillMonths.add(month);
      this.#scheduleCapture(key, params.requestId, sessionId, {
        resource: body.resource,
        rqData: body.rqData,
      });
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
  #queue = Promise.resolve();
  #aborted = false;
  #logout;

  constructor(cdp, watcher) {
    this.#cdp = cdp;
    this.#watcher = watcher;
    this.#sessionId = watcher.templateSessionId;
    this.#template = {
      ...watcher.template,
      headers: { ...watcher.template.headers },
    };
  }

  /** 依序送出請求；中斷或登出後不再送新的查詢。 */
  call(resource, rqData) {
    const run = this.#queue.then(() => {
      if (this.#aborted) throw new CtbcWebImportError("已中斷，停止查詢。");
      return this.#send(resource, rqData);
    });
    this.#queue = run.catch(() => {});
    return run;
  }

  /** 排在進行中的請求之後登出；重複呼叫共用同一次登出。 */
  logout() {
    if (!this.#logout) {
      this.#logout = this.#queue.then(() => this.#send(RESOURCES.logout, {}));
      this.#aborted = true;
      this.#queue = this.#logout.catch(() => {});
    }
    return this.#logout;
  }

  async #send(resource, rqData) {
    // 每次送出前改用最新 token；使用者或頁面自己的請求都可能讓 token 更新。
    const latest = this.#watcher.tokens.current;
    if (latest) this.#template.headers["x-auth-token"] = latest;
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
      throw new CtbcWebImportError(
        `「${resourceLabel(resource)}」頁面內請求失敗。`,
      );
    }
    const result = evaluated.result?.value;
    if (!isRecord(result) || result.status !== 200) {
      throw new CtbcWebImportError(
        `「${resourceLabel(resource)}」請求失敗（HTTP ${isRecord(result) ? Number(result.status) || 0 : 0}）。`,
      );
    }
    // 回應 token 已由 Network.responseReceived 依抵達順序記錄；這裡只在沒有追蹤到任何
    // token 時備援，避免較晚回到的 evaluate 結果蓋掉頁面較新的 token。
    if (
      typeof result.authToken === "string" &&
      result.authToken &&
      !this.#watcher.tokens.current
    ) {
      this.#template.headers["x-auth-token"] = result.authToken;
    }
    try {
      const parsed = JSON.parse(String(result.text));
      if (isRecord(parsed)) return parsed;
    } catch {
      // Fall through.
    }
    throw new CtbcWebImportError(
      `「${resourceLabel(resource)}」回應不是預期格式（可能已登出或被安全機制阻擋），未匯入任何資料。`,
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

/** pkill -f 用的樣式：跳脫 regex 字元並限制參數邊界，避免誤殺路徑相近的其他 Chrome。 */
export function userDataDirPattern(profileDir) {
  const escaped = profileDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `(^| )--user-data-dir=${escaped}( |$)`;
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function acquireToolLock(lockPath) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      await handle.writeFile(String(process.pid));
      await handle.close();
      return async () => {
        await rm(lockPath, { force: true });
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const text = await readFile(lockPath, "utf8").catch(() => "");
      const owner = Number(text);
      // 內容為空或無法解析時可能是另一次匯入剛建立、尚未寫入 PID，視為使用中。
      if (!/^\d+$/.test(text) || processAlive(owner)) {
        throw new CtbcWebImportError(
          `這個 profile 正在被另一次匯入使用；確定沒有時請刪除 ${lockPath}。`,
        );
      }
      await rm(lockPath, { force: true });
    }
  }
  throw new CtbcWebImportError("無法取得 profile 鎖定。");
}

/** Chrome 的 SingletonLock 內容是「主機名稱-PID」；同主機且程序已不存在時視為殘留。 */
async function chromeUsingProfile(profileDir) {
  const lockPath = path.join(profileDir, "SingletonLock");
  let target;
  try {
    target = await readlink(lockPath);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    return true;
  }
  const separator = target.lastIndexOf("-");
  const host = target.slice(0, separator);
  const pid = Number(target.slice(separator + 1));
  if (
    separator > 0 &&
    host === hostname() &&
    Number.isInteger(pid) &&
    pid > 0 &&
    !processAlive(pid)
  ) {
    await rm(lockPath, { force: true });
    return false;
  }
  return true;
}

/**
 * 建立或檢查固定 profile：必須是目前使用者擁有、其他人無權限的實體目錄，
 * 取得本工具的鎖定，且沒有 Chrome 正在使用（避免新視窗被轉交給既有 Chrome，
 * 結束時又誤關它）。回傳釋放鎖定的函式。
 */
export async function prepareFixedProfile(profileDir) {
  try {
    await mkdir(profileDir, { recursive: true, mode: 0o700 });
  } catch (error) {
    throw new CtbcWebImportError(
      `無法建立 Chrome profile 目錄（${error?.code ?? "unknown"}）。`,
    );
  }
  const stats = await lstat(profileDir);
  if (!stats.isDirectory()) {
    throw new CtbcWebImportError(
      "--profile 必須是實體目錄，不能是連結或檔案。",
    );
  }
  if (typeof process.getuid === "function" && stats.uid !== process.getuid()) {
    throw new CtbcWebImportError("--profile 目錄必須屬於目前使用者。");
  }
  if ((stats.mode & 0o077) !== 0) {
    throw new CtbcWebImportError(
      "--profile 目錄不可讓其他使用者存取，請先執行 chmod 700。",
    );
  }
  const release = await acquireToolLock(
    path.join(profileDir, "ctbc-web-import.lock"),
  );
  try {
    if (await chromeUsingProfile(profileDir)) {
      throw new CtbcWebImportError(
        `這個 profile 已有 Chrome 開著，請先關閉該視窗再執行；確定沒有時請刪除 ${path.join(profileDir, "SingletonLock")}。`,
      );
    }
  } catch (error) {
    await release();
    throw error;
  }
  return release;
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

async function closeChrome(browser, profileDir, keepProfile) {
  if (browser) {
    try {
      await browser.send("Browser.close", {}, undefined, 5_000);
    } catch {
      // 連線可能已中斷；下方以 profile 路徑結束程序。
    }
    browser.close();
  }
  await new Promise((resolve) => {
    const child = spawn("pkill", ["-f", "--", userDataDirPattern(profileDir)], {
      stdio: "ignore",
    });
    child.once("error", resolve);
    child.once("exit", resolve);
  });
  if (keepProfile) return true;
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
  const keepProfile = options.profileDir !== undefined;
  let profileDir;
  let releaseProfile = async () => {};
  try {
    if (keepProfile) {
      profileDir = options.profileDir;
      releaseProfile = await prepareFixedProfile(profileDir);
    } else {
      profileDir = await mkdtemp(path.join(tmpdir(), "ctbc-web-import-"));
    }
  } catch (error) {
    console.error(safeErrorText(error));
    return 1;
  }
  let browser = null;
  let session = null;
  let cleanupPromise = null;
  // 所有呼叫者等同一次清理，避免中斷處理在 Chrome 關閉、鎖釋放前就結束程序。
  const cleanup = () =>
    (cleanupPromise ??= (async () => {
      const removed = await closeChrome(browser, profileDir, keepProfile);
      if (!removed) console.error("無法刪除暫存 Chrome profile，請手動刪除。");
      await releaseProfile().catch(() => {});
    })());
  let aborting = false;
  let signalLogout = Promise.resolve();
  const onSignal = () => {
    if (aborting) {
      console.error("正在登出並關閉 Chrome，請稍候…");
      return;
    }
    aborting = true;
    console.error("已中斷，正在登出並關閉 Chrome…");
    // 已登入時等進行中的請求結束後登出（最多 5 秒），避免固定 profile 留下網銀 session。
    signalLogout = session
      ? Promise.race([session.logout(), sleep(5_000)]).catch(() => {})
      : Promise.resolve();
    void signalLogout.then(() => cleanup()).finally(() => process.exit(130));
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    await launchChrome(options, profileDir);
    const version = await waitForDebugger(options.port, 30_000);
    browser = await CdpConnection.connect(version.webSocketDebuggerUrl);
    const watcher = new RequestTemplateWatcher(browser);
    await watcher.start();

    console.log("請在剛開啟的 Chrome 視窗自行登入中國信託網銀。");
    await watcher.waitForTemplate(options.loginTimeoutMinutes * 60_000);
    if (aborting) return 130;
    session = new PageApiSession(browser, watcher);
    if (options.depositWaitSeconds === 0 && !watcher.observedDetailPage) {
      console.log(
        "已偵測到登入。頁面靜止 5 秒後自動開始查詢，不用再點任何地方；完成前請勿操作該視窗。",
      );
    }
    if (options.depositWaitSeconds > 0 && !watcher.observedDetailPage) {
      console.log(
        `已偵測到登入。請在網銀點開要匯入的明細：信用卡「帳單」切到要補明細的月份，或存款帳戶的交易明細；看到明細後工具才開始查詢（最多等 ${formatSeconds(options.depositWaitSeconds)}，沒點也會繼續）。`,
      );
      const observed = await watcher.waitForDetailPage(
        options.depositWaitSeconds * 1_000,
        () => aborting,
      );
      if (aborting) return 130;
      console.log(
        observed ? "已看到明細頁。" : "未偵測到明細頁，改用工具自己的查詢。",
      );
      if (!observed) {
        console.log(
          `登入後頁面送出的請求：${watcher.pageResources.join("、") || "無"}`,
        );
      }
    }
    if (watcher.observedDepositQuery) {
      const captured = await watcher.waitForPageDeposit(15_000, () => aborting);
      if (aborting) return 130;
      console.log(
        captured
          ? "已取得存款明細頁的查詢結果。"
          : "未取得可用的存款明細頁查詢結果。",
      );
    }
    if (watcher.depositEnvelopeDiff) {
      const { bodyKeys, headerNames, queryNames } = watcher.depositEnvelopeDiff;
      const list = (values) => (values.length ? values.join("、") : "無");
      console.log(
        `存款明細頁請求與工具的差異：body=${list(bodyKeys)}；標頭=${list(headerNames)}；網址參數=${list(queryNames)}`,
      );
    }
    // 使用者還在操作頁面時不送查詢。看過明細後多等一些，讓使用者切換月份、期間或帳戶
    // 補舊資料，每次切換的頁面結果都會收下。
    const quietMs = watcher.observedDetailPage ? 15_000 : 5_000;
    if (watcher.observedDetailPage) {
      console.log(
        "要補其他月份，可繼續在網銀切換信用卡帳單月份或存款明細期間；停止操作 15 秒後開始查詢。",
      );
    }
    const quiet = await watcher.waitForQuiet(quietMs, 180_000, () => aborting);
    if (aborting) return 130;
    if (!quiet) {
      // 頁面一直有請求時同時查詢會輪替 x-auth-token，實測整批 9994；寧可中止請使用者重來。
      throw new CtbcWebImportError(
        "網銀頁面 3 分鐘內一直有操作，工具無法開始查詢（同時查詢會讓網銀判定登入失效）；未匯入任何資料。請重新匯入，登入後不要操作視窗。",
      );
    }
    console.log("開始唯讀查詢；完成前請勿操作該視窗。");

    let result;
    try {
      result = await collectCtbcPayloads(
        (resource, rqData) => session.call(resource, rqData),
        {
          log: (line) => console.log(line),
          observedDepositQuery: () => watcher.observedDepositQuery,
          pageDeposits: () => watcher.pageDeposits,
          pageCardBills: () => watcher.pageCardBills,
        },
      );
    } finally {
      try {
        const response = await session.logout();
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
        `帳單明細未取得的月份：${result.statementMonthsUnavailable.map((month) => formatStatementMonth(month)).join("、")}（僅匯入帳單總額；到網銀信用卡「帳單」切到這些月份後再匯入一次即可補上）。`,
      );
    }
    if (result.statementMonthsIncomplete?.length) {
      console.log(
        `帳單明細分頁未收齊的月份：${result.statementMonthsIncomplete.map((month) => formatStatementMonth(month)).join("、")}（已匯入取得的部分；在網銀把該月份每一頁都翻過再匯入一次即可補齊）。`,
      );
    }
    if (result.depositTransactionsUnavailable) {
      console.log(
        "depositTransactionsUnavailable：有存款帳戶未取得交易明細，這些帳戶只匯入餘額。",
      );
    }
    if (options.dryRun) {
      console.log("--dry-run：未送到 Worker。");
      return 0;
    }

    if (aborting) return 130;
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
    // 中斷時等登出送完（最多 5 秒）再關閉 Chrome。
    await signalLogout;
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

function formatSeconds(seconds) {
  return seconds % 60 === 0 ? `${seconds / 60} 分鐘` : `${seconds} 秒`;
}

function requestKey(sessionId, requestId) {
  return `${sessionId ?? ""}:${requestId}`;
}

function headerValue(headers, name) {
  if (!isRecord(headers)) return undefined;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name && typeof value === "string" && value) {
      return value;
    }
  }
  return undefined;
}

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
