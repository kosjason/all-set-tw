/**
 * 國外交易服務費的歸屬：信用卡的「國外交易服務費－479.00」是另一筆國外消費
 * （新台幣 479 元）附帶的費用。找出同卡、相近日期的那筆消費，讓費用列沿用它的
 * 分類（例如軟體訂閱），而不是一律歸到「稅費手續費」。只影響分類顯示與統計歸類，
 * 不合併兩筆交易，也不改金額。
 */

import { isForeignTransactionFee } from "./activity-matching";

export interface ForeignFeeTransaction {
  id: string;
  accountId?: string | null;
  accountType?: string | null;
  amount?: number | null;
  currency?: string | null;
  authorizedAt?: string | null;
  postedDate?: string | null;
  description?: string | null;
  counterparty?: string | null;
}

/** 費用與原消費的日期（台北時間）最多相差的天數。 */
export const FOREIGN_FEE_DAY_WINDOW = 2;
/** 描述沒有原交易金額時，以此費率（1.5%）推算，四捨五入後容許差 NT$1。 */
export const FOREIGN_FEE_RATE = 0.015;
export const FOREIGN_FEE_RATE_TOLERANCE = 1;

const FEE_BASE_AMOUNT =
  /(?:國外|海外)交易(?:服務|手續)費\s*[－\-—–:：(（]?\s*(?:NT\$|TWD)?\s*([\d,]+(?:\.\d+)?)/u;

const TAIPEI_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function text(transaction: ForeignFeeTransaction) {
  return [transaction.description, transaction.counterparty]
    .filter(Boolean)
    .join(" ");
}

/** 費用描述中的原交易台幣金額（例如「國外交易服務費－479.00」→ 479）。 */
export function foreignFeeBaseAmount(value?: string | null) {
  const match = value?.normalize("NFKC").match(FEE_BASE_AMOUNT);
  if (!match) return undefined;
  const amount = Number(match[1].replace(/,/gu, ""));
  return Number.isFinite(amount) && amount > 0 ? amount : undefined;
}

function dayIndex(transaction: ForeignFeeTransaction) {
  const value = transaction.authorizedAt ?? transaction.postedDate;
  if (!value) return undefined;
  let day = value.slice(0, 10);
  if (value.length > 10) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) day = TAIPEI_DAY.format(parsed);
  }
  const match = day.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!match) return undefined;
  return (
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) /
    86_400_000
  );
}

/**
 * 國外交易服務費 → 原消費交易 id。條件：同一張卡（accountId）、原消費為台幣支出、
 * 日期相差不超過 {@link FOREIGN_FEE_DAY_WINDOW} 天，且
 * - 描述帶原交易金額時，原消費金額等於該金額；
 * - 描述沒有金額時（例如「國外交易手續費」），原消費的 1.5% 四捨五入後與費用
 *   相差不超過 NT$1。
 * 多筆候選時只留描述沒有中文者（國外商家）；仍找不到或有兩筆以上候選時不歸屬
 * （費用維持原分類）。
 */
export function attributeForeignTransactionFees(
  transactions: readonly ForeignFeeTransaction[],
) {
  const result = new Map<string, string>();
  const purchases = transactions.filter(
    (transaction) =>
      transaction.accountId &&
      transaction.amount != null &&
      transaction.amount < 0 &&
      (transaction.currency ?? "TWD") === "TWD" &&
      !isForeignTransactionFee(transaction),
  );
  for (const fee of transactions) {
    if (
      !fee.accountId ||
      fee.amount == null ||
      !(fee.amount < 0) ||
      !isForeignTransactionFee(fee)
    )
      continue;
    const feeDay = dayIndex(fee);
    if (feeDay == null) continue;
    const baseAmount = foreignFeeBaseAmount(text(fee));
    const feeAmount = Math.abs(fee.amount);
    const candidates = purchases.filter((purchase) => {
      if (purchase.accountId !== fee.accountId || purchase.id === fee.id)
        return false;
      const day = dayIndex(purchase);
      if (day == null || Math.abs(day - feeDay) > FOREIGN_FEE_DAY_WINDOW)
        return false;
      const paid = Math.abs(purchase.amount!);
      return baseAmount != null
        ? Math.round(paid) === Math.round(baseAmount)
        : Math.abs(Math.round(paid * FOREIGN_FEE_RATE) - feeAmount) <=
            FOREIGN_FEE_RATE_TOLERANCE;
    });
    // 多筆候選時，只留描述沒有中文的（國外商家的刷卡描述是英文）。
    const chosen =
      candidates.length > 1
        ? candidates.filter(
            (purchase) => !/\p{Script=Han}/u.test(text(purchase)),
          )
        : candidates;
    if (chosen.length === 1) result.set(fee.id, chosen[0].id);
  }
  return result;
}
