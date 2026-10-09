import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRequestBody,
  collectCtbcPayloads,
  CtbcWebImportError,
  depositQueryStrategies,
  describeEnvelopeDiff,
  extractDepositAccounts,
  extractRequestTemplate,
  formatImportResult,
  formatResourceLog,
  formatStatementMonth,
  AuthTokenTracker,
  mergeDepositDetailLists,
  pageDepositDetailLists,
  pageStatementGroup,
  parseArgs,
  prepareFixedProfile,
  userDataDirPattern,
  pickTemplateHeaders,
  redactMessage,
  RequestTemplateWatcher,
  RESOURCES,
  statementDetailQueries,
  statementMonthsToFetch,
  summarizePayloads,
} from "./ctbc-web-import.mjs";

// Synthetic values only: fake account numbers, fake merchants, fake tokens.
const ACCOUNT_A = "0000111122223333";
const ACCOUNT_B = "0000444455556666";
const SEED = "fake-seed-value-0123456789abcdef";
const AUTH_TOKEN = "fake-auth-token-abcdefghijklmnopqrstuvwxyz";
const RESOURCE_URL =
  "https://www.ctbcbank.com/IB/api/adapters/IB_Adapter/resource/ebmwResource?IIhfvu=fake";

function pageBody(overrides = {}) {
  return {
    deviceIxd: "none",
    trackingIxd: "page-tracking",
    txnIxd: "page-txn",
    model: "chrome",
    appVer: "5.01.18",
    clientTime: "1700000000000",
    fromSys: "1",
    seed: SEED,
    token: "mfpAsync",
    rqData: { page: true },
    resource: "/twrbc-general/qu001/010",
    ...overrides,
  };
}

const pageHeaders = {
  "Content-Type": "application/json",
  "x-auth-token": AUTH_TOKEN,
  "X-Channel-Id": "EBMW_WEB",
  "X-Requested-With": "MFPAsync",
  Cookie: "session=fake",
  "User-Agent": "Mozilla/5.0",
  "X-Fake-Shape-a": "per-request-value",
};

test("parseArgs applies defaults and validates options", () => {
  assert.deepEqual(parseArgs([], {}), {
    workerUrl: "http://localhost:8797",
    port: 9333,
    loginUrl: "https://www.ctbcbank.com/twrbc/",
    loginTimeoutMinutes: 10,
    profileDir: undefined,
    depositWaitSeconds: 0,
    dryRun: false,
    help: false,
    accessClientId: undefined,
    accessClientSecret: undefined,
  });
  const options = parseArgs(
    ["--worker", "https://fin.example.com/", "--port=9444", "--dry-run"],
    { CF_ACCESS_CLIENT_ID: "id", CF_ACCESS_CLIENT_SECRET: "secret" },
  );
  assert.equal(options.workerUrl, "https://fin.example.com");
  assert.equal(options.port, 9444);
  assert.equal(options.dryRun, true);
  assert.equal(options.accessClientId, "id");

  assert.equal(
    parseArgs(["--profile", "/Users/me/.ctbc-profile"], {}).profileDir,
    "/Users/me/.ctbc-profile",
  );
  assert.equal(
    parseArgs(["--profile", "/Users/me/.ctbc-profile/"], {}).profileDir,
    "/Users/me/.ctbc-profile",
  );
  assert.throws(
    () => parseArgs(["--profile", "relative/dir"], {}),
    CtbcWebImportError,
  );
  assert.equal(parseArgs(["--deposit-wait", "0"], {}).depositWaitSeconds, 0);
  assert.throws(
    () => parseArgs(["--deposit-wait", "-1"], {}),
    CtbcWebImportError,
  );
  assert.throws(
    () => parseArgs(["--deposit-wait", "1.5"], {}),
    CtbcWebImportError,
  );
  for (const value of ["", "0x3c", "1e2", " 60", "601"]) {
    assert.throws(
      () => parseArgs([`--deposit-wait=${value}`], {}),
      CtbcWebImportError,
    );
  }
  assert.throws(() => parseArgs(["--bogus"], {}), CtbcWebImportError);
  assert.throws(() => parseArgs(["--worker"], {}), CtbcWebImportError);
  assert.throws(
    () => parseArgs(["--worker", "http://fin.example.com"], {}),
    CtbcWebImportError,
  );
  assert.equal(
    parseArgs(["--worker", "http://127.0.0.1:8797"], {}).workerUrl,
    "http://127.0.0.1:8797",
  );

  assert.throws(
    () => parseArgs(["--login-url", "https://evil.example.com/"], {}),
    CtbcWebImportError,
  );
  assert.throws(
    () => parseArgs([], { CF_ACCESS_CLIENT_ID: "id" }),
    CtbcWebImportError,
  );
});

test("header whitelist drops cookies, UA and anti-bot headers", () => {
  assert.deepEqual(pickTemplateHeaders(pageHeaders), {
    "Content-Type": "application/json",
    "x-auth-token": AUTH_TOKEN,
    "X-Channel-Id": "EBMW_WEB",
    "X-Requested-With": "MFPAsync",
  });
});

test("extractRequestTemplate keeps session constants and ignores login", () => {
  const template = extractRequestTemplate(
    RESOURCE_URL,
    JSON.stringify(pageBody()),
    pageHeaders,
  );
  assert.equal(template.origin, "https://www.ctbcbank.com");
  assert.equal(template.body.seed, SEED);
  assert.equal(template.body.token, "mfpAsync");
  assert.equal(template.body.resource, null);
  assert.equal(template.body.rqData, null);
  assert.equal(template.clientTimeType, "string");

  assert.equal(
    extractRequestTemplate(
      RESOURCE_URL,
      JSON.stringify(pageBody({ resource: "/twrbc-general/ot001/010" })),
      pageHeaders,
    ),
    null,
  );
  assert.equal(
    extractRequestTemplate(
      "https://www.ctbcbank.com/IB/api/adapters/IB_Adapter/resource/preLogin",
      JSON.stringify(pageBody()),
      pageHeaders,
    ),
    null,
  );
  assert.equal(
    extractRequestTemplate(
      "https://evil.example.com/IB/api/adapters/IB_Adapter/resource/ebmwResource",
      JSON.stringify(pageBody()),
      pageHeaders,
    ),
    null,
  );
  assert.equal(
    extractRequestTemplate(RESOURCE_URL, JSON.stringify(pageBody()), {
      "Content-Type": "application/json",
    }),
    null,
  );
  assert.equal(
    extractRequestTemplate(RESOURCE_URL, "not-json", pageHeaders),
    null,
  );
});

test("buildRequestBody only replaces per-request fields", () => {
  const template = extractRequestTemplate(
    RESOURCE_URL,
    JSON.stringify(pageBody()),
    pageHeaders,
  );
  let counter = 0;
  const body = buildRequestBody(
    template,
    RESOURCES.depositOverview,
    {},
    { now: 1_800_000_000_000, uuid: () => `uuid-${++counter}` },
  );
  assert.deepEqual(Object.keys(body), Object.keys(pageBody()));
  assert.deepEqual(body, {
    ...pageBody(),
    resource: RESOURCES.depositOverview,
    rqData: {},
    trackingIxd: "uuid-1",
    txnIxd: "uuid-2",
    clientTime: "1800000000000",
  });

  const numericTemplate = extractRequestTemplate(
    RESOURCE_URL,
    JSON.stringify(pageBody({ clientTime: 1 })),
    pageHeaders,
  );
  assert.equal(
    buildRequestBody(numericTemplate, "/x", {}, { now: 5 }).clientTime,
    5,
  );
});

test("deposit query strategies follow the documented order", () => {
  const strategies = depositQueryStrategies(ACCOUNT_A, {
    dateRanges: [
      { firstDateYYYYMMDD: "20260701", lastDateYYYYMMDD: "20260731" },
      { firstDateYYYYMMDD: "20260901", lastDateYYYYMMDD: "20260926" },
      { firstDateYYYYMMDD: "20260801", lastDateYYYYMMDD: "20260831" },
      { firstDateYYYYMMDD: "20260601", lastDateYYYYMMDD: "20260630" },
    ],
    now: new Date("2026-09-26T04:00:00.000Z"),
  });
  assert.deepEqual(
    strategies.map((strategy) => strategy.name),
    ["type-month", "custom-yyyymmdd", "custom-slash", "custom-computed"],
  );
  assert.deepEqual(strategies[0].requests, [
    { accountId: ACCOUNT_A, type: "m0" },
    { accountId: ACCOUNT_A, type: "m1" },
    { accountId: ACCOUNT_A, type: "m2" },
  ]);
  assert.deepEqual(strategies[1].requests[0], {
    accountId: ACCOUNT_A,
    startDate: "20260901",
    endDate: "20260926",
    keyWord: "",
    type: "custom",
  });
  assert.equal(strategies[1].requests.length, 3);
  assert.equal(strategies[2].requests[2].startDate, "2026/07/01");
  assert.deepEqual(
    strategies[3].requests.map((request) => request.startDate),
    ["20260901", "20260801", "20260701"],
  );

  const observed = depositQueryStrategies(ACCOUNT_B, {
    observedQuery: { accountId: ACCOUNT_A, type: "m0", extra: "x" },
  });
  assert.equal(observed[0].name, "observed");
  assert.deepEqual(observed[0].requests, [
    { accountId: ACCOUNT_B, type: "m0", extra: "x" },
  ]);
  assert.deepEqual(
    observed.map((strategy) => strategy.name),
    ["observed", "type-month", "custom-computed"],
  );
});

test("formatResourceLog never prints anything but resource, code and count", () => {
  assert.equal(
    formatResourceLog(RESOURCES.depositOverview, "0000", 2),
    "  /twrbc-deposit/qu001/010 code=0000 筆數=2",
  );
  assert.equal(
    formatResourceLog(`/twrbc-deposit/${ACCOUNT_A}`, `H404 ${ACCOUNT_A}`, 1.5),
    "  [resource] code=?",
  );
  assert.equal(
    formatResourceLog(RESOURCES.logout, undefined),
    "  /twrbc-general/ot002/010 code=?",
  );
});

test("redactMessage hides account numbers, ids and tokens", () => {
  const text = redactMessage(
    `帳號 ${ACCOUNT_A} 身分 A123456789 金額 12,345 token ${AUTH_TOKEN} https://x.example/y`,
  );
  assert.ok(!text.includes(ACCOUNT_A));
  assert.ok(!text.includes("A123456789"));
  assert.ok(!text.includes("12,345"));
  assert.ok(!text.includes(AUTH_TOKEN));
  assert.ok(!text.includes("x.example"));
});

function overview(accountIds, balances = []) {
  return {
    code: "0000",
    rsData: {
      twdAcctSummaryResponse: {
        demDepBalSummaryResponse: {
          infoList: accountIds.map((accountId, index) => ({
            accountId,
            balance: balances[index] ?? String(1000 * (index + 1)),
            accountNickName: "測試戶名",
          })),
        },
      },
    },
  };
}

function fakeBank({
  balances,
  depositHandler,
  failResource,
  creditCards,
  monthHandler,
  monthPageHandler,
} = {}) {
  const calls = [];
  const call = async (resource, rqData) => {
    calls.push({ resource, rqData });
    if (resource === failResource) return { code: "9991", desc: "未提供" };
    switch (resource) {
      case RESOURCES.depositOverview:
        return overview([ACCOUNT_A, ACCOUNT_B], balances);
      case RESOURCES.depositInit:
        return {
          code: "0000",
          rsData: {
            accountInfoList: [{ accountId: rqData.accountId }],
            dateRanges: [
              { firstDateYYYYMMDD: "20260901", lastDateYYYYMMDD: "20260926" },
            ],
          },
        };
      case RESOURCES.depositTransactions:
        return depositHandler
          ? depositHandler(rqData)
          : { code: "H404", desc: "查無資料" };
      case RESOURCES.creditCardBills:
        return (
          creditCards ?? {
            code: "0000",
            rsData: { billData: {}, cardDataList: [] },
          }
        );
      case RESOURCES.creditCardMonthBills:
        return monthHandler ? monthHandler(rqData) : { code: "9991" };
      case RESOURCES.creditCardMonthBillsPage:
        return monthPageHandler ? monthPageHandler(rqData) : { code: "9991" };
      case RESOURCES.unbilledInit:
        return {
          code: "0000",
          rsData: { curOptions: [{ curCode: "TWD" }, { curCode: "USD" }] },
        };
      case RESOURCES.unbilled:
        return {
          code: "0000",
          rsData: {
            allItems: [{ description: `虛構商家-${rqData.curCode}` }],
            displayPaging: rqData.curCode === "TWD" ? "Y" : "N",
            pageCount: 1,
            totalRow: rqData.curCode === "TWD" ? 2 : 1,
          },
        };
      case RESOURCES.unbilledPage:
        return {
          code: "0000",
          rsData: { allItems: [{ description: "虛構商家-第二頁" }] },
        };
      case RESOURCES.realtime:
        return {
          code: "0000",
          rsData: { allItems: [{ merchName: "虛構咖啡" }], noMore: true },
        };
      default:
        throw new Error(`unexpected resource ${resource}`);
    }
  };
  return { call, calls };
}

test("collectCtbcPayloads marks deposit transactions unavailable when every strategy fails", async () => {
  const lines = [];
  const { call, calls } = fakeBank();
  const result = await collectCtbcPayloads(call, {
    log: (line) => lines.push(line),
    now: new Date("2026-09-26T04:00:00.000Z"),
  });

  assert.equal(result.depositTransactionsUnavailable, true);
  assert.equal(result.depositStrategy, null);
  assert.deepEqual(result.payloads.depositTransactions, {
    rsData: { detailList: [] },
  });
  assert.equal(result.payloads.creditCards.code, "0000");
  assert.deepEqual(
    result.payloads.unbilled.rsData.allItems.map((item) => item.sourceCurrency),
    ["TWD", "TWD", "USD"],
  );
  assert.equal(result.payloads.realtime.rsData.allItems.length, 1);

  const firstAccountQueries = calls
    .filter(
      (entry) =>
        entry.resource === RESOURCES.depositTransactions &&
        entry.rqData.accountId === ACCOUNT_A,
    )
    .map((entry) => entry.rqData.type + ":" + (entry.rqData.startDate ?? ""));
  assert.deepEqual(firstAccountQueries.slice(0, 4), [
    "m0:",
    "m1:",
    "m2:",
    "custom:20260901",
  ]);
  assert.ok(firstAccountQueries.includes("custom:2026/09/01"));
  assert.ok(!calls.some((entry) => entry.resource.includes("qu046")));

  const output = lines.join("\n");
  assert.ok(output.includes("code=H404"));
  for (const secret of [ACCOUNT_A, ACCOUNT_B, "1000", "測試戶名", "虛構"]) {
    assert.ok(!output.includes(secret), `log leaked ${secret}`);
  }
});

test("collectCtbcPayloads uses the first working strategy and tags source accounts", async () => {
  const { call, calls } = fakeBank({
    depositHandler: (rqData) => {
      if (rqData.type !== "custom" || !/^\d{8}$/.test(rqData.startDate)) {
        return { code: "H404" };
      }
      if (rqData.startDate !== "20260901") return { code: "H404" };
      if (rqData.nextKey === "page-2") {
        return {
          code: "0000",
          rsData: { detailList: [{ memo1: "第二頁" }], nextKey: "" },
        };
      }
      return {
        code: "0000",
        rsData: { detailList: [{ memo1: "虛構入帳" }], nextKey: "page-2" },
      };
    },
  });

  const result = await collectCtbcPayloads(call, {
    now: new Date("2026-09-26T04:00:00.000Z"),
  });

  assert.equal(result.depositTransactionsUnavailable, false);
  assert.equal(result.depositStrategy, "custom-yyyymmdd");
  assert.deepEqual(result.payloads.depositTransactions.rsData.detailList, [
    { memo1: "虛構入帳", sourceAccountId: ACCOUNT_A },
    { memo1: "第二頁", sourceAccountId: ACCOUNT_A },
    { memo1: "虛構入帳", sourceAccountId: ACCOUNT_B },
    { memo1: "第二頁", sourceAccountId: ACCOUNT_B },
  ]);
  // The second account tries the strategy that already worked first.
  const secondAccountFirstQuery = calls.find(
    (entry) =>
      entry.resource === RESOURCES.depositTransactions &&
      entry.rqData.accountId === ACCOUNT_B,
  );
  assert.equal(secondAccountFirstQuery.rqData.type, "custom");
});

test("collectCtbcPayloads prefers the query the page itself sent", async () => {
  const { call, calls } = fakeBank({
    depositHandler: (rqData) =>
      rqData.pageOnly === "yes"
        ? { code: "0000", rsData: { detailList: [{ memo1: "頁面參數" }] } }
        : { code: "H404" },
  });

  const result = await collectCtbcPayloads(call, {
    observedDepositQuery: () => ({
      accountId: "page-account",
      type: "m0",
      pageOnly: "yes",
    }),
  });

  assert.equal(result.depositStrategy, "observed");
  const firstQuery = calls.find(
    (entry) => entry.resource === RESOURCES.depositTransactions,
  );
  assert.deepEqual(firstQuery.rqData, {
    accountId: ACCOUNT_A,
    type: "m0",
    pageOnly: "yes",
  });
});

test("collectCtbcPayloads imports the page's own deposit results when replays fail", async () => {
  const lines = [];
  const { call } = fakeBank();
  const pageItem = { memo1: "虛構轉帳存入", crAmt: "31520", balanceAmt: "9" };
  const result = await collectCtbcPayloads(call, {
    log: (line) => lines.push(line),
    now: new Date("2026-10-04T04:00:00.000Z"),
    pageDeposits: () => [
      {
        rqData: { accountId: ACCOUNT_A, type: "m0" },
        response: { code: "0000", rsData: { detailList: [pageItem] } },
      },
      // 同一查詢再開一次：同一筆只算一次。
      {
        rqData: { accountId: ACCOUNT_A, type: "m0" },
        response: { code: "0000", rsData: { detailList: [pageItem] } },
      },
      {
        rqData: { accountId: ACCOUNT_B, type: "m0" },
        response: { code: "H404", desc: "查無資料" },
      },
      {
        rqData: { accountId: "0000999999999999", type: "m0" },
        response: {
          code: "0000",
          rsData: { detailList: [{ memo1: "別的帳戶" }] },
        },
      },
    ],
  });

  // B 有餘額卻沒取得明細（頁面回 H404、也不重送）：仍帶部分資料未取得的警告。
  assert.equal(result.depositTransactionsUnavailable, true);
  assert.equal(result.depositStrategy, "page");
  assert.deepEqual(result.payloads.depositTransactions.rsData.detailList, [
    { ...pageItem, sourceAccountId: ACCOUNT_A },
  ]);
  const output = lines.join("\n");
  assert.ok(output.includes("使用頁面查詢結果 1 筆"));
  assert.ok(output.includes("1 個有餘額（或餘額不明）的帳戶未取得"));
  for (const secret of [ACCOUNT_A, ACCOUNT_B, "31520", "虛構"]) {
    assert.ok(!output.includes(secret), `log leaked ${secret}`);
  }
});

test("collectCtbcPayloads skips every replay once the page showed deposits", async () => {
  const pageDeposits = () => [
    {
      rqData: { accountId: ACCOUNT_A, type: "m0" },
      response: {
        code: "0000",
        rsData: { detailList: [{ memo1: "虛構本月", balanceAmt: "2" }] },
      },
    },
    // 使用者切換到前幾個月：與本月重疊的紀錄只算一次。
    {
      rqData: { accountId: ACCOUNT_A, type: "m2" },
      response: {
        code: "0000",
        rsData: {
          detailList: [
            { memo1: "虛構上月", balanceAmt: "1" },
            { balanceAmt: "2", memo1: "虛構本月" },
          ],
        },
      },
    },
  ];
  const { call, calls } = fakeBank({ balances: ["5000", "0"] });
  const lines = [];
  const result = await collectCtbcPayloads(call, {
    pageDeposits,
    log: (line) => lines.push(line),
  });
  assert.ok(
    lines.includes("存款明細：1 個餘額為 0 的帳戶未取得明細（不列為警告）"),
  );
  assert.equal(result.depositStrategy, "page");
  // 沒看的 B 餘額為 0：不算遺漏，不帶警告。
  assert.equal(result.depositTransactionsUnavailable, false);
  assert.deepEqual(
    result.payloads.depositTransactions.rsData.detailList.map(
      (item) => `${item.memo1}:${item.sourceAccountId === ACCOUNT_A}`,
    ),
    ["虛構本月:true", "虛構上月:true"],
  );
  assert.ok(
    !calls.some((entry) => entry.resource === RESOURCES.depositTransactions),
  );

  // B 有餘額時就要警告。
  const withBalance = await collectCtbcPayloads(fakeBank().call, {
    pageDeposits,
  });
  assert.equal(withBalance.depositTransactionsUnavailable, true);

  // 全部帳戶都沒取得時，即使餘額都是 0 也要警告。
  const nothing = await collectCtbcPayloads(
    fakeBank({ balances: ["0", "NT$ 0"] }).call,
  );
  assert.equal(nothing.depositTransactionsUnavailable, true);
});

test("extractDepositAccounts normalizes balances and keeps unknown ones as null", () => {
  const accounts = extractDepositAccounts({
    code: "0000",
    rsData: {
      twdAcctSummaryResponse: {
        demDepBalSummaryResponse: {
          infoList: [
            { accountId: "a1", balance: "1,234" },
            { accountId: "a2", balance: "NT$0" },
            { accountId: "a3", balance: 0 },
            { accountId: "a4", balance: "" },
            { accountId: "a5", balance: "不明" },
            { accountId: "a6" },
            { accountId: " ", balance: "1" },
          ],
        },
      },
    },
  });
  assert.deepEqual(
    accounts.map((account) => [account.accountId, account.balance]),
    [
      ["a1", 1234],
      ["a2", 0],
      ["a3", 0],
      ["a4", null],
      ["a5", null],
      ["a6", null],
    ],
  );
});

test("mergeDepositDetailLists keeps repeated records within one list", () => {
  const same = { memo1: "虛構", amount: 1 };
  assert.deepEqual(
    mergeDepositDetailLists([
      [same, { ...same }],
      [{ amount: 1, memo1: "虛構" }, { memo1: "其他" }],
    ]),
    [same, same, { memo1: "其他" }],
  );
  assert.deepEqual(
    pageDepositDetailLists(
      [
        { rqData: { accountId: ` ${ACCOUNT_A} ` }, response: { code: "0000" } },
        { rqData: null, response: { code: "0000" } },
        "not-a-capture",
      ],
      [ACCOUNT_A],
    ),
    [[]],
  );
});

test("describeEnvelopeDiff reports field names without values", () => {
  const template = extractRequestTemplate(
    RESOURCE_URL,
    JSON.stringify(pageBody()),
    pageHeaders,
  );
  const { model: _model, ...withoutModel } = pageBody({
    seed: "different-seed-value",
    funcCode: "secret-func-value",
    resource: RESOURCES.depositTransactions,
    rqData: { accountId: ACCOUNT_A, type: "m0" },
  });
  const diff = describeEnvelopeDiff(
    template,
    RESOURCE_URL,
    withoutModel,
    pageHeaders,
  );
  assert.deepEqual(diff, {
    bodyKeys: ["seed(值不同)", "funcCode(工具沒有)", "model(頁面沒有)"],
    headerNames: ["x-fake-shape-a"],
    queryNames: ["IIhfvu"],
  });
  const text = JSON.stringify(diff);
  for (const secret of [
    "different-seed-value",
    "secret-func-value",
    SEED,
    AUTH_TOKEN,
    ACCOUNT_A,
    "per-request-value",
    '"fake"',
  ]) {
    assert.ok(!text.includes(secret), `diff leaked ${secret}`);
  }
});

test("collectCtbcPayloads explains an expired login instead of printing the resource path", async () => {
  for (const code of ["9992", "9994"]) {
    const error = await collectCtbcPayloads(async () => ({ code })).catch(
      (cause) => cause,
    );
    assert.ok(error instanceof CtbcWebImportError);
    assert.match(error.message, /登入已失效/);
    assert.equal(redactMessage(error.message), error.message);
  }
  const other = await collectCtbcPayloads(async () => ({ code: "E001" })).catch(
    (cause) => cause,
  );
  assert.match(other.message, /「存款總覽」失敗（code=E001）/);
  assert.equal(redactMessage(other.message), other.message);
});

test("collectCtbcPayloads stops without importing when a required resource fails", async () => {
  const { call } = fakeBank({ failResource: RESOURCES.creditCardBills });
  await assert.rejects(collectCtbcPayloads(call), (error) => {
    assert.ok(error instanceof CtbcWebImportError);
    assert.match(error.message, /「信用卡帳單」失敗（code=9991）/);
    assert.ok(!error.message.includes("未提供"));
    assert.ok(!error.message.includes(ACCOUNT_A));
    return true;
  });
});

test("formatImportResult prints counts and redacts worker messages", () => {
  assert.deepEqual(
    formatImportResult({
      status: 200,
      json: {
        success: true,
        records: 12,
        newRecords: { bankTransactions: 3 },
        warnings: ["部分資料未取得"],
      },
    }),
    {
      ok: true,
      lines: ["匯入成功：records=12，新增交易=3", "警告：部分資料未取得"],
    },
  );
  const failed = formatImportResult({
    status: 400,
    json: {
      success: false,
      error: { code: "CTBC_IMPORT_INVALID", message: `壞資料 ${ACCOUNT_A}` },
    },
  });
  assert.equal(failed.ok, false);
  assert.ok(failed.lines[0].includes("CTBC_IMPORT_INVALID"));
  assert.ok(!failed.lines[0].includes(ACCOUNT_A));
  assert.match(
    formatImportResult({ status: 403, json: null }).lines[0],
    /UNKNOWN.*Access/,
  );
});

function statementOverview() {
  const summary = (period) => ({ date: period.replace("/", ""), billAmt: 100 });
  return {
    code: "0000",
    rsData: {
      billData: {
        TWD: {
          "2026/05": { summary: summary("2026/05"), bills: [] },
          "2026/07": { summary: summary("2026/07"), bills: [] },
          "2026/08": { summary: summary("2026/08"), bills: [] },
          "2026/09": {
            summary: { billDt: "091326", billAmt: 300 },
            displayPaging: false,
            bills: [{ merchantChiName: "虛構最新一期" }],
          },
        },
      },
      cardDataList: [],
    },
  };
}

test("statementMonthsToFetch picks the latest three periods without details", () => {
  assert.deepEqual(statementMonthsToFetch(statementOverview()), [
    { currency: "TWD", month: "2026/08", hasBills: false },
    { currency: "TWD", month: "2026/07", hasBills: false },
  ]);
  const paged = statementOverview();
  Object.assign(paged.rsData.billData.TWD["2026/09"], {
    displayPaging: true,
    totalRow: "3",
    pageCount: "1",
  });
  assert.deepEqual(statementMonthsToFetch(paged)[0], {
    currency: "TWD",
    month: "2026/09",
    hasBills: true,
  });
  assert.deepEqual(statementDetailQueries("TWD", "2026/08"), [
    { curCode: "TWD", month: "2026/08" },
    { curCode: "TWD", month: "202608" },
  ]);
});

test("collectCtbcPayloads merges month statement details and pages", async () => {
  const lines = [];
  const { call, calls } = fakeBank({
    creditCards: statementOverview(),
    monthHandler: (rqData) => {
      if (rqData.month === "2026/08") {
        return {
          code: "0000",
          rsData: {
            summary: { billDt: "081326", pmtExpDt: "090326", billAmt: 999 },
            displayPaging: true,
            totalRow: "3",
            pageCount: "2",
            bills: [
              { merchantChiName: "虛構八月一" },
              { merchantChiName: "虛構八月二" },
            ],
          },
        };
      }
      // 2026/07 only answers the compact month format.
      if (rqData.month === "202607") {
        return {
          code: "0000",
          rsData: { bills: [{ merchantChiName: "虛構七月" }] },
        };
      }
      return { code: "E001", desc: "查無資料" };
    },
    monthPageHandler: (rqData) => ({
      code: "0000",
      rsData: {
        bills: [{ merchantChiName: `虛構八月第${rqData.pageNum}頁` }],
      },
    }),
  });

  const result = await collectCtbcPayloads(call, {
    log: (line) => lines.push(line),
  });
  const twd = result.payloads.creditCards.rsData.billData.TWD;
  assert.deepEqual(
    twd["2026/08"].bills.map((bill) => bill.merchantChiName),
    ["虛構八月一", "虛構八月二", "虛構八月第2頁"],
  );
  // The overview summary wins; the month response only fills missing fields.
  assert.equal(twd["2026/08"].summary.billAmt, 100);
  assert.equal(twd["2026/08"].summary.billDt, "081326");
  assert.deepEqual(
    twd["2026/07"].bills.map((bill) => bill.merchantChiName),
    ["虛構七月"],
  );
  assert.equal(twd["2026/05"].bills.length, 0);
  assert.deepEqual(result.statementMonthsUnavailable, []);
  assert.deepEqual(
    calls
      .filter((entry) =>
        [
          RESOURCES.creditCardMonthBills,
          RESOURCES.creditCardMonthBillsPage,
        ].includes(entry.resource),
      )
      .map((entry) => entry.rqData),
    [
      { curCode: "TWD", month: "2026/08" },
      { curCode: "TWD", month: "2026/08", pageNum: 2 },
      { curCode: "TWD", month: "2026/07" },
      { curCode: "TWD", month: "202607" },
    ],
  );
  assert.ok(lines.includes("  /twrbc-card/qu002/011 code=E001 筆數=0"));
  assert.equal(summarizePayloads(result).statementItems, 5);
});

test("collectCtbcPayloads keeps importing when month details are unavailable", async () => {
  const { call } = fakeBank({ creditCards: statementOverview() });
  const result = await collectCtbcPayloads(call);
  assert.deepEqual(result.statementMonthsUnavailable, ["2026/08", "2026/07"]);
  assert.equal(
    result.payloads.creditCards.rsData.billData.TWD["2026/08"].bills.length,
    0,
  );
  assert.equal(formatStatementMonth("2026/08"), "2026/08");
  assert.equal(formatStatementMonth("secret 1234"), "[month]");
});

function cardBillCapture(resource, rqData, response) {
  return { resource, rqData, response };
}

test("collectCtbcPayloads imports bill months the user viewed in the page, without replaying them", async () => {
  const lines = [];
  const { call, calls } = fakeBank({
    creditCards: statementOverview(),
    // 工具重送一律被拒；2026/07 沒有頁面結果，只能靠重送（失敗）。
    monthHandler: () => ({ code: "9999", desc: "系統忙碌" }),
    monthPageHandler: () => ({ code: "9999" }),
  });
  const pageCardBills = () => [
    cardBillCapture(
      RESOURCES.creditCardMonthBills,
      { curCode: "TWD", month: "2026/08" },
      {
        code: "0000",
        rsData: {
          summary: { billDt: "081326", billAmt: 999 },
          displayPaging: true,
          totalRow: "3",
          pageCount: "2",
          bills: [
            { merchantChiName: "虛構八月一" },
            { merchantChiName: "虛構八月二" },
          ],
        },
      },
    ),
    cardBillCapture(
      RESOURCES.creditCardMonthBillsPage,
      { curCode: "TWD", month: "2026/08", pageNum: 2 },
      { code: "0000", rsData: { bills: [{ merchantChiName: "虛構八月三" }] } },
    ),
  ];
  const result = await collectCtbcPayloads(call, {
    log: (line) => lines.push(line),
    pageCardBills,
  });
  const twd = result.payloads.creditCards.rsData.billData.TWD;
  assert.deepEqual(
    twd["2026/08"].bills.map((bill) => bill.merchantChiName),
    ["虛構八月一", "虛構八月二", "虛構八月三"],
  );
  assert.equal(twd["2026/08"].summary.billAmt, 100);
  assert.deepEqual(result.statementMonthsUnavailable, ["2026/07"]);
  assert.deepEqual(result.statementMonthsIncomplete, []);
  assert.ok(
    !calls.some(
      (entry) =>
        [
          RESOURCES.creditCardMonthBills,
          RESOURCES.creditCardMonthBillsPage,
        ].includes(entry.resource) && entry.rqData.month === "2026/08",
    ),
  );
  assert.ok(lines.includes("信用卡帳單 2026/08：使用頁面查詢結果 2 筆"));
});

test("collectCtbcPayloads reports a page-captured month whose later pages are missing", async () => {
  const { call } = fakeBank({
    creditCards: statementOverview(),
    monthPageHandler: () => ({ code: "9999" }),
  });
  const result = await collectCtbcPayloads(call, {
    pageCardBills: () => [
      cardBillCapture(
        RESOURCES.creditCardMonthBills,
        { curCode: "TWD", month: "2026/08" },
        {
          code: "0000",
          rsData: {
            displayPaging: true,
            totalRow: "3",
            pageCount: "2",
            bills: [
              { merchantChiName: "虛構八月一" },
              { merchantChiName: "虛構八月二" },
            ],
          },
        },
      ),
    ],
  });
  assert.equal(
    result.payloads.creditCards.rsData.billData.TWD["2026/08"].bills.length,
    2,
  );
  assert.deepEqual(result.statementMonthsIncomplete, ["2026/08"]);
});

test("pageStatementGroup matches the month in either format and ignores failed or other-currency captures", () => {
  const ok = (bills) => ({ code: "0000", rsData: { bills } });
  const captures = [
    cardBillCapture(
      RESOURCES.creditCardMonthBills,
      { curCode: "TWD", month: "202607" },
      ok([{ id: "old" }]),
    ),
    cardBillCapture(
      RESOURCES.creditCardMonthBills,
      { curCode: "TWD", month: "2026/07" },
      ok([{ id: "new" }]),
    ),
    cardBillCapture(
      RESOURCES.creditCardMonthBills,
      { curCode: "USD", month: "2026/07" },
      ok([{ id: "usd" }]),
    ),
    cardBillCapture(
      RESOURCES.creditCardMonthBills,
      { curCode: "TWD", month: "2026/07" },
      { code: "9999" },
    ),
  ];
  assert.deepEqual(pageStatementGroup(captures, "TWD", "2026/07").first.bills, [
    { id: "new" },
  ]);
  assert.equal(
    pageStatementGroup(captures, "TWD", "2026/07").first.month,
    "2026/07",
  );
  assert.deepEqual(pageStatementGroup(captures, "USD", "2026/07").first.bills, [
    { id: "usd" },
  ]);
  assert.equal(pageStatementGroup(captures, "TWD", "2026/06"), null);
});

test("pageStatementGroup uses captures without curCode only when the month has one currency", () => {
  const captures = [
    cardBillCapture(
      RESOURCES.creditCardMonthBills,
      { month: "2026/07" },
      { code: "0000", rsData: { bills: [{ id: "no-currency" }] } },
    ),
  ];
  assert.equal(pageStatementGroup(captures, "TWD", "2026/07"), null);
  assert.deepEqual(
    pageStatementGroup(captures, "TWD", "2026/07", {
      allowMissingCurrency: true,
    }).first.bills,
    [{ id: "no-currency" }],
  );
});

test("collectCtbcPayloads does not apply a capture without curCode to a month with two currencies", async () => {
  const overview = statementOverview();
  overview.rsData.billData.USD = {
    "2026/08": { summary: { billAmt: 10 }, bills: [] },
  };
  const lines = [];
  const { call } = fakeBank({
    creditCards: overview,
    monthHandler: () => ({ code: "9999" }),
  });
  const result = await collectCtbcPayloads(call, {
    log: (line) => lines.push(line),
    pageCardBills: () => [
      cardBillCapture(
        RESOURCES.creditCardMonthBills,
        { month: "2026/08" },
        { code: "0000", rsData: { bills: [{ merchantChiName: "不明幣別" }] } },
      ),
      cardBillCapture(
        RESOURCES.creditCardMonthBills,
        { curCode: "TWD", month: "2031/01" },
        { code: "0000", rsData: { bills: [] } },
      ),
    ],
  });
  const billData = result.payloads.creditCards.rsData.billData;
  assert.equal(billData.TWD["2026/08"].bills.length, 0);
  assert.equal(billData.USD["2026/08"].bills.length, 0);
  assert.deepEqual(result.statementMonthsUnavailable, [
    "2026/08",
    "2026/07",
    "2026/08",
  ]);
  assert.ok(lines.includes("頁面帳單查詢對不上帳單月份或幣別：2031/01/TWD"));
});

test("collectCtbcPayloads uses page-captured later pages of the latest statement", async () => {
  const overview = statementOverview();
  Object.assign(overview.rsData.billData.TWD["2026/09"], {
    displayPaging: true,
    totalRow: "2",
    pageCount: "1",
  });
  const { call, calls } = fakeBank({
    creditCards: overview,
    monthHandler: () => ({ code: "9999" }),
    monthPageHandler: () => ({ code: "9999" }),
  });
  const result = await collectCtbcPayloads(call, {
    pageCardBills: () => [
      cardBillCapture(
        RESOURCES.creditCardMonthBillsPage,
        { curCode: "TWD", month: "2026/09", pageNum: 2 },
        {
          code: "0000",
          rsData: { bills: [{ merchantChiName: "虛構最新一期第2頁" }] },
        },
      ),
    ],
  });
  assert.deepEqual(
    result.payloads.creditCards.rsData.billData.TWD["2026/09"].bills.map(
      (bill) => bill.merchantChiName,
    ),
    ["虛構最新一期", "虛構最新一期第2頁"],
  );
  assert.deepEqual(result.statementMonthsIncomplete, []);
  assert.ok(
    !calls.some(
      (entry) =>
        entry.resource === RESOURCES.creditCardMonthBillsPage &&
        entry.rqData.month === "2026/09",
    ),
  );
});

test("collectCtbcPayloads keeps later captured pages after a failed page replay", async () => {
  const { call, calls } = fakeBank({
    creditCards: statementOverview(),
    monthPageHandler: () => ({ code: "9999" }),
  });
  const result = await collectCtbcPayloads(call, {
    pageCardBills: () => [
      cardBillCapture(
        RESOURCES.creditCardMonthBills,
        { curCode: "TWD", month: "2026/08" },
        {
          code: "0000",
          rsData: {
            displayPaging: true,
            totalRow: "4",
            pageCount: "1",
            bills: [{ merchantChiName: "第1頁" }],
          },
        },
      ),
      cardBillCapture(
        RESOURCES.creditCardMonthBillsPage,
        { curCode: "TWD", month: "2026/08", pageNum: 3 },
        { code: "0000", rsData: { bills: [{ merchantChiName: "第3頁" }] } },
      ),
    ],
  });
  assert.deepEqual(
    result.payloads.creditCards.rsData.billData.TWD["2026/08"].bills.map(
      (bill) => bill.merchantChiName,
    ),
    ["第1頁", "第3頁"],
  );
  assert.deepEqual(result.statementMonthsIncomplete, ["2026/08"]);
  // 第 2 頁補查失敗後不再對第 4 頁送請求。
  assert.deepEqual(
    calls
      .filter(
        (entry) =>
          entry.resource === RESOURCES.creditCardMonthBillsPage &&
          entry.rqData.month === "2026/08",
      )
      .map((entry) => entry.rqData.pageNum),
    [2],
  );
});

test("collectCtbcPayloads keeps unbilled card information", async () => {
  const { call } = fakeBank();
  const result = await collectCtbcPayloads(call);
  assert.ok(Array.isArray(result.payloads.unbilled.rsData.cardInfos));
});

test("userDataDirPattern escapes regex characters and anchors the argument", () => {
  const pattern = new RegExp(userDataDirPattern("/Users/me/.ctbc (1)"));
  assert.ok(
    pattern.test("Chrome --user-data-dir=/Users/me/.ctbc (1) --no-first-run"),
  );
  assert.ok(pattern.test("Chrome --user-data-dir=/Users/me/.ctbc (1)"));
  assert.ok(!pattern.test("Chrome --user-data-dir=/Users/me/.ctbc (1)-old"));
  assert.ok(!pattern.test("Chrome --user-data-dir=/Users/me/Xctbc (1)"));
  assert.ok(!pattern.test("Chrome x--user-data-dir=/Users/me/.ctbc (1)"));
});

test("prepareFixedProfile creates a private directory and rejects unsafe ones", async () => {
  const { mkdtemp, chmod, writeFile, symlink, rm, access } =
    await import("node:fs/promises");
  const { tmpdir, hostname } = await import("node:os");
  const path = (await import("node:path")).default;
  const root = await mkdtemp(path.join(tmpdir(), "ctbc-profile-test-"));
  try {
    const fresh = path.join(root, "fresh");
    const release = await prepareFixedProfile(fresh);
    // 同一 profile 已被這次匯入鎖定時，另一次匯入不可使用。
    await assert.rejects(prepareFixedProfile(fresh), /另一次匯入/);
    await release();
    await (
      await prepareFixedProfile(fresh)
    )();

    // 鎖檔還沒寫入 PID（空的）時視為使用中；PID 已不存在時視為殘留。
    const lockFile = path.join(fresh, "ctbc-web-import.lock");
    await writeFile(lockFile, "");
    await assert.rejects(prepareFixedProfile(fresh), /另一次匯入/);
    await writeFile(lockFile, "99999999");
    await (
      await prepareFixedProfile(fresh)
    )();

    const open = path.join(root, "open");
    await (
      await prepareFixedProfile(open)
    )();
    await chmod(open, 0o755);
    await assert.rejects(prepareFixedProfile(open), CtbcWebImportError);

    // Chrome 仍在執行（PID 存在）時拒絕。
    const locked = path.join(root, "locked");
    await (
      await prepareFixedProfile(locked)
    )();
    await symlink(
      `${hostname()}-${process.pid}`,
      path.join(locked, "SingletonLock"),
    );
    await assert.rejects(prepareFixedProfile(locked), /已有 Chrome 開著/);

    // 同主機、程序已不存在的殘留鎖會被清掉。
    const stale = path.join(root, "stale");
    await (
      await prepareFixedProfile(stale)
    )();
    await symlink(`${hostname()}-99999999`, path.join(stale, "SingletonLock"));
    await (
      await prepareFixedProfile(stale)
    )();
    await assert.rejects(access(path.join(stale, "SingletonLock")));

    // 其他主機的鎖無法判斷，維持拒絕。
    const remote = path.join(root, "remote");
    await (
      await prepareFixedProfile(remote)
    )();
    await symlink("other-host-1", path.join(remote, "SingletonLock"));
    await assert.rejects(prepareFixedProfile(remote), /已有 Chrome 開著/);

    const file = path.join(root, "file");
    await writeFile(file, "");
    await assert.rejects(prepareFixedProfile(file), CtbcWebImportError);

    const link = path.join(root, "link");
    await symlink(fresh, link);
    await assert.rejects(prepareFixedProfile(link), CtbcWebImportError);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("AuthTokenTracker keeps the newest token regardless of classification order", () => {
  const tracker = new AuthTokenTracker();
  const send = (key) => {
    tracker.begin(key);
    return tracker.nextSeq();
  };
  // 頁面請求 A 帶 T1 送出，但取 postData 較慢；頁面請求 B 的回應先帶回 T2。
  const aRequest = send("s:a");
  const bRequest = send("s:b");
  tracker.classify("s:b", "page", "T1", bRequest);
  tracker.response("s:b", "T2", tracker.nextSeq());
  assert.equal(tracker.current, "T2");
  // A 晚分類，header 的舊 T1 不能蓋掉 T2。
  tracker.classify("s:a", "page", "T1", aRequest);
  assert.equal(tracker.current, "T2");

  // 回應比分類先到：暫存，分類成頁面請求後才套用。
  const cRequest = send("s:c");
  tracker.response("s:c", "T3", tracker.nextSeq());
  assert.equal(tracker.current, "T2");
  tracker.classify("s:c", "page", "T2", cRequest);
  assert.equal(tracker.current, "T3");

  // 回應與結束都早於分類：暫存的 token 不可被清掉。
  const dRequest = send("s:d");
  tracker.response("s:d", "T4", tracker.nextSeq());
  tracker.finished("s:d");
  tracker.classify("s:d", "page", "T3", dRequest);
  assert.equal(tracker.current, "T4");
  // 分類後已清除，晚到的事件不再套用。
  tracker.response("s:d", "late", tracker.nextSeq());
  assert.equal(tracker.current, "T4");

  // 工具自己的請求回應也算；登入或無關請求的回應丟棄；未登記的請求不追蹤。
  send("s:own");
  tracker.classify("s:own", "own");
  tracker.response("s:own", "T5", tracker.nextSeq());
  assert.equal(tracker.current, "T5");
  send("s:login");
  tracker.response("s:login", "X", tracker.nextSeq());
  tracker.classify("s:login", "ignored");
  tracker.response("s:unknown", "Y", tracker.nextSeq());
  tracker.finished("s:unknown");
  assert.equal(tracker.current, "T5");

  // 不同分頁相同 requestId 分開追蹤。
  send("t1:9");
  tracker.classify("t1:9", "ignored");
  const t2 = send("t2:9");
  tracker.classify("t2:9", "page", undefined, t2);
  tracker.response("t2:9", "T6", tracker.nextSeq());
  assert.equal(tracker.current, "T6");
});

function fakeCdp(handlers = {}) {
  const listeners = new Map();
  const sent = [];
  return {
    sent,
    on(method, handler) {
      listeners.set(method, [...(listeners.get(method) ?? []), handler]);
    },
    emit(method, params, sessionId) {
      for (const handler of listeners.get(method) ?? []) {
        handler(params, sessionId);
      }
    },
    async send(method, params, sessionId) {
      sent.push({ method, sessionId });
      return handlers[method] ? handlers[method](params, sessionId) : {};
    },
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function depositPostData(overrides = {}) {
  return JSON.stringify(
    pageBody({
      resource: RESOURCES.depositTransactions,
      rqData: { accountId: ACCOUNT_A, type: "m0" },
      ...overrides,
    }),
  );
}

async function startWatcher(handlers = {}) {
  let releasePostData = () => {};
  const cdp = fakeCdp({
    "Target.getTargets": () => ({ targetInfos: [] }),
    "Network.getRequestPostData": () =>
      new Promise((resolve) => {
        releasePostData = () => resolve({ postData: depositPostData() });
      }),
    "Network.getResponseBody": () => ({
      body: JSON.stringify({
        code: "0000",
        rsData: { detailList: [{ memo1: "虛構入帳" }] },
      }),
      base64Encoded: false,
    }),
    ...handlers,
  });
  const watcher = new RequestTemplateWatcher(cdp);
  await watcher.start();
  const request = (requestId, sessionId, postData) =>
    cdp.emit(
      "Network.requestWillBeSent",
      {
        requestId,
        request: {
          url: RESOURCE_URL,
          method: "POST",
          headers: pageHeaders,
          ...(postData === undefined ? { hasPostData: true } : { postData }),
        },
      },
      sessionId,
    );
  return { cdp, watcher, request, release: () => releasePostData() };
}

test("RequestTemplateWatcher captures a page deposit that finished before classification", async () => {
  const { cdp, watcher, request, release } = await startWatcher();
  request("r1", "s1");
  cdp.emit("Network.loadingFinished", { requestId: "r1" }, "s1");
  release();
  assert.equal(await watcher.waitForPageDeposit(1_000), true);
  assert.deepEqual(watcher.pageDeposits[0].rqData, {
    accountId: ACCOUNT_A,
    type: "m0",
  });
  assert.equal(await watcher.waitForQuiet(10, 1_000), true);
});

test("RequestTemplateWatcher captures the bill months the user opens in the page", async () => {
  const bill = (month) =>
    JSON.stringify(
      pageBody({
        resource: RESOURCES.creditCardMonthBills,
        rqData: { curCode: "TWD", month },
      }),
    );
  const { cdp, watcher, request } = await startWatcher({
    "Network.getResponseBody": () => ({
      body: JSON.stringify({
        code: "0000",
        rsData: { bills: [{ merchantChiName: "虛構消費" }] },
      }),
      base64Encoded: false,
    }),
  });
  assert.equal(watcher.observedDetailPage, false);
  request("r1", "s1", bill("2026/08"));
  await flush();
  assert.equal(watcher.observedDetailPage, true);
  cdp.emit("Network.loadingFinished", { requestId: "r1" }, "s1");
  assert.equal(await watcher.waitForQuiet(10, 1_000), true);
  assert.equal(watcher.pageCardBills.length, 1);
  assert.deepEqual(watcher.pageCardBills[0].rqData, {
    curCode: "TWD",
    month: "2026/08",
  });
  assert.equal(
    watcher.pageCardBills[0].resource,
    RESOURCES.creditCardMonthBills,
  );
  assert.equal(watcher.pageDeposits.length, 0);
  assert.equal(await watcher.waitForDetailPage(10), true);
});

test("RequestTemplateWatcher skips the body of a failed page deposit", async () => {
  const { cdp, watcher, request, release } = await startWatcher();
  request("r1", "s1");
  cdp.emit("Network.loadingFailed", { requestId: "r1" }, "s1");
  release();
  await flush();
  assert.ok(
    !cdp.sent.some((entry) => entry.method === "Network.getResponseBody"),
  );
  assert.equal(watcher.pageDeposits.length, 0);
  assert.equal(watcher.observedDepositQuery?.type, "m0");
  assert.equal(await watcher.waitForQuiet(10, 1_000), true);
});

test("RequestTemplateWatcher stops waiting on requests of a detached tab", async () => {
  const { cdp, watcher, request } = await startWatcher();
  request("r1", "s2", depositPostData());
  await flush();
  assert.equal(await watcher.waitForQuiet(10, 300), false);
  cdp.emit("Target.detachedFromTarget", { sessionId: "s2" });
  assert.equal(await watcher.waitForQuiet(10, 1_000), true);
});

test("RequestTemplateWatcher does not count the tool's own requests as page activity", async () => {
  const { watcher, request } = await startWatcher();
  watcher.markOwnRequest("own-tracking");
  request("r1", "s1", depositPostData({ trackingIxd: "own-tracking" }));
  await flush();
  assert.equal(await watcher.waitForQuiet(10, 1_000), true);
  assert.equal(watcher.observedDepositQuery, null);
  assert.equal(watcher.pageDeposits.length, 0);
});

test("RequestTemplateWatcher is not quiet while a finished request is still being classified", async () => {
  const { cdp, watcher, request, release } = await startWatcher();
  request("r1", "s1");
  cdp.emit("Network.loadingFinished", { requestId: "r1" }, "s1");
  assert.equal(await watcher.waitForQuiet(10, 300), false);
  release();
  assert.equal(await watcher.waitForQuiet(10, 1_000), true);
  assert.equal(watcher.pageDeposits.length, 1);
});

test("RequestTemplateWatcher settles when reading the response body fails", async () => {
  const { cdp, watcher, request } = await startWatcher({
    "Network.getResponseBody": () => Promise.reject(new Error("gone")),
  });
  request("r1", "s1", depositPostData());
  await flush();
  cdp.emit("Network.loadingFinished", { requestId: "r1" }, "s1");
  assert.equal(await watcher.waitForPageDeposit(300), false);
  assert.equal(await watcher.waitForQuiet(10, 1_000), true);
  assert.equal(watcher.pageDeposits.length, 0);
});
