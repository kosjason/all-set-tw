import type {
  ActivityMonthSummary,
  ActivitySummaryIncompleteReason,
} from "@taiwan-fin-hub/core";
import type {
  CashFlowEquation,
  CashFlowExcludedPart,
} from "@/shared/ui/cash-flow-summary/types";

/**
 * 月收支的算式：收入 − 消費 ＝ 存下來，其中投資／留在帳戶（＝存下來 − 投資）。
 * 數字一律來自 `GET /api/activity/summary`，前端只做這一個減法；本月頁與交易頁
 * 總帳摘要共用。summary 尚未取得時金額為 null。
 */
export function activitySummaryEquation(
  summary: ActivityMonthSummary | undefined,
): CashFlowEquation {
  if (!summary)
    return {
      income: null,
      spending: null,
      saved: null,
      investment: null,
      keptInAccounts: null,
    };
  return {
    income: summary.income,
    spending: summary.spending,
    saved: summary.saved,
    investment: summary.investment,
    keptInAccounts: summary.saved - summary.investment,
  };
}

export interface ActivitySummaryExcludedPart extends CashFlowExcludedPart {
  key: "ownTransfer" | "cardPayment" | "duplicateExcluded" | "excluded";
}

/**
 * 「另有 … 未計入」的項目；金額為 0 的項目省略，全為 0 時回傳空陣列。
 * 「不計入」是使用者標記（或作廢發票）的 excluded 角色，不含在其他任何欄位。
 */
export function activitySummaryExcludedParts(
  summary: ActivityMonthSummary | undefined,
): ActivitySummaryExcludedPart[] {
  if (!summary) return [];
  const parts: ActivitySummaryExcludedPart[] = [
    { key: "ownTransfer", label: "轉到自己帳戶", amount: summary.ownTransfer },
    { key: "cardPayment", label: "繳卡費", amount: summary.cardPayment },
    {
      key: "duplicateExcluded",
      label: "重複發票",
      amount: summary.duplicateExcluded,
    },
    { key: "excluded", label: "不計入", amount: summary.excludedAmount ?? 0 },
  ];
  return parts.filter((part) => part.amount > 0);
}

const INCOMPLETE_REASON_LABELS: Record<
  Exclude<ActivitySummaryIncompleteReason, "missing_exchange_rates">,
  string
> = {
  classification_unavailable: "分類規則無法載入，只能依金額正負判斷",
  role_overrides_unavailable: "你手動指定的角色無法載入，暫未套用",
  own_accounts_unavailable: "「我的其他帳戶」無法載入，互轉可能被算進收支",
};

/** summary 不完整的中文原因；complete 時為空陣列。 */
export function activitySummaryIncompleteLabels(
  summary: ActivityMonthSummary | undefined,
): string[] {
  if (!summary || summary.complete) return [];
  return summary.incompleteReasons.map((reason) =>
    reason === "missing_exchange_rates"
      ? summary.missingCurrencies.length
        ? `缺少 ${summary.missingCurrencies.join("、")} 匯率，這些外幣未計入`
        : "缺少部分外幣匯率，這些外幣未計入"
      : INCOMPLETE_REASON_LABELS[reason],
  );
}
