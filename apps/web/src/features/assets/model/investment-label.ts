import type { InvestmentRow } from "@/data/investments/types";

/**
 * 同一證券可能分屬不同券商帳戶（例如兩家券商各持有 0050），以券商名稱
 * 標示持倉來源；沒有名稱時退回券商代碼，都沒有則不顯示。
 */
export function investmentBrokerLabel(
  position: Pick<InvestmentRow, "brokerNo" | "brokerName">,
): string | undefined {
  const name = position.brokerName?.trim();
  if (name) return name;
  const code = position.brokerNo?.trim();
  return code ? `券商 ${code}` : undefined;
}
