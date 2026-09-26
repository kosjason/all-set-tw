import type { ConnectorId } from "@/data/connectors/types";

/** 側欄主導覽與設定（桌面側欄、平板頂列）。 */
export type PrimaryView =
  "month" | "transactions" | "cards" | "assets" | "data-sources" | "settings";

/** 掛在某個主導覽底下的子頁（頁首顯示「← 返回…」）。 */
export type DetailView =
  "investments" | "manual-assets" | "own-accounts" | "transaction-rules";

/** `inbox` 是全域收件匣（不佔主導覽）；`more` 是手機「更多」選單。 */
export type View = PrimaryView | DetailView | "inbox" | "more";

export interface NavigateOptions {
  /** 開啟資料來源頁時直接展開的連接器。 */
  connectorId?: ConnectorId;
  /** 目標頁的 hash query（不含 `?`），例如交易頁的 `review=1`。 */
  query?: string;
}

export type Navigate = (view: View, options?: NavigateOptions) => void;

export interface RuntimeInfo {
  demoMode: boolean;
}
