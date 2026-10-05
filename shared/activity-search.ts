import { activityDisplayAmount } from "./activity-flow";
import type { ActivityItem } from "./activity-types";

export type AmountComparator = "=" | ">" | ">=" | "<" | "<=";

export interface AmountCondition {
  op: AmountComparator;
  value: number;
}

export interface ParsedActivitySearch {
  /** 文字條件（小寫）；空字串代表沒有文字條件。 */
  text: string;
  /** 金額條件（比對金額絕對值）；全部都要符合。 */
  amounts: AmountCondition[];
  /**
   * 查詢只有一個不帶運算子的數字（如 `125`）：金額相等或文字包含此數字都算符合。
   */
  numberOrText: boolean;
}

const AMOUNT_TOKEN = /^(>=|<=|>|<|=)\s*(?:nt\$?|\$)?\s*(\d[\d,]*(?:\.\d+)?)$/iu;
const RANGE_TOKEN =
  /^(\d[\d,]*(?:\.\d+)?)\s*(?:-|~|～)\s*(\d[\d,]*(?:\.\d+)?)$/u;
const NUMBER_TOKEN = /^(?:nt\$?|\$)?\s*(\d[\d,]*(?:\.\d+)?)$/iu;

const toNumber = (value: string) => Number(value.replace(/,/g, ""));

/**
 * 解析活動搜尋字串。支援：
 * - 文字：比對標題、商家顯示名稱、品項名稱、帳戶、備註等。
 * - `125`：金額等於 125，或文字包含「125」。
 * - `>1000`、`>=1000`、`<500`、`<=500`、`=125`：金額比較（絕對值）。
 * - `100-200`：金額介於（含）。
 * 多個條件以空白分隔時全部都要符合，例如 `咖啡 >100`。
 */
export function parseActivitySearch(query: string): ParsedActivitySearch {
  const normalized = query.normalize("NFKC").trim();
  // 允許運算子與數字之間有空白（`> 1000`）。
  const tokens = normalized
    .replace(/(>=|<=|>|<|=)\s+(?=[\d$n])/giu, "$1")
    .split(/\s+/u)
    .filter(Boolean);
  const amounts: AmountCondition[] = [];
  const words: string[] = [];
  for (const token of tokens) {
    const compare = token.match(AMOUNT_TOKEN);
    if (compare) {
      amounts.push({
        op: compare[1] as AmountComparator,
        value: toNumber(compare[2]),
      });
      continue;
    }
    const range = token.match(RANGE_TOKEN);
    if (range) {
      const [low, high] = [toNumber(range[1]), toNumber(range[2])].sort(
        (a, b) => a - b,
      );
      amounts.push({ op: ">=", value: low }, { op: "<=", value: high });
      continue;
    }
    words.push(token);
  }
  const single =
    words.length === 1 && amounts.length === 0 && tokens.length === 1;
  const number = single ? words[0].match(NUMBER_TOKEN) : null;
  if (number)
    return {
      text: words[0].toLowerCase(),
      amounts: [{ op: "=", value: toNumber(number[1]) }],
      numberOrText: true,
    };
  return { text: words.join(" ").toLowerCase(), amounts, numberOrText: false };
}

export function matchesAmountCondition(
  amount: number | undefined,
  condition: AmountCondition,
) {
  if (amount == null || !Number.isFinite(amount)) return false;
  const value = Math.abs(amount);
  switch (condition.op) {
    case "=":
      return value === condition.value;
    case ">":
      return value > condition.value;
    case ">=":
      return value >= condition.value;
    case "<":
      return value < condition.value;
    case "<=":
      return value <= condition.value;
  }
}

export function activitySearchHaystack(item: ActivityItem) {
  return [
    item.title,
    item.displayName,
    item.subtitle,
    item.institutionName,
    item.accountName,
    item.category,
    item.searchText,
    item.note,
    ...(item.itemsPreview ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .normalize("NFKC")
    .toLowerCase();
}

export function matchesActivitySearch(
  item: ActivityItem,
  search: ParsedActivitySearch,
) {
  const amount = activityDisplayAmount(item);
  const amountsMatch = search.amounts.every((condition) =>
    matchesAmountCondition(amount, condition),
  );
  const textMatch =
    !search.text || activitySearchHaystack(item).includes(search.text);
  if (search.numberOrText) return amountsMatch || textMatch;
  return amountsMatch && textMatch;
}
