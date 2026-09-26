import assert from "node:assert/strict";
import { BANK_SYNC_MONTHS } from "../../src/sync-window";
import {
  ctbcTransactionMatchKind,
  ctbcTransactionsMatch,
  pairCtbcTransactions,
  parseCtbcConfig,
  parseCtbcData,
  type CtbcPayloads,
} from "../../src/ctbc";

assert.deepEqual(
  parseCtbcConfig({
    userId: "A123456789",
    account: "demo-user",
    password: "demo-password",
  }),
  {
    userId: "A123456789",
    account: "demo-user",
    password: "demo-password",
  },
);
assert.equal(BANK_SYNC_MONTHS, 3);

const payloads = {
  depositOverview: {
    rsData: {
      twdAcctSummaryResponse: {
        demDepBalSummaryResponse: {
          infoList: [
            {
              accountId: "123456789012",
              balance: "12,345",
              availableBalance: "12,000",
              acctType: "活期儲蓄存款",
              accountNickName: "日常帳戶",
              actDigSvType: "SAVING",
            },
          ],
        },
      },
    },
  },
  depositTransactions: {
    rsData: {
      detailList: [
        {
          sourceAccountId: "123456789012",
          acctId: "987654321000",
          trnDtFull: "2026/07/20 11:22:33",
          memo1: "薪資入帳",
          crAmt: "25,000",
          dbAmt: "0",
          balanceAmt: "37,345",
          defaultSeq: "001",
        },
        {
          sourceAccountId: "123456789012",
          acctId: "987654321001",
          trnDtFull: "2026/07/21",
          memo1: "ATM 提款",
          crAmt: "0",
          dbAmt: "1,000",
          balanceAmt: "36,345",
          defaultSeq: "002",
        },
      ],
    },
  },
  creditCards: {
    rsData: {
      cardDataList: [
        {
          cardNo: "4111111111113108",
          cardNoSuffixFour: "3108",
          positiveOrAttached: "正卡",
          cardName: "測試信用卡",
        },
      ],
      curDataList: [{ curName: "新臺幣", curCode: "TWD" }],
      billData: {
        TWD: {
          "202607": {
            summary: {
              currPmtAmt: "8,000",
              minPmtAmt: "800",
              pmtExpDt: "2026/08/05",
              billDt: "2026/07/20",
              prevBal: "10,000",
              billAmt: "10,000",
              pmtAmt: "2,000",
              adjust: "0",
            },
            bills: [
              {
                purchaseDt: "2026/07/08",
                postingDt: "2026/07/10",
                merchantChiName: "測試商店",
                occCurCode: "TWD",
                authCode: "AUTH001",
                foreignAmt: "350",
                clearingDt: "2026/07/10",
                purchaseCountry: "TW",
                cardNo: "4111111111113108",
                fullCardNo: "4111111111113108",
                acwRefNbr: "ACW-REF-001",
                merchAcct: "MERCHANT-ACCOUNT",
                ntAmt: "350",
                txCode: "SALE",
                sorting: "0001",
              },
              {
                purchaseDt: "2026/07/09",
                postingDt: "2026/07/11",
                merchantChiName: "網購退貨退款",
                occCurCode: "TWD",
                foreignAmt: "120",
                clearingDt: "2026/07/11",
                purchaseCountry: "TW",
                cardNo: "4111111111113108",
                ntAmt: "120",
                sorting: "0002",
              },
              {
                purchaseDt: "2026/07/12",
                postingDt: "2026/07/14",
                merchantChiName: "已入帳商店",
                occCurCode: "TWD",
                foreignAmt: "500",
                clearingDt: "2026/07/14",
                purchaseCountry: "TW",
                cardNo: "4111111111113108",
                ntAmt: "500",
                sorting: "0003",
              },
            ],
          },
        },
      },
    },
  },
  realtime: {
    rsData: {
      allItems: [
        {
          txnCountry: "TW",
          origCurCode: "TWD",
          authCode: "AUTH001",
          merchName: "測試商店",
          txnType: "消費",
          cardNo: "4111111111113108",
          txnDateTime: "2026/07/08 12:00:00",
          merchId: "MERCHANT-1",
          isDoubleCoinCard: false,
          mccCode: "5411",
          cardNoSuffixFour: "3108",
          acntholderId: "A123456789",
          txnDate: "20260708",
          txnAmt: "350",
          txnDateMMDD: "0708",
        },
        {
          txnCountry: "TW",
          origCurCode: "TWD",
          authCode: "AUTH002",
          merchName: "未入帳商店",
          txnType: "消費",
          cardNo: "4111111111113108",
          // More than three days after the posted 500, so the card/amount
          // fallback must not merge it with that posted row.
          txnDate: "20260720",
          txnAmt: "500",
          cardNoSuffixFour: "3108",
        },
      ],
      totalRow: { ignored: true },
      noMore: true,
    },
  },
};

const result = parseCtbcData(payloads, new Date("2026-07-29T00:00:00.000Z"));

assert.deepEqual(
  result.bankAccounts.map((account) => [account.sourceId, account.accountName]),
  [
    [result.bankAccounts[0]!.sourceId, "日常帳戶"],
    ["credit:ctbc:main", "中國信託信用卡（合併帳單）"],
    ["credit:ctbc:3108", "測試信用卡"],
  ],
);
assert.equal(result.bankBalanceSnapshots.length, 2);
assert.equal(result.bankBalanceSnapshots[1]?.accountId, "credit:ctbc:main");
assert.equal(result.creditCardBills[0]?.accountId, "credit:ctbc:main");
assert.ok(
  result.bankTransactions
    .filter((transaction) => transaction.accountId.startsWith("credit:"))
    .every((transaction) => transaction.accountId === "credit:ctbc:3108"),
);
assert.equal(result.bankTransactions.length, 6);
assert.equal(result.creditCardBills.length, 1);
// 本期應繳取 currPmtAmt；pmtAmt 是本期間繳掉的上期帳單，不可當作本期已繳。
assert.equal(result.creditCardBills[0]?.statementAmount, 8000);
assert.equal(result.creditCardBills[0]?.paidAmount, undefined);
assert.equal(result.creditCardBills[0]?.isPaid, undefined);
assert.equal(result.bankTransactions[0]?.amount, 25000);
assert.equal(result.bankTransactions[1]?.amount, -1000);
assert.equal(result.bankTransactions[2]?.amount, -350);
assert.equal(result.bankTransactions[3]?.amount, 120);
assert.equal(result.bankTransactions[4]?.amount, -500);
assert.equal(result.bankTransactions[4]?.status, "posted");
assert.equal(result.bankTransactions[0]?.postedDate, "2026-07-20");
assert.equal(
  result.bankTransactions[0]?.authorizedAt,
  "2026-07-20T11:22:33+08:00",
);
assert.equal(
  result.bankTransactions[2]?.authorizedAt,
  "2026-07-08T12:00:00+08:00",
);
const utcMillisPayloads = {
  ...payloads,
  realtime: {
    ...payloads.realtime,
    rsData: {
      ...payloads.realtime.rsData,
      allItems: payloads.realtime.rsData.allItems.map((item, index) =>
        index === 0
          ? { ...item, txnDateTime: "2026-07-08T12:00:00.000Z" }
          : item,
      ),
    },
  },
};
const utcMillisResult = parseCtbcData(
  utcMillisPayloads,
  new Date("2026-07-29T00:00:00.000Z"),
);
assert.equal(
  utcMillisResult.bankTransactions[2]?.authorizedAt,
  "2026-07-08T12:00:00.000Z",
);
assert.equal(
  utcMillisResult.bankTransactions[2]?.sourceId,
  result.bankTransactions[2]?.sourceId,
);
assert.equal(result.bankTransactions[5]?.amount, -500);
assert.equal(result.bankTransactions[5]?.status, "pending");
assert.notEqual(
  result.bankTransactions[4]?.sourceId,
  result.bankTransactions[5]?.sourceId,
);
assert.equal(result.bankBalanceSnapshots[1]?.balance, -8000);
assert.equal(result.bankBalanceSnapshots[1]?.statementBalance, 10000);
assert.equal(result.creditCardBills[0]?.minimumPayment, 800);

const repeated = parseCtbcData(payloads, new Date("2026-07-29T00:00:00.000Z"));
assert.deepEqual(
  repeated.bankTransactions.map((transaction) => transaction.sourceId),
  result.bankTransactions.map((transaction) => transaction.sourceId),
);

const serialized = JSON.stringify(result);
assert.doesNotMatch(
  serialized,
  /123456789012|987654321000|987654321001|4111111111113108|A123456789|AUTH-CARD-001|AUTH001|ACW-REF-001|MERCHANT-ACCOUNT|MERCHANT-1/,
);
assert.match(serialized, /3108/);

// Shapes observed in the App: MMDDYY statements and YYYYMMDD unbilled rows.
const observed = structuredClone(payloads);
const statement = observed.creditCards.rsData.billData.TWD["202607"];
statement.summary.billDt = "072026";
statement.summary.pmtExpDt = "080526";
statement.bills[0]!.purchaseDt = "070826";
statement.bills[0]!.postingDt = "071026";
statement.bills[0]!.clearingDt = "000000";
const fixed = parseCtbcData(observed);
assert.equal(fixed.bankTransactions[2]!.postedDate, "2026-07-10");
assert.equal(
  fixed.bankTransactions[2]!.authorizedAt,
  "2026-07-08T12:00:00+08:00",
);
assert.equal(fixed.creditCardBills[0]!.paymentDueDate, "2026-08-05");
assert.equal(fixed.bankBalanceSnapshots[1]!.statementClosingDate, "2026-07-20");
assert.ok(
  (fixed.bankTransactions[2]!.raw as Record<string, unknown>).legacySourceId,
);
const unbilled = parseCtbcData({
  ...observed,
  creditCards: {},
  unbilled: {
    rsData: {
      allItems: [
        {
          purchaseDt: "20260708",
          postingDt: "20260710",
          purchaseAmt: 350,
          description: "銀行正式商家名稱",
          sourceCurrency: "TWD",
          cardNoSuffixFour: "3108",
          authCode: "AUTH001",
          acwRefNbr: "REFERENCE-1",
        },
      ],
    },
  },
});
const purchase = unbilled.bankTransactions.find(
  (t) => t.status === "posted" && t.amount === -350,
)!;
assert.equal(purchase.description, "銀行正式商家名稱");
assert.equal(purchase.authorizedAt, "2026-07-08T12:00:00+08:00");
assert.equal(purchase.sourceId, result.bankTransactions[2]!.sourceId);
assert.doesNotMatch(JSON.stringify(unbilled), /AUTH001|REFERENCE-1/);

// Conflicting authorization codes and duplicate candidates cannot be merged.
const conflict = structuredClone(observed);
conflict.creditCards.rsData.billData.TWD["202607"].bills[0]!.authCode =
  "DIFFERENT";
assert.equal(
  parseCtbcData(conflict).bankTransactions.filter((t) => t.status === "pending")
    .length,
  2,
);
const ambiguous = structuredClone(observed);
ambiguous.creditCards.rsData.billData.TWD["202607"].bills.push({
  ...statement.bills[0]!,
});
assert.equal(
  parseCtbcData(ambiguous).bankTransactions.filter(
    (t) => t.status === "pending",
  ).length,
  2,
);

const midnight = structuredClone(observed);
midnight.realtime.rsData.allItems[0]!.txnDateTime = "2026-07-07T16:30:00.000Z";
assert.equal(
  parseCtbcData(midnight).bankTransactions[2]!.authorizedAt,
  "2026-07-07T16:30:00.000Z",
);
const invalidDate = structuredClone(observed);
invalidDate.creditCards.rsData.billData.TWD["202607"].bills[0]!.purchaseDt =
  "invalid";
invalidDate.creditCards.rsData.billData.TWD["202607"].bills[0]!.postingDt =
  "000000";
assert.throws(() => parseCtbcData(invalidDate), /日期或金額/);

const matchBase = {
  amount: -350,
  currency: "TWD",
  description: "測試商店",
  raw: { cardLast4: "3108", authorizationHash: "same-auth" },
};
assert.equal(
  ctbcTransactionsMatch(
    { ...matchBase, authorizedAt: "2026-07-08T12:00:00+08:00" },
    { ...matchBase, authorizedAt: undefined, postedDate: undefined },
  ),
  true,
);
// The same authorization may be captured days later (for example Apple
// subscriptions), but not more than a month apart.
assert.equal(
  ctbcTransactionMatchKind(
    { ...matchBase, authorizedAt: "2026-07-08T12:00:00+08:00" },
    { ...matchBase, authorizedAt: "2026-07-19" },
  ),
  "authorization",
);
assert.equal(
  ctbcTransactionsMatch(
    { ...matchBase, authorizedAt: "2026-07-08T12:00:00+08:00" },
    { ...matchBase, authorizedAt: "2026-08-20" },
  ),
  false,
);

// Card numbers and merchant names are not matching criteria.
const authorization = {
  ...matchBase,
  authorizedAt: "2026-09-09T19:02:00+08:00",
  raw: { cardLast4: "3108", authorizationHash: "same-auth" },
};
const cardlessPosted = {
  ...matchBase,
  authorizedAt: "2026-09-09",
  postedDate: "2026-09-10",
  description: "測試商店 TAIPEI TW",
  raw: { authorizationHash: "same-auth" },
};
for (const accepted of [
  cardlessPosted,
  {
    ...cardlessPosted,
    raw: { authorizationHash: "same-auth", cardLast4: "9999" },
  },
  { ...cardlessPosted, authorizedAt: undefined, postedDate: "2026-09-10" },
]) {
  assert.equal(ctbcTransactionsMatch(authorization, accepted), true);
  assert.equal(ctbcTransactionsMatch(accepted, authorization), true);
}
for (const rejected of [
  { ...cardlessPosted, raw: {} },
  { ...cardlessPosted, raw: { authorizationHash: "different" } },
  { ...cardlessPosted, authorizedAt: "2026-08-01" },
  { ...cardlessPosted, amount: 350 },
  { ...cardlessPosted, currency: "USD" },
])
  assert.equal(ctbcTransactionsMatch(authorization, rejected), false);
assert.equal(
  ctbcTransactionsMatch(
    { ...cardlessPosted, authorizedAt: undefined },
    { ...cardlessPosted, authorizedAt: undefined },
  ),
  true,
);
assert.equal(
  ctbcTransactionsMatch(
    { ...cardlessPosted, raw: {} },
    { ...cardlessPosted, raw: {} },
  ),
  false,
);

// Normalized authorization hashes that differ prove different purchases; a
// legacy row (hash of a suffixed code, no version) may still use the
// same-card/amount/≤3-day fallback.
const normalized = (hash: string, cardLast4 = "3108") => ({
  cardLast4,
  authorizationHash: hash,
  authorizationHashVersion: 2,
});
const fallbackBase = { ...matchBase, authorizedAt: "2026-09-09" };
assert.equal(
  ctbcTransactionMatchKind(
    { ...fallbackBase, raw: normalized("a") },
    { ...fallbackBase, raw: normalized("b") },
  ),
  undefined,
);
assert.equal(
  ctbcTransactionMatchKind(
    { ...fallbackBase, raw: normalized("a") },
    {
      ...fallbackBase,
      authorizedAt: "2026-09-11T23:00:00+08:00",
      raw: { cardLast4: "3108", authorizationHash: "legacy" },
    },
  ),
  "fallback",
);
for (const rejected of [
  { ...fallbackBase, authorizedAt: "2026-09-13", raw: { cardLast4: "3108" } },
  { ...fallbackBase, raw: { cardLast4: "9999" } },
  { ...fallbackBase, raw: { cardLast4: "0000" } },
  { ...fallbackBase, authorizedAt: undefined, raw: { cardLast4: "3108" } },
])
  assert.equal(
    ctbcTransactionMatchKind(
      { ...fallbackBase, raw: normalized("a") },
      rejected,
    ),
    undefined,
  );

// Pairing is one-to-one and prefers authorization codes over the fallback.
{
  const posted = [
    { ...fallbackBase, raw: normalized("a") },
    { ...fallbackBase, raw: { cardLast4: "3108" } },
  ];
  const pending = [
    { ...fallbackBase, authorizedAt: "2026-09-10", raw: normalized("a") },
    { ...fallbackBase, authorizedAt: "2026-09-08", raw: normalized("c") },
  ];
  assert.deepEqual(
    pairCtbcTransactions(posted, pending, ctbcTransactionMatchKind).map(
      ([left, right]) => [posted.indexOf(left), pending.indexOf(right)],
    ),
    [
      [0, 0],
      [1, 1],
    ],
  );
  // Two same-amount authorizations for one code-less posted row: no merge.
  assert.deepEqual(
    pairCtbcTransactions(
      [posted[1]!],
      pending.slice(1).concat({
        ...fallbackBase,
        raw: normalized("d"),
      }),
      ctbcTransactionMatchKind,
    ),
    [],
  );
}

// Observed lifecycle shapes (synthetic values): realtime `qu041` items versus
// unbilled `qu006` items and statement bills for the same purchases.
const CARD = "4444";
const realtimeItem = (
  authCode: string,
  txnDateTime: string,
  txnAmt: number,
  merchName: string,
) => ({
  authCode,
  merchName,
  txnType: "非實體卡交易",
  cardNo: `411111111111${CARD}`,
  cardNoSuffixFour: CARD,
  txnDateTime,
  txnDate: txnDateTime.slice(0, 10).replace(/\//g, ""),
  txnAmt,
});
const unbilledItem = (
  authCode: string,
  purchaseDt: string,
  postingDt: string,
  purchaseAmt: number,
  description: string,
) => ({
  authCode,
  purchaseDt,
  postingDt,
  purchaseAmt,
  description,
  cardNoSuffixFour: `${CARD}_0`,
  acwRefNbr: `REF-${authCode}-${purchaseAmt}`,
  txnKey: `KEY-${authCode}-${purchaseAmt}`,
  sourceCurrency: "TWD",
});
const lifecyclePayloads: CtbcPayloads = {
  depositOverview: {},
  depositTransactions: {},
  creditCards: {
    rsData: {
      cardDataList: [
        {
          cardNoSuffixFour: "1111_0",
          cardNo: "4111-11**-****-1111",
          cardName: "虛構甲卡",
          positiveOrAttached: "正卡",
        },
        {
          cardNoSuffixFour: `${CARD}_0`,
          cardNo: `4111-11**-****-${CARD}`,
          cardName: "虛構航空卡",
          positiveOrAttached: "正卡",
        },
        {
          cardNoSuffixFour: "2222_0",
          cardNo: "4111-11**-****-2222",
          cardName: "虛構乙卡",
          positiveOrAttached: "附卡",
        },
      ],
      billData: {
        TWD: {
          "2026/09": {
            summary: {
              billDt: "091326",
              pmtExpDt: "100326",
              billAmt: 5000,
              currPmtAmt: 5000,
              minPmtAmt: 500,
            },
            bills: [
              {
                purchaseDt: "090126",
                postingDt: "090326",
                ntAmt: 1200,
                authCode: "",
                merchantChiName: "虛構無授權碼商店",
                cardNo: `${CARD}_0`,
                fullCardNo: `4111-11**-****-${CARD}`,
                sorting: "0001",
              },
              {
                purchaseDt: "090326",
                postingDt: "090426",
                ntAmt: 150,
                authCode: "",
                merchantChiName: "虛構同額商店",
                cardNo: `${CARD}_0`,
                fullCardNo: `4111-11**-****-${CARD}`,
                sorting: "0002",
              },
              {
                purchaseDt: "090226",
                postingDt: "090226",
                ntAmt: -3000,
                authCode: "",
                merchantChiName: "本行扣繳",
                cardNo: "0000",
                fullCardNo: "0000-00**-****-0000",
                txCode: "20",
                sorting: "0003",
              },
            ],
          },
          // Previous statement whose details were fetched month by month.
          "2026/08": {
            summary: { date: "202608", billAmt: 800, pmtAmt: 800 },
            bills: [
              {
                purchaseDt: "080526",
                postingDt: "080726",
                ntAmt: 800,
                authCode: "444444",
                merchantChiName: "虛構八月商店",
                cardNo: "1111_0",
                fullCardNo: "4111-11**-****-1111",
                sorting: "0001",
              },
            ],
          },
        },
      },
    },
  },
  unbilled: {
    rsData: {
      allItems: [
        unbilledItem("111111", "20260912", "20260914", 6643, "虛構 AI 訂閱"),
        unbilledItem("111111", "20260912", "20260914", 100, "國外交易手續費"),
        unbilledItem("222222", "20260911", "20260914", 688, "虛構購物網"),
        unbilledItem("333333", "20260916", "20260921", 3400, "虛構電腦"),
      ],
      cardInfos: [
        {
          cardNoSuffixFour: "2222_0",
          cardName: "虛構乙卡",
          cardUnbillItemSumStr: "1,234",
        },
      ],
    },
  },
  realtime: {
    rsData: {
      allItems: [
        realtimeItem("111111", "2026/09/13 04:39", 6643, "暫無資訊"),
        realtimeItem(
          "222222 Y",
          "2026/09/11 01:01",
          688,
          "虛構購物網股份有限公司",
        ),
        realtimeItem("333333", "2026/09/15 22:16", 3400, "虛構電腦"),
        realtimeItem("555555", "2026/09/02 10:00", 1200, "虛構無授權碼商店"),
        realtimeItem("666666", "2026/09/03 12:00", 150, "虛構同額商店"),
        realtimeItem("777777", "2026/09/04 12:00", 150, "虛構同額商店"),
      ],
    },
  },
};
const lifecycle = parseCtbcData(
  lifecyclePayloads,
  new Date("2026-09-26T00:00:00.000Z"),
);
const cardRows = lifecycle.bankTransactions;
const rowsFor = (amount: number) =>
  cardRows.filter((transaction) => transaction.amount === amount);
// Each authorization is replaced by exactly one posted row.
for (const [amount, description, authorizedAt] of [
  [-6643, "虛構 AI 訂閱", "2026-09-13T04:39:00+08:00"],
  [-688, "虛構購物網", "2026-09-11T01:01:00+08:00"],
  [-3400, "虛構電腦", "2026-09-15T22:16:00+08:00"],
  [-1200, "虛構無授權碼商店", "2026-09-02T10:00:00+08:00"],
] as const) {
  const rows = rowsFor(amount);
  assert.equal(rows.length, 1, `${amount} should be merged`);
  assert.equal(rows[0]!.status, "posted");
  assert.equal(rows[0]!.description, description);
  assert.equal(rows[0]!.authorizedAt, authorizedAt);
  assert.equal(rows[0]!.accountId, `credit:ctbc:${CARD}`);
}
// A fee sharing the authorization code but not the amount stays separate.
assert.equal(rowsFor(-100).length, 1);
// Two same-amount authorizations near a code-less posted row are ambiguous.
assert.deepEqual(
  rowsFor(-150)
    .map((transaction) => transaction.status)
    .sort(),
  ["pending", "pending", "posted"],
);
// A stored authorization keeps its identity when its posted row arrives.
const pendingOnly = parseCtbcData({
  ...lifecyclePayloads,
  creditCards: {},
  unbilled: {},
});
assert.equal(
  pendingOnly.bankTransactions.find((t) => t.amount === -6643)!.sourceId,
  rowsFor(-6643)[0]!.sourceId,
);

// Statement details of previous months become posted transactions.
const august = rowsFor(-800);
assert.equal(august.length, 1);
assert.equal(august[0]!.postedDate, "2026-08-07");
assert.equal(august[0]!.accountId, "credit:ctbc:1111");

// Per-card accounts only for cards with activity; the combined bill, the
// snapshot and card-less payments live on the summary account.
const creditAccounts = lifecycle.bankAccounts.filter(
  (account) => account.accountType === "credit",
);
assert.deepEqual(
  creditAccounts.map((account) => [account.sourceId, account.accountName]),
  [
    ["credit:ctbc:main", "中國信託信用卡（合併帳單）"],
    [`credit:ctbc:${CARD}`, "虛構航空卡"],
    ["credit:ctbc:1111", "虛構甲卡"],
    ["credit:ctbc:2222", "虛構乙卡"],
  ],
);
assert.deepEqual((creditAccounts[0]!.raw as { cards: unknown[] }).cards, [
  {
    cardLast4: "1111",
    cardName: "虛構甲卡",
    positiveOrAttached: "正卡",
    hasActivity: true,
  },
  {
    cardLast4: CARD,
    cardName: "虛構航空卡",
    positiveOrAttached: "正卡",
    hasActivity: true,
  },
  {
    cardLast4: "2222",
    cardName: "虛構乙卡",
    positiveOrAttached: "附卡",
    hasActivity: true,
  },
]);
assert.deepEqual(
  lifecycle.creditCardBills.map((bill) => bill.sourceId),
  ["credit:ctbc:main:bill:2026-09", "credit:ctbc:main:bill:2026-08"],
);
assert.equal(
  lifecycle.bankBalanceSnapshots.find((s) => s.accountId.startsWith("credit:"))!
    .accountId,
  "credit:ctbc:main",
);
const payment = rowsFor(3000);
assert.equal(payment.length, 1);
assert.equal(payment[0]!.accountId, "credit:ctbc:main");

// Cards without any activity only appear in the summary card list.
const quiet = parseCtbcData({
  ...lifecyclePayloads,
  unbilled: {},
  realtime: {},
  creditCards: {
    rsData: {
      ...(lifecyclePayloads.creditCards as { rsData: object }).rsData,
      billData: {},
    },
  },
});
assert.deepEqual(
  quiet.bankAccounts.map((account) => account.sourceId),
  ["credit:ctbc:main"],
);
assert.equal(
  (quiet.bankAccounts[0]!.raw as { inactiveCardCount: number })
    .inactiveCardCount,
  3,
);
assert.doesNotMatch(
  JSON.stringify(lifecycle),
  /111111|222222|REF-|KEY-|411111111111/,
);

// 某期已繳金額取自下一期的 pmtAmt（本期間繳掉的上期帳單）。
const twoPeriods = parseCtbcData({
  ...payloads,
  creditCards: {
    rsData: {
      curDataList: [{ curName: "新臺幣", curCode: "TWD" }],
      billData: {
        TWD: {
          "202608": {
            summary: { currPmtAmt: "5,000", billAmt: "5,000", pmtAmt: "0" },
            bills: [],
          },
          "202609": {
            summary: {
              currPmtAmt: "3,000",
              billAmt: "4,000",
              adjust: "1,000",
              pmtAmt: "5,000",
            },
            bills: [],
          },
        },
      },
    },
  },
});
const billByPeriod = new Map(
  twoPeriods.creditCardBills.map((bill) => [bill.billingPeriod, bill]),
);
assert.equal(billByPeriod.get("2026-08")?.paidAmount, 5000);
assert.equal(billByPeriod.get("2026-08")?.isPaid, true);
assert.equal(billByPeriod.get("2026-09")?.statementAmount, 3000);
assert.equal(billByPeriod.get("2026-09")?.paidAmount, undefined);

console.log("CTBC connector self-check passed.");
