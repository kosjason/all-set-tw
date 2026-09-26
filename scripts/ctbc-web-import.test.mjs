import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRequestBody,
  collectCtbcPayloads,
  CtbcWebImportError,
  depositQueryStrategies,
  extractRequestTemplate,
  formatImportResult,
  formatResourceLog,
  formatStatementMonth,
  parseArgs,
  pickTemplateHeaders,
  redactMessage,
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

function overview(accountIds) {
  return {
    code: "0000",
    rsData: {
      twdAcctSummaryResponse: {
        demDepBalSummaryResponse: {
          infoList: accountIds.map((accountId, index) => ({
            accountId,
            balance: String(1000 * (index + 1)),
            accountNickName: "測試戶名",
          })),
        },
      },
    },
  };
}

function fakeBank({
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
        return overview([ACCOUNT_A, ACCOUNT_B]);
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

test("collectCtbcPayloads stops without importing when a required resource fails", async () => {
  const { call } = fakeBank({ failResource: RESOURCES.creditCardBills });
  await assert.rejects(collectCtbcPayloads(call), (error) => {
    assert.ok(error instanceof CtbcWebImportError);
    assert.match(error.message, /\/twrbc-card\/qu002\/010.*code=9991/);
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

test("collectCtbcPayloads keeps unbilled card information", async () => {
  const { call } = fakeBank();
  const result = await collectCtbcPayloads(call);
  assert.ok(Array.isArray(result.payloads.unbilled.rsData.cardInfos));
});
