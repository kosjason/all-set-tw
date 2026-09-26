import type {
  ActivityItem,
  InboxItem,
  InboxResponse,
  InboxSeverity,
} from "@taiwan-fin-hub/core";
import type { ConnectorId } from "@/data/connectors/types";
import { resolveViewHash } from "@/app/navigation";
import type { NavigateOptions, View } from "@/app/types";

export interface InboxGroup {
  severity: InboxSeverity;
  title: string;
  description: string;
  items: InboxItem[];
}

const GROUPS: readonly Omit<InboxGroup, "items">[] = [
  {
    severity: "blocking",
    title: "需要處理",
    description: "資料可能已不正確，或有錢要處理（同步失敗、驗證、卡費）。",
  },
  {
    severity: "tidy",
    title: "待整理",
    description: "讓本月與上月的收支更準確：確認角色、發票配對、補分類。",
  },
];

/** 依嚴重度分成「需要處理」與「待整理」兩組（保留 API 的排序）；空組省略。 */
export function groupInboxItems(response: InboxResponse | undefined) {
  const items = response?.items ?? [];
  return GROUPS.map((group) => ({
    ...group,
    items: items.filter((item) => item.severity === group.severity),
  })).filter((group) => group.items.length > 0);
}

export interface InboxNavigation {
  view: View;
  options: NavigateOptions;
}

/**
 * 項目的目標頁。API 的 target 沿用 hash 路由名稱（可能是舊名稱，例如
 * `activity`），一律經過 App 的路由解析換成目前的頁面與 query。
 */
export function inboxNavigation(item: InboxItem): InboxNavigation {
  const query = new URLSearchParams(item.target.query ?? {}).toString();
  const route = resolveViewHash(
    `#/${item.target.view}${query ? `?${query}` : ""}`,
  );
  if (!route) return { view: "month", options: {} };
  const routeQuery = route.hash.split("?")[1] ?? "";
  const connector = item.target.query?.connector;
  return {
    view: route.view,
    options: {
      ...(routeQuery ? { query: routeQuery } : {}),
      ...(route.view === "data-sources" && connector
        ? { connectorId: connector as ConnectorId }
        : {}),
    },
  };
}

/** 項目按鈕文字：API 提供 action 時用它的 label。 */
export function inboxActionLabel(item: InboxItem) {
  return item.action?.label ?? "查看";
}

/**
 * 待確認角色的項目可在列上直接選角色：由 target 的 `activity=<source>:<id>`
 * 取得覆寫對象。發票配對歧義（duplicate_ambiguous）要看配對，不在列上處理。
 */
export function inboxRoleActivity(
  item: InboxItem,
): Pick<ActivityItem, "source" | "id"> | null {
  if (item.kind !== "needs_review") return null;
  const value = item.target.query?.activity ?? "";
  const separator = value.indexOf(":");
  if (separator < 0) return null;
  const source = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (!id || (source !== "bank" && source !== "card" && source !== "invoice"))
    return null;
  return { source, id };
}
