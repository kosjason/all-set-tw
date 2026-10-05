/**
 * 待處理收件匣 API 契約（`GET /api/inbox`）。
 * blocking：資料不再正確或有錢要處理（同步錯誤、需要驗證、中信久未匯入、卡費將到期未繳）。
 * tidy：整理類工作（待確認角色、發票配對歧義、未分類消費）。
 */
export const INBOX_ITEM_KINDS = [
  "connector_error",
  "connector_needs_user_action",
  "ctbc_import_stale",
  "card_due_unpaid",
  "needs_review",
  "duplicate_ambiguous",
  "uncategorized",
] as const;
export type InboxItemKind = (typeof INBOX_ITEM_KINDS)[number];

export type InboxSeverity = "blocking" | "tidy";

/** 前端 view（hash 路由名稱）與該頁可理解的 hash query。 */
export interface InboxTarget {
  view: string;
  query?: Record<string, string>;
}

export interface InboxAction {
  kind:
    | "open_connector"
    | "run_ctbc_import"
    | "open_card"
    | "review_activity"
    | "categorize";
  label: string;
}

export interface InboxItem {
  /** 穩定 id：同一件事在資料未變動前 id 不變，供前端記住已讀或略過。 */
  id: string;
  kind: InboxItemKind;
  severity: InboxSeverity;
  title: string;
  detail: string;
  target: InboxTarget;
  /** 事件時間（同步時間、活動日期或結帳日）。 */
  createdAt: string;
  action?: InboxAction;
  /** 相關金額（TWD 或 currency 指定的幣別）。 */
  amount?: number;
  currency?: string;
  /** 彙總項目的筆數（uncategorized）。 */
  count?: number;
}

export interface InboxResponse {
  /** 項目數；活動類只計本月與上月（台北時間）。 */
  counts: { blocking: number; tidy: number };
  /** 本月與上月（YYYY-MM）。 */
  months: string[];
  items: InboxItem[];
  /** 載入失敗而未列出的來源（sync、cards、activity）；其餘項目仍回傳。 */
  unavailable: InboxSource[];
}

export type InboxSource = "sync" | "cards" | "activity";
