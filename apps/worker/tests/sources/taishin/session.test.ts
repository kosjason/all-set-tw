import { beforeEach, describe, expect, it, vi } from "vitest";

const puppeteerMock = vi.hoisted(() => ({
  connect: vi.fn(),
  launch: vi.fn(),
  limits: vi.fn(),
  sessions: vi.fn(),
}));

vi.mock("@cloudflare/puppeteer", () => ({ default: puppeteerMock }));

import { BrowserRunCapacityError } from "../../../src/sources/browser";
import {
  createTaishinConnector,
  prepareTaishinCaptcha,
  TaishinCaptchaRejectedError,
  TaishinConnectionError,
  TaishinCredentialRejectedError,
  TaishinSyncStageError,
} from "../../../src/sources/taishin/connector";
import {
  depositRequest,
  emptyRealtime,
  emptyUnbilled,
} from "./fixtures/bank-data";

const credentials = {
  userId: "A123456789",
  account: "test-user",
  password: "test-password",
};

const selectors = {
  userId: 'input[data-taishin-field="user-id"]',
  account: 'input[data-taishin-field="account"]',
  password: 'input[data-taishin-field="password"]',
  captcha: 'input[data-taishin-field="captcha"]',
};

const captchaTarget = {
  selector: 'img[data-taishin-captcha="image"]',
  digitCount: 6,
};

const SECRET_PAGE_TEXT = "raw-secret-login-page";
const SECRET_SESSION_BODY = "raw-secret-session-body";
const SECRET_ERROR_MESSAGE = "raw-secret-error-message";

const RWD_URL = "https://my.taishinbank.com.tw/TIBNetBank/svc/rwd/index.html";
const API_ROOT = "/TIBNetBank/svc";
const paths = {
  sessionCheck: `${API_ROOT}/web/common/sessioncheck`,
  twdAccounts: `${API_ROOT}/web1/rb0100/query`,
  twdTransactions: `${API_ROOT}/web1/rb0102/query`,
  fxAccounts: `${API_ROOT}/web2/rb0800/getRB08000100Data`,
  fxTransactions: `${API_ROOT}/web2/rb0802/getRB08020100ForeignTranDetail`,
  summary: `${API_ROOT}/web4/rb0708rwd/doXTPA`,
  overview: `${API_ROOT}/web4/rb0760/getCardOverviewData`,
  bill: `${API_ROOT}/web4/rb0708rwd/init`,
  realtime: `${API_ROOT}/web4/rb0708rwd/queryRealTime`,
  unbilled: `${API_ROOT}/web4/rb0708rwd/qryUnposted`,
} as const;
const SESSION_DELETE_URL =
  "https://fake.host/v1/devtools/browser/taishin-session";

type ApiInput = { path: string; body?: unknown; timeoutMs: number };
type ApiResponse = {
  ok: boolean;
  status: number;
  contentType: string;
  text: string;
  timedOut?: boolean;
  errorName?: string;
  errorMessage?: string;
};
type ApiReply =
  ApiResponse | ((input: ApiInput) => ApiResponse | Promise<ApiResponse>);
type ApiRouter = (
  input: ApiInput,
) => ApiResponse | undefined | Promise<ApiResponse | undefined>;

function json(payload: unknown): ApiResponse {
  return {
    ok: true,
    status: 200,
    contentType: "application/json",
    text: JSON.stringify(payload),
  };
}

function cardResponse(value: unknown, error: unknown = null) {
  return json({ value, error });
}

function networkFailure(errorMessage: string): ApiResponse {
  return {
    ok: false,
    status: 0,
    contentType: "",
    text: "",
    timedOut: false,
    errorName: "TypeError",
    errorMessage,
  };
}

const activeSession = json({
  RESULT: "SUCCESS",
  DBSESSIONID: "synthetic-db-session",
});
const currentStatementSummary = cardResponse({
  "001": { "OUT-DTE-LST-STMT": "20260720" },
});

// Synthetic customer without deposit products. Since 42ac0da the sync reads
// RB0100/RB0800 deposits before the card queries, and queryRealTime/qryUnposted
// are both required card queries.
function defaultApiResponse(path: string): ApiResponse {
  switch (path) {
    case paths.sessionCheck:
      return activeSession;
    case paths.twdAccounts:
      return json({ RESULT: "NORMAL", OUTPUTDATA: { SavingAccount: [] } });
    case paths.fxAccounts:
      return json({ error: null, data: { FCS_ACCOUNT: [] } });
    case paths.realtime:
      return json(emptyRealtime);
    case paths.unbilled:
      return json(emptyUnbilled);
  }
  if (path.includes("/web4/")) return cardResponse({});
  throw new Error(`測試未定義的台新 API：${path}`);
}

const manualUnknownCases = [
  {
    name: "HTTP 200 JSON without a session id",
    response: () => ({
      ok: true,
      status: 200,
      contentType: "application/json",
      text: JSON.stringify({
        RESULT: "SUCCESS",
        diagnostic: SECRET_SESSION_BODY,
      }),
      timedOut: false,
      errorName: "",
      errorMessage: SECRET_ERROR_MESSAGE,
    }),
    sessionCheck: {
      httpStatus: 200,
      isJson: true,
      timedOut: false,
      validJson: true,
      hasApiError: false,
      expired: false,
      hasSessionId: false,
    },
  },
  {
    name: "HTTP 503 session check",
    response: () => ({
      ok: false,
      status: 503,
      contentType: "application/json",
      text: JSON.stringify({ error: SECRET_SESSION_BODY }),
      timedOut: false,
      errorName: "",
      errorMessage: SECRET_ERROR_MESSAGE,
    }),
    sessionCheck: {
      httpStatus: 503,
      isJson: true,
      timedOut: false,
      checkFailed: true,
    },
  },
] as const;

function isApiInput(value: unknown): value is ApiInput {
  return typeof value === "object" && value !== null && "path" in value;
}

/**
 * `evaluate` routes bank API calls (postJson) by path through `api`, answers
 * frame-discovery probes, and hands every other DOM callback (login state,
 * form fill, CAPTCHA target, login click, popup text) to `dom` in call order.
 */
function page(options: { api?: ApiRouter } = {}) {
  const routes = new Map<string, ApiReply[]>();
  const api = vi.fn(async (input: ApiInput): Promise<ApiResponse> => {
    const reply = routes.get(input.path)?.shift();
    if (reply) return typeof reply === "function" ? reply(input) : reply;
    return (await options.api?.(input)) ?? defaultApiResponse(input.path);
  });
  const dom = vi.fn();
  const frames: unknown[] = [];
  const browserPage = {
    api,
    dom,
    respond(path: string, ...replies: ApiReply[]) {
      routes.set(path, [...(routes.get(path) ?? []), ...replies]);
    },
    $: vi.fn().mockResolvedValue({
      screenshot: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    }),
    click: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn(async (callback: unknown, input?: unknown) => {
      if (isApiInput(input)) return api(input);
      // Post-login frame state (42ac0da): the mounted, inactive password
      // reminder popup means the page is ready for data queries.
      if (typeof input === "boolean") return "ready";
      // findLoginFrame probes each frame for the rendered login form.
      if (String(callback).includes("inputCount"))
        return { text: "", inputCount: 4 };
      return dom(callback, input);
    }),
    frames: vi.fn(() => frames),
    url: vi.fn(() => RWD_URL),
    on: vi.fn(),
    off: vi.fn(),
    goto: vi.fn().mockResolvedValue(undefined),
    cookies: vi
      .fn()
      .mockResolvedValue([
        { name: "SESSION", value: "fresh", domain: "my.taishinbank.com.tw" },
      ]),
    setCookie: vi.fn().mockResolvedValue(undefined),
    setUserAgent: vi.fn().mockResolvedValue(undefined),
    setViewport: vi.fn().mockResolvedValue(undefined),
    type: vi.fn().mockResolvedValue(undefined),
    waitForFunction: vi.fn().mockResolvedValue(undefined),
  };
  frames.push(browserPage);
  return browserPage;
}

type BrowserPageMock = ReturnType<typeof page>;

function browser(browserPage: BrowserPageMock) {
  return {
    close: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    once: vi.fn(),
    pages: vi.fn().mockResolvedValue([browserPage]),
    newPage: vi.fn().mockResolvedValue(browserPage),
    sessionId: vi.fn().mockReturnValue("taishin-session"),
  };
}

// Browser Run binding: login preparation (07e328c) scopes its fetch, and
// cleanup confirms the remote session DELETE through it.
const bindingFetch = vi.fn();
const binding = { fetch: bindingFetch } as unknown as Fetcher;

function apiCalls(browserPage: BrowserPageMock, path: string) {
  return browserPage.api.mock.calls.flatMap(([input]) =>
    input.path === path ? [input] : [],
  );
}

function sessionCookies(value: string) {
  return JSON.stringify([
    { name: "SESSION", value, domain: "my.taishinbank.com.tw" },
  ]);
}

/** First login page, opened inside Browser Run login preparation (07e328c). */
function preparedLoginPage(browserPage: BrowserPageMock) {
  browserPage.dom
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(selectors)
    // Preparation re-checks the login state after filling the form.
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(captchaTarget);
}

/** A login page reopened by the OCR loop or manual CAPTCHA preparation. */
function reopenedLoginPage(browserPage: BrowserPageMock) {
  browserPage.dom
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(selectors)
    .mockResolvedValueOnce(captchaTarget);
}

function loginSubmission(
  browserPage: BrowserPageMock,
  detail: string,
  submitted = true,
) {
  browserPage.dom
    .mockImplementationOnce(async () => {
      if (submitted) emitLoginRequest(browserPage);
      return true;
    })
    .mockResolvedValueOnce(detail);
}

function emitLoginRequest(browserPage: BrowserPageMock) {
  const onRequest = browserPage.on.mock.calls
    .filter(([event]) => event === "request")
    .at(-1)?.[1];
  onRequest?.({
    url: () => "https://my.taishinbank.com.tw/TIBNetBank/svc/web/login/login",
  });
}

beforeEach(() => {
  // Reset queued once-values so an unconsumed launch rejection cannot leak.
  vi.resetAllMocks();
  bindingFetch.mockImplementation(
    async () => new Response(null, { status: 200 }),
  );
  puppeteerMock.sessions.mockResolvedValue([]);
  puppeteerMock.limits.mockResolvedValue({
    activeSessions: [],
    maxConcurrentSessions: 3,
    allowedBrowserAcquisitions: 1,
    timeUntilNextAllowedBrowserAcquisition: 0,
  });
});

describe("Taishin browser session lifecycle", () => {
  it("preserves a shared Browser Run launch error through stage normalization", async () => {
    puppeteerMock.launch.mockRejectedValueOnce(
      new Error("Unable to create new browser: code: 429"),
    );
    await expect(
      createTaishinConnector(binding).sync(credentials),
    ).rejects.toBeInstanceOf(BrowserRunCapacityError);
  });

  it("labels an empty browser acquisition error", async () => {
    puppeteerMock.launch.mockRejectedValueOnce(new Error(""));

    await expect(
      createTaishinConnector(binding).sync(credentials),
    ).rejects.toMatchObject({
      name: "TaishinSyncStageError",
      stage: "acquire_browser",
      message: "台新同步在啟動瀏覽器階段失敗。",
      cause: expect.any(Error),
    });
  });

  it("labels an empty runtime error with its sync stage", async () => {
    const browserPage = page();
    browserPage.setViewport.mockRejectedValueOnce(new Error(""));
    const browserInstance = browser(browserPage);
    puppeteerMock.launch.mockResolvedValue(browserInstance);

    const error = await createTaishinConnector(binding)
      .sync(credentials)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TaishinSyncStageError);
    expect(error).toMatchObject({
      stage: "configure_browser_page",
      message: "台新同步在設定瀏覽器頁面階段失敗。",
      cause: expect.any(Error),
    });
    expect(browserInstance.close).toHaveBeenCalledOnce();
  });

  it("does not turn a successful sync into failure when browser cleanup fails", async () => {
    const browserPage = page();
    browserPage.respond(paths.summary, currentStatementSummary);
    const browserInstance = browser(browserPage);
    browserInstance.close.mockRejectedValueOnce(new Error(""));
    // Since 07e328c cleanup fails when the remote session DELETE is not
    // confirmed; a local close() rejection alone is not a cleanup failure.
    bindingFetch.mockImplementation(
      async () => new Response(null, { status: 500 }),
    );
    puppeteerMock.launch.mockResolvedValue(browserInstance);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await createTaishinConnector(binding).sync({
      ...credentials,
      sessionCookies: sessionCookies("valid"),
    });

    expect(result.bankTransactions).toEqual([]);
    expect(bindingFetch).toHaveBeenCalledWith(
      SESSION_DELETE_URL,
      expect.objectContaining({ method: "DELETE" }),
    );
    // 07e328c dropped errorName/message from this diagnostic.
    expect(JSON.parse(String(warn.mock.calls.at(-1)?.[0]))).toEqual({
      event: "taishin_browser_cleanup_failed",
      connectorId: "taishin",
      stage: "close_browser",
    });
    warn.mockRestore();
  });

  it("preserves the primary failure when browser cleanup also fails", async () => {
    // A cleanup failure during login preparation now deliberately surfaces as
    // BrowserSessionCleanupError (07e328c, covered in tests/sources/browser.test.ts),
    // so the primary failure here happens after login, in the connector's own
    // finally block.
    const browserPage = page();
    browserPage.respond(paths.twdAccounts, () => {
      throw new Error("primary failure");
    });
    const browserInstance = browser(browserPage);
    browserInstance.close.mockRejectedValueOnce(new Error("cleanup failure"));
    bindingFetch.mockImplementation(
      async () => new Response(null, { status: 500 }),
    );
    puppeteerMock.launch.mockResolvedValue(browserInstance);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(
      createTaishinConnector(binding).sync({
        ...credentials,
        sessionCookies: sessionCookies("valid"),
      }),
    ).rejects.toMatchObject({
      stage: "fetch_deposit_accounts",
      message: "台新同步在取得存款帳戶階段失敗：primary failure",
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("taishin_browser_cleanup_failed"),
    );
    warn.mockRestore();
  });

  it("reuses valid encrypted cookies without running OCR", async () => {
    // Synthetic deposits from the shared fixture, with empty transaction lists
    // so the result does not depend on the current date window.
    const browserPage = page({
      api: async ({ path, body }) => {
        if (path === paths.twdTransactions)
          return json({
            RESULT: "NORMAL",
            OUTPUTDATA: { userList: [], inNo: 0, outNo: 0 },
          });
        if (path === paths.fxTransactions)
          return json({ error: null, data: { TRANS_DETAILS: {} } });
        if (/\/web[12]\//.test(path))
          return json(
            await depositRequest(
              path,
              body as Record<string, unknown> | string,
            ),
          );
        return undefined;
      },
    });
    browserPage.respond(
      paths.summary,
      cardResponse(
        {
          "001": {
            "OUT-AVAIL-CREDIT": "100000",
            "OUT-STMT-BALANCE": "1200",
            "OUT-CRLIMIT-PERM": "200000",
            "OUT-DTE-LST-STMT": "20260720",
          },
        },
        "",
      ),
    );
    browserPage.respond(
      paths.bill,
      cardResponse({
        showAccoutnYM: "2026/07",
        showCbalance: "1200",
        showCdue: "1200",
        newAcctDetailList: [],
      }),
    );
    const browserInstance = browser(browserPage);
    puppeteerMock.launch.mockResolvedValue(browserInstance);
    const recognize = vi.fn();

    const result = await createTaishinConnector(binding, recognize).sync({
      ...credentials,
      sessionCookies: sessionCookies("encrypted-at-rest"),
    });

    expect(browserPage.setCookie).toHaveBeenCalledOnce();
    expect(recognize).not.toHaveBeenCalled();
    expect(
      result.bankAccounts?.map(({ accountType, currency }) => [
        accountType,
        currency,
      ]),
    ).toEqual([
      ["savings", "TWD"],
      ["savings", "USD"],
      ["savings", "JPY"],
      ["credit", "TWD"],
    ]);
    // 42ac0da: the post-login reminder check runs on the reused session frame.
    expect(browserPage.evaluate).toHaveBeenCalledWith(
      expect.any(Function),
      true,
    );
    for (const path of [
      paths.twdAccounts,
      `${API_ROOT}/web1/rb0102/listaccount`,
      `${API_ROOT}/web1/rb0101/query`,
      paths.twdTransactions,
      paths.fxAccounts,
      `${API_ROOT}/web2/rb0812/getRB08120100Options`,
      `${API_ROOT}/web2/rb0800/getRB08000100QueryRealtimeBalance`,
      paths.fxTransactions,
    ]) {
      expect(apiCalls(browserPage, path).length).toBeGreaterThan(0);
    }
    // 42ac0da moved realtime spending to queryRealTime and requires qryUnposted.
    expect(browserPage.evaluate).toHaveBeenCalledWith(expect.any(Function), {
      path: paths.realtime,
      body: "",
      timeoutMs: 8_000,
    });
    expect(browserPage.evaluate).toHaveBeenCalledWith(expect.any(Function), {
      path: paths.unbilled,
      body: "",
      timeoutMs: 8_000,
    });
    expect(browserPage.evaluate).toHaveBeenCalledWith(expect.any(Function), {
      path: paths.summary,
      body: {},
      timeoutMs: 4_000,
    });
    expect(browserPage.evaluate).toHaveBeenCalledWith(expect.any(Function), {
      path: paths.overview,
      body: {},
      timeoutMs: 4_000,
    });
    expect(browserPage.evaluate).toHaveBeenCalledWith(expect.any(Function), {
      path: paths.bill,
      body: {
        org: "001",
        byear: "2026",
        bmonth: "07",
        cardHolderFlagSelected: "1",
        cardNo: "",
      },
      timeoutMs: 4_000,
    });
    expect(browserInstance.close).toHaveBeenCalledOnce();
  });

  it.each([
    "您尚未持有本行信用卡。",
    { code: "SYNTHETIC_NO_CARD", message: "您尚未持有本行信用卡。" },
  ])("明確無卡時成功同步空結果並停止信用卡請求", async (error) => {
    const browserPage = page();
    browserPage.respond(paths.summary, cardResponse({}, error));
    const browserInstance = browser(browserPage);
    puppeteerMock.launch.mockResolvedValue(browserInstance);
    const result = await createTaishinConnector(binding).sync({
      ...credentials,
      sessionCookies: sessionCookies("synthetic"),
    });
    expect(result).toMatchObject({
      bankAccounts: [],
      bankBalanceSnapshots: [],
      bankTransactions: [],
      creditCardBills: [],
    });
    expect(
      browserPage.api.mock.calls.filter(([input]) =>
        input.path.includes("/web4/"),
      ),
    ).toHaveLength(1);
    expect(browserInstance.close).toHaveBeenCalledOnce();
    expect(JSON.parse(result.cursor ?? "{}").syncedAt).toEqual(
      expect.any(String),
    );
  });

  it("未知必需查詢錯誤仍回報失敗", async () => {
    // Since 42ac0da the summary is optional and runs first; the unknown error
    // goes to the required realtime query, as in the original scenario.
    const browserPage = page();
    browserPage.respond(
      paths.realtime,
      cardResponse(
        {},
        { code: "SYNTHETIC_ERROR", message: "信用卡服務維護中" },
      ),
    );
    const browserInstance = browser(browserPage);
    puppeteerMock.launch.mockResolvedValue(browserInstance);
    const error = await createTaishinConnector(binding)
      .sync({
        ...credentials,
        sessionCookies: sessionCookies("synthetic"),
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TaishinConnectionError);
    expect(error).toMatchObject({
      message: expect.stringContaining("信用卡服務維護中"),
    });
    expect(apiCalls(browserPage, paths.realtime)).toHaveLength(1);
    expect(browserInstance.close).toHaveBeenCalledOnce();
  });

  it("re-authenticates once and skips history when no current bill exists", async () => {
    const browserPage = page();
    browserPage.respond(
      paths.summary,
      { ok: true, status: 200, contentType: "text/html", text: "登入" },
      currentStatementSummary,
    );
    reopenedLoginPage(browserPage);
    loginSubmission(browserPage, "登入成功", false);
    const browserInstance = browser(browserPage);
    puppeteerMock.launch.mockResolvedValue(browserInstance);
    const recognize = vi.fn().mockResolvedValue("123456");

    const result = await createTaishinConnector(binding, recognize).sync({
      ...credentials,
      sessionCookies: sessionCookies("expired-during-fetch"),
    });

    expect(recognize).toHaveBeenCalledOnce();
    expect(apiCalls(browserPage, paths.summary)).toHaveLength(2);
    expect(apiCalls(browserPage, paths.bill)).toHaveLength(1);
    expect(result.bankBalanceSnapshots).toEqual([]);
    expect(result.creditCardBills).toEqual([]);
    expect(browserInstance.close).toHaveBeenCalledOnce();
  });

  it("keeps realtime transactions when the optional bill API fails", async () => {
    const browserPage = page();
    browserPage.respond(paths.summary, currentStatementSummary);
    browserPage.respond(paths.bill, {
      ok: false,
      status: 504,
      contentType: "application/json",
      text: "{}",
    });
    browserPage.respond(
      paths.realtime,
      cardResponse({}, "系統忙碌中，無法取得資料。"),
      cardResponse({}, "系統忙碌中，無法取得資料。"),
      cardResponse({
        fmtRealTxListMap: [
          {
            cardname: "信用卡 (卡號末四碼:3108)",
            txlist: [
              // 42ac0da requires the seventh display-name column.
              [
                "2026/07/24",
                "12:30:00",
                "即時消費",
                "350",
                "TW",
                "成功",
                "即時消費",
              ],
            ],
          },
        ],
      }),
    );
    const browserInstance = browser(browserPage);
    puppeteerMock.launch.mockResolvedValue(browserInstance);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await createTaishinConnector(binding).sync({
      ...credentials,
      sessionCookies: sessionCookies("valid"),
    });

    const transactions = result.bankTransactions ?? [];
    expect(apiCalls(browserPage, paths.realtime)).toEqual(
      Array.from({ length: 3 }, () => ({
        path: paths.realtime,
        body: "",
        timeoutMs: 8_000,
      })),
    );
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({
      description: "即時消費",
      status: "pending",
    });
    expect(result.creditCardBills).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("optional bill sync skipped"),
    );
    warn.mockRestore();
  });

  it("retries a transient realtime fetch failure and keeps its diagnostics", async () => {
    const browserPage = page();
    browserPage.respond(paths.summary, currentStatementSummary);
    browserPage.respond(
      paths.realtime,
      networkFailure(
        "Failed to fetch https://my.taishinbank.com.tw/private-path",
      ),
      { ok: false, status: 502, contentType: "application/json", text: "{}" },
    );
    const browserInstance = browser(browserPage);
    puppeteerMock.launch.mockResolvedValue(browserInstance);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await createTaishinConnector(binding).sync({
      ...credentials,
      sessionCookies: sessionCookies("valid"),
    });

    // 42ac0da renamed the endpoint and the "台新信用卡 API" message prefix.
    expect(warn).toHaveBeenCalledWith(
      "[taishin] realtime retry 1/3: 台新銀行 API queryRealTime 網路請求失敗（TypeError: Failed to fetch [URL]）。",
    );
    expect(warn).toHaveBeenCalledWith(
      "[taishin] realtime retry 2/3: 台新銀行 API queryRealTime 回應 HTTP 502。",
    );
    expect(apiCalls(browserPage, paths.realtime)).toHaveLength(3);
    warn.mockRestore();
  });

  it("returns fresh session cookies when an API fails after login", async () => {
    // Deposit queries succeed; every card API then fails at the network layer.
    const browserPage = page({
      api: ({ path }) =>
        path.includes("/web4/") ? networkFailure("Failed to fetch") : undefined,
    });
    const browserInstance = browser(browserPage);
    puppeteerMock.launch.mockResolvedValue(browserInstance);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const error = await createTaishinConnector(binding)
      .sync({
        ...credentials,
        sessionCookies: sessionCookies("expired"),
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TaishinConnectionError);
    expect(error).toMatchObject({
      message:
        "台新銀行 API queryRealTime 網路請求失敗（TypeError: Failed to fetch）。",
      sessionCookies: JSON.stringify([
        {
          name: "SESSION",
          value: "fresh",
          domain: "my.taishinbank.com.tw",
        },
      ]),
      sessionCreatedAt: expect.any(String),
    });
    // The optional summary call fails first, then two realtime retries.
    expect(warn).toHaveBeenCalledTimes(3);
    expect(apiCalls(browserPage, paths.realtime)).toHaveLength(3);
    expect(browserInstance.close).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("reuses the same browser for manual CAPTCHA and disconnects it", async () => {
    const browserPage = page();
    reopenedLoginPage(browserPage);
    const browserInstance = browser(browserPage);
    puppeteerMock.sessions.mockResolvedValue([
      { sessionId: "taishin-session", startTime: Date.now() },
    ]);
    puppeteerMock.connect.mockResolvedValue(browserInstance);

    const result = await prepareTaishinCaptcha(binding, {
      ...credentials,
      browserSessionId: "taishin-session",
    });

    expect(puppeteerMock.connect).toHaveBeenCalledWith(
      binding,
      "taishin-session",
    );
    expect(puppeteerMock.launch).not.toHaveBeenCalled();
    expect(browserInstance.disconnect).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      browserSessionId: "taishin-session",
      captchaImage: "data:image/jpeg;base64,AQID",
      captchaDigitCount: 6,
    });
  });

  it("reopens the login page once when the CAPTCHA image is slow to load", async () => {
    const browserPage = page();
    browserPage.dom
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(selectors);
    reopenedLoginPage(browserPage);
    browserPage.waitForFunction
      .mockRejectedValueOnce(new Error("CAPTCHA image timeout"))
      .mockResolvedValueOnce(undefined);
    const browserInstance = browser(browserPage);
    puppeteerMock.launch.mockResolvedValue(browserInstance);

    const result = await prepareTaishinCaptcha(binding, credentials);

    expect(browserPage.goto).toHaveBeenCalledTimes(2);
    expect(browserPage.waitForFunction).toHaveBeenCalledTimes(2);
    expect(result.captchaImage).toBe("data:image/jpeg;base64,AQID");
    expect(browserInstance.disconnect).toHaveBeenCalledOnce();
  });

  it("preserves the CAPTCHA page on reconnect and closes it after rejection", async () => {
    const browserPage = page();
    browserPage.dom
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce("驗證碼錯誤");
    const browserInstance = browser(browserPage);
    puppeteerMock.sessions.mockResolvedValue([
      { sessionId: "taishin-session", startTime: Date.now() },
    ]);
    puppeteerMock.connect.mockResolvedValue(browserInstance);

    await expect(
      createTaishinConnector(binding).sync({
        ...credentials,
        browserSessionId: "taishin-session",
        browserSessionExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        captchaDigitCount: 6,
        captcha: "123456",
      }),
    ).rejects.toThrow("圖形驗證碼錯誤");

    // Reapplying mobile emulation on a reconnected Page triggers a reload.
    expect(browserPage.setViewport).not.toHaveBeenCalled();
    expect(browserPage.setUserAgent).not.toHaveBeenCalled();
    expect(browserPage.goto).not.toHaveBeenCalled();
    expect(browserInstance.close).toHaveBeenCalledOnce();
    // 07e328c: cleanup always detaches locally, so the session is shown to be
    // closed (not preserved) by the remote DELETE instead of a missing
    // disconnect().
    expect(bindingFetch).toHaveBeenCalledWith(
      SESSION_DELETE_URL,
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("clicks a visible div used as the login button", async () => {
    const browserPage = page();
    const loginButton = {
      tagName: "DIV",
      innerText: "登入網銀",
      hidden: false,
      title: "",
      dataset: {} as Record<string, string>,
      getAttribute: vi.fn().mockReturnValue(null),
      getBoundingClientRect: vi
        .fn()
        .mockReturnValue({ width: 300, height: 50 }),
      matches: vi.fn().mockReturnValue(false),
      click: vi.fn(),
    };
    browserPage.dom
      .mockImplementationOnce(async (callback: () => unknown) => {
        vi.stubGlobal("document", {
          querySelectorAll: vi.fn().mockReturnValue([loginButton]),
        });
        try {
          return callback();
        } finally {
          vi.unstubAllGlobals();
        }
      })
      .mockResolvedValueOnce("驗證碼錯誤");
    const browserInstance = browser(browserPage);
    puppeteerMock.sessions.mockResolvedValue([
      { sessionId: "taishin-session", startTime: Date.now() },
    ]);
    puppeteerMock.connect.mockResolvedValue(browserInstance);

    await expect(
      createTaishinConnector(binding).sync({
        ...credentials,
        browserSessionId: "taishin-session",
        browserSessionExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        captchaDigitCount: 6,
        captcha: "123456",
      }),
    ).rejects.toThrow("圖形驗證碼錯誤");

    expect(loginButton.dataset.taishinLogin).toBe("submit");
    expect(loginButton.click).toHaveBeenCalledOnce();
    expect(browserPage.click).not.toHaveBeenCalled();
  });

  it("prioritizes an active popup when rejecting a CAPTCHA", async () => {
    const browserPage = page();
    const popup = { innerText: "驗證碼輸入錯誤" };
    const querySelector = vi.fn().mockReturnValue(popup);
    const noisyBodyText = `${"x".repeat(2_000)}-footer`;
    browserPage.dom
      .mockResolvedValueOnce(true)
      .mockImplementationOnce(async (callback: () => unknown) => {
        vi.stubGlobal("document", {
          querySelector,
          body: { innerText: noisyBodyText },
        });
        try {
          return callback();
        } finally {
          vi.unstubAllGlobals();
        }
      });
    const browserInstance = browser(browserPage);
    puppeteerMock.sessions.mockResolvedValue([
      { sessionId: "taishin-session", startTime: Date.now() },
    ]);
    puppeteerMock.connect.mockResolvedValue(browserInstance);

    await expect(
      createTaishinConnector(binding).sync({
        ...credentials,
        browserSessionId: "taishin-session",
        browserSessionExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        captchaDigitCount: 6,
        captcha: "123456",
      }),
    ).rejects.toBeInstanceOf(TaishinCaptchaRejectedError);

    expect(querySelector).toHaveBeenCalledWith(".js-popup.active ._popup_text");
    // Only the login click and one popup read; no session polling.
    expect(browserPage.dom).toHaveBeenCalledTimes(2);
    expect(browserPage.api).not.toHaveBeenCalled();
    expect(browserInstance.close).toHaveBeenCalledOnce();
  });

  it("records a safe manual login response diagnostic", async () => {
    const browserPage = page();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    type EventHandler = (payload: unknown) => void | Promise<void>;
    const handlers = new Map<string, Set<EventHandler>>();
    browserPage.on.mockImplementation(
      (event: string, handler: EventHandler) => {
        const eventHandlers = handlers.get(event) ?? new Set<EventHandler>();
        eventHandlers.add(handler);
        handlers.set(event, eventHandlers);
        return browserPage;
      },
    );
    browserPage.off.mockImplementation(
      (event: string, handler: EventHandler) => {
        handlers.get(event)?.delete(handler);
        return browserPage;
      },
    );
    const emit = async (event: string, payload: unknown) => {
      await Promise.all(
        [...(handlers.get(event) ?? [])].map((handler) =>
          Promise.resolve(handler(payload)),
        ),
      );
    };
    const loginUrl =
      "https://my.taishinbank.com.tw/TIBNetBank/svc/web/login/login";
    const loginRequest = { url: vi.fn().mockReturnValue(loginUrl) };
    const loginResponse = {
      url: vi.fn().mockReturnValue(loginUrl),
      status: vi.fn().mockReturnValue(200),
      json: vi.fn().mockResolvedValue({
        RESULT: "FAIL",
        STATUS: "A",
        ERRORMSG: "private-body",
        TOKEN: "secret-token",
      }),
    };
    let clickEvents: Promise<void> | undefined;
    const loginButton = {
      tagName: "BUTTON",
      innerText: "登入網銀",
      hidden: false,
      title: "",
      dataset: {} as Record<string, string>,
      getAttribute: vi.fn().mockReturnValue(null),
      getBoundingClientRect: vi
        .fn()
        .mockReturnValue({ width: 300, height: 50 }),
      matches: vi.fn().mockReturnValue(true),
      click: vi.fn(() => {
        clickEvents = Promise.all([
          emit("request", loginRequest),
          emit("response", loginResponse),
        ]).then(() => undefined);
      }),
    };
    browserPage.dom
      .mockImplementationOnce(async (callback: () => unknown) => {
        vi.stubGlobal("document", {
          querySelectorAll: vi.fn().mockReturnValue([loginButton]),
        });
        try {
          const result = callback();
          if (clickEvents) await clickEvents;
          return result;
        } finally {
          vi.unstubAllGlobals();
        }
      })
      .mockResolvedValueOnce("驗證碼輸入錯誤");
    const browserInstance = browser(browserPage);
    puppeteerMock.sessions.mockResolvedValue([
      { sessionId: "taishin-session", startTime: Date.now() },
    ]);
    puppeteerMock.connect.mockResolvedValue(browserInstance);

    try {
      await expect(
        createTaishinConnector(binding).sync({
          ...credentials,
          browserSessionId: "taishin-session",
          browserSessionExpiresAt: new Date(Date.now() + 60_000).toISOString(),
          captchaDigitCount: 6,
          captcha: "123456",
        }),
      ).rejects.toBeInstanceOf(TaishinCaptchaRejectedError);

      expect(browserPage.on).toHaveBeenCalledWith(
        "request",
        expect.any(Function),
      );
      expect(browserPage.on).toHaveBeenCalledWith(
        "response",
        expect.any(Function),
      );
      expect(browserPage.off).toHaveBeenCalledWith(
        "request",
        expect.any(Function),
      );
      expect(browserPage.off).toHaveBeenCalledWith(
        "response",
        expect.any(Function),
      );
      expect(loginRequest.url).toHaveBeenCalledOnce();
      expect(loginResponse.url).toHaveBeenCalledOnce();
      expect(loginResponse.status).toHaveBeenCalledOnce();
      expect(loginResponse.json).toHaveBeenCalledOnce();

      const diagnostic = warn.mock.calls
        .map(([value]) => JSON.parse(String(value)) as Record<string, unknown>)
        .find((value) => value.event === "taishin_login_response");
      expect(diagnostic).toMatchObject({
        event: "taishin_login_response",
        mode: "manual",
        httpStatus: 200,
        validJson: true,
        result: "FAIL",
        status: "A",
        hasErrorMessage: true,
      });
      const serialized = JSON.stringify(warn.mock.calls);
      for (const secret of [
        "private-body",
        "secret-token",
        credentials.userId,
        credentials.account,
        credentials.password,
        "123456",
      ]) {
        expect(serialized).not.toContain(secret);
      }
    } finally {
      warn.mockRestore();
    }
  });

  it.each(manualUnknownCases)(
    "reports a safe manual unknown outcome after ten session checks ($name)",
    async ({ response, sessionCheck }) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-06T12:00:00.000Z"));
      const warn = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      try {
        const browserPage = page({
          api: ({ path }) =>
            path === paths.sessionCheck ? response() : undefined,
        });
        browserPage.dom
          .mockResolvedValueOnce(true)
          .mockResolvedValue(SECRET_PAGE_TEXT);
        const browserInstance = browser(browserPage);
        puppeteerMock.sessions.mockResolvedValue([
          { sessionId: "taishin-session", startTime: Date.now() },
        ]);
        puppeteerMock.connect.mockResolvedValue(browserInstance);

        const pending = createTaishinConnector(binding).sync({
          ...credentials,
          browserSessionId: "taishin-session",
          browserSessionExpiresAt: new Date(Date.now() + 60_000).toISOString(),
          captchaDigitCount: 6,
          captcha: "123456",
        });
        const rejected = expect(pending).rejects.toMatchObject({
          name: "TaishinLoginOutcomeUnknownError",
          message:
            "台新人工驗證已送出，但尚未確認登入成功，請稍後重新取得驗證碼再試。",
        });
        await vi.runAllTimersAsync();
        await rejected;

        expect(warn).toHaveBeenCalledTimes(1);
        const diagnostic = JSON.parse(String(warn.mock.calls[0]?.[0]));
        expect(diagnostic).toMatchObject({
          event: "taishin_login_outcome_unknown",
          mode: "manual",
          attempts: 10,
          elapsedMs: expect.any(Number),
          sessionChecks: Array.from({ length: 10 }, () => sessionCheck),
        });
        const serialized = String(warn.mock.calls[0]?.[0]);
        expect(serialized).not.toContain(SECRET_PAGE_TEXT);
        expect(serialized).not.toContain(SECRET_SESSION_BODY);
        expect(serialized).not.toContain(SECRET_ERROR_MESSAGE);
        expect(browserInstance.close).toHaveBeenCalledOnce();
      } finally {
        warn.mockRestore();
        vi.useRealTimers();
      }
    },
  );

  it("accepts a valid bank session without relying on account overview text", async () => {
    const browserPage = page();
    preparedLoginPage(browserPage);
    loginSubmission(browserPage, "登入成功");
    browserPage.respond(
      paths.summary,
      cardResponse({
        "001": {
          "OUT-AVAIL-CREDIT": "100000",
          "OUT-STMT-BALANCE": "1200",
          "OUT-CRLIMIT-PERM": "200000",
          "OUT-DTE-LST-STMT": "20260720",
        },
      }),
    );
    browserPage.respond(
      paths.bill,
      cardResponse({
        showAccoutnYM: "2026/07",
        showCbalance: "1200",
        showCdue: "1200",
        newAcctDetailList: [],
      }),
    );
    const browserInstance = browser(browserPage);
    puppeteerMock.launch.mockResolvedValue(browserInstance);
    const recognize = vi.fn().mockResolvedValue("123456");

    const result = await createTaishinConnector(binding, recognize).sync({
      ...credentials,
    });

    expect(result.bankAccounts).toHaveLength(1);
    expect(recognize).toHaveBeenCalledOnce();
    expect(browserInstance.close).toHaveBeenCalledOnce();
    // 42ac0da: the post-login reminder check runs on the freshly logged-in
    // frame (it replaced the text-based dismissal with a 2s wait).
    expect(browserPage.evaluate).toHaveBeenCalledWith(
      expect.any(Function),
      false,
    );
  });

  it("allows a successful login after three unusable OCR results", async () => {
    const browserPage = page();
    preparedLoginPage(browserPage);
    reopenedLoginPage(browserPage);
    reopenedLoginPage(browserPage);
    reopenedLoginPage(browserPage);
    loginSubmission(browserPage, "登入成功");
    browserPage.respond(paths.summary, currentStatementSummary);
    const browserInstance = browser(browserPage);
    puppeteerMock.launch.mockResolvedValue(browserInstance);
    const recognize = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("123456");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const result = await createTaishinConnector(binding, recognize).sync(
      credentials,
    );

    expect(result.bankAccounts).toHaveLength(1);
    expect(recognize).toHaveBeenCalledTimes(4);
    expect(browserPage.goto).toHaveBeenCalledTimes(4);
    expect(browserPage.type).toHaveBeenCalledOnce();
    expect(JSON.parse(String(log.mock.calls[2]?.[0]))).toEqual({
      event: "taishin_auto_login_attempt",
      connectorId: "taishin",
      ocrAttempt: 3,
      loginRequests: 0,
      totalLoginRequests: 0,
      outcome: "ocr_invalid",
      elapsedMs: expect.any(Number),
    });
    expect(JSON.parse(String(log.mock.calls[3]?.[0]))).toMatchObject({
      ocrAttempt: 4,
      loginRequests: 1,
      totalLoginRequests: 1,
      outcome: "success",
    });
    log.mockRestore();
  });

  it("bounds OCR retries separately without submitting login", async () => {
    const browserPage = page();
    preparedLoginPage(browserPage);
    for (let attempt = 1; attempt < 6; attempt += 1) {
      reopenedLoginPage(browserPage);
    }
    const browserInstance = browser(browserPage);
    puppeteerMock.launch.mockResolvedValue(browserInstance);
    const recognize = vi.fn().mockResolvedValue(null);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(
      createTaishinConnector(binding, recognize).sync(credentials),
    ).rejects.toThrow("辨識已達 6 次上限（登入已送出 0 次）");

    expect(recognize).toHaveBeenCalledTimes(6);
    expect(browserPage.goto).toHaveBeenCalledTimes(6);
    expect(browserPage.type).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(6);
    expect(browserInstance.close).toHaveBeenCalledOnce();
    log.mockRestore();
  });

  it("stops automatic login immediately when credentials are rejected", async () => {
    const browserPage = page();
    preparedLoginPage(browserPage);
    loginSubmission(browserPage, "使用者密碼錯誤");
    const browserInstance = browser(browserPage);
    puppeteerMock.launch.mockResolvedValue(browserInstance);
    const recognize = vi.fn().mockResolvedValue("123456");

    await expect(
      createTaishinConnector(binding, recognize).sync(credentials),
    ).rejects.toBeInstanceOf(TaishinCredentialRejectedError);

    expect(recognize).toHaveBeenCalledOnce();
    expect(browserInstance.close).toHaveBeenCalledOnce();
  });

  it("stops after three submitted logins rejected for CAPTCHA errors", async () => {
    const browserPage = page();
    preparedLoginPage(browserPage);
    loginSubmission(browserPage, "驗證碼錯誤");
    reopenedLoginPage(browserPage);
    loginSubmission(browserPage, "驗證碼錯誤");
    reopenedLoginPage(browserPage);
    loginSubmission(browserPage, "驗證碼錯誤");
    const browserInstance = browser(browserPage);
    puppeteerMock.launch.mockResolvedValue(browserInstance);
    const recognize = vi.fn().mockResolvedValue("123456");

    await expect(
      createTaishinConnector(binding, recognize).sync(credentials),
    ).rejects.toThrow("自動登入已送出 3 次，驗證碼仍遭拒絕");

    expect(recognize).toHaveBeenCalledTimes(3);
    expect(browserPage.goto).toHaveBeenCalledTimes(3);
    expect(browserInstance.close).toHaveBeenCalledOnce();
  });

  it("preserves all three login submissions when unusable OCR results occur between them", async () => {
    const browserPage = page();
    preparedLoginPage(browserPage);
    reopenedLoginPage(browserPage);
    loginSubmission(browserPage, "驗證碼錯誤");
    reopenedLoginPage(browserPage);
    reopenedLoginPage(browserPage);
    loginSubmission(browserPage, "驗證碼錯誤");
    reopenedLoginPage(browserPage);
    loginSubmission(browserPage, "驗證碼錯誤");
    const browserInstance = browser(browserPage);
    puppeteerMock.launch.mockResolvedValue(browserInstance);
    const recognize = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("123456")
      .mockResolvedValueOnce(null)
      .mockResolvedValue("123456");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(
      createTaishinConnector(binding, recognize).sync(credentials),
    ).rejects.toThrow("自動登入已送出 3 次，驗證碼仍遭拒絕");

    expect(recognize).toHaveBeenCalledTimes(5);
    expect(browserPage.goto).toHaveBeenCalledTimes(5);
    expect(browserPage.type).toHaveBeenCalledTimes(3);
    const diagnostics = log.mock.calls.map(([value]) =>
      JSON.parse(String(value)),
    );
    expect(diagnostics.map((event) => event.totalLoginRequests)).toEqual([
      0, 1, 1, 2, 3,
    ]);
    const serialized = JSON.stringify(diagnostics);
    for (const secret of [
      credentials.userId,
      credentials.account,
      credentials.password,
      "123456",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    log.mockRestore();
  });

  it("stops with the original error when a login field is missing and no request was sent", async () => {
    const browserPage = page();
    preparedLoginPage(browserPage);
    loginSubmission(browserPage, "請輸入身分證字號", false);
    const browserInstance = browser(browserPage);
    puppeteerMock.launch.mockResolvedValue(browserInstance);
    const recognize = vi.fn().mockResolvedValue("123456");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(
      createTaishinConnector(binding, recognize).sync(credentials),
    ).rejects.toMatchObject({
      name: "TaishinLoginOutcomeUnknownError",
      message: "台新登入頁沒有帶入身分證字號，請稍後再試。",
    });

    expect(recognize).toHaveBeenCalledOnce();
    expect(browserPage.goto).toHaveBeenCalledOnce();
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      ocrAttempt: 1,
      loginRequests: 0,
      totalLoginRequests: 0,
      outcome: "login_unknown",
    });
    log.mockRestore();
  });

  it("maps Browser Rendering capacity limits to a typed retryable error", async () => {
    puppeteerMock.limits.mockResolvedValue({
      allowedBrowserAcquisitions: 0,
      timeUntilNextAllowedBrowserAcquisition: 20_000,
    });

    await expect(
      prepareTaishinCaptcha(binding, credentials),
    ).rejects.toBeInstanceOf(BrowserRunCapacityError);
    expect(puppeteerMock.launch).not.toHaveBeenCalled();
  });
});
