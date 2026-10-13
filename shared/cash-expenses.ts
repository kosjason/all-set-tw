import type { ActivityItem, CashWithdrawalAllocation } from "./activity-types";
import { activityDateKey } from "./activity-list";
import { MISC_CATEGORY_ID, UNCATEGORIZED_CATEGORY_ID } from "./categories";

/**
 * 現金支出（手動記帳）。提款（ATM、無卡提款）仍先以「其他」計入消費，代表錢的
 * 去向未知；使用者記下的現金支出從尚未細分的提款扣，把提款拆成實際分類。扣的順序：
 * 1. 先扣同月份的提款（依提款時間由早到晚）：該月消費總額不變。
 * 2. 同月不夠時，再扣上個月還沒細分完的提款（由晚到早，月底領的錢先用）：上個月的
 *    「其他」減少、這個月照常計入，兩個月合計不變。
 * 3. 仍不夠的部分照常計入消費（例如用更早以前領的錢）。
 *
 * 每月提款只會被當月與下個月的現金支出扣，所以計算某月份時需要載入下個月的
 * 提款與現金支出（見 worker 的 loadRoleActivities）。
 *
 * 商家規則勾選「這家都付現金」時，這家沒有配對到刷卡／銀行交易的台幣發票也視為
 * 現金支出（{@link isCashPaidInvoice}）：發票照常依分類計入消費，並和手記的現金支出
 * 一樣從提款扣，避免同一筆現金在提款與發票各算一次。
 */

/**
 * 現金提領的文字（與分類建議「現金提領」相同）。「提款卡」「提款機」本身不是提款；
 * 「跨行提款手續費」等費用由 {@link isCashWithdrawalPool} 另外排除。
 */
export const CASH_WITHDRAWAL_PATTERN =
  /無卡提款|atm\s*提款|跨行提款|提款(?!卡|機)/iu;

/** 現金支出的說明上限（字元）。 */
export const CASH_EXPENSE_DESCRIPTION_MAX = 100;
/** 單筆現金支出的金額上限（新台幣）。 */
export const CASH_EXPENSE_AMOUNT_MAX = 10_000_000;
/** 沒有說明時的列表標題。 */
export const CASH_EXPENSE_DEFAULT_TITLE = "現金支出";
/** 「常用」最多列幾個。 */
export const FREQUENT_CASH_EXPENSE_LIMIT = 8;
/** 「常用」只看最近幾天記過的現金支出，很久沒記的一次性消費會自然消失。 */
export const FREQUENT_CASH_EXPENSE_DAYS = 90;

/**
 * 記帳對話框的「常用」：最近記過、有說明的現金支出，依說明、金額與分類合併，
 * 點一下即以同樣內容再記一筆。
 */
export interface FrequentCashExpense {
  description: string;
  amount: number;
  categoryId: string;
  /** 期間內記過幾次。 */
  uses: number;
  /** 最近一次的消費日期（YYYY-MM-DD）。 */
  lastDate: string;
}

export interface CashExpense {
  id: string;
  /** 台北日期 YYYY-MM-DD。 */
  date: string;
  /** 新台幣整數金額（正數）。 */
  amount: number;
  categoryId: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 現金支出列在活動中的樣子：一律是已確認的消費，分類由使用者指定。 */
export function cashExpenseActivityItem(
  expense: CashExpense,
  categoryLabel: string,
): ActivityItem {
  return {
    id: expense.id,
    source: "cash",
    date: expense.date,
    dateHasTime: false,
    title: expense.description ?? CASH_EXPENSE_DEFAULT_TITLE,
    subtitle: "現金",
    searchText: "現金",
    institutionName: "現金",
    amount: -expense.amount,
    currency: "TWD",
    amountTwd: -expense.amount,
    category: categoryLabel,
    categoryId: expense.categoryId,
    categorySource: "user",
    status: "posted",
    economicRole: "spending",
    reviewStatus: "confirmed",
    duplicateOf: null,
    investmentEventKind: null,
    roleReason: "cash_expense",
    cashExpense: { description: expense.description },
  };
}

function normalizedText(value: string) {
  return value.normalize("NFKC");
}

/**
 * 可以被現金支出細分的提款：銀行帳戶（非信用卡）的台幣提款（不含手續費），角色為消費、
 * 不是重複，而且分類是「其他」或未分類（去向未知）。使用者已把提款歸到具體分類（例如付房租）、
 * 改成代墊或轉帳時，代表已經知道錢的用途，不再細分。
 */
export function isCashWithdrawalPool(
  item: Pick<
    ActivityItem,
    | "source"
    | "amount"
    | "currency"
    | "economicRole"
    | "duplicateOf"
    | "categoryId"
    | "title"
    | "searchText"
  >,
) {
  if (item.source !== "bank" || item.currency !== "TWD") return false;
  if (item.amount == null || item.amount >= 0) return false;
  if (item.economicRole !== "spending" || item.duplicateOf) return false;
  const categoryId = item.categoryId ?? UNCATEGORIZED_CATEGORY_ID;
  if (
    categoryId !== MISC_CATEGORY_ID &&
    categoryId !== UNCATEGORIZED_CATEGORY_ID
  )
    return false;
  const text = normalizedText(`${item.title} ${item.searchText ?? ""}`);
  // 提款手續費不是領出來的現金，不能拿來扣現金支出。
  return CASH_WITHDRAWAL_PATTERN.test(text) && !CASH_WITHDRAWAL_FEE.test(text);
}

const CASH_WITHDRAWAL_FEE = /手續費|\bfee\b/iu;

/**
 * 視為現金付款、要從提款扣的發票：商家規則勾選「這家都付現金」，沒有配對到交易
 * （`matchStatus = unmatched`，含使用者選「分開記錄」），角色為消費、不是重複的台幣發票。
 * 等待刷卡入帳、有歧義、已配對或使用者改成其他角色的發票不算。
 */
export function isCashPaidInvoice(
  item: Pick<
    ActivityItem,
    | "source"
    | "merchantPaidInCash"
    | "matchStatus"
    | "economicRole"
    | "duplicateOf"
    | "currency"
    | "amount"
  >,
) {
  return (
    item.source === "invoice" &&
    item.merchantPaidInCash === true &&
    item.matchStatus === "unmatched" &&
    item.economicRole === "spending" &&
    !item.duplicateOf &&
    item.currency === "TWD" &&
    item.amount != null &&
    item.amount > 0
  );
}

/** 從提款扣的金額（新台幣，正數）：手記的現金支出與視為現金付款的發票；其他為 0。 */
function cashNeed(item: ActivityItem) {
  if (item.source === "cash")
    return item.economicRole === "spending" && item.amount != null
      ? Math.abs(item.amount)
      : 0;
  return isCashPaidInvoice(item) ? Math.abs(item.amount!) : 0;
}

function previousMonth(month: string) {
  const [year, value] = month.split("-").map(Number);
  return value === 1
    ? `${year! - 1}-12`
    : `${year}-${String(value! - 1).padStart(2, "0")}`;
}

interface PoolEntry {
  key: string;
  dateKey: string;
  order: string;
  amount: number;
  allocated: number;
}

function poolKey(item: Pick<ActivityItem, "source" | "id">) {
  return `${item.source}\u0000${item.id}`;
}

function take(entries: PoolEntry[], need: number) {
  let left = need;
  for (const entry of entries) {
    if (left <= 0) break;
    const available = entry.amount - entry.allocated;
    if (available <= 0) continue;
    const used = Math.min(available, left);
    entry.allocated += used;
    left -= used;
  }
  return need - left;
}

/**
 * 把現金支出（含視為現金付款的發票）分配到提款，回傳加上 `cashWithdrawal` 的活動
 * （其他活動原樣回傳）。
 * 傳入的活動必須涵蓋連續的月份，並一併傳入最後一個月的下個月（至少其中的現金支出
 * 與提款），最後一個月的提款才會被下個月的現金支出扣到；跳過月份會讓同一月份在
 * 不同呼叫中算出不同結果。
 */
export function allocateCashExpenses<T extends ActivityItem>(items: T[]): T[] {
  const pools = new Map<string, PoolEntry[]>();
  const needs = new Map<string, number>();
  for (const item of items) {
    const dateKey = activityDateKey(item);
    const month = dateKey.slice(0, 7);
    if (!month) continue;
    if (item.source === "cash" || item.source === "invoice") {
      const need = cashNeed(item);
      if (need > 0) needs.set(month, (needs.get(month) ?? 0) + need);
      continue;
    }
    if (!isCashWithdrawalPool(item)) continue;
    const entries = pools.get(month) ?? [];
    entries.push({
      key: poolKey(item),
      dateKey,
      order: `${item.date}\u0000${item.id}`,
      amount: Math.abs(item.amount!),
      allocated: 0,
    });
    pools.set(month, entries);
  }
  if (pools.size === 0) return items;
  for (const entries of pools.values())
    entries.sort((a, b) => a.order.localeCompare(b.order));
  // 先扣同月份，所有月份都扣完後才處理不夠的部分，上個月的提款才會先被自己的月份用。
  const overflow = new Map<string, number>();
  for (const [month, need] of needs) {
    const used = take(pools.get(month) ?? [], need);
    if (need > used) overflow.set(month, need - used);
  }
  for (const [month, need] of overflow) {
    const previous = pools.get(previousMonth(month));
    if (previous) take([...previous].reverse(), need);
  }
  const allocations = new Map<string, CashWithdrawalAllocation>();
  for (const entries of pools.values())
    for (const entry of entries)
      allocations.set(entry.key, {
        allocated: entry.allocated,
        remaining: entry.amount - entry.allocated,
      });
  return items.map((item) => {
    const allocation =
      item.source === "bank" ? allocations.get(poolKey(item)) : undefined;
    return allocation ? { ...item, cashWithdrawal: allocation } : item;
  });
}
