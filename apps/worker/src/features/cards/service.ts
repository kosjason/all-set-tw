import {
  CONNECTOR_BANK_CODES,
  connectorCatalog,
  isConnectorId,
  isTaiwanBankCode,
  taiwanBankCodeFromText,
  type CardBill,
  type CardBillPayment,
  type CardBillsResponse,
  type CardEstimatedReason,
  type CardIssuerSummary,
  type CardSummaryCard,
  type CardsSummaryResponse,
  type CurrentCardBill,
} from "@taiwan-fin-hub/core";
import { loadBankRange } from "../bank/service";
import { getExchangeRates } from "../exchange-rates/service";
import {
  billingDay,
  cardPaymentSide,
  daysBetween,
  evaluateBill,
  mergeIssuerBills,
  normalizeDay,
  shiftDate,
  taipeiDate,
  transactionDay,
  type CardTransaction,
  type IssuerIdentity,
  type MergedBill,
} from "./billing";
import {
  listBillsForAccounts,
  listConnectorSyncStatuses,
  listCreditAccounts,
  listLatestCardSnapshots,
  listTransactionCardLast4,
  type CardBillRow,
  type CardSnapshotRow,
  type ConnectorSyncStatusRow,
  type CreditAccountRow,
} from "./repository";

/** 只能以半自動匯入更新的來源（中信網銀有防機器人機制，無法排程同步）。 */
export const MANUAL_IMPORT_CONNECTORS: ReadonlySet<string> = new Set(["ctbc"]);

/** 帳單歷史最多期數。 */
export const CARD_BILL_HISTORY_LIMIT = 12;

/** 載入交易時往前多抓的天數：刷卡日在結帳日前、入帳日在結帳日後的消費仍需看得到。 */
const TRANSACTION_LOOKBACK_DAYS = 10;

export class CardIssuerNotFoundError extends Error {
  constructor() {
    super("Card issuer not found.");
    this.name = "CardIssuerNotFoundError";
  }
}

type Issuer = {
  issuer: string;
  name: string;
  bankCode: string | null;
  accounts: CreditAccountRow[];
  identity: IssuerIdentity;
  bills: MergedBill[];
  snapshots: CardSnapshotRow[];
  syncStatus: ConnectorSyncStatusRow | undefined;
};

type CardDefinition = {
  key: string;
  account: CreditAccountRow;
  last4: string | null;
  name: string;
  /** 帳戶只對應一張卡，交易頁可以精準篩到這張卡。 */
  exact: boolean;
};

function issuerBankCode(connectorId: string, accounts: CreditAccountRow[]) {
  if (CONNECTOR_BANK_CODES[connectorId])
    return CONNECTOR_BANK_CODES[connectorId]!;
  for (const account of accounts) {
    if (isTaiwanBankCode(account.bankCode)) return account.bankCode;
    const code = taiwanBankCodeFromText(account.institutionName);
    if (code) return code;
  }
  return null;
}

function issuerName(connectorId: string, accounts: CreditAccountRow[]) {
  return isConnectorId(connectorId)
    ? connectorCatalog[connectorId].title
    : (accounts[0]?.institutionName ?? connectorId);
}

function pickSyncStatus(rows: ConnectorSyncStatusRow[], connectorId: string) {
  const candidates = rows.filter((row) => row.connectorId === connectorId);
  return candidates.find((row) => row.scope === "all") ?? candidates[0];
}

async function loadIssuers(db: D1Database, only?: string): Promise<Issuer[]> {
  const accounts = (await listCreditAccounts(db)).filter(
    (account) => !only || account.connectorId === only,
  );
  const accountIds = accounts.map((account) => account.id);
  const [billRows, snapshots, statuses] = await Promise.all([
    listBillsForAccounts(db, accountIds),
    listLatestCardSnapshots(db, accountIds),
    listConnectorSyncStatuses(db, [
      ...new Set(accounts.map((account) => account.connectorId)),
    ]),
  ]);
  const grouped = new Map<string, CreditAccountRow[]>();
  for (const account of accounts) {
    const list = grouped.get(account.connectorId) ?? [];
    list.push(account);
    grouped.set(account.connectorId, list);
  }
  return [...grouped.entries()].map(([connectorId, issuerAccounts]) => {
    const ids = new Set(issuerAccounts.map((account) => account.id));
    const bankCode = issuerBankCode(connectorId, issuerAccounts);
    return {
      issuer: connectorId,
      name: issuerName(connectorId, issuerAccounts),
      bankCode,
      accounts: issuerAccounts,
      identity: { accountIds: ids, bankCode },
      bills: mergeIssuerBills(
        billRows.filter((row: CardBillRow) => ids.has(row.accountId)),
      ),
      snapshots: snapshots.filter((row) => ids.has(row.accountId)),
      syncStatus: pickSyncStatus(statuses, connectorId),
    };
  });
}

function parseJsonArray(value: string | null): unknown[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function last4Of(value: unknown) {
  return typeof value === "string"
    ? (value.match(/^\d{4}$/)?.[0] ?? null)
    : null;
}

function accountDisplayName(account: CreditAccountRow) {
  return account.accountName ?? account.institutionName ?? "信用卡";
}

/**
 * 發卡行底下的卡片：
 * - 一個帳戶一張卡（國泰實體卡帳戶 `credit:cathaybk:1234`）：末四碼取自帳戶。
 * - 多張卡共用帳戶（中信 raw `cards`、台新 raw `cardLast4s`）：依 raw 卡片清單拆分，
 *   交易以 raw_payload 的 `cardLast4` 歸卡。
 * - 國泰多卡摘要帳戶（`credit:cathaybk:main`）只放帳單與繳款；它的 raw 也列出
 *   `cardLast4s`，但這些卡已有自己的帳戶，不重複列出。沒有消費時不列為卡片。
 */
function cardDefinitions(accounts: CreditAccountRow[]) {
  const definitions: CardDefinition[] = [];
  const multiCardAccounts = new Set<string>();
  const ownAccountLast4 = new Map<string, string>();
  for (const account of accounts) {
    const last4 =
      last4Of(account.accountLast4) ??
      account.sourceId.match(/(?:^|[^\d])(\d{4})$/)?.[1] ??
      null;
    if (last4) ownAccountLast4.set(account.id, last4);
  }
  const coveredLast4 = new Set(ownAccountLast4.values());
  for (const account of accounts) {
    const single = ownAccountLast4.get(account.id);
    if (single) {
      definitions.push({
        key: `${account.id}:${single}`,
        account,
        last4: single,
        name: accountDisplayName(account).includes(single)
          ? accountDisplayName(account)
          : `${accountDisplayName(account)} ${single}`,
        exact: true,
      });
      continue;
    }
    const listed = [
      ...parseJsonArray(account.rawCards).map((card) => {
        const record =
          card && typeof card === "object"
            ? (card as Record<string, unknown>)
            : {};
        return {
          last4: last4Of(record.cardLast4),
          cardName:
            typeof record.cardName === "string" && record.cardName.trim()
              ? record.cardName.trim()
              : null,
        };
      }),
      ...parseJsonArray(account.rawCardLast4s).map((value) => ({
        last4: last4Of(value),
        cardName: null,
      })),
    ].filter(
      (card, index, all) =>
        card.last4 &&
        !coveredLast4.has(card.last4) &&
        all.findIndex((other) => other.last4 === card.last4) === index,
    );
    if (listed.length === 0) continue;
    multiCardAccounts.add(account.id);
    for (const card of listed)
      definitions.push({
        key: `${account.id}:${card.last4}`,
        account,
        last4: card.last4,
        name: `${card.cardName ?? accountDisplayName(account)} ${card.last4}`,
        exact: false,
      });
  }
  return { definitions, multiCardAccounts };
}

function toTwd(
  amount: number,
  currency: string,
  rates: ReadonlyMap<string, number>,
) {
  if (amount === 0 || currency === "TWD") return amount;
  const rate = rates.get(currency);
  return rate != null && Number.isFinite(rate) && rate > 0
    ? amount * rate
    : undefined;
}

const round = (value: number) => Math.round(value * 100) / 100 || 0;

type LoadedTransactions = {
  transactions: CardTransaction[];
  rates: ReadonlyMap<string, number>;
};

async function loadCardTransactions(
  db: D1Database,
  from: string,
  to: string,
): Promise<LoadedTransactions> {
  const [bank, rates] = await Promise.all([
    loadBankRange(db, { from, to }),
    getExchangeRates(db),
  ]);
  return {
    transactions: bank.transactions.map((transaction) => ({
      id: transaction.id,
      accountId: transaction.accountId,
      accountType: transaction.accountType,
      amount: transaction.amount,
      currency: transaction.currency,
      status: transaction.status,
      postedDate: transaction.postedDate,
      authorizedAt: transaction.authorizedAt,
      description: transaction.description,
      counterparty: transaction.counterparty,
      counterpartyBankCode: transaction.counterpartyBankCode,
      economicRole: transaction.economicRole,
      duplicateOf: transaction.duplicateOf,
    })),
    rates: new Map(rates.map((rate) => [rate.currency, rate.rateTwd])),
  };
}

/** (after, until] 區間內配對到此發卡行的繳款。 */
function paymentsBetween(
  transactions: CardTransaction[],
  issuer: IssuerIdentity,
  after: string | null,
  until: string | null,
): CardBillPayment[] {
  const payments: CardBillPayment[] = [];
  for (const transaction of transactions) {
    const side = cardPaymentSide(transaction, issuer);
    if (!side) continue;
    const day = transactionDay(transaction);
    if (!day || (after && day <= after) || (until && day > until)) continue;
    payments.push({
      transactionId: transaction.id,
      date: day,
      amount: Math.abs(transaction.amount),
      side,
      description: transaction.description ?? transaction.counterparty,
    });
  }
  return payments;
}

/** 該期（上期結帳日, 本期結帳日] 的刷卡淨額，供來源沒有帳單總額時推估。 */
function estimateStatementAmount(
  transactions: CardTransaction[],
  issuer: IssuerIdentity,
  previousClosing: string,
  closing: string,
  rates: ReadonlyMap<string, number>,
) {
  let total = 0;
  for (const transaction of transactions) {
    if (!issuer.accountIds.has(transaction.accountId)) continue;
    if (transaction.economicRole !== "spending" || transaction.duplicateOf)
      continue;
    const day = billingDay(transaction);
    if (day <= previousClosing || day > closing) continue;
    const amount = toTwd(transaction.amount, transaction.currency, rates);
    if (amount == null) return null;
    total -= amount;
  }
  return round(Math.max(total, 0));
}

/**
 * 帳單的應繳金額：帳單總額 → 同一結帳日的餘額快照應繳 → 以刷卡明細推估。
 */
function billInput(
  bill: MergedBill,
  previousClosing: string | null,
  context: {
    snapshots?: CardSnapshotRow[];
    transactions: CardTransaction[];
    issuer: IssuerIdentity;
    rates: ReadonlyMap<string, number>;
  },
) {
  let statementAmount = bill.statementAmount;
  let statementEstimated = false;
  let paymentDueDate = bill.paymentDueDate;
  let statementClosingDate = bill.statementClosingDate;
  let sourceIsPaid = bill.sourceIsPaid;
  for (const snapshot of context.snapshots ?? []) {
    const snapshotClosing = normalizeDay(snapshot.statementClosingDate);
    const sameStatement =
      !snapshotClosing ||
      !statementClosingDate ||
      snapshotClosing === statementClosingDate;
    if (!sameStatement) continue;
    if (statementAmount == null && snapshot.statementBalance != null)
      statementAmount = Math.abs(snapshot.statementBalance);
    paymentDueDate ??= normalizeDay(snapshot.paymentDueDate);
    statementClosingDate ??= snapshotClosing;
    const observedAfterClosing =
      !statementClosingDate ||
      taipeiDate(snapshot.asOfAt) > statementClosingDate;
    if (snapshot.noPaymentNeeded === 1 && observedAfterClosing)
      sourceIsPaid = true;
  }
  if (statementAmount == null && previousClosing && statementClosingDate) {
    const estimate = estimateStatementAmount(
      context.transactions,
      context.issuer,
      previousClosing,
      statementClosingDate,
      context.rates,
    );
    if (estimate != null) {
      statementAmount = estimate;
      statementEstimated = true;
    }
  }
  return {
    billingPeriod: bill.billingPeriod,
    currency: bill.currency,
    statementAmount,
    statementEstimated,
    minimumPayment: bill.minimumPayment,
    paymentDueDate,
    statementClosingDate,
    sourcePaidAmount: bill.sourcePaidAmount,
    sourceIsPaid,
  };
}

/** 帳單的繳款區間起點（不含）：結帳日；沒有結帳日時以帳單月份 1 日前一天估計。 */
function paymentWindowStart(bill: {
  statementClosingDate: string | null;
  billingPeriod: string;
}) {
  return bill.statementClosingDate ?? shiftDate(`${bill.billingPeriod}-01`, -1);
}

function evaluateIssuerBills(
  issuer: Issuer,
  loaded: LoadedTransactions,
  today: string,
  limit: number,
): CardBill[] {
  const bills = issuer.bills.slice(0, limit);
  return bills.map((bill, index) => {
    const previous = issuer.bills[index + 1];
    const input = billInput(
      bill,
      previous ? normalizeDay(previous.statementClosingDate) : null,
      {
        snapshots: index === 0 ? issuer.snapshots : undefined,
        transactions: loaded.transactions,
        issuer: issuer.identity,
        rates: loaded.rates,
      },
    );
    const newer = index > 0 ? bills[index - 1] : undefined;
    const until = newer?.statementClosingDate ?? today;
    return evaluateBill(
      input,
      paymentsBetween(
        loaded.transactions,
        issuer.identity,
        paymentWindowStart(input),
        until,
      ),
    );
  });
}

function currentBillOf(bill: CardBill | undefined, today: string) {
  if (!bill) return null;
  return {
    ...bill,
    daysUntilDue: bill.paymentDueDate
      ? daysBetween(today, bill.paymentDueDate)
      : null,
  } satisfies CurrentCardBill;
}

function lastUpdatedAt(issuer: Issuer) {
  return (
    [
      issuer.syncStatus?.lastSuccessAt,
      ...issuer.snapshots.map((snapshot) => snapshot.asOfAt),
      ...issuer.bills.map((bill) => bill.updatedAt),
    ]
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null
  );
}

function sourceOf(issuer: Issuer) {
  return {
    connectorId: issuer.issuer,
    name: issuer.name,
    mode: MANUAL_IMPORT_CONNECTORS.has(issuer.issuer)
      ? ("manual_import" as const)
      : ("sync" as const),
    lastSuccessAt: issuer.syncStatus?.lastSuccessAt ?? null,
    lastStatus: issuer.syncStatus?.lastStatus ?? null,
  };
}

function estimatedReasons(
  issuer: Issuer,
  currentBill: CardBill | null,
  closingDateKnown: boolean,
) {
  const reasons: CardEstimatedReason[] = [];
  if (MANUAL_IMPORT_CONNECTORS.has(issuer.issuer))
    reasons.push("manual_import");
  if (currentBill?.statementEstimated)
    reasons.push("statement_from_transactions");
  if (!closingDateKnown) reasons.push("closing_date_unknown");
  return reasons;
}

/** 未出帳消費：上期結帳日之後、spending 角色的刷卡（含待入帳），依卡片分組。 */
async function summarizeUnbilled(
  db: D1Database,
  issuer: Issuer,
  since: string,
  loaded: LoadedTransactions,
) {
  const { definitions, multiCardAccounts } = cardDefinitions(issuer.accounts);
  const unbilled = loaded.transactions.filter(
    (transaction) =>
      issuer.identity.accountIds.has(transaction.accountId) &&
      transaction.economicRole === "spending" &&
      !transaction.duplicateOf &&
      billingDay(transaction) >= since,
  );
  const cardLast4 = await listTransactionCardLast4(
    db,
    unbilled
      .filter((transaction) => multiCardAccounts.has(transaction.accountId))
      .map((transaction) => transaction.id),
  );
  const cards = new Map<string, CardSummaryCard>();
  const accountById = new Map(
    issuer.accounts.map((account) => [account.id, account]),
  );
  const cardFor = (definition: CardDefinition): CardSummaryCard => {
    const existing = cards.get(definition.key);
    if (existing) return existing;
    const card: CardSummaryCard = {
      key: definition.key,
      accountId: definition.account.id,
      last4: definition.last4,
      name: definition.name,
      unbilledAmount: 0,
      pendingAmount: 0,
      transactionCount: 0,
      activityFilter: {
        q: accountDisplayName(definition.account),
        source: "card",
        from: since,
      },
      activityFilterExact: definition.exact,
    };
    cards.set(definition.key, card);
    return card;
  };
  for (const definition of definitions) cardFor(definition);

  let amount = 0;
  let pendingAmount = 0;
  const missingCurrencies = new Set<string>();
  for (const transaction of unbilled) {
    const value = toTwd(
      -transaction.amount,
      transaction.currency,
      loaded.rates,
    );
    if (value == null) {
      missingCurrencies.add(transaction.currency);
      continue;
    }
    const account = accountById.get(transaction.accountId)!;
    const last4 = multiCardAccounts.has(account.id)
      ? (cardLast4.get(transaction.id) ?? null)
      : null;
    const definition =
      definitions.find((candidate) =>
        multiCardAccounts.has(account.id)
          ? candidate.account.id === account.id && candidate.last4 === last4
          : candidate.account.id === account.id,
      ) ??
      ({
        key: `${account.id}:${last4 ?? "other"}`,
        account,
        last4,
        name: last4
          ? `${accountDisplayName(account)} ${last4}`
          : accountDisplayName(account),
        exact: !multiCardAccounts.has(account.id),
      } satisfies CardDefinition);
    const card = cardFor(definition);
    card.unbilledAmount += value;
    card.transactionCount += 1;
    amount += value;
    if (transaction.status === "pending") {
      card.pendingAmount += value;
      pendingAmount += value;
    }
  }
  return {
    unbilled: {
      since,
      amount: round(amount),
      pendingAmount: round(pendingAmount),
      transactionCount: unbilled.length,
      missingCurrencies: [...missingCurrencies].sort(),
    },
    cards: [...cards.values()]
      .map((card) => ({
        ...card,
        unbilledAmount: round(card.unbilledAmount),
        pendingAmount: round(card.pendingAmount),
      }))
      .sort(
        (left, right) =>
          right.unbilledAmount - left.unbilledAmount ||
          left.name.localeCompare(right.name, "zh-Hant"),
      ),
    physicalCardCount: definitions.length,
  };
}

function issuerWindowStart(issuer: Issuer, monthStart: string) {
  const current = issuer.bills[0];
  const previous = issuer.bills[1];
  const snapshotClosing = issuer.snapshots
    .map((snapshot) => normalizeDay(snapshot.statementClosingDate))
    .find(Boolean);
  const start =
    normalizeDay(previous?.statementClosingDate) ??
    normalizeDay(current?.statementClosingDate) ??
    snapshotClosing ??
    shiftDate(monthStart, -1);
  return shiftDate(start, -TRANSACTION_LOOKBACK_DAYS);
}

export async function getCardsSummary(
  db: D1Database,
  now = new Date(),
): Promise<CardsSummaryResponse> {
  const today = taipeiDate(now);
  const monthStart = `${today.slice(0, 7)}-01`;
  const issuers = await loadIssuers(db);
  const from = issuers
    .map((issuer) => issuerWindowStart(issuer, monthStart))
    .sort()[0];
  const loaded: LoadedTransactions = from
    ? await loadCardTransactions(db, from, shiftDate(today, 1))
    : { transactions: [], rates: new Map() };

  const summaries: CardIssuerSummary[] = [];
  for (const issuer of issuers) {
    const [bill] = evaluateIssuerBills(issuer, loaded, today, 1);
    const currentBill = currentBillOf(bill, today);
    const closing =
      currentBill?.statementClosingDate ??
      issuer.snapshots
        .map((snapshot) => normalizeDay(snapshot.statementClosingDate))
        .find(Boolean) ??
      null;
    const since = closing ? shiftDate(closing, 1) : monthStart;
    const { unbilled, cards, physicalCardCount } = await summarizeUnbilled(
      db,
      issuer,
      since,
      loaded,
    );
    const reasons = estimatedReasons(issuer, currentBill, closing != null);
    summaries.push({
      issuer: issuer.issuer,
      name: issuer.name,
      bankCode: issuer.bankCode,
      combinedStatement: physicalCardCount > 1,
      currentBill,
      unbilled,
      cards,
      source: sourceOf(issuer),
      lastUpdatedAt: lastUpdatedAt(issuer),
      estimated: reasons.length > 0,
      estimatedReasons: reasons,
    });
  }
  summaries.sort(
    (left, right) =>
      (left.currentBill?.paymentDueDate ?? "9999").localeCompare(
        right.currentBill?.paymentDueDate ?? "9999",
      ) || left.name.localeCompare(right.name, "zh-Hant"),
  );

  const twdBills = summaries
    .map((summary) => summary.currentBill)
    .filter((bill): bill is CurrentCardBill => bill?.currency === "TWD");
  const nextDue = summaries
    .filter(
      (summary) =>
        summary.currentBill?.paymentDueDate &&
        summary.currentBill.daysUntilDue != null &&
        summary.currentBill.paymentStatus !== "paid",
    )
    .sort((left, right) =>
      left.currentBill!.paymentDueDate!.localeCompare(
        right.currentBill!.paymentDueDate!,
      ),
    )[0];
  return {
    asOf: today,
    currency: "TWD",
    totals: {
      statementBalance: round(
        twdBills.reduce((sum, bill) => sum + (bill.statementBalance ?? 0), 0),
      ),
      remainingAmount: round(
        twdBills.reduce((sum, bill) => sum + (bill.remainingAmount ?? 0), 0),
      ),
      unbilledAmount: round(
        summaries.reduce((sum, summary) => sum + summary.unbilled.amount, 0),
      ),
    },
    nextDue: nextDue
      ? {
          issuer: nextDue.issuer,
          name: nextDue.name,
          paymentDueDate: nextDue.currentBill!.paymentDueDate!,
          daysUntilDue: nextDue.currentBill!.daysUntilDue!,
          remainingAmount: nextDue.currentBill!.remainingAmount,
          paymentStatus: nextDue.currentBill!.paymentStatus,
        }
      : null,
    issuers: summaries,
  };
}

export async function getCardIssuerBills(
  db: D1Database,
  issuerId: string,
  now = new Date(),
): Promise<CardBillsResponse> {
  const today = taipeiDate(now);
  const [issuer] = await loadIssuers(db, issuerId);
  if (!issuer) throw new CardIssuerNotFoundError();
  const bills = issuer.bills.slice(0, CARD_BILL_HISTORY_LIMIT + 1);
  const oldestClosing = bills
    .map((bill) => normalizeDay(bill.statementClosingDate))
    .filter((value): value is string => Boolean(value))
    .sort()[0];
  const loaded =
    bills.length > 0
      ? await loadCardTransactions(
          db,
          shiftDate(
            oldestClosing ?? `${bills.at(-1)!.billingPeriod}-01`,
            -TRANSACTION_LOOKBACK_DAYS,
          ),
          shiftDate(today, 1),
        )
      : { transactions: [], rates: new Map<string, number>() };
  const evaluated = evaluateIssuerBills(
    issuer,
    loaded,
    today,
    CARD_BILL_HISTORY_LIMIT,
  );
  const reasons = estimatedReasons(
    issuer,
    evaluated.find((bill) => bill.statementEstimated) ?? null,
    true,
  );
  return {
    issuer: issuer.issuer,
    name: issuer.name,
    estimated: reasons.length > 0,
    estimatedReasons: reasons,
    bills: evaluated,
  };
}
