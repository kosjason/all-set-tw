import {
  cardPaymentIssuerCode,
  type CardBill,
  type CardBillPayment,
  type CardPaymentStatus,
  type EconomicRoleFields,
} from "@taiwan-fin-hub/core";

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 台北日期 YYYY-MM-DD。 */
export function taipeiDate(value: Date | string) {
  const time = typeof value === "string" ? Date.parse(value) : value.getTime();
  return new Date(time + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
}

export function shiftDate(day: string, offset: number) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

/** b − a 的天數（皆為 YYYY-MM-DD）。 */
export function daysBetween(from: string, to: string) {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) /
      86_400_000,
  );
}

const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/;

export function normalizeDay(value?: string | null) {
  return value?.match(DATE_PREFIX)?.[0] ?? null;
}

export type CardTransaction = Pick<
  EconomicRoleFields,
  "economicRole" | "duplicateOf"
> & {
  id: string;
  accountId: string;
  accountType: string | null;
  amount: number;
  currency: string;
  status: "pending" | "posted";
  postedDate: string | null;
  authorizedAt: string | null;
  description: string | null;
  counterparty: string | null;
  counterpartyBankCode?: string | null;
};

/** 與 bank repository 的 transaction day 相同：有時刻的授權時間換成台北日期。 */
export function transactionDay(
  transaction: Pick<CardTransaction, "authorizedAt" | "postedDate">,
) {
  const authorizedAt = transaction.authorizedAt;
  if (authorizedAt && authorizedAt.length > 10) {
    const time = Date.parse(authorizedAt);
    if (Number.isFinite(time)) return taipeiDate(new Date(time));
  }
  return normalizeDay(authorizedAt ?? transaction.postedDate) ?? "";
}

/**
 * 帳單歸屬日：已入帳的刷卡依入帳日進帳單，待入帳只有授權日。
 * 結帳日前刷卡、結帳日後才入帳的消費屬於下一期。
 */
export function billingDay(
  transaction: Pick<CardTransaction, "authorizedAt" | "postedDate" | "status">,
) {
  if (transaction.status === "posted") {
    const posted = normalizeDay(transaction.postedDate);
    if (posted) return posted;
  }
  return transactionDay(transaction);
}

export type IssuerIdentity = {
  accountIds: ReadonlySet<string>;
  bankCode: string | null;
};

/**
 * 判斷交易是否為繳這個發卡行的卡費：
 * - card：發卡行信用卡帳戶上的繳款入帳（正數、economicRole = card_payment）。
 * - bank：存款端扣款（負數、card_payment），由對方銀行代碼或描述推得的發卡銀行相同。
 */
export function cardPaymentSide(
  transaction: CardTransaction,
  issuer: IssuerIdentity,
): CardBillPayment["side"] | null {
  if (transaction.economicRole !== "card_payment") return null;
  if (transaction.duplicateOf) return null;
  if (issuer.accountIds.has(transaction.accountId))
    return transaction.amount > 0 ? "card" : null;
  if (transaction.accountType === "credit" || transaction.amount >= 0)
    return null;
  if (!issuer.bankCode) return null;
  const code = cardPaymentIssuerCode({
    counterpartyBankCode: transaction.counterpartyBankCode,
    text: [transaction.description, transaction.counterparty]
      .filter(Boolean)
      .join(" "),
  });
  return code === issuer.bankCode ? "bank" : null;
}

export type BillInput = {
  billingPeriod: string;
  currency: string;
  statementAmount: number | null;
  statementEstimated: boolean;
  minimumPayment: number | null;
  paymentDueDate: string | null;
  statementClosingDate: string | null;
  /** 來源提供的已繳金額。 */
  sourcePaidAmount: number | null;
  /** 來源明確表示已繳清（或本期不需繳款）；false／null 都不作為未繳的證據。 */
  sourceIsPaid: boolean;
};

const round = (value: number) => Math.round(value * 100) / 100 || 0;

/**
 * 繳款狀態判斷：
 * 1. 應繳金額不明：來源標示已繳 → paid；否則 unknown。
 * 2. 應繳 ≤ 0 → paid（本期不需繳款）。
 * 3. 來源標示已繳，或已繳 ≥ 應繳 → paid。
 * 4. 已繳 > 0 → partial。
 * 5. 其餘 → unpaid。
 * 已繳 = max(來源已繳金額, 存款端扣款加總, 卡片端繳款入帳加總)：兩端是同一筆錢，
 * 取較大者可在任一端尚未同步時仍看得到繳款，且不會重複計算。
 */
export function evaluateBill(
  input: BillInput,
  payments: CardBillPayment[],
): CardBill {
  const sideTotal = (side: CardBillPayment["side"]) =>
    payments
      .filter((payment) => payment.side === side)
      .reduce((sum, payment) => sum + payment.amount, 0);
  const paidAmount = round(
    Math.max(input.sourcePaidAmount ?? 0, sideTotal("bank"), sideTotal("card")),
  );
  const balance = input.statementAmount;
  let paymentStatus: CardPaymentStatus;
  let remainingAmount: number | null;
  if (balance == null) {
    paymentStatus = input.sourceIsPaid ? "paid" : "unknown";
    remainingAmount = input.sourceIsPaid ? 0 : null;
  } else if (balance <= 0 || input.sourceIsPaid || paidAmount >= balance) {
    paymentStatus = "paid";
    remainingAmount = 0;
  } else if (paidAmount > 0) {
    paymentStatus = "partial";
    remainingAmount = round(balance - paidAmount);
  } else {
    paymentStatus = "unpaid";
    remainingAmount = balance;
  }
  return {
    billingPeriod: input.billingPeriod,
    currency: input.currency,
    statementBalance: balance,
    statementEstimated: input.statementEstimated,
    minimumPayment: input.minimumPayment,
    paymentDueDate: input.paymentDueDate,
    statementClosingDate: input.statementClosingDate,
    paidAmount,
    remainingAmount,
    paymentStatus,
    minimumPaid:
      input.minimumPayment == null
        ? null
        : paymentStatus === "paid" || paidAmount >= input.minimumPayment,
    payments: [...payments].sort(
      (left, right) =>
        left.date.localeCompare(right.date) ||
        left.transactionId.localeCompare(right.transactionId),
    ),
  };
}

export type MergeableBillRow = {
  billingPeriod: string;
  currency: string;
  statementAmount: number | null;
  minimumPayment: number | null;
  paidAmount: number | null;
  isPaid: number | null;
  paymentDueDate: string | null;
  statementClosingDate: string | null;
  updatedAt: string;
};

export type MergedBill = Omit<
  BillInput,
  "statementEstimated" | "sourceIsPaid"
> & {
  sourceIsPaid: boolean;
  updatedAt: string;
};

const sumNullable = (values: Array<number | null>) =>
  values.every((value) => value == null)
    ? null
    : values.reduce<number>((sum, value) => sum + (value ?? 0), 0);

/**
 * 同一發卡行的帳單依帳單週期合併成一期：以 TWD 為主（中信另有外幣帳單），
 * 同期同幣別有多個帳戶的帳單時金額相加。新到舊。
 */
export function mergeIssuerBills(rows: MergeableBillRow[]): MergedBill[] {
  const byPeriod = new Map<string, MergeableBillRow[]>();
  for (const row of rows) {
    const list = byPeriod.get(row.billingPeriod) ?? [];
    list.push(row);
    byPeriod.set(row.billingPeriod, list);
  }
  return [...byPeriod.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([billingPeriod, periodRows]) => {
      const currency = periodRows.some((row) => row.currency === "TWD")
        ? "TWD"
        : periodRows[0]!.currency;
      const selected = periodRows.filter((row) => row.currency === currency);
      const dueDates = selected
        .map((row) => normalizeDay(row.paymentDueDate))
        .filter((value): value is string => Boolean(value))
        .sort();
      const closingDates = selected
        .map((row) => normalizeDay(row.statementClosingDate))
        .filter((value): value is string => Boolean(value))
        .sort();
      return {
        billingPeriod,
        currency,
        statementAmount: sumNullable(
          selected.map((row) =>
            row.statementAmount == null ? null : Math.abs(row.statementAmount),
          ),
        ),
        minimumPayment: sumNullable(
          selected.map((row) =>
            row.minimumPayment == null ? null : Math.abs(row.minimumPayment),
          ),
        ),
        sourcePaidAmount: sumNullable(
          selected.map((row) =>
            row.paidAmount == null ? null : Math.abs(row.paidAmount),
          ),
        ),
        sourceIsPaid: selected.every((row) => row.isPaid === 1),
        paymentDueDate: dueDates[0] ?? null,
        statementClosingDate: closingDates.at(-1) ?? null,
        updatedAt: selected
          .map((row) => row.updatedAt)
          .sort()
          .at(-1)!,
      };
    });
}
