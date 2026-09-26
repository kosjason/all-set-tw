/**
 * 由存款交易明細推算「第一筆真實餘額快照之前」的每日日終餘額。
 *
 * 純計算模組：不存取 D1，輸入帳戶、錨點快照與交易，輸出要寫入的推算快照與
 * 每個帳戶的處理結果。寫入與清理由 repository 負責。
 */

export const DERIVED_BALANCE_SOURCE_PREFIX = "derived-balance:";

/** 同步時會抓完整存款明細（BANK_SYNC_MONTHS 內）的連接器：沒有交易即代表餘額未變動。 */
export const TRUSTED_DEPOSIT_DETAIL_CONNECTORS: ReadonlySet<string> = new Set([
  "esun",
  "cathaybk",
  "obank",
  "kgibank",
  "skbank",
  "firstbank",
]);

/**
 * 存款明細可能缺漏的連接器：中信網銀匯入可能取不到存款明細（只剩零星幾筆），
 * 而資料庫沒有逐帳戶保存「本次明細是否完整」，無法可靠判斷，因此一律不推算。
 * 其餘不在可信清單的連接器（例如華南只抓存款總覽）同樣跳過。
 */
export const INCOMPLETE_DEPOSIT_DETAIL_CONNECTORS: ReadonlySet<string> =
  new Set(["ctbc"]);

/** 交易後餘額在各連接器 raw payload 的欄位名稱。 */
const RUNNING_BALANCE_KEYS = [
  "balance",
  "balanceAfter",
  "balanceAmt",
  "Balance",
  "acctBal",
] as const;

/** 兩種方法差額超過此值（原幣最小單位）視為不一致。 */
export const CROSS_CHECK_TOLERANCE = 1;

/**
 * - running_balance：交易後餘額。
 * - reverse_sum：由真實快照倒推交易。
 * - carry_back：明細不完整或不抓明細的帳戶，以第一筆真實快照往前延伸（假設期間無進出），
 *   避免該帳戶在第一次同步那天讓總額出現假性跳升。
 */
export type BackfillMethod = "running_balance" | "reverse_sum" | "carry_back";

export type BackfillAccountInput = {
  id: string;
  connectorId: string;
  accountLast4: string | null;
  openedDate: string | null;
  /** 最早一筆真實（非推算）餘額快照。 */
  anchor: { balance: number; currency: string; asOfAt: string } | null;
};

export type BackfillTransactionInput = {
  accountId: string;
  postedDate: string | null;
  authorizedAt: string | null;
  amount: number;
  currency: string;
  rawPayload: string | null;
};

export type DerivedBalanceSnapshot = {
  accountId: string;
  connectorId: string;
  date: string;
  balance: number;
  currency: string;
  method: BackfillMethod;
};

export type BackfillSkipReason =
  | "connector_without_deposit_details"
  | "deposit_details_may_be_incomplete"
  | "no_real_snapshot"
  | "no_transactions"
  | "mixed_currency";

export type AccountBackfillReport = {
  accountId: string;
  connectorId: string;
  accountLast4: string | null;
  status: "backfilled" | "skipped";
  reason?: BackfillSkipReason;
  from?: string;
  to?: string;
  days: number;
  methods: Partial<Record<BackfillMethod, number>>;
  /** 兩種方法都能算的天數與不一致天數（只含日期，不含金額）。 */
  crossCheck?: {
    comparedDays: number;
    mismatchDays: number;
    firstMismatch?: string;
    lastMismatch?: string;
  };
};

export type BackfillPlan = {
  snapshots: DerivedBalanceSnapshot[];
  accounts: AccountBackfillReport[];
};

type PreparedTransaction = {
  day: string;
  sortKey: string;
  timestamp: number | null;
  amount: number;
  currency: string;
  runningBalance: number | null;
};

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

export function taipeiDay(value: string | Date) {
  const time = typeof value === "string" ? Date.parse(value) : value.getTime();
  return new Date(time + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function subtractMonths(date: string, months: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCMonth(value.getUTCMonth() - months);
  return value.toISOString().slice(0, 10);
}

/** 推算快照的時間點：台北時間當日 23:59:59（UTC 日期與台北日期相同）。 */
export function derivedAsOfAt(date: string) {
  return `${date}T15:59:59.000Z`;
}

export function derivedSourceId(date: string) {
  return `${DERIVED_BALANCE_SOURCE_PREFIX}${date}`;
}

/** 與 bank repository 的 transaction day 一致：有時刻的授權時間換成台北日期。 */
function transactionDay(transaction: BackfillTransactionInput) {
  const { authorizedAt, postedDate } = transaction;
  if (authorizedAt && authorizedAt.length > 10) {
    const time = Date.parse(authorizedAt);
    if (Number.isFinite(time)) return taipeiDay(new Date(time));
  }
  return (authorizedAt ?? postedDate)?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
}

function transactionTimestamp(transaction: BackfillTransactionInput) {
  const { authorizedAt } = transaction;
  if (!authorizedAt || authorizedAt.length <= 10) return null;
  const time = Date.parse(authorizedAt);
  return Number.isFinite(time) ? time : null;
}

function parseNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const normalized = value.replace(/,/g, "").trim();
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  return Number(normalized);
}

function parseRaw(rawPayload: string | null) {
  if (!rawPayload) return null;
  try {
    const value = JSON.parse(rawPayload) as unknown;
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function runningBalanceFromRaw(rawPayload: string | null) {
  const raw = parseRaw(rawPayload);
  if (!raw) return null;
  for (const key of RUNNING_BALANCE_KEYS) {
    const value = parseNumber(raw[key]);
    if (value !== null) return value;
  }
  return null;
}

function rawSequence(rawPayload: string | null) {
  const raw = parseRaw(rawPayload);
  const value = parseNumber(raw?.sequenceNumber ?? raw?.defaultSeq);
  return value === null ? "" : String(value).padStart(10, "0");
}

function prepareTransactions(transactions: BackfillTransactionInput[]) {
  const prepared: PreparedTransaction[] = [];
  for (const transaction of transactions) {
    const day = transactionDay(transaction);
    if (!day) continue;
    const timestamp = transactionTimestamp(transaction);
    prepared.push({
      day,
      timestamp,
      sortKey: `${day}|${timestamp ?? ""}|${rawSequence(transaction.rawPayload)}`,
      amount: transaction.amount,
      currency: transaction.currency || "TWD",
      runningBalance: runningBalanceFromRaw(transaction.rawPayload),
    });
  }
  return prepared.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}

/**
 * 當日日終餘額：鏈的終點是「交易後餘額不是其他任何一筆的交易前餘額」的那筆；
 * 無法唯一判定時退回排序後最後一筆。
 */
function dayEndBalance(transactions: PreparedTransaction[]) {
  const ends = transactions.filter(
    (transaction) =>
      !transactions.some(
        (other) =>
          other !== transaction &&
          other.runningBalance! - other.amount === transaction.runningBalance,
      ),
  );
  return ends.length === 1
    ? ends[0]!.runningBalance!
    : transactions.at(-1)!.runningBalance!;
}

function enumerateDates(from: string, to: string) {
  const dates: string[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
  return dates;
}

export type PlanDepositBackfillInput = {
  accounts: BackfillAccountInput[];
  transactions: BackfillTransactionInput[];
  syncMonths: number;
};

export function planDepositBackfill({
  accounts,
  transactions,
  syncMonths,
}: PlanDepositBackfillInput): BackfillPlan {
  const byAccount = new Map<string, BackfillTransactionInput[]>();
  for (const transaction of transactions) {
    const list = byAccount.get(transaction.accountId) ?? [];
    list.push(transaction);
    byAccount.set(transaction.accountId, list);
  }

  type Candidate = {
    account: BackfillAccountInput & {
      anchor: NonNullable<BackfillAccountInput["anchor"]>;
    };
    anchorDay: string;
    anchorTime: number;
    transactions: PreparedTransaction[];
  };

  const reports: AccountBackfillReport[] = [];
  const candidates: Candidate[] = [];
  const carryBack: Array<
    BackfillAccountInput & {
      anchor: NonNullable<BackfillAccountInput["anchor"]>;
    }
  > = [];
  const skip = (
    account: BackfillAccountInput,
    reason: BackfillSkipReason,
    extra: Partial<AccountBackfillReport> = {},
  ) =>
    reports.push({
      accountId: account.id,
      connectorId: account.connectorId,
      accountLast4: account.accountLast4,
      status: "skipped",
      reason,
      days: 0,
      methods: {},
      ...extra,
    });

  for (const account of accounts) {
    if (
      INCOMPLETE_DEPOSIT_DETAIL_CONNECTORS.has(account.connectorId) ||
      !TRUSTED_DEPOSIT_DETAIL_CONNECTORS.has(account.connectorId)
    ) {
      if (account.anchor)
        carryBack.push({ ...account, anchor: account.anchor });
      else
        skip(
          account,
          INCOMPLETE_DEPOSIT_DETAIL_CONNECTORS.has(account.connectorId)
            ? "deposit_details_may_be_incomplete"
            : "connector_without_deposit_details",
        );
      continue;
    }
    if (!account.anchor) {
      skip(account, "no_real_snapshot");
      continue;
    }
    const anchor = account.anchor;
    const anchorTime = Date.parse(anchor.asOfAt);
    const anchorDay = taipeiDay(anchor.asOfAt);
    // 錨點之後的交易不影響錨點之前的餘額；同日只有日期的交易視為發生在錨點之前。
    const prepared = prepareTransactions(
      byAccount.get(account.id) ?? [],
    ).filter(
      (transaction) =>
        transaction.day < anchorDay ||
        (transaction.day === anchorDay &&
          (transaction.timestamp === null ||
            transaction.timestamp <= anchorTime)),
    );
    const anchorCurrency = anchor.currency || "TWD";
    if (
      prepared.some((transaction) => transaction.currency !== anchorCurrency)
    ) {
      skip(account, "mixed_currency");
      continue;
    }
    candidates.push({
      account: { ...account, anchor },
      anchorDay,
      anchorTime,
      transactions: prepared,
    });
  }

  // 所有可推算帳戶一律從「其中最早的交易日」開始（不早於各自的同步明細範圍與開戶日），
  // 讓各帳戶在同一區間都有值，避免總額因部分帳戶沒有推算值而出現假性跳動。
  const transactionDays = candidates.flatMap((candidate) =>
    candidate.transactions.map((tx) => tx.day),
  );
  const globalStart = transactionDays.length
    ? transactionDays.reduce((min, day) => (day < min ? day : min))
    : null;

  const snapshots: DerivedBalanceSnapshot[] = [];

  for (const candidate of candidates) {
    const { account, anchorDay, transactions: txs } = candidate;
    let start = globalStart;
    if (!start) {
      skip(account, "no_transactions");
      continue;
    }
    const windowStart = subtractMonths(anchorDay, syncMonths);
    if (start < windowStart) start = windowStart;
    if (account.openedDate && start < account.openedDate)
      start = account.openedDate;
    const end = addDays(anchorDay, -1);
    if (start > end) {
      reports.push({
        accountId: account.id,
        connectorId: account.connectorId,
        accountLast4: account.accountLast4,
        status: "backfilled",
        days: 0,
        methods: {},
      });
      continue;
    }
    const dates = enumerateDates(start, end);

    // 倒推：balance(D) = anchor − Σ(D 之後、錨點之前的交易)。
    const sumAfter = new Map<string, number>();
    {
      let running = 0;
      let index = txs.length - 1;
      for (let i = dates.length - 1; i >= 0; i -= 1) {
        const date = dates[i]!;
        while (index >= 0 && txs[index]!.day > date) {
          running += txs[index]!.amount;
          index -= 1;
        }
        sumAfter.set(date, running);
      }
    }
    const reverse = (date: string) =>
      account.anchor.balance - (sumAfter.get(date) ?? 0);

    // 交易後餘額：每日取日終餘額，沒有交易的日子延續前一日；第一筆交易之前用其交易前餘額。
    const hasRunning =
      txs.length > 0 && txs.every((tx) => tx.runningBalance !== null);
    const runningByDate = new Map<string, number>();
    if (hasRunning) {
      const byDay = new Map<string, PreparedTransaction[]>();
      for (const tx of txs) {
        const list = byDay.get(tx.day) ?? [];
        list.push(tx);
        byDay.set(tx.day, list);
      }
      const days = [...byDay.keys()].sort();
      const firstDayTxs = byDay.get(days[0]!)!;
      let current =
        dayEndBalance(firstDayTxs) -
        firstDayTxs.reduce((sum, tx) => sum + tx.amount, 0);
      let dayIndex = 0;
      for (const date of dates) {
        while (dayIndex < days.length && days[dayIndex]! <= date) {
          current = dayEndBalance(byDay.get(days[dayIndex]!)!);
          dayIndex += 1;
        }
        runningByDate.set(date, current);
      }
    }

    const methods: Partial<Record<BackfillMethod, number>> = {};
    const mismatches: string[] = [];
    const planned: DerivedBalanceSnapshot[] = [];
    for (const date of dates) {
      const reverseValue = reverse(date);
      const runningValue = runningByDate.get(date);
      let method: BackfillMethod = "reverse_sum";
      let balance = reverseValue;
      if (runningValue !== undefined) {
        if (Math.abs(runningValue - reverseValue) > CROSS_CHECK_TOLERANCE) {
          // 以真實快照為準：該日採倒推值。
          mismatches.push(date);
        } else {
          method = "running_balance";
          balance = runningValue;
        }
      }
      methods[method] = (methods[method] ?? 0) + 1;
      planned.push({
        accountId: account.id,
        connectorId: account.connectorId,
        date,
        balance: Math.round(balance),
        currency: account.anchor.currency || "TWD",
        method,
      });
    }

    const crossCheck = hasRunning
      ? {
          comparedDays: dates.length,
          mismatchDays: mismatches.length,
          ...(mismatches.length
            ? {
                firstMismatch: mismatches[0],
                lastMismatch: mismatches.at(-1),
              }
            : {}),
        }
      : undefined;

    snapshots.push(...planned);
    reports.push({
      accountId: account.id,
      connectorId: account.connectorId,
      accountLast4: account.accountLast4,
      status: "backfilled",
      from: start,
      to: end,
      days: dates.length,
      methods,
      ...(crossCheck ? { crossCheck } : {}),
    });
  }

  // 明細不完整的帳戶：以第一筆真實快照的餘額往前延伸到同一起始日。
  for (const account of carryBack) {
    const anchorDay = taipeiDay(account.anchor.asOfAt);
    let start = globalStart;
    if (!start) {
      skip(account, "no_transactions");
      continue;
    }
    const windowStart = subtractMonths(anchorDay, syncMonths);
    if (start < windowStart) start = windowStart;
    if (account.openedDate && start < account.openedDate)
      start = account.openedDate;
    const end = addDays(anchorDay, -1);
    const dates = start > end ? [] : enumerateDates(start, end);
    for (const date of dates)
      snapshots.push({
        accountId: account.id,
        connectorId: account.connectorId,
        date,
        balance: Math.round(account.anchor.balance),
        currency: account.anchor.currency || "TWD",
        method: "carry_back",
      });
    reports.push({
      accountId: account.id,
      connectorId: account.connectorId,
      accountLast4: account.accountLast4,
      status: "backfilled",
      ...(dates.length ? { from: start, to: end } : {}),
      days: dates.length,
      methods: dates.length ? { carry_back: dates.length } : {},
    });
  }

  const order = new Map(accounts.map((account, index) => [account.id, index]));
  reports.sort(
    (a, b) => (order.get(a.accountId) ?? 0) - (order.get(b.accountId) ?? 0),
  );
  return { snapshots, accounts: reports };
}
