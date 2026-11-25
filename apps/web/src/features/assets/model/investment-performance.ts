import type {
  InvestmentCostIssue,
  InvestmentCostSource,
  InvestmentEvent,
  InvestmentHolding,
  InvestmentPerformance,
} from "@taiwan-fin-hub/shared";
import { formatCurrency } from "@/shared/format/financial";

/** 帶正負號的金額：+12,345／−12,345；0 不帶符號。 */
export function formatSignedCurrency(value: number) {
  const text = formatCurrency(Math.abs(value));
  if (value > 0) return `+${text}`;
  if (value < 0) return `−${text}`;
  return text;
}

/** 帶正負號的百分比，保留一位小數。 */
export function formatSignedPercent(value: number) {
  const text = `${Math.abs(value).toFixed(1)}%`;
  if (value > 0) return `+${text}`;
  if (value < 0) return `−${text}`;
  return text;
}

/** 損益的文字顏色：賺為 moss、賠為 coral。 */
export function pnlTone(value: number | null | undefined) {
  if (value == null || value === 0) return "";
  return value > 0 ? "text-moss" : "text-coral";
}

/** 每股價格：小數兩位。 */
export function formatSharePrice(value: number) {
  return new Intl.NumberFormat("zh-TW", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** 「2023/1/6」：時間軸與說明用的短日期。 */
export function shortDate(value: string | null | undefined) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(value ?? "");
  if (!match) return "";
  return `${match[1]}/${Number(match[2])}/${Number(match[3])}`;
}

export const COST_SOURCE_LABELS: Record<InvestmentCostSource, string> = {
  bank: "銀行扣款",
  estimate: "收盤價估算",
  opening: "期初估算",
  manual: "期初實際成本",
};

/** 本金的組成，只列有金額的來源。 */
export function costBreakdownText(holding: InvestmentHolding) {
  return (Object.keys(COST_SOURCE_LABELS) as InvestmentCostSource[])
    .filter((source) => holding.costBreakdown[source] > 0)
    .map(
      (source) =>
        `${COST_SOURCE_LABELS[source]} ${formatCurrency(holding.costBreakdown[source])}`,
    )
    .join(" · ");
}

/** 本金算不出來或不完整的原因（給使用者看）。 */
export function costIssueText(
  issue: InvestmentCostIssue,
  holding: Pick<InvestmentHolding, "missingPriceDates">,
) {
  switch (issue) {
    case "prices_pending":
      return "歷史收盤價補抓中，本金稍後才會出現。";
    case "price_missing":
      return `交易所沒有 ${holding.missingPriceDates.map(shortDate).join("、")} 的收盤價，無法估算本金。`;
    case "quantity_mismatch":
      return "集保的股數和交易紀錄對不起來，暫不估算本金。";
    case "unknown_event":
      return "有無法辨識的異動（不是買賣或分割），暫不估算本金。";
    case "split_unmatched":
      return "分割的轉出與轉入配對不到，暫不估算本金。";
    case "opening_unpriced":
      return "沒有交易紀錄可估算期初成本，請填入實際成本。";
  }
}

const EVENT_LABELS: Record<InvestmentEvent["kind"], string> = {
  opening: "期初持股",
  buy: "買進",
  sell: "賣出",
  split_in: "分割轉入",
  split_out: "分割轉出",
  dividend: "配息",
};

export function eventLabel(event: InvestmentEvent) {
  return EVENT_LABELS[event.kind];
}

/** 時間軸的說明：股數、每股價格與成本來源。 */
export function eventDetail(event: InvestmentEvent) {
  const parts: string[] = [];
  if (event.quantity != null)
    parts.push(`${new Intl.NumberFormat("zh-TW").format(event.quantity)} 股`);
  if (event.price != null) {
    const label =
      event.kind === "sell"
        ? "收盤價"
        : event.costSource === "bank" || event.costSource === "manual"
          ? "每股"
          : "收盤價";
    parts.push(`${label} ${formatSharePrice(event.price)}`);
  }
  if (event.costSource) parts.push(COST_SOURCE_LABELS[event.costSource]);
  if (event.kind === "split_in" || event.kind === "split_out")
    parts.push(
      `持有 ${new Intl.NumberFormat("zh-TW").format(event.quantityAfter)} 股`,
    );
  return parts.join(" · ");
}

/** 期初持股的說明。 */
export function openingText(holding: InvestmentHolding) {
  const opening = holding.opening;
  if (!opening) return "";
  const quantity = new Intl.NumberFormat("zh-TW").format(opening.quantity);
  const since = opening.date
    ? `集保紀錄從 ${shortDate(opening.date)} 開始，之前已持有 ${quantity} 股`
    : `集保沒有這檔的交易紀錄，目前 ${quantity} 股都視為期初持股`;
  if (opening.manual && opening.cost != null)
    return `${since}；成本採用你填的 ${formatCurrency(opening.cost)}。`;
  if (opening.cost != null)
    return `${since}；成本以當天收盤價估算為 ${formatCurrency(opening.cost)}。`;
  return `${since}；成本還無法估算。`;
}

/** 配息欄位：沒有對到入帳時顯示「未找到」，不當成 0。 */
export function dividendText(holding: InvestmentHolding) {
  return holding.dividends > 0 ? formatCurrency(holding.dividends) : "未找到";
}

/** 估算方法的說明文字（投資頁摘要下方）。 */
export function estimateNote(performance: InvestmentPerformance) {
  const parts = [
    "集保只有股數、沒有成交價，本金是推算的：有銀行「證券定期」扣款的日子用實際扣款金額，其餘用證交所／櫃買中心當天收盤價加手續費估算。",
  ];
  if (
    performance.estimateCheck.samples > 0 &&
    performance.estimateCheck.meanAbsErrorPct != null
  )
    parts.push(
      `和 ${performance.estimateCheck.samples} 次實際扣款比對，估算平均誤差 ${performance.estimateCheck.meanAbsErrorPct.toFixed(2)}%。`,
    );
  parts.push(
    "賣出依收盤價扣掉手續費與證交稅估算。淨資產照常以市值計算，損益在賣出前都是未實現。",
  );
  return parts.join("");
}

/**
 * 持倉（/api/investments 的列，只有券商代號沒有帳號）對應的持股績效。同一券商兩個帳戶
 * 持有同一檔時會有多筆。
 */
export function matchingHoldings(
  performance: InvestmentPerformance | undefined,
  position: { brokerNo?: string | null; symbol?: string },
) {
  const symbol = position.symbol?.trim();
  if (!performance || !symbol) return [];
  return performance.holdings.filter(
    (holding) =>
      holding.symbol === symbol &&
      (holding.brokerNo ?? "") === (position.brokerNo ?? ""),
  );
}

/** 唯一對應的持股績效（資產頁的持倉列用）；對不到或有多筆時為 undefined。 */
export function findHoldingPerformance(
  performance: InvestmentPerformance | undefined,
  position: { brokerNo?: string | null; symbol?: string },
) {
  const matches = matchingHoldings(performance, position);
  return matches.length === 1 ? matches[0] : undefined;
}
