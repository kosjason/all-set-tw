/**
 * 投資績效 API（`GET /api/investments/performance`）的回傳契約。
 *
 * 集保的交易只有股數、沒有成交價，因此成本是推算的：
 * - 有對到銀行「證券定期」扣款的買進：用實際扣款金額（同一天買多檔時依收盤價 × 股數分攤）。
 * - 其他買進：證交所／櫃買中心當天收盤價 × 股數，加上估算的手續費。
 * - 期初持股（集保最早一筆紀錄之前就有的股數）：以最早一筆紀錄當天的收盤價估算，
 *   使用者可以改填實際成本。
 * 賣出的收入同樣以收盤價扣掉估算的手續費與證交稅計算。
 *
 * 市值沿用集保每天的持股快照，淨資產照常以市值計算；這裡另外列出本金與尚未實現的損益。
 */

/** 成本的來源：銀行實際扣款、收盤價估算、期初持股估算、使用者填的期初成本。 */
export type InvestmentCostSource = "bank" | "estimate" | "opening" | "manual";

export type HoldingEventKind =
  "opening" | "buy" | "sell" | "split_in" | "split_out" | "dividend";

export interface InvestmentEvent {
  /** 台北日期 YYYY-MM-DD。 */
  date: string;
  kind: HoldingEventKind;
  /** 股數（配息為 null）。 */
  quantity: number | null;
  /** 計算用的每股價格：收盤價或扣款金額換算；配息與分割為 null。 */
  price: number | null;
  /** 金額：買進為成本、賣出為估算收入、配息為入帳金額；算不出來為 null。 */
  amount: number | null;
  /** 買進與期初的成本來源；其他事件為 null。 */
  costSource: InvestmentCostSource | null;
  /** 賣出的已實現損益（估算）；其他事件為 null。 */
  realizedPnl: number | null;
  /** 這筆事件之後的持有股數。 */
  quantityAfter: number;
}

/** 成本算不出來或不完整的原因。 */
export type InvestmentCostIssue =
  /** 某些交易日的收盤價還沒抓到（排程正在補）。 */
  | "prices_pending"
  /** 收盤價抓過但沒有這天的資料。 */
  | "price_missing"
  /** 集保的股數與交易紀錄對不起來。 */
  | "quantity_mismatch"
  /** 有無法辨識的異動（不是買進、賣出、分割）。 */
  | "unknown_event"
  /** 分割轉入找不到對應的轉出。 */
  | "split_unmatched"
  /** 期初持股沒有可用的日期或價格估算。 */
  | "opening_unpriced";

export interface InvestmentHistoryPoint {
  date: string;
  marketValue: number;
  /** 當天的本金；成本不完整時為 null。 */
  costBasis: number | null;
}

export interface InvestmentHolding {
  /** 帳戶與代號組成的識別（券商代號:帳號:代號），用於期初成本的設定。 */
  key: string;
  symbol: string;
  name: string;
  assetType: "stock" | "etf" | "fund";
  /** 債券 ETF（代號以 B 結尾）為 bond，其餘為 equity。 */
  category: "equity" | "bond";
  brokerNo: string | null;
  brokerName: string | null;
  quantity: number;
  /** 最新市值（集保快照）；已出清的部位為 0。 */
  marketValue: number;
  /** 最新收盤價（市值 ÷ 股數）。 */
  closePrice: number | null;
  asOfDate: string | null;
  /** 投入本金（剩餘持股的成本）；不完整時為 null。 */
  costBasis: number | null;
  /** 平均每股成本；不完整時為 null。 */
  averageCost: number | null;
  /** 未實現損益（市值 − 本金）；不完整時為 null。 */
  unrealizedPnl: number | null;
  /** 未實現損益率（相對本金）。 */
  unrealizedPct: number | null;
  /** 已實現損益（估算）；不完整時為 null。 */
  realizedPnl: number | null;
  /** 對到的配息入帳合計（只含銀行資料期間）。 */
  dividends: number;
  /** 含息總報酬（未實現 + 已實現 + 配息）；不完整時為 null。 */
  totalReturn: number | null;
  /** 本金中各來源的金額（四捨五入到元）。 */
  costBreakdown: Record<InvestmentCostSource, number>;
  /** 期初持股（集保最早紀錄之前的股數）。 */
  opening: {
    quantity: number;
    /** 估算用的日期（集保最早一筆紀錄當天）；沒有交易紀錄時為 null。 */
    date: string | null;
    /** 目前採用的成本：使用者填的，或估算值；算不出來為 null。 */
    cost: number | null;
    /** 使用者是否已填實際成本。 */
    manual: boolean;
  } | null;
  issues: InvestmentCostIssue[];
  /** 缺少收盤價的日期（最多列 10 個）。 */
  missingPriceDates: string[];
  events: InvestmentEvent[];
  history: InvestmentHistoryPoint[];
}

export interface InvestmentUnattributedDividend {
  date: string;
  amount: number;
  description: string;
}

export interface InvestmentPerformanceTotals {
  marketValue: number;
  /** 所有持股都有本金時的合計；任何一檔不完整為 null。 */
  costBasis: number | null;
  unrealizedPnl: number | null;
  realizedPnl: number | null;
  dividends: number;
  /** 今年（台北時間）的配息合計。 */
  dividendsThisYear: number;
  totalReturn: number | null;
  /** 債券 ETF 與其他持股的市值。 */
  marketValueByCategory: { equity: number; bond: number };
}

export interface InvestmentPerformance {
  /** 最新持股快照日期。 */
  asOfDate: string | null;
  totals: InvestmentPerformanceTotals;
  /** 目前持有的部位。 */
  holdings: InvestmentHolding[];
  /** 已全部賣出的部位（只看已實現損益與配息）。 */
  closed: InvestmentHolding[];
  /** 看起來是配息、但對不到持股的銀行入帳。 */
  unattributedDividends: InvestmentUnattributedDividend[];
  /** 配息資料的起始日（最早一筆銀行交易）；沒有銀行資料為 null。 */
  dividendsSince: string | null;
  /** 估算方法和銀行實際扣款的比對：天數與平均誤差（%）。 */
  estimateCheck: { samples: number; meanAbsErrorPct: number | null };
  /** 收盤價是否還在補抓。 */
  pricesPending: boolean;
}
