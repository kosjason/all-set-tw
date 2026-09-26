import type {
  BankAccount,
  BankBalanceSnapshot,
  BankTransaction,
  CreditCardBill,
} from "@taiwan-fin-hub/core";
import { z } from "zod";
import { BANK_SYNC_MONTHS } from "./sync-window";

export const taishinConfigSchema = z.object({
  userId: z.string().min(1).optional(),
  account: z.string().min(1).optional(),
  password: z.string().min(1).optional(),
  sessionCookies: z.string().optional(),
  sessionCreatedAt: z.string().optional(),
  browserSessionId: z.string().optional(),
  browserSessionExpiresAt: z.string().optional(),
  captchaDigitCount: z.number().int().min(4).max(8).optional(),
  captcha: z
    .string()
    .regex(/^\d{4,8}$/)
    .optional(),
});

export type TaishinConfig = z.infer<typeof taishinConfigSchema>;

export function parseTaishinConfig(config: unknown): TaishinConfig {
  return taishinConfigSchema.parse(config);
}

export type TaishinCreditCardPayloads = {
  summary: unknown;
  overview?: unknown;
  bills: unknown[];
  realtime?: unknown;
};

export type TaishinCreditCardData = {
  bankAccounts: Array<Omit<BankAccount, "id" | "connectorId">>;
  bankBalanceSnapshots: Array<Omit<BankBalanceSnapshot, "id" | "connectorId">>;
  bankTransactions: Array<Omit<BankTransaction, "id" | "connectorId">>;
  creditCardBills: Array<Omit<CreditCardBill, "id" | "connectorId">>;
};

type JsonRecord = Record<string, unknown>;
type TransactionCandidate = Omit<
  BankTransaction,
  "id" | "connectorId" | "accountId" | "sourceId"
> & {
  matchKey: string;
  identityKey: string;
  cardLast4: string;
};

const ACCOUNT_SOURCE_ID = "credit:taishin:main";

export function parseTaishinCreditCardData(
  payloads: TaishinCreditCardPayloads,
  now = new Date(),
): TaishinCreditCardData {
  const summary = responseValue(payloads.summary);
  const summaryTwd = firstRecordValue(summary) ?? {};
  const overview = currentPaymentOverview(responseValue(payloads.overview));
  const billValues = payloads.bills
    .map(responseValue)
    .filter((value): value is JsonRecord => Boolean(value));
  const billEntries = billValues
    .flatMap((value) => {
      const bill = parseBill(value);
      return bill ? [{ value, bill }] : [];
    })
    .sort((left, right) =>
      right.bill.billingPeriod.localeCompare(left.bill.billingPeriod),
    );
  const currentBillEntry = billEntries[0];
  const currentBill = currentBillEntry?.value;
  const postedCandidates = billValues.flatMap(postedTransactions);
  const pendingCandidates = realtimeTransactions(
    responseValue(payloads.realtime),
  );
  const transactions = mergeTransactionLifecycle(
    postedCandidates,
    pendingCandidates,
  );
  const cardLast4s = Array.from(
    new Set(
      [...postedCandidates, ...pendingCandidates]
        .map((transaction) => transaction.cardLast4)
        .filter((value) => value !== "unknown"),
    ),
  ).sort();

  const statementAmount = optionalAbsoluteNumber(
    currentBill?.showCbalance ?? summaryTwd["OUT-STMT-BALANCE"],
  );
  const availableCredit = optionalNumber(summaryTwd["OUT-AVAIL-CREDIT"]);
  const creditLimit = optionalNumber(summaryTwd["OUT-CRLIMIT-PERM"]);
  const paymentDueDate = normalizeDate(currentBill?.showDueDate);
  const statementClosingDate = normalizeDate(currentBill?.showStmtDate);
  const overviewMatchesCurrentBill =
    overview?.billingPeriod != null &&
    overview.billingPeriod === currentBillEntry?.bill.billingPeriod;
  const paidAmount = overviewMatchesCurrentBill
    ? overview.paidAmount
    : undefined;
  const remainingDue =
    overviewMatchesCurrentBill && overview.statementAmount != null
      ? Math.max(overview.statementAmount - (paidAmount ?? 0), 0)
      : undefined;
  const asOfAt = now.toISOString();

  const bills = billEntries
    .map(({ bill }) =>
      overviewMatchesCurrentBill &&
      bill.billingPeriod === overview.billingPeriod
        ? {
            ...bill,
            paidAmount,
            isPaid: remainingDue === 0,
          }
        : bill,
    )
    .slice(0, BANK_SYNC_MONTHS);

  return {
    bankAccounts: [
      {
        sourceId: ACCOUNT_SOURCE_ID,
        institutionName: "台新銀行",
        accountName: "台新信用卡",
        accountType: "credit",
        currency: "TWD",
        creditLimit,
        raw: { cardLast4s },
      },
    ],
    bankBalanceSnapshots:
      currentBill && remainingDue != null
        ? [
            {
              accountId: ACCOUNT_SOURCE_ID,
              sourceId: `${ACCOUNT_SOURCE_ID}:${asOfAt.slice(0, 10)}`,
              balance: remainingDue > 0 ? -remainingDue : 0,
              availableBalance: availableCredit,
              statementBalance: statementAmount,
              paymentDueDate,
              statementClosingDate,
              noPaymentNeeded: remainingDue === 0,
              currency: "TWD",
              asOfAt,
              raw: {
                statementAmount,
                availableCredit,
                paymentDueDate,
                statementClosingDate,
              },
            },
          ]
        : [],
    bankTransactions: transactions.map((transaction) => ({
      ...transaction,
      accountId: ACCOUNT_SOURCE_ID,
    })),
    creditCardBills: bills.map((bill) => ({
      ...bill,
      accountId: ACCOUNT_SOURCE_ID,
    })),
  };
}

function parseBill(
  value: JsonRecord,
): Omit<CreditCardBill, "id" | "connectorId" | "accountId"> | undefined {
  const billingPeriod = normalizePeriod(value.showAccoutnYM);
  if (!billingPeriod) return undefined;
  const statementAmount = optionalAbsoluteNumber(value.showCbalance);
  const minimumPayment = optionalAbsoluteNumber(value.showMinPay);
  const paymentDueDate = normalizeDate(value.showDueDate);
  const statementClosingDate = normalizeDate(value.showStmtDate);
  return {
    sourceId: `taishin:card:statement:${billingPeriod}:TWD`,
    billingPeriod,
    statementAmount,
    minimumPayment,
    paymentDueDate,
    statementClosingDate,
    currency: "TWD",
    raw: {
      billingPeriod,
      statementAmount,
      minimumPayment,
      paymentDueDate,
      statementClosingDate,
    },
  };
}

function currentPaymentOverview(value: JsonRecord | undefined) {
  const cardInfoList = isRecord(value?.carInfoList)
    ? value.carInfoList
    : undefined;
  const twd = isRecord(cardInfoList?.["001"]) ? cardInfoList["001"] : undefined;
  const year = stringValue(twd?.BillYear).trim();
  const month = Number(stringValue(twd?.BillMon).trim());
  if (!/^\d{4}$/.test(year) || month < 1 || month > 12) return undefined;
  return {
    billingPeriod: `${year}-${String(month).padStart(2, "0")}`,
    statementAmount: optionalAbsoluteNumber(twd?.StmtBalance),
    paidAmount: optionalAbsoluteNumber(twd?.LstPymtAmt),
  };
}

function postedTransactions(value: JsonRecord): TransactionCandidate[] {
  const groups = Array.isArray(value.newAcctDetailList)
    ? value.newAcctDetailList.filter(isRecord)
    : [];
  const candidates: TransactionCandidate[] = [];
  for (const group of groups) {
    const cardLast4 = last4(stringValue(group.order)) ?? "unknown";
    const details = Array.isArray(group.detail)
      ? group.detail.filter(isRecord)
      : [];
    for (const detail of details) {
      const transactionDate = normalizeDate(detail.showOutTXNDate);
      const postedDate = normalizeDate(detail.showOutPostDate);
      const rawAmount = optionalNumber(detail.showOutAmt);
      if (!transactionDate || rawAmount == null || rawAmount === 0) continue;
      const description =
        stringValue(detail.showOutDesc).trim() || "台新信用卡交易";
      const amount = signedAmount(rawAmount, description);
      const currency = normalizeCurrency(detail.showOutCurrency);
      const matchKey = transactionMatchKey(
        currency,
        transactionDate,
        amount,
        cardLast4,
      );
      candidates.push({
        matchKey,
        identityKey: transactionIdentityKey(matchKey, description),
        cardLast4,
        authorizedAt: transactionDate,
        postedDate: postedDate ?? transactionDate,
        amount,
        currency,
        description,
        counterparty: description,
        status: "posted",
        raw: {
          cardLast4: cardLast4 === "unknown" ? undefined : cardLast4,
          transactionDate,
          postedDate: postedDate ?? transactionDate,
          description,
          amount,
          currency,
          country: stringValue(detail.showOutCountry).trim() || undefined,
        },
      });
    }
  }
  return candidates;
}

function realtimeTransactions(
  value: JsonRecord | undefined,
): TransactionCandidate[] {
  if (!value || !Array.isArray(value.fmtRealTxListMap)) return [];
  const candidates: TransactionCandidate[] = [];
  for (const group of value.fmtRealTxListMap.filter(isRecord)) {
    const cardName = stringValue(group.cardname);
    const cardLast4 = last4(cardName) ?? "unknown";
    const rows = Array.isArray(group.txlist) ? group.txlist : [];
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      const transactionDate = normalizeDate(row[0]);
      const time = stringValue(row[1]).trim();
      const description = stringValue(row[2]).trim() || "台新信用卡交易";
      const rawAmount = optionalNumber(row[3]);
      const country = stringValue(row[4]).trim();
      const authorizationResult = stringValue(row[5]).trim();
      if (
        !transactionDate ||
        rawAmount == null ||
        rawAmount === 0 ||
        !/成功|success|approved/i.test(authorizationResult)
      ) {
        continue;
      }
      const amount = signedAmount(rawAmount, description);
      const currency = "TWD";
      const authorizedAt = dateTimeWithTaipeiOffset(transactionDate, time);
      const matchKey = transactionMatchKey(
        currency,
        transactionDate,
        amount,
        cardLast4,
      );
      candidates.push({
        matchKey,
        identityKey: transactionIdentityKey(matchKey, description),
        cardLast4,
        authorizedAt,
        amount,
        currency,
        description,
        counterparty: description,
        status: "pending",
        raw: {
          cardLast4: cardLast4 === "unknown" ? undefined : cardLast4,
          authorizedAt,
          description,
          amount,
          currency,
          country: country || undefined,
          authorizationResult,
        },
      });
    }
  }
  return candidates;
}

/**
 * 台新即時消費（未入帳）的描述只有 MCC 類別（例如「餐飲」「百貨公司」），
 * 入帳後才出現商家名稱，所以不能用商家名稱配對。一筆入帳明細取代對應的
 * 即時消費後，即時消費不再輸出；入帳明細保留自己的識別（跨同步穩定），
 * 只在同一消費日時沿用即時消費的時間。已存過的即時消費由 Worker 在寫入時
 * 以相同規則清除（見 apps/worker/src/features/sync/taishin-lifecycle.ts）。
 */
function mergeTransactionLifecycle(
  posted: TransactionCandidate[],
  pending: TransactionCandidate[],
) {
  const pairs = new Map(
    pairTaishinTransactions(pending, posted, taishinTransactionMatchKind).map(
      ([pendingTransaction, postedTransaction]) => [
        postedTransaction,
        pendingTransaction,
      ],
    ),
  );
  const consumedPending = new Set(pairs.values());
  const candidates = [
    ...posted.map((transaction) => {
      const pendingTransaction = pairs.get(transaction);
      return pendingTransaction
        ? {
            ...transaction,
            authorizedAt: taishinPreferredAuthorizedAt(
              transaction.authorizedAt,
              pendingTransaction.authorizedAt,
            ),
          }
        : transaction;
    }),
    ...pending.filter((transaction) => !consumedPending.has(transaction)),
  ];
  const occurrences = new Map<string, number>();
  return candidates.map((transaction) => {
    const occurrence = (occurrences.get(transaction.identityKey) ?? 0) + 1;
    occurrences.set(transaction.identityKey, occurrence);
    return assignSourceId(transaction, occurrence);
  });
}

/** 授權碼相同時容許較晚請款；沒有授權碼時只接受消費日相差 3 天內。 */
export const TAISHIN_AUTHORIZATION_MATCH_DAYS = 31;
export const TAISHIN_FALLBACK_MATCH_DAYS = 3;

export type TaishinMatchKind =
  "authorization" | "identical" | "merchant" | "fallback";

export type TaishinMatchTransaction = {
  authorizedAt?: string;
  amount: number;
  currency: string;
  description?: string | null;
  raw?: unknown;
};

/**
 * 判斷一筆即時消費（pending）與一筆入帳明細（posted）是否可能是同一筆消費；
 * 一對一唯一由 {@link pairTaishinTransactions} 負責。
 *
 * - 幣別與帶正負號的金額必須相同；國外交易服務費等費用列一律不配。
 * - 兩邊都有授權碼時只看授權碼（相同且消費日差 ≤ 31 天）。
 * - 否則必須同卡末四碼、消費日差 ≤ 3 天；兩邊都有交易國別時國別也要相同。
 *   商家名稱相同或互相包含時視為較強的候選（`identical`／`merchant`）。
 */
export function taishinTransactionMatchKind(
  pending: TaishinMatchTransaction,
  posted: TaishinMatchTransaction,
): TaishinMatchKind | undefined {
  if (pending.currency !== posted.currency || pending.amount !== posted.amount)
    return undefined;
  if (
    isTaishinFeeRow(pending.description) ||
    isTaishinFeeRow(posted.description)
  )
    return undefined;
  const pendingRaw = isRecord(pending.raw) ? pending.raw : {};
  const postedRaw = isRecord(posted.raw) ? posted.raw : {};
  const days = purchaseDayDistance(pending.authorizedAt, posted.authorizedAt);
  if (days == null) return undefined;
  const pendingCode = stringValue(pendingRaw.authorizationCode).trim();
  const postedCode = stringValue(postedRaw.authorizationCode).trim();
  if (pendingCode && postedCode) {
    return pendingCode === postedCode &&
      days <= TAISHIN_AUTHORIZATION_MATCH_DAYS
      ? "authorization"
      : undefined;
  }
  const pendingCard = stringValue(pendingRaw.cardLast4).trim();
  if (
    !/^\d{4}$/.test(pendingCard) ||
    pendingCard !== stringValue(postedRaw.cardLast4).trim() ||
    days > TAISHIN_FALLBACK_MATCH_DAYS
  )
    return undefined;
  const pendingCountry = stringValue(pendingRaw.country).trim().toUpperCase();
  const postedCountry = stringValue(postedRaw.country).trim().toUpperCase();
  if (pendingCountry && postedCountry && pendingCountry !== postedCountry)
    return undefined;
  const pendingName = normalizeMerchantName(pending.description ?? undefined);
  if (
    days === 0 &&
    pendingName &&
    pendingName === normalizeMerchantName(posted.description ?? undefined)
  )
    return "identical";
  if (
    merchantNamesMatch(
      pending.description ?? undefined,
      posted.description ?? undefined,
    )
  )
    return "merchant";
  return "fallback";
}

/**
 * 一對一配對：依序只接受授權碼、商家名稱、最後才用同卡同額同日期的後備
 * 條件；任一方有兩個以上候選時不配對，避免把同額的兩筆消費誤合併。完全
 * 相同（同卡、同日、同額、同名）的多筆彼此無從區分，依出現順序逐一配對。
 */
export function pairTaishinTransactions<P, T>(
  pendings: readonly P[],
  posteds: readonly T[],
  kindOf: (pending: P, posted: T) => TaishinMatchKind | undefined,
): Array<[P, T]> {
  const pairs: Array<[P, T]> = [];
  const usedPending = new Set<P>();
  const usedPosted = new Set<T>();
  const accept = (pending: P, posted: T) => {
    pairs.push([pending, posted]);
    usedPending.add(pending);
    usedPosted.add(posted);
  };
  for (const pending of pendings) {
    const posted = posteds.find(
      (candidate) =>
        !usedPosted.has(candidate) &&
        kindOf(pending, candidate) === "identical",
    );
    if (posted) accept(pending, posted);
  }
  const passes: ReadonlyArray<ReadonlyArray<TaishinMatchKind>> = [
    ["authorization"],
    ["authorization", "identical", "merchant"],
    ["authorization", "identical", "merchant", "fallback"],
  ];
  for (const accepted of passes) {
    const openPending = pendings.filter((pending) => !usedPending.has(pending));
    const openPosted = posteds.filter((posted) => !usedPosted.has(posted));
    const candidates = openPending.map((pending) =>
      openPosted.filter((posted) => {
        const kind = kindOf(pending, posted);
        return kind != null && accepted.includes(kind);
      }),
    );
    openPending.forEach((pending, index) => {
      const matches = candidates[index]!;
      if (matches.length !== 1) return;
      const posted = matches[0]!;
      if (candidates.filter((group) => group.includes(posted)).length !== 1)
        return;
      accept(pending, posted);
    });
  }
  return pairs;
}

/** 入帳明細只有日期；同一消費日時沿用即時消費的時分秒。 */
export function taishinPreferredAuthorizedAt(
  postedAuthorizedAt: string | undefined,
  pendingAuthorizedAt: string | undefined,
) {
  if (
    hasTimeComponent(pendingAuthorizedAt) &&
    !hasTimeComponent(postedAuthorizedAt) &&
    postedAuthorizedAt &&
    purchaseDay(pendingAuthorizedAt!) === postedAuthorizedAt.slice(0, 10)
  )
    return pendingAuthorizedAt;
  return postedAuthorizedAt;
}

function isTaishinFeeRow(description: string | null | undefined) {
  return /國外交易服務費|國外交易手續費|海外交易服務費|手續費|服務費/.test(
    description ?? "",
  );
}

function purchaseDay(value: string) {
  const timestamp = hasTimeComponent(value) ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp)
    ? new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
    : value.slice(0, 10);
}

function purchaseDayDistance(
  left: string | undefined,
  right: string | undefined,
) {
  if (!left || !right) return undefined;
  const leftDay = Date.parse(`${purchaseDay(left)}T00:00:00Z`);
  const rightDay = Date.parse(`${purchaseDay(right)}T00:00:00Z`);
  if (!Number.isFinite(leftDay) || !Number.isFinite(rightDay)) return undefined;
  return Math.abs(leftDay - rightDay) / 86_400_000;
}

function hasTimeComponent(value: string | undefined) {
  return Boolean(value && /T\d{2}:\d{2}(?::\d{2})?/.test(value));
}

function assignSourceId(candidate: TransactionCandidate, occurrence: number) {
  const {
    matchKey: _matchKey,
    identityKey,
    cardLast4: _cardLast4,
    ...transaction
  } = candidate;
  return {
    ...transaction,
    sourceId: taishinTransactionSourceId(identityKey, occurrence),
    raw: {
      ...(candidate.raw as JsonRecord),
      duplicateOccurrence: occurrence,
    },
  };
}

function taishinTransactionSourceId(identityKey: string, occurrence: number) {
  return `taishin:card:tx:v2:${identityKey}:${occurrence}`;
}

function merchantNamesMatch(
  left: string | undefined,
  right: string | undefined,
) {
  const normalizedLeft = normalizeMerchantName(left);
  const normalizedRight = normalizeMerchantName(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;
  return (
    Math.min(normalizedLeft.length, normalizedRight.length) >= 4 &&
    (normalizedLeft.includes(normalizedRight) ||
      normalizedRight.includes(normalizedLeft))
  );
}

function normalizeMerchantName(value: string | undefined) {
  return (value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s()[\]{}（）【】〈〉《》,，.。:：/\\_-]+/g, "");
}

function responseValue(value: unknown): JsonRecord | undefined {
  if (!isRecord(value)) return undefined;
  if (Boolean(value.error)) {
    throw new Error("台新信用卡 API 回傳錯誤。");
  }
  return isRecord(value.value) ? value.value : undefined;
}

function firstRecordValue(value: JsonRecord | undefined) {
  if (!value) return undefined;
  return Object.values(value).find(isRecord);
}

function transactionMatchKey(
  currency: string,
  transactionDate: string,
  amount: number,
  cardLast4: string,
) {
  return [currency, transactionDate, amount, cardLast4].join(":");
}

function transactionIdentityKey(matchKey: string, description: string) {
  return [matchKey, normalizeMerchantName(description) || "unknown"].join(":");
}

function signedAmount(rawAmount: number, description: string) {
  const isCredit =
    rawAmount < 0 ||
    /退款|退貨|折抵|折讓|回饋|沖銷|繳款|自動轉帳扣繳|refund|credit|payment/i.test(
      description,
    );
  return isCredit ? Math.abs(rawAmount) : -Math.abs(rawAmount);
}

function normalizeCurrency(value: unknown) {
  const text = stringValue(value).trim().toUpperCase();
  if (!text || /新臺幣|台幣|臺幣|TWD|NTD/.test(text)) return "TWD";
  if (/美元|USD/.test(text)) return "USD";
  if (/日圓|日幣|JPY/.test(text)) return "JPY";
  if (/歐元|EUR/.test(text)) return "EUR";
  return text.length === 3 ? text : "TWD";
}

function normalizePeriod(value: unknown) {
  const text = stringValue(value).trim();
  const match = text.match(/(\d{4})[/-]?(\d{1,2})/);
  if (!match) return undefined;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return undefined;
  return `${match[1]}-${String(month).padStart(2, "0")}`;
}

function normalizeDate(value: unknown) {
  const text = stringValue(value).trim();
  const match = text.match(
    /(\d{4})(?:[/-](\d{1,2})[/-](\d{1,2})|(\d{2})(\d{2}))/,
  );
  if (!match) return undefined;
  const month = Number(match[2] ?? match[4]);
  const day = Number(match[3] ?? match[5]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  return `${match[1]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dateTimeWithTaipeiOffset(date: string, time: string) {
  const match = time.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return date;
  return `${date}T${String(Number(match[1])).padStart(2, "0")}:${match[2]}:${match[3] ?? "00"}+08:00`;
}

function optionalNumber(value: unknown) {
  if (typeof value === "number")
    return Number.isFinite(value) ? value : undefined;
  const text = stringValue(value)
    .replaceAll(",", "")
    .replace(/[^\d().+-]/g, "")
    .trim();
  if (!text) return undefined;
  const negative = /^\(.*\)$/.test(text);
  const number = Number(text.replace(/[()]/g, ""));
  if (!Number.isFinite(number)) return undefined;
  return negative ? -Math.abs(number) : number;
}

function optionalAbsoluteNumber(value: unknown) {
  const number = optionalNumber(value);
  return number == null ? undefined : Math.abs(number);
}

function last4(value: string) {
  return value.match(/(?:末四碼\s*[:：]?\s*|[*xX])(\d{4})\D*$/)?.[1];
}

function stringValue(value: unknown) {
  return value == null ? "" : String(value);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
