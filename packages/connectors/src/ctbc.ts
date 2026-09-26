import type {
  BankAccount,
  BankBalanceSnapshot,
  BankTransaction,
  CreditCardBill,
} from "@taiwan-fin-hub/core";
import forge from "node-forge";
import { z } from "zod";
import { BANK_SYNC_MONTHS } from "./sync-window";

/** 中國信託行動銀行 API 連接器設定。機密欄位由 Worker 加密保存。 */
export const ctbcConfigSchema = z.object({
  userId: z.string().min(1).optional(),
  account: z.string().min(1).optional(),
  password: z.string().min(1).optional(),
});

export type CtbcConfig = z.infer<typeof ctbcConfigSchema>;

export function parseCtbcConfig(config: unknown): CtbcConfig {
  return ctbcConfigSchema.parse(config);
}

export type CtbcPayloads = {
  depositOverview: unknown;
  depositTransactions: unknown;
  creditCards: unknown;
  unbilled?: unknown;
  realtime?: unknown;
};

export type CtbcData = {
  bankAccounts: Array<Omit<BankAccount, "id" | "connectorId">>;
  bankBalanceSnapshots: Array<Omit<BankBalanceSnapshot, "id" | "connectorId">>;
  bankTransactions: Array<Omit<BankTransaction, "id" | "connectorId">>;
  creditCardBills: Array<Omit<CreditCardBill, "id" | "connectorId">>;
};

type JsonRecord = Record<string, unknown>;
type CtbcDepositAccount = {
  accountId: string;
  balance: number;
  availableBalance?: number;
  acctType?: string;
  accountNickName?: string;
  actDigSvType?: string;
};
type CreditCardGroup = {
  currency: string;
  currencyName?: string;
  billingPeriod: string;
  currentPayment?: number;
  minimumPayment?: number;
  paymentDueDate?: string;
  statementClosingDate?: string;
  statementAmount?: number;
  paidAmount?: number;
  adjustment?: number;
  raw: JsonRecord;
  bills: JsonRecord[];
};
type CtbcCardTransactionCandidate = Omit<
  BankTransaction,
  "id" | "connectorId" | "sourceId"
> & {
  matchKey: string;
  identityKey: string;
  legacyIdentityKey?: string;
};

const TWD = "TWD";

/**
 * Converts the observed CTBC response envelopes into the project's neutral
 * bank records. The parser deliberately accepts unknown payloads so the Worker
 * adapter can surface a protocol error separately without leaking responses.
 */
export function parseCtbcData(
  payloads: CtbcPayloads,
  now = new Date(),
): CtbcData {
  const deposits = parseDepositAccounts(payloads.depositOverview);
  const accountSourceIds = new Map(
    deposits.map((account) => [
      account.accountId,
      depositSourceId(account.accountId),
    ]),
  );

  const bankAccounts: CtbcData["bankAccounts"] = deposits.map((account) => ({
    sourceId: accountSourceIds.get(account.accountId)!,
    institutionName: "中國信託商業銀行",
    accountName: account.accountNickName || "中國信託存款帳戶",
    accountType: depositAccountType(account),
    currency: TWD,
    raw: sanitizeDepositAccount(account),
  }));
  const bankBalanceSnapshots: CtbcData["bankBalanceSnapshots"] = deposits.map(
    (account) => {
      const sourceId = accountSourceIds.get(account.accountId)!;
      return {
        accountId: sourceId,
        sourceId: `${sourceId}:${now.toISOString()}`,
        balance: account.balance,
        availableBalance: account.availableBalance,
        currency: TWD,
        asOfAt: now.toISOString(),
        raw: sanitizeDepositAccount(account),
      };
    },
  );

  const bankTransactions = parseDepositTransactions(
    payloads.depositTransactions,
    accountSourceIds,
  );
  const creditCardGroups = parseCreditCardGroups(payloads.creditCards)
    .sort(compareCreditCardGroups)
    .slice(0, BANK_SYNC_MONTHS * 8);
  const selectedGroups = selectGroupsByCurrency(creditCardGroups);
  const unbilledTransactions = parseUnbilledTransactions(payloads.unbilled);
  const realtimeTransactions = parseRealtimeTransactions(payloads.realtime);
  const cardTransactions = reconcileCreditCardLifecycle(
    [...parseCreditCardTransactions(selectedGroups), ...unbilledTransactions],
    realtimeTransactions,
  );
  const cardMetadata = parseCardMetadata(
    payloads.creditCards,
    payloads.unbilled,
  );
  bankAccounts.push(
    ...buildCreditCardAccounts(selectedGroups, cardTransactions, cardMetadata),
  );
  bankBalanceSnapshots.push(...buildCreditCardSnapshots(selectedGroups, now));

  // 中信帳單、應繳與最低應繳是所有卡片合併計算，掛在摘要帳戶。
  // 摘要的 billAmt 是本期新增消費，currPmtAmt 才是扣除調整後的本期應繳；
  // pmtAmt 是「本期間繳掉的上期帳單」，所以某期的已繳金額取自下一期的 pmtAmt。
  const creditCardBills = selectedGroups.map((group) => {
    const statementAmount = group.currentPayment ?? group.statementAmount;
    const paidAmount = creditCardGroups.find(
      (candidate) =>
        candidate.currency === group.currency &&
        candidate.billingPeriod === nextBillingPeriod(group.billingPeriod),
    )?.paidAmount;
    return {
      accountId: creditCardSummarySourceId(group.currency),
      sourceId: `${creditCardSummarySourceId(group.currency)}:bill:${group.billingPeriod}`,
      billingPeriod: group.billingPeriod,
      statementAmount,
      minimumPayment: group.minimumPayment,
      paidAmount,
      isPaid:
        statementAmount != null && statementAmount <= 0
          ? true
          : statementAmount != null && paidAmount != null
            ? paidAmount >= statementAmount
            : undefined,
      paymentDueDate: group.paymentDueDate,
      statementClosingDate: group.statementClosingDate,
      currency: group.currency,
      raw: sanitizeCreditCardGroup(group),
    };
  });
  bankTransactions.push(...cardTransactions);

  return {
    bankAccounts: dedupeBySourceId(bankAccounts),
    bankBalanceSnapshots: dedupeBySourceId(bankBalanceSnapshots),
    bankTransactions: dedupeBySourceId(bankTransactions),
    creditCardBills: dedupeBySourceId(creditCardBills),
  };
}

function parseDepositAccounts(payload: unknown): CtbcDepositAccount[] {
  const rsData = responseData(payload);
  const infoList = arrayAt(
    recordAt(
      recordAt(rsData, "twdAcctSummaryResponse"),
      "demDepBalSummaryResponse",
    ),
    "infoList",
  );
  return infoList.flatMap((value) => {
    if (!isRecord(value)) return [];
    const accountId = stringValue(value.accountId).trim();
    const balance = numberValue(value.balance);
    if (!accountId || balance == null) return [];
    return [
      {
        accountId,
        balance,
        availableBalance: numberValue(value.availableBalance),
        acctType: optionalString(value.acctType),
        accountNickName: optionalString(value.accountNickName),
        actDigSvType: optionalString(value.actDigSvType),
      },
    ];
  });
}

function parseDepositTransactions(
  payload: unknown,
  accountSourceIds: Map<string, string>,
) {
  const detailList = arrayAt(responseData(payload), "detailList");
  const occurrences = new Map<string, number>();
  return detailList.flatMap<Omit<BankTransaction, "id" | "connectorId">>(
    (value) => {
      if (!isRecord(value)) return [];
      // `acctId` is the counterparty account in CTBC's detail response. The
      // Worker adapter adds the selected account separately while the response
      // is still associated with its request envelope.
      const accountId = stringValue(value.sourceAccountId).trim();
      const rawDebit = numberValue(value.dbAmt) ?? 0;
      const rawCredit = numberValue(value.crAmt) ?? 0;
      const amount =
        rawCredit !== 0 ? Math.abs(rawCredit) : -Math.abs(rawDebit);
      if (!accountId || amount === 0) return [];
      const sourceAccountId =
        accountSourceIds.get(accountId) ?? depositSourceId(accountId);
      const postedDate = normalizeDate(value.trnDtFull) ?? undefined;
      const authorizedAt = normalizeTaipeiDateTime(value.trnDtFull);
      const description =
        optionalString(value.memo1) ||
        optionalString(value.passBookMemo) ||
        optionalString(value.memo2) ||
        "中國信託帳戶交易";
      const sourceKey = [
        sourceAccountId,
        postedDate ?? "",
        amount,
        description,
        stringValue(value.defaultSeq),
        numberValue(value.balanceAmt) ?? "",
      ].join(":");
      const occurrence = (occurrences.get(sourceKey) ?? 0) + 1;
      occurrences.set(sourceKey, occurrence);
      return [
        {
          accountId: sourceAccountId,
          sourceId: `ctbc:deposit:tx:${stableHash(sourceKey)}:${occurrence}`,
          postedDate,
          ...(authorizedAt ? { authorizedAt } : {}),
          amount,
          currency: TWD,
          description,
          counterparty: optionalString(value.memo2),
          status: "posted",
          raw: sanitizeDepositTransaction(value, accountId),
        },
      ];
    },
  );
}

function parseCreditCardGroups(payload: unknown): CreditCardGroup[] {
  const rsData = responseData(payload);
  const billData = recordAt(rsData, "billData");
  if (!isRecord(billData)) return [];
  const currencyNames = new Map(
    arrayAt(rsData, "curDataList").flatMap((value) => {
      if (!isRecord(value)) return [];
      const code = normalizeCurrency(value.curCode);
      return code ? [[code, optionalString(value.curName)] as const] : [];
    }),
  );
  const groups: CreditCardGroup[] = [];
  for (const [currencyKey, currencyValue] of Object.entries(billData)) {
    const currency = normalizeCurrency(currencyKey) ?? TWD;
    if (!isRecord(currencyValue)) continue;
    for (const [periodKey, groupValue] of Object.entries(currencyValue)) {
      if (!isRecord(groupValue)) continue;
      const summary = isRecord(groupValue.summary)
        ? groupValue.summary
        : groupValue;
      const billingPeriod =
        normalizeBillingPeriod(periodKey) ??
        billingPeriodFromDate(summary.billDt) ??
        billingPeriodFromDate(summary.pmtExpDt);
      if (!billingPeriod) continue;
      groups.push({
        currency,
        currencyName: currencyNames.get(currency),
        billingPeriod,
        currentPayment: numberValue(summary.currPmtAmt),
        minimumPayment: numberValue(summary.minPmtAmt),
        paymentDueDate: normalizeCardDate(summary.pmtExpDt) ?? undefined,
        statementClosingDate: normalizeCardDate(summary.billDt) ?? undefined,
        statementAmount: numberValue(summary.billAmt),
        paidAmount: numberValue(summary.pmtAmt),
        adjustment: numberValue(summary.adjust),
        raw: summary,
        bills: arrayAt(groupValue, "bills").filter(isRecord),
      });
    }
  }
  return groups;
}

function selectGroupsByCurrency(groups: CreditCardGroup[]) {
  const selected: CreditCardGroup[] = [];
  const byCurrency = new Map<string, CreditCardGroup[]>();
  for (const group of groups) {
    const list = byCurrency.get(group.currency) ?? [];
    list.push(group);
    byCurrency.set(group.currency, list);
  }
  for (const currencyGroups of byCurrency.values()) {
    selected.push(
      ...currencyGroups
        .sort(compareCreditCardGroups)
        .slice(0, BANK_SYNC_MONTHS),
    );
  }
  return selected;
}

type CtbcCardMetadata = {
  cardLast4: string;
  cardName?: string;
  positiveOrAttached?: string;
  hasUnbilledAmount: boolean;
};

/**
 * 每張有交易或有未出帳金額的實體卡各建一個帳戶；合併帳單、應繳與快照放在
 * 摘要帳戶，沒有消費的卡只記在摘要帳戶 raw 的卡片清單，不另建帳戶。
 */
function buildCreditCardAccounts(
  groups: CreditCardGroup[],
  transactions: Array<Pick<BankTransaction, "accountId" | "currency" | "raw">>,
  metadata: CtbcCardMetadata[],
) {
  const cardAccounts = new Map<
    string,
    { cardLast4: string; currency: string }
  >();
  const summaryCurrencies = new Set(groups.map((group) => group.currency));
  for (const transaction of transactions) {
    const raw = isRecord(transaction.raw) ? transaction.raw : {};
    const cardLast4 = physicalCardLast4(raw.cardLast4);
    if (
      cardLast4 &&
      transaction.accountId ===
        creditCardSourceId(cardLast4, transaction.currency)
    )
      cardAccounts.set(transaction.accountId, {
        cardLast4,
        currency: transaction.currency,
      });
    else summaryCurrencies.add(transaction.currency);
  }
  for (const card of metadata) {
    if (!card.hasUnbilledAmount) continue;
    const sourceId = creditCardSourceId(card.cardLast4, TWD);
    if (!cardAccounts.has(sourceId))
      cardAccounts.set(sourceId, { cardLast4: card.cardLast4, currency: TWD });
  }
  if (cardAccounts.size > 0 || metadata.length > 0) summaryCurrencies.add(TWD);

  const activeLast4s = new Set(
    Array.from(cardAccounts.values(), (card) => card.cardLast4),
  );
  const metadataByLast4 = new Map(
    metadata.map((card) => [card.cardLast4, card]),
  );
  const cards = [
    ...metadata.map((card) => card.cardLast4),
    ...Array.from(activeLast4s).filter((last4) => !metadataByLast4.has(last4)),
  ].map((cardLast4) => ({
    cardLast4,
    cardName: metadataByLast4.get(cardLast4)?.cardName,
    positiveOrAttached: metadataByLast4.get(cardLast4)?.positiveOrAttached,
    hasActivity: activeLast4s.has(cardLast4),
  }));

  const summaries = Array.from(summaryCurrencies, (currency) => ({
    sourceId: creditCardSummarySourceId(currency),
    institutionName: "中國信託商業銀行",
    accountName:
      currency === TWD
        ? "中國信託信用卡（合併帳單）"
        : `中國信託信用卡（合併帳單，${currency}）`,
    accountType: "credit" as const,
    currency,
    raw: {
      summary: true,
      cards,
      inactiveCardCount: cards.filter((card) => !card.hasActivity).length,
    },
  }));
  const physical = Array.from(
    cardAccounts,
    ([sourceId, { cardLast4, currency }]) => {
      const card = metadataByLast4.get(cardLast4);
      const name = card?.cardName || `中國信託信用卡 ${cardLast4}`;
      return {
        sourceId,
        institutionName: "中國信託商業銀行",
        accountName: currency === TWD ? name : `${name}（${currency}）`,
        accountType: "credit" as const,
        currency,
        raw: {
          cardLast4,
          cardName: card?.cardName,
          positiveOrAttached: card?.positiveOrAttached,
        },
      };
    },
  );
  return [...summaries, ...physical];
}

function buildCreditCardSnapshots(groups: CreditCardGroup[], now: Date) {
  const newestByCurrency = new Map<string, CreditCardGroup>();
  for (const group of groups.sort(compareCreditCardGroups)) {
    if (!newestByCurrency.has(group.currency))
      newestByCurrency.set(group.currency, group);
  }
  return Array.from(newestByCurrency.values()).map((group) => {
    const remainingDue = remainingDueForGroup(group);
    const sourceId = creditCardSummarySourceId(group.currency);
    return {
      accountId: sourceId,
      sourceId: `${sourceId}:${now.toISOString()}`,
      balance: remainingDue == null ? 0 : -Math.abs(remainingDue),
      statementBalance: group.statementAmount,
      availableBalance: undefined,
      paymentDueDate: group.paymentDueDate,
      statementClosingDate: group.statementClosingDate,
      noPaymentNeeded: remainingDue == null ? undefined : remainingDue === 0,
      currency: group.currency,
      asOfAt: now.toISOString(),
      raw: sanitizeCreditCardGroup(group),
    };
  });
}

function parseCreditCardTransactions(groups: CreditCardGroup[]) {
  const transactions: CtbcCardTransactionCandidate[] = [];
  for (const group of groups) {
    for (const bill of group.bills) {
      const purchaseDate = normalizeCardDate(bill.purchaseDt) ?? undefined;
      const postedDate =
        normalizeCardDate(bill.postingDt) ??
        normalizeCardDate(bill.clearingDt) ??
        purchaseDate;
      const description =
        optionalString(bill.description) ||
        optionalString(bill.merchantChiName) ||
        "中國信託信用卡消費";
      const rawAmount =
        group.currency === TWD
          ? numberValue(bill.ntAmt)
          : (numberValue(bill.foreignAmt) ?? numberValue(bill.ntAmt));
      if (rawAmount === 0) continue;
      if (rawAmount == null || !postedDate)
        throw new Error("中信已入帳明細日期或金額格式無法辨識。");
      const refund =
        rawAmount < 0 ||
        /退款|退貨|折讓|沖銷|回饋|繳款|refund|credit|payment/i.test(
          description,
        );
      const amount = refund ? Math.abs(rawAmount) : -Math.abs(rawAmount);
      // Identity keys keep the historical last-4 extraction so existing rows
      // keep their source IDs; account assignment uses the normalized card.
      const cardLast4 =
        last4(stringValue(bill.cardNoSuffixFour)) ??
        last4(stringValue(bill.cardNo)) ??
        last4(stringValue(bill.fullCardNo));
      const matchKey = [
        group.currency,
        purchaseDate ?? "",
        amount,
        cardLast4,
      ].join(":");
      const identityKey = [
        matchKey,
        normalizeMerchantName(description),
        stringValue(bill.sorting),
      ].join(":");
      transactions.push({
        accountId: cardTransactionAccountId(
          normalizedCardLast4(
            bill.cardNoSuffixFour,
            bill.cardNo,
            bill.fullCardNo,
          ),
          group.currency,
        ),
        postedDate,
        authorizedAt: purchaseDate,
        amount,
        currency: group.currency,
        description,
        counterparty: description,
        status: "posted",
        raw: sanitizeCreditCardTransaction(bill),
        matchKey,
        identityKey,
        legacyIdentityKey: [
          [
            group.currency,
            normalizeDate(bill.purchaseDt) ?? "",
            amount,
            cardLast4,
          ].join(":"),
          normalizeMerchantName(description),
          stringValue(bill.sorting),
        ].join(":"),
      });
    }
  }
  return transactions;
}

function parseRealtimeTransactions(payload: unknown) {
  const items = arrayAt(responseData(payload), "allItems");
  return items.flatMap<CtbcCardTransactionCandidate>((value) => {
    if (!isRecord(value)) return [];
    const transactionDate =
      normalizeDate(value.txnDate) ?? normalizeDate(value.txnDateTime);
    const authorizedAt =
      normalizeTaipeiDateTime(value.txnDateTime) ?? transactionDate;
    const rawAmount = numberValue(value.txnAmt);
    if (!transactionDate || rawAmount == null || rawAmount === 0) return [];
    const description = optionalString(value.merchName) || "中國信託信用卡消費";
    const transactionType = optionalString(value.txnType) ?? "";
    const refund =
      rawAmount < 0 ||
      /退款|退貨|折讓|沖銷|回饋|繳款|refund|credit|payment/i.test(
        `${description} ${transactionType}`,
      );
    const amount = refund ? Math.abs(rawAmount) : -Math.abs(rawAmount);
    const cardLast4 =
      last4(stringValue(value.cardNoSuffixFour)) ??
      last4(stringValue(value.cardNo));
    // Keep the established date-only match/source identity.  The realtime
    // timestamp is display metadata and must not create a second transaction
    // when the same authorization later appears in the posted feed.
    const matchKey = [TWD, transactionDate, amount, cardLast4].join(":");
    return [
      {
        accountId: cardTransactionAccountId(
          normalizedCardLast4(value.cardNoSuffixFour, value.cardNo),
          TWD,
        ),
        authorizedAt,
        amount,
        currency: TWD,
        description,
        counterparty: description,
        status: "pending",
        raw: sanitizeRealtimeTransaction(value),
        matchKey,
        identityKey: [
          matchKey,
          normalizeMerchantName(description),
          stringValue(value.authCode),
        ].join(":"),
      },
    ];
  });
}

function parseUnbilledTransactions(payload: unknown) {
  const items = arrayAt(responseData(payload), "allItems");
  return items.flatMap<CtbcCardTransactionCandidate>((value) => {
    if (!isRecord(value)) return [];
    const purchaseDate = normalizeCardDate(value.purchaseDt) ?? undefined;
    const postedDate = normalizeCardDate(value.postingDt) ?? purchaseDate;
    const rawAmount =
      numberValue(value.purchaseAmt) ??
      numberValue(value.ntAmt) ??
      numberValue(value.txnAmt);
    if (rawAmount === 0) return [];
    if (!postedDate || rawAmount == null)
      throw new Error("中信未出帳明細日期或金額格式無法辨識。");
    const description =
      optionalString(value.description) ||
      optionalString(value.merchantChiName) ||
      optionalString(value.merchName) ||
      "中國信託信用卡消費";
    const transactionType = optionalString(value.txnType) ?? "";
    const refund =
      rawAmount < 0 ||
      /退款|退貨|折讓|沖銷|回饋|繳款|refund|credit|payment/i.test(
        `${description} ${transactionType}`,
      );
    const amount = refund ? Math.abs(rawAmount) : -Math.abs(rawAmount);
    const currency =
      normalizeCurrency(value.sourceCurrency ?? value.curCode) ?? TWD;
    const cardLast4 =
      last4(stringValue(value.cardNoSuffixFour)) ??
      last4(stringValue(value.cardNo));
    const matchKey = [
      currency,
      purchaseDate ?? postedDate,
      amount,
      cardLast4,
    ].join(":");
    return [
      {
        accountId: cardTransactionAccountId(
          normalizedCardLast4(value.cardNoSuffixFour, value.cardNo),
          currency,
        ),
        postedDate,
        authorizedAt: purchaseDate,
        amount,
        currency,
        description,
        counterparty: description,
        status: "posted",
        raw: sanitizeCreditCardTransaction(value),
        matchKey,
        identityKey: [
          matchKey,
          normalizeMerchantName(description),
          stringValue(value.authCode),
          stringValue(value.acwRefNbr),
        ].join(":"),
      },
    ];
  });
}

function reconcileCreditCardLifecycle(
  posted: CtbcCardTransactionCandidate[],
  pending: CtbcCardTransactionCandidate[],
) {
  const pairs = new Map(
    pairCtbcTransactions(posted, pending, ctbcTransactionMatchKind),
  );
  const consumedPending = new Set(pairs.values());
  // A posted row replaces its authorization: it inherits the authorization's
  // identity (so a stored pending row is updated in place) and its time.
  const reconciledPosted = posted.map((transaction) => {
    const candidate = pairs.get(transaction);
    if (!candidate) return transaction;
    return {
      ...transaction,
      accountId:
        transaction.accountId ===
        creditCardSummarySourceId(transaction.currency)
          ? candidate.accountId
          : transaction.accountId,
      identityKey: candidate.identityKey,
      authorizedAt: preferredAuthorizedAt(
        transaction.authorizedAt,
        candidate.authorizedAt,
      ),
    };
  });
  const all = [
    ...reconciledPosted,
    ...pending.filter((transaction) => !consumedPending.has(transaction)),
  ];
  const occurrences = new Map<string, number>();
  const legacyOccurrences = new Map<string, number>();
  return all.map(
    ({
      matchKey: _matchKey,
      identityKey,
      legacyIdentityKey,
      ...transaction
    }) => {
      const occurrence = (occurrences.get(identityKey) ?? 0) + 1;
      occurrences.set(identityKey, occurrence);
      const legacyOccurrence = legacyIdentityKey
        ? (legacyOccurrences.get(legacyIdentityKey) ?? 0) + 1
        : 0;
      if (legacyIdentityKey)
        legacyOccurrences.set(legacyIdentityKey, legacyOccurrence);
      return {
        ...transaction,
        raw: {
          ...(isRecord(transaction.raw) ? transaction.raw : {}),
          ...(legacyIdentityKey
            ? {
                legacySourceId: `ctbc:card:tx:${stableHash(legacyIdentityKey)}:${legacyOccurrence}`,
              }
            : {}),
        },
        sourceId: `ctbc:card:tx:${stableHash(identityKey)}:${occurrence}`,
      };
    },
  );
}

function preferredAuthorizedAt(
  postedAuthorizedAt: string | undefined,
  pendingAuthorizedAt: string | undefined,
) {
  if (hasTimeComponent(pendingAuthorizedAt)) return pendingAuthorizedAt;
  if (hasTimeComponent(postedAuthorizedAt)) return postedAuthorizedAt;
  return pendingAuthorizedAt ?? postedAuthorizedAt;
}

function hasTimeComponent(value: string | undefined) {
  return Boolean(value && /T\d{2}:\d{2}(?::\d{2})?/.test(value));
}

type CtbcMatchTransaction = Pick<
  BankTransaction,
  "authorizedAt" | "amount" | "currency" | "description" | "raw"
> & {
  postedDate?: string;
};

/**
 * 授權碼相同時，授權（即時消費）可能晚好幾天才請款入帳（例如 Apple 月費），
 * 因此容許較長的消費日差距；沒有授權碼可比時只接受同卡、同金額且消費日
 * 相差不超過 3 天，並一律由呼叫端確認一對一唯一。
 */
const CTBC_AUTHORIZATION_MATCH_DAYS = 31;
const CTBC_FALLBACK_MATCH_DAYS = 3;
/** raw 中 `authorizationHash` 以正規化授權碼計算的版本；舊資料沒有此欄位。 */
const CTBC_AUTHORIZATION_HASH_VERSION = 2;

export type CtbcMatchKind = "authorization" | "fallback";

/**
 * Currency and signed amount must always agree. Equal authorization codes
 * match within {@link CTBC_AUTHORIZATION_MATCH_DAYS}; two normalized codes that
 * differ never match. Otherwise the same physical card and a purchase day at
 * most {@link CTBC_FALLBACK_MATCH_DAYS} apart is a weaker candidate. Callers
 * must enforce one-to-one uniqueness (see {@link pairCtbcTransactions}).
 */
export function ctbcTransactionMatchKind(
  left: CtbcMatchTransaction,
  right: CtbcMatchTransaction,
): CtbcMatchKind | undefined {
  if (left.currency !== right.currency || left.amount !== right.amount)
    return undefined;
  const l = isRecord(left.raw) ? left.raw : {};
  const r = isRecord(right.raw) ? right.raw : {};
  const leftHash = stringValue(l.authorizationHash);
  const rightHash = stringValue(r.authorizationHash);
  // Posting dates describe a different lifecycle event, not the purchase day.
  const days = purchaseDayDistance(left.authorizedAt, right.authorizedAt);
  if (leftHash && leftHash === rightHash)
    return days == null || days <= CTBC_AUTHORIZATION_MATCH_DAYS
      ? "authorization"
      : undefined;
  // Rows written before normalization hashed suffixed codes such as
  // `123456 Y`; only two normalized hashes prove different authorizations.
  if (
    leftHash &&
    rightHash &&
    l.authorizationHashVersion === CTBC_AUTHORIZATION_HASH_VERSION &&
    r.authorizationHashVersion === CTBC_AUTHORIZATION_HASH_VERSION
  )
    return undefined;
  const leftCard = physicalCardLast4(l.cardLast4);
  if (
    !leftCard ||
    leftCard !== physicalCardLast4(r.cardLast4) ||
    days == null ||
    days > CTBC_FALLBACK_MATCH_DAYS
  )
    return undefined;
  return "fallback";
}

/** Whether two CTBC card rows may describe the same purchase; callers enforce uniqueness. */
export function ctbcTransactionsMatch(
  left: CtbcMatchTransaction,
  right: CtbcMatchTransaction,
) {
  return ctbcTransactionMatchKind(left, right) != null;
}

/**
 * 一對一配對：先只用授權碼配對，再以剩下的列做後備比對。任一方有多個候選
 * 時不配對，避免把同金額的兩筆消費誤合併。
 */
export function pairCtbcTransactions<L, R>(
  lefts: readonly L[],
  rights: readonly R[],
  kindOf: (left: L, right: R) => CtbcMatchKind | undefined,
): Array<[L, R]> {
  const pairs: Array<[L, R]> = [];
  const usedLeft = new Set<L>();
  const usedRight = new Set<R>();
  const passes: ReadonlyArray<ReadonlyArray<CtbcMatchKind>> = [
    ["authorization"],
    ["authorization", "fallback"],
  ];
  for (const accepted of passes) {
    const openLefts = lefts.filter((left) => !usedLeft.has(left));
    const openRights = rights.filter((right) => !usedRight.has(right));
    const candidates = openLefts.map((left) =>
      openRights.filter((right) => {
        const kind = kindOf(left, right);
        return kind != null && accepted.includes(kind);
      }),
    );
    openLefts.forEach((left, index) => {
      const matches = candidates[index]!;
      if (matches.length !== 1) return;
      const right = matches[0]!;
      if (candidates.filter((group) => group.includes(right)).length !== 1)
        return;
      pairs.push([left, right]);
      usedLeft.add(left);
      usedRight.add(right);
    });
  }
  return pairs;
}

function purchaseDay(value: string) {
  const timestamp = value.includes("T") ? Date.parse(value) : NaN;
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

/**
 * 即時消費的授權碼有時帶後綴（例如 `123456 Y`），未出帳與帳單明細只有前段；
 * 取第一段作為比對用授權碼。
 */
function normalizeAuthCode(value: unknown) {
  const code = (
    stringValue(value).trim().split(/\s+/, 1)[0] ?? ""
  ).toUpperCase();
  return code && !/^0+$/.test(code) ? code : undefined;
}

function authorizationFields(value: unknown) {
  const code = normalizeAuthCode(value);
  return code
    ? {
        authorizationHash: forge.md.sha256
          .create()
          .update(code, "utf8")
          .digest()
          .toHex(),
        authorizationHashVersion: CTBC_AUTHORIZATION_HASH_VERSION,
      }
    : { authorizationHash: undefined };
}

function referenceHash(value: unknown) {
  const code = stringValue(value).trim();
  return code && !/^0+$/.test(code)
    ? forge.md.sha256.create().update(code, "utf8").digest().toHex()
    : undefined;
}

// Card statements use MMDDYY, while deposit and unbilled feeds use full years.
function normalizeCardDate(value: unknown) {
  const text = stringValue(value).trim();
  if (/^\d{6}$/.test(text)) {
    if (text === "000000") return undefined;
    return normalizeDate(
      `20${text.slice(4)}-${text.slice(0, 2)}-${text.slice(2, 4)}`,
    );
  }
  return normalizeDate(value);
}

/**
 * 帳單回應的 `cardDataList` 列出所有卡片；未出帳回應的 `cardInfos` 只列出有
 * 未出帳消費的卡並帶未出帳合計。兩者以正規化末四碼合併。
 */
function parseCardMetadata(creditCards: unknown, unbilled: unknown) {
  const cards = new Map<string, CtbcCardMetadata>();
  for (const value of [
    ...arrayAt(responseData(creditCards), "cardDataList"),
    ...arrayAt(responseData(unbilled), "cardInfos"),
  ]) {
    if (!isRecord(value)) continue;
    const cardLast4 = physicalCardLast4(
      normalizedCardLast4(value.cardNoSuffixFour, value.cardNo),
    );
    if (!cardLast4) continue;
    const previous = cards.get(cardLast4);
    const unbilledAmount = numberValue(value.cardUnbillItemSumStr) ?? 0;
    cards.set(cardLast4, {
      cardLast4,
      cardName: previous?.cardName ?? optionalString(value.cardName),
      positiveOrAttached:
        previous?.positiveOrAttached ??
        optionalString(value.positiveOrAttached),
      hasUnbilledAmount:
        Boolean(previous?.hasUnbilledAmount) ||
        unbilledAmount !== 0 ||
        arrayAt(value, "unbillItems").length > 0,
    });
  }
  return Array.from(cards.values());
}

function nextBillingPeriod(period: string) {
  const [year, month] = period.split("-").map(Number);
  if (!year || !month) return undefined;
  return month === 12
    ? `${year + 1}-01`
    : `${year}-${String(month + 1).padStart(2, "0")}`;
}

function remainingDueForGroup(group: CreditCardGroup) {
  if (group.currentPayment != null) return Math.max(0, group.currentPayment);
  if (group.statementAmount == null) return undefined;
  return Math.max(0, group.statementAmount - (group.adjustment ?? 0));
}

function sanitizeDepositAccount(account: CtbcDepositAccount) {
  return {
    accountLast4: last4(account.accountId),
    acctType: account.acctType,
    accountNickName: account.accountNickName,
    actDigSvType: account.actDigSvType,
  };
}

function sanitizeDepositTransaction(value: JsonRecord, accountId: string) {
  return {
    accountLast4: last4(accountId),
    trnDtFull: normalizeDate(value.trnDtFull),
    authorizedAt: normalizeTaipeiDateTime(value.trnDtFull),
    memo1: optionalString(value.memo1),
    memo2: optionalString(value.memo2),
    passBookMemo: optionalString(value.passBookMemo),
    defaultSeq: optionalString(value.defaultSeq),
    dbAmt: numberValue(value.dbAmt),
    crAmt: numberValue(value.crAmt),
    balanceAmt: numberValue(value.balanceAmt),
  };
}

function sanitizeCreditCardGroup(group: CreditCardGroup) {
  return {
    currency: group.currency,
    currencyName: group.currencyName,
    billingPeriod: group.billingPeriod,
    currPmtAmt: group.currentPayment,
    minPmtAmt: group.minimumPayment,
    pmtExpDt: group.paymentDueDate,
    billDt: group.statementClosingDate,
    prevBal: numberValue(group.raw.prevBal),
    billAmt: group.statementAmount,
    pmtAmt: group.paidAmount,
    adjust: group.adjustment,
  };
}

function sanitizeCreditCardTransaction(value: JsonRecord) {
  return {
    purchaseDt: normalizeCardDate(value.purchaseDt),
    postingDt: normalizeCardDate(value.postingDt),
    clearingDt: normalizeCardDate(value.clearingDt),
    merchantChiName:
      optionalString(value.description) ??
      optionalString(value.merchantChiName),
    ...authorizationFields(value.authCode),
    referenceHash: referenceHash(value.acwRefNbr),
    occCurCode: normalizeCurrency(value.occCurCode),
    foreignAmt: numberValue(value.foreignAmt),
    ntAmt: numberValue(value.purchaseAmt) ?? numberValue(value.ntAmt),
    cardLast4: normalizedCardLast4(
      value.cardNoSuffixFour,
      value.cardNo,
      value.fullCardNo,
    ),
    txCode: optionalString(value.txCode),
  };
}

function sanitizeRealtimeTransaction(value: JsonRecord) {
  return {
    ...authorizationFields(value.authCode),
    txnCountry: optionalString(value.txnCountry),
    origCurCode: normalizeCurrency(value.origCurCode ?? value.origCurCo),
    merchName: optionalString(value.merchName),
    txnType: optionalString(value.txnType),
    cardLast4: normalizedCardLast4(value.cardNoSuffixFour, value.cardNo),
    txnDateTime: optionalString(value.txnDateTime),
    isDoubleCoinCard: value.isDoubleCoinCard === true,
    mccCode: optionalString(value.mccCode),
    txnDate: normalizeDate(value.txnDate),
    txnAmt: numberValue(value.txnAmt),
    txnDateMMDD: optionalString(value.txnDateMMDD),
  };
}

function depositSourceId(accountId: string) {
  return `bank:ctbc:${last4(accountId) || "unknown"}:${stableHash(accountId)}`;
}

/** 實體卡帳戶；臺幣以外的幣別另建 `credit:ctbc:<末四碼>:<幣別>`。 */
function creditCardSourceId(cardLast4: string, currency: string) {
  return currency === TWD
    ? `credit:ctbc:${cardLast4}`
    : `credit:ctbc:${cardLast4}:${currency}`;
}

/** 合併帳單摘要帳戶；存放帳單、應繳快照、繳款與無法歸卡的明細。 */
function creditCardSummarySourceId(currency: string) {
  return currency === TWD ? "credit:ctbc:main" : `credit:ctbc:main:${currency}`;
}

function cardTransactionAccountId(
  cardLast4: string | undefined,
  currency: string,
) {
  const physical = physicalCardLast4(cardLast4);
  return physical
    ? creditCardSourceId(physical, currency)
    : creditCardSummarySourceId(currency);
}

/**
 * 中信卡號欄位可能是 `4444_0`（`_0` 為正附卡標記）、`4111-11**-****-4444`
 * 或完整卡號；去掉底線後綴再取末四碼。
 */
function normalizedCardLast4(...values: unknown[]) {
  for (const value of values) {
    const found = last4(stringValue(value).trim().replace(/_\d*$/, ""));
    if (found) return found;
  }
  return undefined;
}

/** 帳單的本行扣繳等列以 `0000` 表示不屬於任何實體卡。 */
function physicalCardLast4(value: unknown) {
  const text = stringValue(value);
  return /^\d{4}$/.test(text) && text !== "0000" ? text : undefined;
}

function depositAccountType(
  account: CtbcDepositAccount,
): "checking" | "savings" {
  const description = `${account.acctType ?? ""} ${account.actDigSvType ?? ""}`;
  return /支票|checking/i.test(description) ? "checking" : "savings";
}

function responseData(payload: unknown) {
  return recordAt(payload, "rsData");
}

function recordAt(value: unknown, key: string) {
  return isRecord(value) && isRecord(value[key]) ? value[key] : {};
}

function arrayAt(value: unknown, key: string) {
  return isRecord(value) && Array.isArray(value[key]) ? value[key] : [];
}

function compareCreditCardGroups(
  left: CreditCardGroup,
  right: CreditCardGroup,
) {
  return right.billingPeriod.localeCompare(left.billingPeriod);
}

function normalizeBillingPeriod(value: string) {
  const separated = value.match(/^(\d{3,4})[/-](\d{1,2})$/);
  if (separated)
    return periodFromParts(Number(separated[1]), Number(separated[2]));
  const compact = value.match(/^(\d{3,4})(\d{2})$/);
  return compact
    ? periodFromParts(Number(compact[1]), Number(compact[2]))
    : undefined;
}

function billingPeriodFromDate(value: unknown) {
  const normalized = normalizeDate(value);
  return normalized?.slice(0, 7);
}

function periodFromParts(year: number, month: number) {
  if (month < 1 || month > 12) return undefined;
  const fullYear = year < 1911 ? year + 1911 : year;
  return fullYear >= 2000 && fullYear <= 2200
    ? `${fullYear}-${String(month).padStart(2, "0")}`
    : undefined;
}

function normalizeDate(value: unknown) {
  const text = stringValue(value).trim();
  const dateText = (text.split(/[T\s]/, 1)[0] ?? "").replace(/\./g, "/");
  const separated = /^(\d{3,4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(dateText);
  const compact = /^(\d{3,4})(\d{2})(\d{2})$/.exec(dateText);
  const parts = separated ?? compact;
  if (!parts) return undefined;
  const year =
    Number(parts[1]) < 1911 ? Number(parts[1]) + 1911 : Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return undefined;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Normalize a provider date-time without changing the date-only identity used
 * by existing CTBC transactions.  CTBC's mobile responses normally omit an
 * offset and represent Taipei local time; an explicit provider offset is
 * retained when one is present.
 */
function normalizeTaipeiDateTime(value: unknown) {
  const text = stringValue(value).trim();
  const time =
    /^(.+?)[T ](\d{1,2})[:：](\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(?:\s*(Z|[+-]\d{2}:?\d{2}))?$/.exec(
      text,
    );
  if (!time) return undefined;
  const date = normalizeDate(time[1]);
  if (!date) return undefined;
  const hour = Number(time[2]);
  const minute = Number(time[3]);
  const second = Number(time[4] ?? 0);
  if (hour > 23 || minute > 59 || second > 59) return undefined;
  const suffix = normalizeOffset(time[6]);
  if (!suffix) return undefined;
  const fraction = time[5] ? "." + time[5].slice(0, 3).padEnd(3, "0") : "";
  return (
    date +
    "T" +
    String(hour).padStart(2, "0") +
    ":" +
    String(minute).padStart(2, "0") +
    ":" +
    String(second).padStart(2, "0") +
    fraction +
    suffix
  );
}

function normalizeOffset(value: string | undefined): string | undefined {
  if (!value) return "+08:00";
  if (value === "Z") return "Z";
  const match = /^([+-]\d{2}):?(\d{2})$/.exec(value);
  if (!match) return undefined;
  const hours = Number(match[1].slice(1));
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return undefined;
  return match[1] + ":" + match[2];
}

function normalizeCurrency(value: unknown) {
  const code = stringValue(value).trim().toUpperCase();
  if (!code || code === "000" || code === "NTD") return TWD;
  if (code === "840") return "USD";
  if (code === "392") return "JPY";
  if (code === "978") return "EUR";
  return /^[A-Z]{3}$/.test(code) ? code : undefined;
}

function numberValue(value: unknown) {
  if (typeof value === "number")
    return Number.isFinite(value) ? value : undefined;
  const normalized = stringValue(value)
    .trim()
    .replace(/[,$\s]/g, "")
    .replace(/^\((.*)\)$/, "-$1");
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(normalized)) return undefined;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : undefined;
}

function optionalString(value: unknown) {
  const result = stringValue(value).trim();
  return result || undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function last4(value: string) {
  return value.match(/(\d{4})\D*$/)?.[1];
}

function stableHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizeMerchantName(value: string) {
  return value.replace(/[\s\-_－—*＊()（）,.，。]/g, "").toLowerCase();
}

function dedupeBySourceId<T extends { sourceId: string }>(records: T[]) {
  return Array.from(
    new Map(records.map((record) => [record.sourceId, record])).values(),
  );
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
