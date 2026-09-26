import {
  CalendarDays,
  CreditCard,
  Inbox,
  PlugZap,
  ReceiptText,
  Settings,
  WalletCards,
} from "@lucide/svelte";
import type { Component } from "svelte";
import type { DetailView, PrimaryView, View } from "./types";

export interface NavigationItem {
  view: View;
  label: string;
  shortLabel: string;
  description: string;
  icon: Component;
}

export interface PrimaryNavigationItem extends NavigationItem {
  view: PrimaryView;
}

/** 側欄主導覽：本月（首頁）／交易／信用卡／資產／資料來源。 */
export const navItems: PrimaryNavigationItem[] = [
  {
    view: "month",
    label: "本月",
    shortLabel: "本月",
    description: "這個月賺多少、花多少、存下多少，以及需要留意的事。",
    icon: CalendarDays,
  },
  {
    view: "transactions",
    label: "交易",
    shortLabel: "交易",
    description: "去重後的總帳，以及銀行、信用卡、發票各自的原始紀錄。",
    icon: ReceiptText,
  },
  {
    view: "cards",
    label: "信用卡",
    shortLabel: "信用卡",
    description: "本期應繳、截止日與各卡未出帳消費。",
    icon: CreditCard,
  },
  {
    view: "assets",
    label: "資產",
    shortLabel: "資產",
    description: "淨資產走勢，以及銀行、投資與其他資產。",
    icon: WalletCards,
  },
  {
    view: "data-sources",
    label: "資料來源",
    shortLabel: "資料來源",
    description: "連接器狀態、同步排程、同步紀錄與參考匯率。",
    icon: PlugZap,
  },
];

/** 側欄底部。 */
export const settingsItem: PrimaryNavigationItem = {
  view: "settings",
  label: "設定",
  shortLabel: "設定",
  description: "通知與介面偏好。",
  icon: Settings,
};

/** 側欄頂端與手機頁首右上的全域收件匣。 */
export const inboxItem: NavigationItem = {
  view: "inbox",
  label: "待處理",
  shortLabel: "待處理",
  description: "需要你處理的同步問題、卡費與待確認交易。",
  icon: Inbox,
};

/** 手機底部列（最後一格固定為「更多」）。 */
export const mobilePrimaryViews: PrimaryView[] = [
  "month",
  "transactions",
  "cards",
  "assets",
];

/** 手機「更多」選單。 */
export const mobileMoreItems: NavigationItem[] = [
  navItems.find((item) => item.view === "data-sources")!,
  inboxItem,
  settingsItem,
];

export const detailLabels: Record<
  DetailView,
  { label: string; description: string; parent: PrimaryView }
> = {
  investments: {
    label: "投資",
    description: "投資持倉與交易紀錄。",
    parent: "assets",
  },
  "manual-assets": {
    label: "其他資產",
    description: "保險、不動產、交通工具與估值紀錄。",
    parent: "assets",
  },
  "own-accounts": {
    label: "我的其他帳戶",
    description: "無法同步的自有帳戶與卡片，轉入轉出不計入收支。",
    parent: "assets",
  },
  "transaction-rules": {
    label: "自動整理",
    description: "依條件自動分類交易；regex 等進階條件也在這裡。",
    parent: "transactions",
  },
};

export function isDetailView(view: View): view is DetailView {
  return Object.hasOwn(detailLabels, view);
}

/** 目前 view 在導覽上對應的項目（子頁對應其上層；「更多」不對應任何項目）。 */
export function activeNavigationView(view: View): View {
  return isDetailView(view) ? detailLabels[view].parent : view;
}

export function navigationItem(view: View): NavigationItem | undefined {
  if (view === "inbox") return inboxItem;
  if (view === "settings") return settingsItem;
  return navItems.find((item) => item.view === view);
}

/** `GET /api/inbox` 的計數：blocking 以紅點、tidy 以數字顯示。 */
export interface InboxCounts {
  blocking: number;
  tidy: number;
}

export const EMPTY_INBOX_COUNTS: InboxCounts = { blocking: 0, tidy: 0 };

/** 收件匣 badge 的數字文字；0 不顯示，超過 99 顯示「99+」。 */
export function inboxBadgeLabel(count: number | undefined) {
  if (!count || count <= 0) return "";
  return count > 99 ? "99+" : String(count);
}

/** 收件匣按鈕的無障礙名稱，例如「待處理（2 件需要處理、5 件待整理）」。 */
export function inboxAccessibleLabel(counts: InboxCounts) {
  const parts = [
    counts.blocking > 0 ? `${counts.blocking} 件需要處理` : "",
    counts.tidy > 0 ? `${counts.tidy} 件待整理` : "",
  ].filter(Boolean);
  return parts.length ? `待處理（${parts.join("、")}）` : "待處理";
}
