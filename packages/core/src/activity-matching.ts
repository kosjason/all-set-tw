import type { EconomicRole } from "./economic-role";
import {
  invoiceAmountTwd,
  isForeignCurrencyInvoice,
  normalizeInvoiceCurrency,
} from "./invoice-currency";
import { latinMerchantMatch, merchantSimilarity } from "./merchant-similarity";

export interface MatchingTransaction {
  id: string;
  connectorId: string;
  sourceId: string;
  accountType?: string | null;
  amount: number;
  currency: string;
  authorizedAt?: string | null;
  postedDate?: string | null;
  counterparty?: string | null;
  description?: string | null;
  excludedFromCalculation?: boolean | null;
  /** 帳戶（信用卡）末四碼；用來比對發票的信用卡載具。 */
  accountLast4?: string | null;
  /** 已推導的經濟角色；非消費（繳卡費、移轉、投資）不與發票配對。 */
  economicRole?: EconomicRole;
}
export interface MatchingInvoice {
  id: string;
  invoiceDate: string;
  /** 發票金額（原幣）；外幣發票為含小數的原幣金額，見 {@link currency}。 */
  amount: number;
  /** 發票幣別；未提供視為 TWD。跨境電商的發票可能是 USD 等外幣。 */
  currency?: string | null;
  /**
   * 品項描述的正規化簽章（依行號串接）；判斷同一筆消費重複開立的發票時，
   * 要求品項相同。未提供時不參與重複開立判斷。
   */
  itemsKey?: string | null;
  sellerName?: string | null;
  /** 賣方統編（8 碼），可用來比對交易描述。 */
  sellerBan?: string | null;
  /** 財政部載具類別，例如 3J0002（手機條碼）；歸戶載具為其實際類別。 */
  carrierType?: string | null;
  /** 載具隱碼末 4 碼（不保存完整隱碼）。 */
  carrierSuffix?: string | null;
  /** 財政部發票狀態（raw `detail.invStatus`）；作廢、註銷者不參與配對。 */
  invoiceStatus?: string | null;
}
const VOIDED_INVOICE_STATUS = /作廢|註銷|撤銷|退回|void|cancel/iu;
const VALID_INVOICE_STATUS = /開立|確認|正常|issued|confirmed/iu;

/**
 * 發票狀態（財政部 `invStatus`）是否代表已作廢：沒有狀態時視為有效；
 * 含「作廢」「註銷」等字樣，或不是「開立」「已確認」這類有效狀態時為作廢。
 */
export function isVoidedInvoiceStatus(status: string | null | undefined) {
  const text = status?.normalize("NFKC").trim();
  if (!text) return false;
  if (VOIDED_INVOICE_STATUS.test(text)) return true;
  return !VALID_INVOICE_STATUS.test(text);
}

export interface InvoiceMatchingOptions {
  /** Maximum Taipei-day distance for the tolerant stages; 0 keeps same-day only. */
  dayWindow?: number;
  /**
   * 已同步信用卡的末四碼。發票載具末碼屬於其中時，該發票只與這張卡的
   * 交易配對，並大幅加分。
   */
  syncedCardSuffixes?: ReadonlySet<string>;
  /**
   * 系統匯率（幣別 → 1 單位折合新台幣）。外幣發票以此換算後與台幣刷卡比對；
   * 缺少該幣別匯率時，外幣發票不自動配對。
   */
  exchangeRates?: Readonly<Record<string, number>>;
}

/** Tolerant stages accept an invoice and an outflow at most this many Taipei days apart. */
export const INVOICE_MATCH_DAY_WINDOW = 3;
/** 信用卡載具的發票與該卡交易可接受的日差（入帳日可能晚於消費日）。 */
export const INVOICE_CARRIER_DAY_WINDOW = 5;
/**
 * Days of surrounding data a bounded caller must load so that the uniqueness
 * checks of the tolerant stages see every competing invoice and transaction.
 */
export const INVOICE_MATCH_CONTEXT_DAYS = INVOICE_CARRIER_DAY_WINDOW * 2;

/**
 * 配對評分（原始分數，回報時除以 {@link INVOICE_MATCH_MAX_RAW_SCORE} 正規化為 0–1）：
 * - 金額：完全相同 0.5；國外商家匯差或點數折抵 0.3（須有商家或載具佐證）。
 * - 日差：同日 +0.3、1 天 +0.2、2 天 +0.1、其餘 0。
 * - 商家：強相符 +0.2、部分相符 +0.1。
 * - 載具：發票載具是該筆交易的已同步信用卡 +0.3。
 */
export const INVOICE_MATCH_SCORE = {
  exactAmount: 0.5,
  approximateAmount: 0.3,
  dayGap: [0.3, 0.2, 0.1] as readonly number[],
  merchantStrong: 0.2,
  merchantPartial: 0.1,
  carrier: 0.3,
} as const;
export const INVOICE_MATCH_MAX_RAW_SCORE = 1.3;
/** 同一張發票或同一筆交易的最佳與次佳候選分數差小於此值時，不自動配對。 */
export const INVOICE_MATCH_MIN_MARGIN = 0.1;
/**
 * 點數折抵（發票為原價、實付較少）：實付至少為發票金額的 80%，且差額不超過
 * NT$500；另須有商家強相符或信用卡載具佐證。
 */
export const INVOICE_DISCOUNT_MIN_PAID_RATIO = 0.8;
export const INVOICE_DISCOUNT_MAX_AMOUNT = 500;
/**
 * 不會是「手機條碼下歸戶的信用卡」的載具類別：手機條碼本身、自然人憑證、
 * 悠遊卡、一卡通（財政部 API 規格「卡別參數說明」）。
 */
export const NON_CARD_CARRIER_TYPES: ReadonlySet<string> = new Set([
  "3J0002",
  "CQ0001",
  "1K0001",
  "1H0001",
]);
const FOREIGN_TRANSACTION_FEE = /國外交易服務費|國外交易手續費|海外交易手續費/u;
/** Foreign merchants: FX conversion differences stay within this ratio or floor. */
export const FOREIGN_MERCHANT_AMOUNT_RATIO = 0.05;
export const FOREIGN_MERCHANT_AMOUNT_FLOOR = 30;
/**
 * 外幣發票 vs 台幣刷卡：以系統匯率換算後，刷卡金額與換算值相差不超過 5%
 * （匯率時間差與發卡行匯率；國外交易服務費另列一筆，不含在內）。換算值很小時
 * 至少容許 NT$1 的四捨五入差。
 */
export const FOREIGN_INVOICE_AMOUNT_RATIO = 0.05;
export const FOREIGN_INVOICE_AMOUNT_FLOOR = 1;
/** 外幣發票 vs 同幣別外幣刷卡：原幣金額直接比對，容忍 1%。 */
export const SAME_CURRENCY_AMOUNT_RATIO = 0.01;
/** 外幣發票：刷卡日可早於發票日 1 天（時區），最晚晚 5 天（授權／入帳延遲）。 */
export const FOREIGN_INVOICE_DAYS_BEFORE = 1;
export const FOREIGN_INVOICE_DAYS_AFTER = 5;
/** 同一筆消費重複開立的外幣發票：第一張起 24 小時內的相同發票視為同一組。 */
export const INVOICE_REPEAT_WINDOW_HOURS = 24;
/**
 * Stored-value top-ups into the user's own e-wallet. Kept identical to the
 * `system:bank:ewallet-topup` classification rule; such outflows are transfers
 * and never the purchase an e-invoice describes.
 */
export const STORED_VALUE_TOP_UP_PATTERN =
  "^(?!.*手續費).*(?:電支.{0,12}儲值|(?:街口|連加|一卡通|全支付|悠遊付|全盈|icash ?pay|line ?pay).{0,8}儲值)";
const STORED_VALUE_TOP_UP = new RegExp(STORED_VALUE_TOP_UP_PATTERN, "i");
export interface InvoiceTransactionPreference {
  updatedAt?: string;
  invoiceId: string;
  transactionId: string | null;
  decision: "linked" | "separate";
}
const TAIPEI_DAY_FORMATTER = new Intl.DateTimeFormat("en", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * 單張發票的配對結果：
 * - linked：使用者手動連結；separate：使用者選擇分開記錄。
 * - matched：自動配對；ambiguous：有候選但分數差距不足，未自動配對。
 * - unmatched：沒有任何候選交易。
 * - repeat：與同組（{@link invoiceRepeatGroups}）另一張發票是同一筆消費重複開立，
 *   付款已由 repeatOf 那張代表；本身不再配對。
 */
export type InvoiceMatchOutcome =
  "linked" | "matched" | "ambiguous" | "separate" | "unmatched" | "repeat";

export interface InvoiceMatchDetail {
  outcome: InvoiceMatchOutcome;
  transactionId?: string;
  /** 0–1；手動連結為 1。 */
  score?: number;
  /** 發票載具對應到的已同步信用卡末四碼。 */
  carrierCardSuffix?: string;
  /** outcome 為 repeat 時，代表這筆消費的那張發票 id。 */
  repeatOf?: string;
}

export interface InvoiceTransactionMatches<
  I extends MatchingInvoice = MatchingInvoice,
> {
  invoiceToTransactionId: Map<string, string>;
  transactionToInvoice: Map<string, I>;
  /** 每張發票的配對結果；舊呼叫端自行組裝時可省略。 */
  details?: Map<string, InvoiceMatchDetail>;
}

const ESUN_LIFECYCLE_MARKER = /:(已入帳|未入帳):(?=\d+$)/u;

export function deduplicateBankTransactions<T extends MatchingTransaction>(
  transactions: T[],
): T[] {
  const preferredByKey = new Map<
    string,
    { transaction: T; priority: number }
  >();

  for (const transaction of transactions) {
    if (transaction.connectorId !== "esun") continue;
    const lifecycle = transaction.sourceId.match(ESUN_LIFECYCLE_MARKER)?.[1];
    const key = transaction.sourceId.replace(ESUN_LIFECYCLE_MARKER, ":");
    const priority = lifecycle == null ? 2 : lifecycle === "已入帳" ? 1 : 0;
    const current = preferredByKey.get(key);
    if (!current || priority > current.priority)
      preferredByKey.set(key, { transaction, priority });
  }

  const preferredIds = new Set(
    Array.from(preferredByKey.values(), ({ transaction }) => transaction.id),
  );
  return transactions.filter(
    (transaction) =>
      transaction.connectorId !== "esun" || preferredIds.has(transaction.id),
  );
}

export function matchInvoicesToTransactions<I extends MatchingInvoice>(
  transactions: MatchingTransaction[],
  allInvoices: I[],
  preferences: InvoiceTransactionPreference[] = [],
  options: InvoiceMatchingOptions = {},
): InvoiceTransactionMatches<I> & {
  details: Map<string, InvoiceMatchDetail>;
} {
  // 作廢／註銷的發票不是消費，不參與配對（也不吃掉真正的刷卡交易）。
  const invoices = allInvoices.filter(
    (invoice) => !isVoidedInvoiceStatus(invoice.invoiceStatus),
  );
  const dayWindow = Math.max(0, options.dayWindow ?? INVOICE_MATCH_DAY_WINDOW);
  const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const transactionById = new Map(
    transactions.map((transaction) => [transaction.id, transaction]),
  );
  const invoiceToTransactionId = new Map<string, string>();
  const transactionToInvoice = new Map<string, I>();
  const details = new Map<string, InvoiceMatchDetail>();
  const separateInvoiceIds = new Set(
    preferences
      .filter(({ decision }) => decision === "separate")
      .map(({ invoiceId }) => invoiceId),
  );
  const carrierSuffixFor = (invoice: I) =>
    invoiceCarrierCardSuffix(invoice, options.syncedCardSuffixes);

  for (const preference of preferences) {
    if (preference.decision !== "linked" || !preference.transactionId) continue;
    const invoice = invoiceById.get(preference.invoiceId);
    const transaction = transactionById.get(preference.transactionId);
    if (!invoice || !transaction || transactionToInvoice.has(transaction.id))
      continue;
    invoiceToTransactionId.set(invoice.id, transaction.id);
    transactionToInvoice.set(transaction.id, invoice);
    details.set(invoice.id, {
      outcome: "linked",
      transactionId: transaction.id,
      score: 1,
      ...optionalSuffix(carrierSuffixFor(invoice)),
    });
  }
  for (const invoice of invoices)
    if (separateInvoiceIds.has(invoice.id) && !details.has(invoice.id))
      details.set(invoice.id, {
        outcome: "separate",
        ...optionalSuffix(carrierSuffixFor(invoice)),
      });

  const remainingInvoices = invoices.filter(
    (invoice) => !details.has(invoice.id),
  );
  // A top-up moves money into the user's own e-wallet; the purchase it later
  // funds carries the invoice, so a top-up is never an automatic counterpart.
  // Foreign transaction fees and non-spending roles never carry an invoice.
  const eligibleTransactions = transactions.filter(
    (transaction) =>
      !isStoredValueTopUp(transaction) &&
      !isForeignTransactionFee(transaction) &&
      transaction.excludedFromCalculation !== true &&
      (transaction.economicRole == null ||
        transaction.economicRole === "spending"),
  );
  // 同一筆消費重複開立的外幣發票：每組先只讓第一張參與配對；配到後才讓下一張
  // 找下一筆付款（真的付了兩次時兩張都配得到），其餘標為 repeat。
  const repeatGroups = invoiceRepeatGroups(
    invoices.filter((invoice) => !separateInvoiceIds.has(invoice.id)),
  );
  const groupedIds = new Set(
    repeatGroups.flatMap((group) => group.map(({ id }) => id)),
  );
  const tried = new Set<string>();
  const nextMember = (group: I[]) =>
    group.find((member) => !details.has(member.id) && !tried.has(member.id));
  const blocked = {
    invoices: new Set<string>(),
    transactions: new Set<string>(),
  };
  let round = new Map<I[], I>();
  let pending = remainingInvoices.filter(
    (invoice) => !groupedIds.has(invoice.id),
  );
  for (const group of repeatGroups) {
    const member = nextMember(group);
    if (member) {
      round.set(group, member);
      pending.push(member);
    }
  }
  while (pending.length) {
    for (const invoice of pending) tried.add(invoice.id);
    const available = eligibleTransactions.filter(
      (transaction) =>
        !transactionToInvoice.has(transaction.id) &&
        !blocked.transactions.has(transaction.id),
    );
    assignMatchEdges(
      buildMatchEdges(
        pending,
        available,
        dayWindow,
        carrierSuffixFor,
        options.exchangeRates,
      ),
      invoiceToTransactionId,
      transactionToInvoice,
      details,
      blocked,
    );
    const next = new Map<I[], I>();
    pending = [];
    for (const [group, member] of round) {
      if (!invoiceToTransactionId.has(member.id)) continue;
      const following = nextMember(group);
      if (!following) continue;
      next.set(group, following);
      pending.push(following);
    }
    round = next;
  }
  for (const invoice of remainingInvoices) {
    if (details.has(invoice.id)) continue;
    details.set(invoice.id, {
      outcome: blocked.invoices.has(invoice.id) ? "ambiguous" : "unmatched",
      ...optionalSuffix(carrierSuffixFor(invoice)),
    });
  }
  for (const group of repeatGroups) {
    const anchor =
      group.find((member) => invoiceToTransactionId.has(member.id)) ?? group[0];
    for (const member of group) {
      if (member === anchor || invoiceToTransactionId.has(member.id)) continue;
      details.set(member.id, {
        outcome: "repeat",
        repeatOf: anchor.id,
        ...optionalSuffix(carrierSuffixFor(member)),
      });
    }
  }
  return {
    invoiceToTransactionId: sortedMap(invoiceToTransactionId),
    transactionToInvoice: sortedMap(transactionToInvoice),
    details,
  };
}

/**
 * 發票載具屬於已同步的信用卡時回傳該卡末四碼。手機條碼本身、自然人憑證與
 * 電子票證不是信用卡；隱碼末四碼必須是數字且等於某張已同步信用卡的末四碼。
 */
export function invoiceCarrierCardSuffix(
  invoice: Pick<MatchingInvoice, "carrierType" | "carrierSuffix">,
  syncedCardSuffixes?: ReadonlySet<string>,
) {
  const type = invoice.carrierType?.trim().toUpperCase();
  const suffix = invoice.carrierSuffix?.trim();
  if (!type || !suffix || NON_CARD_CARRIER_TYPES.has(type)) return undefined;
  if (!/^\d{4}$/u.test(suffix)) return undefined;
  return syncedCardSuffixes?.has(suffix) ? suffix : undefined;
}

function repeatSellerKey(invoice: MatchingInvoice) {
  const ban = invoice.sellerBan?.trim();
  if (ban && /^\d{8}$/u.test(ban)) return `ban:${ban}`;
  const name = invoice.sellerName
    ?.normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
  return name ? `name:${name}` : undefined;
}

function invoiceTime(invoice: MatchingInvoice) {
  const time = Date.parse(invoice.invoiceDate);
  return Number.isNaN(time) ? undefined : time;
}

/**
 * 同一筆消費重複開立的外幣發票分組：同一賣方（統編，否則名稱）、同品項描述
 * （{@link MatchingInvoice.itemsKey}）、同幣別與原幣金額，且在該組第一張的
 * {@link INVOICE_REPEAT_WINDOW_HOURS} 小時內。只看外幣發票：國內發票常有同一家店
 * 隔天買同樣東西（例如每天一杯相同的飲料），不能視為重複開立。
 * 只回傳兩張以上的組，組內依開立時間、id 排序。
 */
export function invoiceRepeatGroups<I extends MatchingInvoice>(invoices: I[]) {
  const byKey = new Map<string, Array<{ invoice: I; time: number }>>();
  for (const invoice of invoices) {
    if (!isForeignCurrencyInvoice(invoice) || !(invoice.amount > 0)) continue;
    const seller = repeatSellerKey(invoice);
    const items = invoice.itemsKey?.trim();
    const time = invoiceTime(invoice);
    if (!seller || !items || time == null) continue;
    const key = [
      normalizeInvoiceCurrency(invoice.currency),
      seller,
      items,
      Math.round(invoice.amount * 100),
    ].join("\u0000");
    const group = byKey.get(key) ?? [];
    group.push({ invoice, time });
    byKey.set(key, group);
  }
  const windowMs = INVOICE_REPEAT_WINDOW_HOURS * 3_600_000;
  const groups: I[][] = [];
  for (const entries of byKey.values()) {
    entries.sort(
      (left, right) =>
        left.time - right.time ||
        left.invoice.id.localeCompare(right.invoice.id),
    );
    let current: typeof entries = [];
    const flush = () => {
      if (current.length > 1)
        groups.push(current.map(({ invoice }) => invoice));
    };
    for (const entry of entries) {
      if (current.length && entry.time - current[0].time > windowMs) {
        flush();
        current = [];
      }
      current.push(entry);
    }
    flush();
  }
  return groups.sort((left, right) => compareById(left[0], right[0]));
}

export function invoiceTransactionCandidates<T extends MatchingTransaction>(
  transactions: T[],
  invoice: MatchingInvoice,
  unavailableTransactionIds: ReadonlySet<string> = new Set(),
  dayWindow = INVOICE_MATCH_DAY_WINDOW,
) {
  const invoiceDay = dayNumber(invoice.invoiceDate);
  if (invoiceDay == null) return [];
  const dayGap = (transaction: T) =>
    Math.abs((expenseDay(transaction) ?? invoiceDay) - invoiceDay);
  return transactions
    .filter((transaction) => {
      const transactionDay = expenseDay(transaction);
      return (
        !unavailableTransactionIds.has(transaction.id) &&
        transactionDay != null &&
        Math.abs(transactionDay - invoiceDay) <= dayWindow
      );
    })
    .sort((left, right) => {
      const leftDifference = Math.abs(invoice.amount - Math.abs(left.amount));
      const rightDifference = Math.abs(invoice.amount - Math.abs(right.amount));
      return (
        leftDifference - rightDifference ||
        dayGap(left) - dayGap(right) ||
        (left.counterparty ?? left.description ?? left.id).localeCompare(
          right.counterparty ?? right.description ?? right.id,
          "zh-TW",
        )
      );
    });
}

/** Taipei-day distance between an invoice and an expense, if both have a day. */
export function invoiceTransactionDayGap(
  invoice: MatchingInvoice,
  transaction: MatchingTransaction,
) {
  const invoiceDay = dayNumber(invoice.invoiceDate);
  const transactionDay = expenseDay(transaction);
  return invoiceDay == null || transactionDay == null
    ? undefined
    : Math.abs(transactionDay - invoiceDay);
}

/** Expands activity day keys (YYYY-MM-DD) so bounded loads keep full matching context. */
export function expandInvoiceMatchingDays(
  days: Iterable<string>,
  contextDays = INVOICE_MATCH_CONTEXT_DAYS,
) {
  const expanded = new Set<string>();
  for (const day of days) {
    const base = dateOnlyNumber(day);
    if (base == null) continue;
    for (let offset = -contextDays; offset <= contextDays; offset += 1)
      expanded.add(
        new Date((base + offset) * 86_400_000).toISOString().slice(0, 10),
      );
  }
  return [...expanded].sort();
}

export function isStoredValueTopUp(
  transaction: Pick<MatchingTransaction, "description" | "counterparty">,
) {
  return STORED_VALUE_TOP_UP.test(
    [transaction.description, transaction.counterparty]
      .filter(Boolean)
      .join(" "),
  );
}

type MatchEdge<I extends MatchingInvoice> = {
  invoice: I;
  transaction: MatchingTransaction;
  /** 原始分數（未正規化）。 */
  score: number;
  exact: boolean;
  gap: number;
  carrierSuffix?: string;
};

function optionalSuffix(suffix: string | undefined) {
  return suffix ? { carrierCardSuffix: suffix } : {};
}

function sortedMap<V>(map: Map<string, V>) {
  return new Map([...map].sort(([left], [right]) => left.localeCompare(right)));
}

export function isForeignTransactionFee(
  transaction: Pick<MatchingTransaction, "description" | "counterparty">,
) {
  return FOREIGN_TRANSACTION_FEE.test(
    [transaction.description, transaction.counterparty]
      .filter(Boolean)
      .join(" "),
  );
}

function transactionText(transaction: MatchingTransaction) {
  return [transaction.description, transaction.counterparty]
    .filter(Boolean)
    .join(" ");
}

function merchantScore(invoice: MatchingInvoice, text: string) {
  const similarity = merchantSimilarity(invoice, text);
  return similarity === "strong"
    ? INVOICE_MATCH_SCORE.merchantStrong
    : similarity === "partial"
      ? INVOICE_MATCH_SCORE.merchantPartial
      : 0;
}

/**
 * 建立發票與交易的候選邊並評分。同日完全同額可使用任何消費（含信用卡
 * 未入帳的正數授權）；跨日與非同額只接受真正的台幣支出。發票載具是已同步
 * 信用卡時，只接受該卡的交易，視窗放寬到 {@link INVOICE_CARRIER_DAY_WINDOW}。
 */
function buildMatchEdges<I extends MatchingInvoice>(
  invoices: I[],
  transactions: MatchingTransaction[],
  dayWindow: number,
  carrierSuffixFor: (invoice: I) => string | undefined,
  exchangeRates?: Readonly<Record<string, number>>,
) {
  const maxWindow =
    dayWindow === 0 ? 0 : Math.max(dayWindow, INVOICE_CARRIER_DAY_WINDOW);
  const transactionsByDay = new Map<number, MatchingTransaction[]>();
  for (const transaction of transactions) {
    const day = expenseDay(transaction);
    if (day == null) continue;
    const group = transactionsByDay.get(day) ?? [];
    group.push(transaction);
    transactionsByDay.set(day, group);
  }
  // 外幣發票的候選：台幣與外幣的信用卡支出。
  const foreignByDay = new Map<number, MatchingTransaction[]>();
  for (const transaction of transactions) {
    if (transaction.accountType !== "credit") continue;
    const day = cardSpendingDay(transaction);
    if (day == null) continue;
    const group = foreignByDay.get(day) ?? [];
    group.push(transaction);
    foreignByDay.set(day, group);
  }
  const edges: MatchEdge<I>[] = [];
  for (const invoice of invoices) {
    const invoiceDay = dayNumber(invoice.invoiceDate);
    if (invoiceDay == null || !(invoice.amount > 0)) continue;
    const carrierSuffix = carrierSuffixFor(invoice);
    const cardAllowed = (transaction: MatchingTransaction) =>
      !carrierSuffix ||
      (transaction.accountType === "credit" &&
        transaction.accountLast4 === carrierSuffix);
    if (isForeignCurrencyInvoice(invoice)) {
      // 外幣發票：同幣別的刷卡直接比原幣；台幣刷卡以系統匯率換算後比對
      // （缺匯率時無從比對，只剩同幣別刷卡可配）。
      const amountTwd = invoiceAmountTwd(invoice, exchangeRates);
      const before = dayWindow === 0 ? 0 : FOREIGN_INVOICE_DAYS_BEFORE;
      const after = dayWindow === 0 ? 0 : FOREIGN_INVOICE_DAYS_AFTER;
      for (let offset = -before; offset <= after; offset += 1)
        for (const transaction of foreignByDay.get(invoiceDay + offset) ?? []) {
          if (!cardAllowed(transaction)) continue;
          const edge = scoreForeignCurrencyEdge(
            invoice,
            transaction,
            amountTwd,
            Math.abs(offset),
            carrierSuffix,
          );
          if (edge) edges.push(edge);
        }
      continue;
    }
    const window = carrierSuffix ? maxWindow : dayWindow;
    for (let offset = -window; offset <= window; offset += 1)
      for (const transaction of transactionsByDay.get(invoiceDay + offset) ??
        []) {
        const gap = Math.abs(offset);
        if (!cardAllowed(transaction)) continue;
        const edge = scoreMatchEdge(invoice, transaction, gap, carrierSuffix);
        if (edge) edges.push(edge);
      }
  }
  return edges.sort(
    (left, right) =>
      right.score - left.score ||
      left.invoice.id.localeCompare(right.invoice.id) ||
      left.transaction.id.localeCompare(right.transaction.id),
  );
}

/**
 * 外幣發票 vs 信用卡支出：
 * - 同幣別的外幣刷卡：原幣金額直接比對，相差在 {@link SAME_CURRENCY_AMOUNT_RATIO} 內。
 * - 台幣刷卡：以系統匯率換算後相差在 {@link FOREIGN_INVOICE_AMOUNT_RATIO} 內。
 * 兩者都要求商家名稱相似（例如 Cloudflare Inc. ↔ CLOUDFLAREA3906）；金額以近似
 * 計分，不會是完全同額。
 */
function scoreForeignCurrencyEdge<I extends MatchingInvoice>(
  invoice: I,
  transaction: MatchingTransaction,
  amountTwd: number | undefined,
  gap: number,
  carrierSuffix: string | undefined,
): MatchEdge<I> | undefined {
  if (transaction.accountType !== "credit" || !(transaction.amount < 0))
    return undefined;
  if (transaction.excludedFromCalculation === true) return undefined;
  const paid = Math.abs(transaction.amount);
  const currency = normalizeInvoiceCurrency(transaction.currency);
  if (currency === normalizeInvoiceCurrency(invoice.currency)) {
    if (
      Math.abs(paid - invoice.amount) >
      Math.max(invoice.amount * SAME_CURRENCY_AMOUNT_RATIO, 0.01)
    )
      return undefined;
  } else if (currency === "TWD" && amountTwd != null && amountTwd > 0) {
    if (
      Math.abs(paid - amountTwd) >
      Math.max(
        amountTwd * FOREIGN_INVOICE_AMOUNT_RATIO,
        FOREIGN_INVOICE_AMOUNT_FLOOR,
      )
    )
      return undefined;
  } else return undefined;
  const merchant = merchantScore(invoice, transactionText(transaction));
  if (merchant === 0) return undefined;
  const score =
    INVOICE_MATCH_SCORE.approximateAmount +
    (INVOICE_MATCH_SCORE.dayGap[gap] ?? 0) +
    merchant +
    (carrierSuffix ? INVOICE_MATCH_SCORE.carrier : 0);
  return { invoice, transaction, score, exact: false, gap, carrierSuffix };
}

function scoreMatchEdge<I extends MatchingInvoice>(
  invoice: I,
  transaction: MatchingTransaction,
  gap: number,
  carrierSuffix: string | undefined,
): MatchEdge<I> | undefined {
  const carrier = carrierSuffix != null;
  const paid = Math.abs(transaction.amount);
  const exact = paid === invoice.amount;
  // 跨日、匯差與折抵只接受真正的台幣支出（不含退款與不計入的交易）。
  if ((!exact || gap > 0) && outflowDay(transaction) == null) return undefined;
  const text = transactionText(transaction);
  const merchant = merchantScore(invoice, text);
  let amountScore: number;
  if (exact) amountScore = INVOICE_MATCH_SCORE.exactAmount;
  else if (
    transaction.accountType === "credit" &&
    isForeignMerchantMatch(invoice, transaction)
  )
    amountScore = INVOICE_MATCH_SCORE.approximateAmount;
  else if (
    paid < invoice.amount &&
    paid >= invoice.amount * INVOICE_DISCOUNT_MIN_PAID_RATIO &&
    invoice.amount - paid <= INVOICE_DISCOUNT_MAX_AMOUNT &&
    (carrier || merchant === INVOICE_MATCH_SCORE.merchantStrong)
  )
    // 點數折抵：發票為原價，實付較少；必須有商家或載具佐證。
    amountScore = INVOICE_MATCH_SCORE.approximateAmount;
  else return undefined;
  const score =
    amountScore +
    (INVOICE_MATCH_SCORE.dayGap[gap] ?? 0) +
    merchant +
    (carrier ? INVOICE_MATCH_SCORE.carrier : 0);
  return { invoice, transaction, score, exact, gap, carrierSuffix };
}

/**
 * 一對一指派：每輪只看最高分附近（差距小於 {@link INVOICE_MATCH_MIN_MARGIN}）
 * 的候選邊；兩端都唯一者直接配對。同日同額、分數相同且彼此完全可互換的
 * 一群（例如同一天兩張同額發票與兩筆同額刷卡、描述也無從區分）依 id 順序
 * 配對，因為任何配法的金額結果都相同。其餘衝突兩端都保留未配對，發票標為
 * ambiguous。結果不受輸入順序影響。
 */
function assignMatchEdges<I extends MatchingInvoice>(
  edges: MatchEdge<I>[],
  invoiceToTransactionId: Map<string, string>,
  transactionToInvoice: Map<string, I>,
  details: Map<string, InvoiceMatchDetail>,
  blocked: { invoices: Set<string>; transactions: Set<string> },
) {
  const blockedInvoices = blocked.invoices;
  const blockedTransactions = blocked.transactions;
  const assign = (edge: MatchEdge<I>) => {
    invoiceToTransactionId.set(edge.invoice.id, edge.transaction.id);
    transactionToInvoice.set(edge.transaction.id, edge.invoice);
    details.set(edge.invoice.id, {
      outcome: "matched",
      transactionId: edge.transaction.id,
      score: normalizedScore(edge.score),
      ...optionalSuffix(edge.carrierSuffix),
    });
  };
  for (;;) {
    const active = edges.filter(
      ({ invoice, transaction }) =>
        !invoiceToTransactionId.has(invoice.id) &&
        !transactionToInvoice.has(transaction.id) &&
        !blockedInvoices.has(invoice.id) &&
        !blockedTransactions.has(transaction.id),
    );
    if (!active.length) break;
    const top = active[0].score;
    const tier = active.filter(
      ({ score }) => top - score < INVOICE_MATCH_MIN_MARGIN - 1e-9,
    );
    const invoiceCounts = countBy(tier, ({ invoice }) => invoice.id);
    const transactionCounts = countBy(
      tier,
      ({ transaction }) => transaction.id,
    );
    const conflicts: MatchEdge<I>[] = [];
    for (const edge of tier) {
      if (
        invoiceCounts.get(edge.invoice.id) === 1 &&
        transactionCounts.get(edge.transaction.id) === 1
      )
        assign(edge);
      else conflicts.push(edge);
    }
    for (const component of connectedComponents(conflicts)) {
      if (isInterchangeable(component)) {
        const invoices = uniqueSorted(component.map(({ invoice }) => invoice));
        const transactions = uniqueSorted(
          component.map(({ transaction }) => transaction),
        );
        const byPair = new Map(
          component.map((edge) => [
            `${edge.invoice.id}\u0000${edge.transaction.id}`,
            edge,
          ]),
        );
        for (
          let index = 0;
          index < Math.min(invoices.length, transactions.length);
          index += 1
        )
          assign(
            byPair.get(`${invoices[index].id}\u0000${transactions[index].id}`)!,
          );
        continue;
      }
      for (const { invoice, transaction } of component) {
        blockedInvoices.add(invoice.id);
        blockedTransactions.add(transaction.id);
      }
    }
  }
  return blockedInvoices;
}

function normalizedScore(raw: number) {
  return Math.round(Math.min(1, raw / INVOICE_MATCH_MAX_RAW_SCORE) * 100) / 100;
}

function uniqueSorted<T extends { id: string }>(items: T[]) {
  return [...new Map(items.map((item) => [item.id, item])).values()].sort(
    compareById,
  );
}

function connectedComponents<I extends MatchingInvoice>(edges: MatchEdge<I>[]) {
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    const value = parent.get(key) ?? key;
    if (value === key) return key;
    const root = find(value);
    parent.set(key, root);
    return root;
  };
  for (const { invoice, transaction } of edges) {
    const left = find(`i:${invoice.id}`);
    const right = find(`t:${transaction.id}`);
    if (left !== right) parent.set(left, right);
  }
  const groups = new Map<string, MatchEdge<I>[]>();
  for (const edge of edges) {
    const root = find(`i:${edge.invoice.id}`);
    const group = groups.get(root) ?? [];
    group.push(edge);
    groups.set(root, group);
  }
  return [...groups.values()];
}

/** 同日、完全同額、分數相同且為完全二分圖：任何配法結果都一樣。 */
function isInterchangeable<I extends MatchingInvoice>(
  component: MatchEdge<I>[],
) {
  const score = component[0].score;
  if (
    !component.every(
      (edge) => edge.exact && edge.gap === 0 && edge.score === score,
    )
  )
    return false;
  const invoices = new Set(component.map(({ invoice }) => invoice.id));
  const transactions = new Set(
    component.map(({ transaction }) => transaction.id),
  );
  return component.length === invoices.size * transactions.size;
}

/**
 * Foreign merchants invoice in their own TWD conversion while the card issuer
 * converts at its own rate (the 國外交易服務費 is a separate line), so the
 * amounts may differ slightly. The seller must also clearly name the merchant.
 */
function isForeignMerchantMatch(
  invoice: MatchingInvoice,
  transaction: MatchingTransaction,
) {
  const difference = Math.abs(Math.abs(transaction.amount) - invoice.amount);
  if (
    difference >
    Math.max(
      FOREIGN_MERCHANT_AMOUNT_FLOOR,
      invoice.amount * FOREIGN_MERCHANT_AMOUNT_RATIO,
    )
  )
    return false;
  return latinMerchantMatch(
    invoice.sellerName ?? "",
    [transaction.description, transaction.counterparty]
      .filter(Boolean)
      .join(" "),
  );
}

function countBy<T>(items: T[], keyFor: (item: T) => string) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyFor(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** Tolerant stages only use real TWD outflows that still count as spending. */
function outflowDay(transaction: MatchingTransaction) {
  if (
    !(transaction.amount < 0) ||
    transaction.currency !== "TWD" ||
    transaction.excludedFromCalculation === true
  )
    return undefined;
  return expenseDay(transaction);
}

/** 信用卡支出（任何幣別）的消費日；外幣發票配對使用。 */
function cardSpendingDay(transaction: MatchingTransaction) {
  if (!(transaction.amount < 0) || transaction.accountType !== "credit")
    return undefined;
  return transaction.authorizedAt
    ? dayNumber(transaction.authorizedAt)
    : dateOnlyNumber(transaction.postedDate);
}

function expenseDay(transaction: MatchingTransaction) {
  if (
    transaction.amount === 0 ||
    (transaction.accountType !== "credit" && transaction.amount > 0) ||
    transaction.currency !== "TWD"
  )
    return undefined;
  return transaction.authorizedAt
    ? dayNumber(transaction.authorizedAt)
    : dateOnlyNumber(transaction.postedDate);
}

function dayNumber(value?: string | null) {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    const parts = Object.fromEntries(
      TAIPEI_DAY_FORMATTER.formatToParts(parsed).map(({ type, value }) => [
        type,
        value,
      ]),
    );
    return (
      Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) /
      86_400_000
    );
  }
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return undefined;
  return (
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) /
    86_400_000
  );
}

function dateOnlyNumber(value?: string | null) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return undefined;
  return (
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) /
    86_400_000
  );
}

function compareById(left: { id: string }, right: { id: string }) {
  return left.id.localeCompare(right.id);
}
