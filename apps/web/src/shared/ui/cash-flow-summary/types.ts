/**
 * 月收支算式（收入 − 消費 ＝ 存下來）與存下來的去向（投資／留在帳戶）。
 * 金額為台幣；null 代表尚未取得或無法計算。
 */
export interface CashFlowEquation {
  income: number | null;
  spending: number | null;
  /** 收入 − 消費；負數代表超支。 */
  saved: number | null;
  /** 投資淨流出（買進減賣出、股利），是存下來的錢的去向之一。 */
  investment: number | null;
  /** 存下來 − 投資；負數代表動用存款。 */
  keptInAccounts: number | null;
}

/** 「另有 … 未計入」的一項（轉到自己帳戶、繳卡費、重複發票）。 */
export interface CashFlowExcludedPart {
  key: string;
  label: string;
  amount: number;
}
