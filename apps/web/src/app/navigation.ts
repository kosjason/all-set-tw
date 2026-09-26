import type { View } from "./types";

/** 每個 view 的正式 hash 路徑（`#/` 之後、`?` 之前）。 */
const VIEW_PATHS: Readonly<Record<View, string>> = {
  month: "month",
  transactions: "transactions",
  "transaction-rules": "transactions/rules",
  cards: "cards",
  assets: "assets",
  investments: "investments",
  "manual-assets": "manual-assets",
  "own-accounts": "own-accounts",
  "data-sources": "data-sources",
  inbox: "inbox",
  settings: "settings",
  more: "more",
};

const VIEW_BY_PATH = new Map(
  Object.entries(VIEW_PATHS).map(([view, path]) => [path, view as View]),
);

/**
 * 舊導覽（總覽／活動／設定子頁）的 hash 導向新位置。頁面自己的 hash query
 * （例如 `#/activity?month=2026-09`）原樣保留。
 * - 匯率併入資料來源頁；同步與通知的排程在資料來源、通知在設定，導向設定。
 */
const LEGACY_PATHS: Readonly<Record<string, View>> = {
  overview: "month",
  activity: "transactions",
  "classification-rules": "transaction-rules",
  "settings/classification-rules": "transaction-rules",
  "settings/data-sources": "data-sources",
  "settings/own-accounts": "own-accounts",
  "exchange-rates": "data-sources",
  "settings/exchange-rates": "data-sources",
  "sync-notifications": "settings",
  "settings/sync-notifications": "settings",
};

export interface ResolvedRoute {
  view: View;
  /** 正式的 hash（含 query），例如 `#/transactions?month=2026-09`。 */
  hash: string;
  /** 網址是舊路徑，需以 replaceState 換成 `hash`。 */
  redirected: boolean;
}

function splitHash(hash: string) {
  const normalized = hash.replace(/^#\/?/, "");
  const queryStart = normalized.indexOf("?");
  return {
    path: (queryStart < 0 ? normalized : normalized.slice(0, queryStart))
      .replace(/\/+$/, "")
      .trim(),
    query: queryStart < 0 ? "" : normalized.slice(queryStart + 1),
  };
}

/**
 * 解析網址 hash：正式路徑直接對應，舊路徑導向新位置（保留 query），其他
 * `#/settings/…` 子頁一律回到設定。未知路徑回傳 null（由 App 導回首頁）。
 */
export function resolveViewHash(hash: string): ResolvedRoute | null {
  const { path, query } = splitHash(hash);
  const current = VIEW_BY_PATH.get(path);
  const legacy =
    LEGACY_PATHS[path] ??
    (path.startsWith("settings/") ? ("settings" as const) : undefined);
  const view = current ?? legacy;
  if (!view) return null;
  return {
    view,
    hash: viewHash(view, query),
    redirected: !current,
  };
}

export function parseViewHash(hash: string): View | null {
  return resolveViewHash(hash)?.view ?? null;
}

export function viewHash(view: View, query = "") {
  const path = `#/${VIEW_PATHS[view]}`;
  return query ? `${path}?${query}` : path;
}
