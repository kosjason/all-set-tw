import type { BankTransactionRow } from "@/data/bank/types";
import { findDuplicateTarget } from "./roles";
import type { ActivityItem } from "./types";

/**
 * 發票對應狀態。伺服器推導的發票帶 `matchStatus`（`packages/core` 的
 * `InvoiceMatchStatus`）時直接採用；舊資料或前端自建項目沒有時，由 `duplicateOf`
 * （已併入哪一筆）與 `roleReason` 推導。
 */
export type InvoiceMatchKey =
  "matched_card" | "matched_bank" | "awaiting_card" | "ambiguous" | "unmatched";

export interface InvoiceMatchStatus {
  key: InvoiceMatchKey;
  label: string;
  tone: "matched" | "waiting" | "warning" | "muted";
}

const MATCH_STATUS: Record<InvoiceMatchKey, Omit<InvoiceMatchStatus, "key">> = {
  matched_card: { label: "已對應刷卡", tone: "matched" },
  matched_bank: { label: "已對應銀行／電支", tone: "matched" },
  awaiting_card: { label: "等待刷卡入帳", tone: "waiting" },
  ambiguous: { label: "疑似重複", tone: "warning" },
  unmatched: { label: "未對應", tone: "muted" },
};

/** 後端 `matchStatus` 對應到畫面狀態；未知的值（未來新增）視為未對應。 */
const BACKEND_MATCH_STATUS: Readonly<Record<string, InvoiceMatchKey>> = {
  matched_card: "matched_card",
  matched_bank: "matched_bank",
  awaiting_card: "awaiting_card",
  ambiguous: "ambiguous",
  unmatched: "unmatched",
};

function status(key: InvoiceMatchKey): InvoiceMatchStatus {
  return { key, ...MATCH_STATUS[key] };
}

export function invoiceMatchStatus(
  item: ActivityItem,
  items: readonly ActivityItem[],
): InvoiceMatchStatus {
  const backend = item.matchStatus;
  if (backend) return status(BACKEND_MATCH_STATUS[backend] ?? "unmatched");
  if (item.duplicateOf) {
    const target = findDuplicateTarget(item, items);
    return status(target?.source === "card" ? "matched_card" : "matched_bank");
  }
  if (item.roleReason === "invoice_ambiguous") return status("ambiguous");
  return status("unmatched");
}

/** DTO 帶有 `itemsPreview`（前 3 個品項名稱）時直接使用；否則回傳 undefined。 */
export function invoiceItemsPreview(item: ActivityItem): string[] | undefined {
  const preview = item.itemsPreview;
  if (!Array.isArray(preview)) return undefined;
  return preview
    .filter((name): name is string => typeof name === "string" && !!name.trim())
    .slice(0, 3);
}

/** 信用卡紀錄所屬的卡片（卡名＋末四碼）。 */
export interface CardIdentity {
  key: string;
  name: string;
  last4?: string;
}

type TransactionWithCard = BankTransactionRow & { cardLast4?: string | null };

/**
 * 交易的卡片末四碼：後端若提供交易層級的 `cardLast4`（多卡共用帳戶，例如台新）
 * 優先使用，否則用帳戶末四碼。
 */
export function transactionCardLast4(
  transaction: BankTransactionRow | undefined,
): string | undefined {
  if (!transaction) return undefined;
  const raw =
    (transaction as TransactionWithCard).cardLast4 ?? transaction.accountLast4;
  return raw && /^\d{4}$/.test(raw) ? raw : undefined;
}

export function cardIdentity(
  item: ActivityItem,
  transaction: BankTransactionRow | undefined,
): CardIdentity {
  const last4 = transactionCardLast4(transaction);
  const name =
    [
      transaction?.institutionName ?? item.institutionName,
      transaction?.accountName ?? item.accountName,
    ]
      .filter(Boolean)
      .join(" ") || "信用卡";
  return {
    key: `${transaction?.accountId ?? item.accountName ?? name}:${last4 ?? ""}`,
    name,
    last4,
  };
}

export interface CardGroup extends CardIdentity {
  items: ActivityItem[];
  pendingCount: number;
}

/** 依卡片分組，保留傳入的排序；群組依第一筆出現的順序排列。 */
export function groupByCard(
  items: readonly ActivityItem[],
  identify: (item: ActivityItem) => CardIdentity,
): CardGroup[] {
  const groups = new Map<string, CardGroup>();
  for (const item of items) {
    const identity = identify(item);
    const group =
      groups.get(identity.key) ??
      groups
        .set(identity.key, { ...identity, items: [], pendingCount: 0 })
        .get(identity.key)!;
    group.items.push(item);
    if (item.status === "pending") group.pendingCount += 1;
  }
  return [...groups.values()];
}

/** 信用卡紀錄的入帳狀態。 */
export function cardPostingLabel(item: ActivityItem) {
  return item.status === "pending" ? "未入帳" : "已入帳";
}
