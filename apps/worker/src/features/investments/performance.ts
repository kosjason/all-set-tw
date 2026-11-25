/**
 * 投資績效的純計算：由集保交易、持股快照、銀行扣款與收盤價推算每個部位的本金、
 * 已實現與未實現損益、配息。不存取 D1，也不抓股價。
 *
 * 部位以「帳戶 + 代號」區分（同一檔在兩家券商各算各的）。成本採移動平均：
 * - 買進：當天有銀行「證券定期」扣款時用實際金額（同一天多檔依收盤價 × 股數分攤，
 *   與估算差太多就不採用）；否則用收盤價 × 股數加估算手續費。
 * - 賣出：收盤價 × 股數扣掉估算手續費與證交稅為收入，減去平均成本即為已實現損益。
 * - 分割：同帳戶同一天的「分割轉出」與「分割轉入」配對，成本整筆移轉（例如
 *   0050 → 0050O → 0050），股數依集保紀錄。
 * - 期初持股：集保最早一筆紀錄之前就有的股數，以那天的收盤價估算，或用使用者填的成本。
 * 集保每筆紀錄都附異動後餘額，逐筆核對；對不起來的部位不給成本，避免顯示錯的數字。
 */
import type {
  InvestmentCostIssue,
  InvestmentCostSource,
  InvestmentEvent,
  InvestmentHistoryPoint,
  InvestmentHolding,
  InvestmentPerformance,
  InvestmentUnattributedDividend,
} from "@taiwan-fin-hub/shared";

/** 券商手續費率（未打折）。 */
export const BROKER_FEE_RATE = 0.001425;
/** 整股（1,000 股的倍數）的最低手續費。 */
export const BOARD_LOT_MIN_FEE = 20;
/** 零股的最低手續費。 */
export const ODD_LOT_MIN_FEE = 1;
/** 證交稅：股票 0.3%、ETF 0.1%、債券 ETF 免徵。 */
export const STOCK_TAX_RATE = 0.003;
export const ETF_TAX_RATE = 0.001;
/** 銀行扣款與估算金額相差超過這個比例就不視為同一筆。 */
export const BANK_MATCH_TOLERANCE = 0.03;

const BUY_CODE = "113";
const SELL_CODE = "123";
const SPLIT_IN_CODE = "1F5";
const SPLIT_OUT_CODE = "1G5";

/** 配息歸給同代號持股九成以上的帳戶。 */
const DOMINANT_ACCOUNT_SHARE = 0.9;

/** 定期定額的銀行扣款（台幣、支出）。 */
const REGULAR_INVESTMENT_DEBIT = /證券定期/u;
/** 配息、收益分配的銀行入帳。 */
const DIVIDEND_CREDIT = /配息|收益分配|股息|股利/u;
/** 複委託（海外股票）不在集保，排除。 */
const FOREIGN_BROKERAGE = /複委託/u;

export type PerformanceTransactionInput = {
  id: string;
  /** 券商代號:帳號。 */
  accountId: string;
  brokerNo: string | null;
  brokerName: string | null;
  symbol: string;
  name: string | null;
  assetType: string | null;
  /** 台北日期 YYYY-MM-DD。 */
  date: string;
  code: string | null;
  /** 集保的借貸別：in 為增加、out 為減少；缺資料為 null（改用交易代碼判斷）。 */
  direction: "in" | "out" | null;
  quantity: number;
  /** 異動後餘額。 */
  balanceAfter: number | null;
};

export type PerformancePositionInput = {
  accountId: string;
  symbol: string;
  name: string;
  assetType: "stock" | "etf" | "fund";
  brokerNo: string | null;
  brokerName: string | null;
  quantity: number;
  marketValue: number;
  date: string;
};

export type PerformanceHistoryInput = {
  accountId: string;
  symbol: string;
  date: string;
  marketValue: number;
};

export type BankFlowInput = {
  date: string;
  amount: number;
  description: string;
};

export interface PriceBook {
  /** 該日（或往前 7 天內最近一個交易日）的收盤價。 */
  close(symbol: string, date: string): number | undefined;
  /** 這天的收盤價之後還可能補到（月份還沒抓完）。 */
  pending(symbol: string, date: string): boolean;
}

export type PerformanceInput = {
  transactions: PerformanceTransactionInput[];
  /** 每個部位最新的持股快照。 */
  positions: PerformancePositionInput[];
  /** 每天的持股快照（畫市值走勢）。 */
  history: PerformanceHistoryInput[];
  bankFlows: BankFlowInput[];
  /** 最早一筆銀行交易日期（配息資料的起點）。 */
  bankDataSince: string | null;
  prices: PriceBook;
  /** 使用者填的期初成本（key 為部位 key）。 */
  openingCosts: ReadonlyMap<string, number>;
  /** 今天（台北日期）。 */
  today: string;
};

/** 部位 key：券商代號:帳號:代號。 */
export function holdingKey(accountId: string, symbol: string) {
  return `${accountId}:${symbol}`;
}

export function isBondEtf(symbol: string) {
  return /^\d+B$/u.test(symbol);
}

export function brokerFee(gross: number, quantity: number) {
  const minimum = quantity % 1000 === 0 ? BOARD_LOT_MIN_FEE : ODD_LOT_MIN_FEE;
  return Math.max(Math.floor(gross * BROKER_FEE_RATE), minimum);
}

export function transactionTax(
  gross: number,
  symbol: string,
  assetType: string | null,
) {
  if (isBondEtf(symbol)) return 0;
  const rate = assetType === "stock" ? STOCK_TAX_RATE : ETF_TAX_RATE;
  return Math.floor(gross * rate);
}

type EventKind = "buy" | "sell" | "split_in" | "split_out" | "other";

function eventKind(row: PerformanceTransactionInput): EventKind {
  if (row.code === BUY_CODE) return "buy";
  if (row.code === SELL_CODE) return "sell";
  if (row.code === SPLIT_IN_CODE) return "split_in";
  if (row.code === SPLIT_OUT_CODE) return "split_out";
  return "other";
}

function signedQuantity(row: PerformanceTransactionInput) {
  const direction =
    row.direction ??
    (row.code === BUY_CODE || row.code === SPLIT_IN_CODE
      ? "in"
      : row.code === SELL_CODE || row.code === SPLIT_OUT_CODE
        ? "out"
        : null);
  if (direction === "in") return row.quantity;
  if (direction === "out") return -row.quantity;
  return null;
}

function sameQuantity(a: number, b: number) {
  return Math.abs(a - b) < 1e-6;
}

/**
 * 同一部位同一天有多筆時，依異動後餘額排出能逐筆接上的順序。
 * 接不上（或缺餘額）時保留原順序並回報 ok=false。
 */
export function orderByBalance(
  rows: PerformanceTransactionInput[],
  start: number,
): { rows: PerformanceTransactionInput[]; ok: boolean; end: number } {
  const remaining = [...rows];
  const ordered: PerformanceTransactionInput[] = [];
  let running = start;
  while (remaining.length > 0) {
    const index = remaining.findIndex((row) => {
      const signed = signedQuantity(row);
      return (
        signed != null &&
        row.balanceAfter != null &&
        sameQuantity(running + signed, row.balanceAfter)
      );
    });
    if (index < 0) {
      for (const row of remaining) running += signedQuantity(row) ?? 0;
      return { rows: [...ordered, ...remaining], ok: false, end: running };
    }
    const [row] = remaining.splice(index, 1);
    ordered.push(row!);
    running = row!.balanceAfter!;
  }
  return { rows: ordered, ok: true, end: running };
}

/**
 * 由第一天的紀錄推出期初股數：找一個能讓當天所有紀錄逐筆接上的起點。
 * 同一天買進又賣出時可能有多個起點都接得上（例如先買 100 再賣 100，或先賣 100 再買 100），
 * 取最小的：沒有證據時不假設之前就有持股。
 */
export function openingQuantity(firstDay: PerformanceTransactionInput[]) {
  const candidates = new Set<number>();
  for (const row of firstDay) {
    const signed = signedQuantity(row);
    if (signed != null && row.balanceAfter != null)
      candidates.add(row.balanceAfter - signed);
  }
  for (const candidate of [...candidates].sort((a, b) => a - b)) {
    if (candidate < -1e-6) continue;
    if (orderByBalance(firstDay, candidate).ok)
      return { quantity: Math.max(0, candidate), ok: true };
  }
  const first = firstDay[0];
  const signed = first ? signedQuantity(first) : null;
  const fallback =
    first && signed != null && first.balanceAfter != null
      ? Math.max(0, first.balanceAfter - signed)
      : 0;
  return { quantity: fallback, ok: candidates.size === 0 };
}

const COST_SOURCES: InvestmentCostSource[] = [
  "bank",
  "estimate",
  "opening",
  "manual",
];

function emptyParts(): Record<InvestmentCostSource, number> {
  return { bank: 0, estimate: 0, opening: 0, manual: 0 };
}

type CostPoint = {
  date: string;
  cost: number | null;
  parts: Record<InvestmentCostSource, number>;
};

type HoldingState = {
  key: string;
  accountId: string;
  symbol: string;
  name: string;
  assetType: string | null;
  brokerNo: string | null;
  brokerName: string | null;
  quantity: number;
  cost: number;
  costKnown: boolean;
  parts: Record<InvestmentCostSource, number>;
  realized: number;
  realizedKnown: boolean;
  dividends: number;
  events: (InvestmentEvent & { order: number })[];
  issues: Set<InvestmentCostIssue>;
  /** 曾經缺收盤價的日期（含已賣出的部分，影響已實現損益）。 */
  missingDates: Set<string>;
  pendingPrice: boolean;
  /** 目前這批持股（上次歸零之後）缺收盤價的日期，影響本金。 */
  lotMissingDates: Set<string>;
  lotPendingPrice: boolean;
  opening: InvestmentHolding["opening"];
  costPoints: CostPoint[];
  /** 每個日期結束時的股數（核對持股快照用）。 */
  quantityPoints: { date: string; quantity: number }[];
};

type SplitPoolEntry = {
  symbol: string;
  cost: number;
  costKnown: boolean;
  parts: Record<InvestmentCostSource, number>;
  used: boolean;
  source: HoldingState;
  missingDates: Set<string>;
  pendingPrice: boolean;
};

type BuyCost = {
  amount: number;
  source: "bank" | "estimate";
  price: number;
};

function normalizeDescription(value: string) {
  return value.replace(/\s+/gu, " ").trim();
}

function round(value: number) {
  return Math.round(value);
}

function roundPrice(value: number) {
  return Math.round(value * 100) / 100;
}

/**
 * 同一天的買進成本：有「證券定期」扣款時依收盤價 × 股數分攤實際金額，
 * 並記錄估算與實際的誤差；否則回傳 undefined（改用估算）。
 */
function allocateBankDebits(
  buys: PerformanceTransactionInput[],
  debitTotal: number,
  prices: PriceBook,
): {
  costs: Map<string, BuyCost> | null;
  sample: { estimated: number; actual: number } | null;
} {
  const grosses = buys.map((row) => {
    const close = prices.close(row.symbol, row.date);
    return close == null ? null : close * row.quantity;
  });
  const known = grosses.every((gross): gross is number => gross != null);
  if (!known) {
    // 只有一筆買進時，整筆扣款都是它的成本，不需要收盤價。
    if (buys.length !== 1) return { costs: null, sample: null };
    const row = buys[0]!;
    return {
      costs: new Map([
        [
          row.id,
          {
            amount: debitTotal,
            source: "bank",
            price: debitTotal / row.quantity,
          },
        ],
      ]),
      sample: null,
    };
  }
  const grossTotal = grosses.reduce((sum, gross) => sum + gross, 0);
  if (grossTotal <= 0) return { costs: null, sample: null };
  const estimated = buys.reduce(
    (sum, row, index) =>
      sum + grosses[index]! + brokerFee(grosses[index]!, row.quantity),
    0,
  );
  const sample = { estimated, actual: debitTotal };
  const ratio = debitTotal / grossTotal;
  if (Math.abs(ratio - 1) > BANK_MATCH_TOLERANCE)
    return { costs: null, sample: null };
  const costs = new Map<string, BuyCost>();
  buys.forEach((row, index) => {
    const amount = (debitTotal * grosses[index]!) / grossTotal;
    costs.set(row.id, {
      amount,
      source: "bank",
      price: amount / row.quantity,
    });
  });
  return { costs, sample };
}

function addEvent(
  state: HoldingState,
  event: InvestmentEvent,
  order: number,
): void {
  state.events.push({ ...event, order });
}

/** 記錄缺價的日期；賣出缺價只影響已實現損益，不影響剩下持股的本金（affectsCost = false）。 */
function recordMissingPrice(
  state: HoldingState,
  prices: PriceBook,
  date: string,
  affectsCost = true,
) {
  const pending = prices.pending(state.symbol, date);
  state.missingDates.add(date);
  if (pending) state.pendingPrice = true;
  if (!affectsCost) return;
  state.lotMissingDates.add(date);
  if (pending) state.lotPendingPrice = true;
}

/**
 * 同一天的處理順序：每個部位維持依餘額排好的順序；分割轉入要等同帳戶、相關代號的
 * 分割轉出先處理（成本才能移轉），其他部位不受影響。互相等待時依序放行（之後標為配對不到）。
 */
export function sameDaySequence(rows: PerformanceTransactionInput[]) {
  const queues = new Map<string, PerformanceTransactionInput[]>();
  for (const row of rows) {
    const key = holdingKey(row.accountId, row.symbol);
    const queue = queues.get(key) ?? [];
    queue.push(row);
    queues.set(key, queue);
  }
  const scheduled = new Set<PerformanceTransactionInput>();
  const sequence: PerformanceTransactionInput[] = [];
  // 已排入、還沒被分割轉入接手的分割轉出（與計算時的分割池一致）。
  const available: PerformanceTransactionInput[] = [];
  const related = (
    out: PerformanceTransactionInput,
    row: PerformanceTransactionInput,
  ) =>
    out.accountId === row.accountId && relatedSymbols(out.symbol, row.symbol);
  // 分割轉入：有可接手的轉出就能處理；沒有、但之後還會有相關的轉出時才等待。
  const ready = (row: PerformanceTransactionInput) =>
    eventKind(row) !== "split_in" ||
    available.some((out) => related(out, row)) ||
    !rows.some(
      (other) =>
        eventKind(other) === "split_out" &&
        related(other, row) &&
        !scheduled.has(other),
    );
  const take = (queue: PerformanceTransactionInput[]) => {
    const row = queue.shift()!;
    scheduled.add(row);
    sequence.push(row);
    if (eventKind(row) === "split_out") available.push(row);
    if (eventKind(row) === "split_in") {
      const index = available.findIndex((out) => related(out, row));
      if (index >= 0) available.splice(index, 1);
    }
  };
  while (queues.size > 0) {
    let progressed = false;
    for (const [key, queue] of queues) {
      while (queue.length > 0 && ready(queue[0]!)) {
        take(queue);
        progressed = true;
      }
      if (queue.length === 0) queues.delete(key);
    }
    if (!progressed) {
      const [key, queue] = queues.entries().next().value!;
      take(queue);
      if (queue.length === 0) queues.delete(key);
    }
  }
  return sequence;
}

/** 全部賣出或轉出後重新開始：之前缺價的不確定性不影響之後再買的部位（已實現損益仍維持未知）。 */
function resetWhenEmpty(state: HoldingState) {
  if (state.quantity > 1e-6) return;
  state.quantity = 0;
  state.cost = 0;
  state.parts = emptyParts();
  state.costKnown = true;
  state.lotMissingDates = new Set();
  state.lotPendingPrice = false;
}

/** 依目前持股比例取出部分成本（賣出、分割轉出用）。 */
function takeCost(state: HoldingState, quantity: number) {
  const ratio = state.quantity > 0 ? Math.min(1, quantity / state.quantity) : 0;
  const cost = state.cost * ratio;
  const parts = emptyParts();
  for (const source of COST_SOURCES) {
    parts[source] = state.parts[source] * ratio;
    state.parts[source] -= parts[source];
  }
  state.cost -= cost;
  return { cost, parts };
}

function relatedSymbols(a: string, b: string) {
  return a !== b && (a.startsWith(b) || b.startsWith(a));
}

export function computeInvestmentPerformance(
  input: PerformanceInput,
): InvestmentPerformance {
  const { prices } = input;
  const holdings = new Map<string, HoldingState>();
  const latestByKey = new Map<string, PerformanceTransactionInput>();
  for (const row of input.transactions)
    latestByKey.set(holdingKey(row.accountId, row.symbol), row);

  function stateFor(row: {
    accountId: string;
    symbol: string;
    name: string | null;
    assetType: string | null;
    brokerNo: string | null;
    brokerName: string | null;
  }) {
    const key = holdingKey(row.accountId, row.symbol);
    let state = holdings.get(key);
    if (!state) {
      state = {
        key,
        accountId: row.accountId,
        symbol: row.symbol,
        name: row.name ?? row.symbol,
        assetType: row.assetType,
        brokerNo: row.brokerNo,
        brokerName: row.brokerName,
        quantity: 0,
        cost: 0,
        costKnown: true,
        parts: emptyParts(),
        realized: 0,
        realizedKnown: true,
        dividends: 0,
        events: [],
        issues: new Set(),
        missingDates: new Set(),
        pendingPrice: false,
        lotMissingDates: new Set(),
        lotPendingPrice: false,
        opening: null,
        costPoints: [],
        quantityPoints: [],
      };
      holdings.set(key, state);
    }
    return state;
  }

  // 1. 依部位排好順序、核對餘額、推出期初股數。
  const byKey = new Map<string, PerformanceTransactionInput[]>();
  for (const row of input.transactions) {
    const key = holdingKey(row.accountId, row.symbol);
    const list = byKey.get(key) ?? [];
    list.push(row);
    byKey.set(key, list);
  }
  const orderedRows: PerformanceTransactionInput[] = [];
  for (const [key, rows] of byKey) {
    const state = stateFor(latestByKey.get(key)!);
    const dates = [...new Set(rows.map((row) => row.date))].sort();
    const firstDay = rows.filter((row) => row.date === dates[0]);
    const opening = openingQuantity(firstDay);
    if (!opening.ok) state.issues.add("quantity_mismatch");
    if (opening.quantity > 0) {
      state.opening = {
        quantity: opening.quantity,
        date: dates[0] ?? null,
        cost: null,
        manual: false,
      };
    }
    let running = opening.quantity;
    for (const date of dates) {
      const day = orderByBalance(
        rows.filter((row) => row.date === date),
        running,
      );
      if (!day.ok) state.issues.add("quantity_mismatch");
      running = day.end;
      orderedRows.push(...day.rows);
    }
  }

  // 2. 期初持股的成本。
  for (const state of holdings.values()) {
    const opening = state.opening;
    if (!opening) continue;
    const manual = input.openingCosts.get(state.key);
    let cost: number | null = null;
    let source: InvestmentCostSource = "opening";
    let price: number | null = null;
    if (manual != null) {
      cost = manual;
      source = "manual";
      price = manual / opening.quantity;
    } else if (opening.date) {
      const close = prices.close(state.symbol, opening.date);
      if (close != null) {
        cost = close * opening.quantity;
        price = close;
      } else {
        recordMissingPrice(state, prices, opening.date);
      }
    }
    opening.cost = cost == null ? null : round(cost);
    opening.manual = manual != null;
    state.quantity = opening.quantity;
    if (cost == null) {
      state.costKnown = false;
      if (!opening.date) state.issues.add("opening_unpriced");
    } else {
      state.cost = cost;
      state.parts[source] += cost;
    }
    addEvent(
      state,
      {
        date: opening.date ?? "",
        kind: "opening",
        quantity: opening.quantity,
        price: price == null ? null : roundPrice(price),
        amount: cost == null ? null : round(cost),
        costSource: source,
        realizedPnl: null,
        quantityAfter: opening.quantity,
      },
      -1,
    );
  }

  // 3. 銀行定期定額扣款：依日期分攤到當天的買進。
  const debitsByDate = new Map<string, number>();
  for (const flow of input.bankFlows) {
    const description = normalizeDescription(flow.description);
    if (
      flow.amount < 0 &&
      REGULAR_INVESTMENT_DEBIT.test(description) &&
      !FOREIGN_BROKERAGE.test(description)
    )
      debitsByDate.set(
        flow.date,
        (debitsByDate.get(flow.date) ?? 0) - flow.amount,
      );
  }
  const buyCosts = new Map<string, BuyCost>();
  const samples: { estimated: number; actual: number }[] = [];
  for (const [date, total] of debitsByDate) {
    const buys = orderedRows.filter(
      (row) => row.date === date && eventKind(row) === "buy",
    );
    if (buys.length === 0) continue;
    const allocation = allocateBankDebits(buys, total, prices);
    if (allocation.sample) samples.push(allocation.sample);
    for (const [id, cost] of allocation.costs ?? []) buyCosts.set(id, cost);
  }

  // 4. 依日期處理事件。
  const dates = [...new Set(orderedRows.map((row) => row.date))].sort();
  let order = 0;
  for (const date of dates) {
    const rows = orderedRows.filter((row) => row.date === date);
    const pools = new Map<string, SplitPoolEntry[]>();
    const sequence = sameDaySequence(rows);
    const touched = new Set<HoldingState>();
    for (const row of sequence) {
      const state = stateFor(row);
      touched.add(state);
      const kind = eventKind(row);
      const quantity = row.quantity;
      order += 1;
      if (kind === "buy") {
        let cost = buyCosts.get(row.id);
        if (!cost) {
          const close = prices.close(row.symbol, date);
          if (close != null) {
            const gross = close * quantity;
            cost = {
              amount: gross + brokerFee(gross, quantity),
              source: "estimate",
              price: close,
            };
          }
        }
        state.quantity += quantity;
        if (cost) {
          state.cost += cost.amount;
          state.parts[cost.source] += cost.amount;
        } else {
          state.costKnown = false;
          recordMissingPrice(state, prices, date);
        }
        addEvent(
          state,
          {
            date,
            kind: "buy",
            quantity,
            price: cost ? roundPrice(cost.price) : null,
            amount: cost ? round(cost.amount) : null,
            costSource: cost?.source ?? null,
            realizedPnl: null,
            quantityAfter: state.quantity,
          },
          order,
        );
      } else if (kind === "sell") {
        const close = prices.close(row.symbol, date);
        const taken = takeCost(state, quantity);
        state.quantity -= quantity;
        let proceeds: number | null = null;
        let realized: number | null = null;
        if (close != null) {
          const gross = close * quantity;
          proceeds =
            gross -
            brokerFee(gross, quantity) -
            transactionTax(gross, row.symbol, state.assetType);
          if (state.costKnown) realized = proceeds - taken.cost;
        } else {
          recordMissingPrice(state, prices, date, false);
        }
        if (realized == null) state.realizedKnown = false;
        else state.realized += realized;
        resetWhenEmpty(state);
        addEvent(
          state,
          {
            date,
            kind: "sell",
            quantity,
            price: close ?? null,
            amount: proceeds == null ? null : round(proceeds),
            costSource: null,
            realizedPnl: realized == null ? null : round(realized),
            quantityAfter: state.quantity,
          },
          order,
        );
      } else if (kind === "split_out") {
        const taken = takeCost(state, quantity);
        state.quantity -= quantity;
        const pool = pools.get(row.accountId) ?? [];
        pool.push({
          symbol: row.symbol,
          cost: taken.cost,
          costKnown: state.costKnown,
          parts: taken.parts,
          used: false,
          source: state,
          missingDates: new Set(state.lotMissingDates),
          pendingPrice: state.lotPendingPrice,
        });
        pools.set(row.accountId, pool);
        resetWhenEmpty(state);
        addEvent(
          state,
          {
            date,
            kind: "split_out",
            quantity,
            price: null,
            amount: null,
            costSource: null,
            realizedPnl: null,
            quantityAfter: state.quantity,
          },
          order,
        );
      } else if (kind === "split_in") {
        const candidates = (pools.get(row.accountId) ?? []).filter(
          (entry) => !entry.used && relatedSymbols(entry.symbol, row.symbol),
        );
        state.quantity += quantity;
        if (candidates.length === 1) {
          const entry = candidates[0]!;
          entry.used = true;
          state.cost += entry.cost;
          for (const source of COST_SOURCES)
            state.parts[source] += entry.parts[source];
          if (!entry.costKnown) state.costKnown = false;
          for (const missing of entry.missingDates) {
            state.missingDates.add(missing);
            state.lotMissingDates.add(missing);
          }
          if (entry.pendingPrice) {
            state.pendingPrice = true;
            state.lotPendingPrice = true;
          }
        } else {
          state.costKnown = false;
          state.issues.add("split_unmatched");
        }
        addEvent(
          state,
          {
            date,
            kind: "split_in",
            quantity,
            price: null,
            amount: null,
            costSource: null,
            realizedPnl: null,
            quantityAfter: state.quantity,
          },
          order,
        );
      } else {
        const signed = signedQuantity(row) ?? 0;
        if (signed < 0) takeCost(state, -signed);
        state.quantity += signed;
        state.costKnown = false;
        state.issues.add("unknown_event");
      }
    }
    for (const entry of [...pools.values()].flat())
      if (!entry.used) entry.source.issues.add("split_unmatched");
    for (const state of touched) {
      state.costPoints.push({
        date,
        cost: state.costKnown ? state.cost : null,
        parts: { ...state.parts },
      });
      state.quantityPoints.push({ date, quantity: state.quantity });
    }
  }

  // 5. 持股快照：核對股數、補上只有快照沒有交易的部位。
  const positionsByKey = new Map<string, PerformancePositionInput>();
  for (const position of input.positions) {
    const key = holdingKey(position.accountId, position.symbol);
    const existing = positionsByKey.get(key);
    positionsByKey.set(
      key,
      existing
        ? {
            ...existing,
            quantity: existing.quantity + position.quantity,
            marketValue: existing.marketValue + position.marketValue,
          }
        : position,
    );
  }
  for (const [key, position] of positionsByKey) {
    let state = holdings.get(key);
    if (!state) {
      state = stateFor(position);
      const manual = input.openingCosts.get(key);
      state.quantity = position.quantity;
      state.opening = {
        quantity: position.quantity,
        date: null,
        cost: manual ?? null,
        manual: manual != null,
      };
      if (manual != null) {
        state.cost = manual;
        state.parts.manual = manual;
      } else {
        state.costKnown = false;
        state.issues.add("opening_unpriced");
      }
    }
    state.name = position.name;
    state.assetType = position.assetType;
    state.brokerName = position.brokerName ?? state.brokerName;
    const asOf = state.quantityPoints.filter(
      (point) => point.date <= position.date,
    );
    const expected = asOf.length
      ? asOf[asOf.length - 1]!.quantity
      : (state.opening?.quantity ?? 0);
    if (!sameQuantity(expected, position.quantity))
      state.issues.add("quantity_mismatch");
  }
  for (const state of holdings.values()) {
    if (!positionsByKey.has(state.key) && state.quantity > 1e-6)
      state.issues.add("quantity_mismatch");
  }

  // 6. 配息：依銀行說明裡的代號或名稱對回部位。
  const unattributed: InvestmentUnattributedDividend[] = [];
  const dividendEvents = new Map<HoldingState, InvestmentEvent[]>();
  for (const flow of input.bankFlows) {
    const description = normalizeDescription(flow.description);
    if (
      flow.amount <= 0 ||
      !DIVIDEND_CREDIT.test(description) ||
      FOREIGN_BROKERAGE.test(description)
    )
      continue;
    const state = attributeDividend(description, [...holdings.values()]);
    if (!state) {
      unattributed.push({ date: flow.date, amount: flow.amount, description });
      continue;
    }
    state.dividends += flow.amount;
    const list = dividendEvents.get(state) ?? [];
    list.push({
      date: flow.date,
      kind: "dividend",
      quantity: null,
      price: null,
      amount: flow.amount,
      costSource: null,
      realizedPnl: null,
      quantityAfter: 0,
    });
    dividendEvents.set(state, list);
  }

  // 7. 輸出。
  const historyByKey = new Map<string, Map<string, number>>();
  for (const point of input.history) {
    const key = holdingKey(point.accountId, point.symbol);
    const series = historyByKey.get(key) ?? new Map<string, number>();
    series.set(point.date, (series.get(point.date) ?? 0) + point.marketValue);
    historyByKey.set(key, series);
  }

  const open: InvestmentHolding[] = [];
  const closed: InvestmentHolding[] = [];
  for (const state of holdings.values()) {
    const position = positionsByKey.get(state.key);
    const holding = toHolding(
      state,
      position,
      dividendEvents.get(state) ?? [],
      historyByKey.get(state.key),
    );
    if (position && position.quantity > 0) open.push(holding);
    else if (
      holding.events.some(
        (event) => event.kind === "sell" || event.kind === "dividend",
      )
    )
      closed.push(holding);
  }
  open.sort((a, b) => b.marketValue - a.marketValue);
  closed.sort((a, b) => a.symbol.localeCompare(b.symbol));

  const all = [...open, ...closed];
  const sumOrNull = (
    list: InvestmentHolding[],
    pick: (holding: InvestmentHolding) => number | null,
  ) =>
    list.every((holding) => pick(holding) != null)
      ? list.reduce((sum, holding) => sum + pick(holding)!, 0)
      : null;
  const marketValue = open.reduce(
    (sum, holding) => sum + holding.marketValue,
    0,
  );
  const costBasis = sumOrNull(open, (holding) => holding.costBasis);
  const unrealizedPnl = sumOrNull(open, (holding) => holding.unrealizedPnl);
  const realizedPnl = sumOrNull(all, (holding) => holding.realizedPnl);
  const dividends = all.reduce((sum, holding) => sum + holding.dividends, 0);
  const year = input.today.slice(0, 4);
  const dividendsThisYear = all.reduce(
    (sum, holding) =>
      sum +
      holding.events
        .filter(
          (event) => event.kind === "dividend" && event.date.startsWith(year),
        )
        .reduce((total, event) => total + (event.amount ?? 0), 0),
    0,
  );
  const errors = samples
    .filter((sample) => sample.actual > 0)
    .map(
      (sample) =>
        (Math.abs(sample.estimated - sample.actual) / sample.actual) * 100,
    );

  return {
    asOfDate:
      [...positionsByKey.values()]
        .map((position) => position.date)
        .sort()
        .at(-1) ?? null,
    totals: {
      marketValue,
      costBasis,
      unrealizedPnl,
      realizedPnl,
      dividends,
      dividendsThisYear,
      totalReturn:
        unrealizedPnl != null && realizedPnl != null
          ? unrealizedPnl + realizedPnl + dividends
          : null,
      marketValueByCategory: {
        equity: open
          .filter((holding) => holding.category === "equity")
          .reduce((sum, holding) => sum + holding.marketValue, 0),
        bond: open
          .filter((holding) => holding.category === "bond")
          .reduce((sum, holding) => sum + holding.marketValue, 0),
      },
    },
    holdings: open,
    closed,
    unattributedDividends: unattributed,
    dividendsSince: input.bankDataSince,
    estimateCheck: {
      samples: errors.length,
      meanAbsErrorPct: errors.length
        ? Math.round(
            (errors.reduce((sum, error) => sum + error, 0) / errors.length) *
              100,
          ) / 100
        : null,
    },
    pricesPending: [...holdings.values()].some((state) => state.pendingPrice),
  };
}

/** 配息入帳對回部位：說明裡的代號（如「0056FUND」）優先，其次是名稱片段（如「科技優息」）。 */
export function attributeDividend<
  T extends { symbol: string; name: string; quantity: number },
>(description: string, holdings: T[]): T | undefined {
  const tokens = description
    .replace(/^轉帳\s*/u, "")
    .replace(/(基金)?(配息|收益分配|股息|股利)/gu, " ")
    .split(/\s+/u)
    .map((token) => token.replace(/FUND$/iu, "").trim())
    .filter((token) => token.length >= 2);
  // 同一代號分屬多個帳戶時，入帳說明分不出是哪個帳戶：只有一個帳戶持有九成以上股數時
  // 才歸給它（例如另一個帳戶只有 1 股），否則不歸屬。
  const pick = (matches: T[]) => {
    if (matches.length === 0) return undefined;
    const best = matches.reduce((top, holding) =>
      holding.quantity > top.quantity ? holding : top,
    );
    if (matches.length === 1) return best;
    const total = matches.reduce((sum, holding) => sum + holding.quantity, 0);
    return total > 0 && best.quantity / total >= DOMINANT_ACCOUNT_SHARE
      ? best
      : undefined;
  };
  const bySymbol = holdings.filter((holding) =>
    tokens.some((token) => token.toUpperCase() === holding.symbol),
  );
  if (bySymbol.length > 0) return pick(bySymbol);
  const byName = holdings.filter((holding) =>
    tokens.some((token) => !/^\d/u.test(token) && holding.name.includes(token)),
  );
  // 名稱片段對到不同代號時無法判斷。
  if (new Set(byName.map((holding) => holding.symbol)).size !== 1)
    return undefined;
  return pick(byName);
}

function toHolding(
  state: HoldingState,
  position: PerformancePositionInput | undefined,
  dividends: InvestmentEvent[],
  history: Map<string, number> | undefined,
): InvestmentHolding {
  const quantity = position?.quantity ?? state.quantity;
  const marketValue = position?.marketValue ?? 0;
  // 集保交易可能比持股快照新（同步時間不同）：本金取快照當天的，與股數、市值同一天。
  let currentCost: number | null = state.costKnown ? state.cost : null;
  let currentParts = state.parts;
  if (
    position &&
    state.costPoints.some((point) => point.date > position.date)
  ) {
    const before = state.costPoints.filter(
      (point) => point.date <= position.date,
    );
    const point = before[before.length - 1];
    if (point) {
      currentCost = point.cost;
      currentParts = point.parts;
    } else {
      // 快照早於第一筆交易：只有期初持股。
      currentCost = state.opening?.cost ?? null;
      currentParts = emptyParts();
      if (currentCost != null)
        currentParts[state.opening?.manual ? "manual" : "opening"] =
          currentCost;
    }
  }
  const consistent =
    !state.issues.has("quantity_mismatch") &&
    !state.issues.has("unknown_event");
  const reliable = consistent && currentCost != null;
  const costBasis = reliable ? (quantity > 0 ? round(currentCost!) : 0) : null;
  const unrealizedPnl =
    costBasis == null ? null : quantity > 0 ? marketValue - costBasis : 0;
  const realizedPnl =
    consistent && state.realizedKnown ? round(state.realized) : null;
  const issues = new Set(state.issues);
  // 本金缺價看目前這批持股；已實現損益未知時看全部。
  const priceGap =
    state.lotMissingDates.size > 0
      ? { dates: state.lotMissingDates, pending: state.lotPendingPrice }
      : !state.realizedKnown && state.missingDates.size > 0
        ? { dates: state.missingDates, pending: state.pendingPrice }
        : null;
  if (priceGap)
    issues.add(priceGap.pending ? "prices_pending" : "price_missing");

  // 配息事件依日期插入，股數沿用當時的持股。
  const timeline = [
    ...state.events,
    ...dividends.map((event, index) => ({
      ...event,
      order: Number.MAX_SAFE_INTEGER - dividends.length + index,
    })),
  ].sort((a, b) =>
    a.date === b.date ? a.order - b.order : a.date < b.date ? -1 : 1,
  );
  let held = 0;
  const events: InvestmentEvent[] = timeline.map(
    ({ order: _order, ...event }) => {
      if (event.kind === "dividend") return { ...event, quantityAfter: held };
      held = event.quantityAfter;
      return event;
    },
  );

  const points: InvestmentHistoryPoint[] = [...(history ?? new Map())]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, value]) => {
      const before = state.costPoints.filter((point) => point.date <= date);
      const cost = before.length
        ? before[before.length - 1]!.cost
        : (state.opening?.cost ?? null);
      return {
        date,
        marketValue: value,
        costBasis: consistent && cost != null ? round(cost) : null,
      };
    });

  const breakdown = emptyParts();
  for (const source of COST_SOURCES)
    breakdown[source] = round(Math.max(0, currentParts[source]));

  return {
    key: state.key,
    symbol: state.symbol,
    name: state.name,
    assetType:
      state.assetType === "etf" || state.assetType === "fund"
        ? state.assetType
        : "stock",
    category: isBondEtf(state.symbol) ? "bond" : "equity",
    brokerNo: state.brokerNo,
    brokerName: state.brokerName,
    quantity,
    marketValue,
    closePrice:
      quantity > 0 && position ? roundPrice(marketValue / quantity) : null,
    asOfDate: position?.date ?? null,
    costBasis,
    averageCost:
      costBasis != null && quantity > 0
        ? roundPrice(currentCost! / quantity)
        : null,
    unrealizedPnl,
    unrealizedPct:
      unrealizedPnl != null && costBasis
        ? Math.round((unrealizedPnl / costBasis) * 10000) / 100
        : null,
    realizedPnl,
    dividends: state.dividends,
    totalReturn:
      unrealizedPnl != null && realizedPnl != null
        ? unrealizedPnl + realizedPnl + state.dividends
        : null,
    costBreakdown: breakdown,
    opening: state.opening,
    issues: [...issues],
    missingPriceDates: [...(priceGap?.dates ?? [])].sort().slice(0, 10),
    events,
    history: points,
  };
}
