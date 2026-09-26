import type { CategorySource } from "./activity-types";
import type {
  ActivityMonthSummary,
  EconomicRole,
  EconomicRoleTargetKind,
  ReviewStatus,
} from "./economic-role";

/** 備註最長字數（以字元計）。 */
export const ACTIVITY_NOTE_MAX_LENGTH = 1000;

/**
 * 使用者對單筆活動（銀行／信用卡交易或電子發票）的備註，讓自己與 LLM 知道原因，
 * 例如「跟朋友A買人民幣，存富邦華一」。`PUT /api/activity/notes/:targetKind/:targetId`
 * 以空字串刪除。
 */
export interface ActivityNote {
  targetKind: EconomicRoleTargetKind;
  targetId: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

/** `GET /api/activity/notes?month=` 的列：備註與所屬活動的日期（台北時間）。 */
export interface ActivityNoteRow extends ActivityNote {
  /** 活動日期（YYYY-MM-DD）；活動已不存在時為 null。 */
  date: string | null;
}

/** `PUT /api/activity/notes/...` 的回應；以空字串刪除時 note 為 null。 */
export type ActivityNoteWriteResult =
  | ActivityNote
  | { targetKind: EconomicRoleTargetKind; targetId: string; note: null };

/**
 * `GET /api/activity/export?from=YYYY-MM&to=YYYY-MM` 的單筆活動：給 LLM 分析用的
 * 精簡資料。不含帳號、卡號（帳戶只到末四碼）與 raw payload；已配對發票的重複項目
 * 不另列（品項已併入交易的 itemsPreview）。
 */
export interface ActivityExportItem {
  /** YYYY-MM-DD（台北時間）。 */
  date: string;
  source: "bank" | "card" | "invoice";
  /** TWD 帶正負號（流出為負）；缺匯率時為 null。 */
  amountTwd: number | null;
  /** 非 TWD 時提供原幣金額與幣別。 */
  originalAmount?: number;
  currency: string;
  displayName: string;
  categoryId: string;
  categoryLabel: string;
  categorySource: CategorySource;
  economicRole: EconomicRole | null;
  reviewStatus: ReviewStatus | null;
  note: string | null;
  itemsPreview: string[];
  /** 帳戶顯示名稱，例如「玉山銀行 信用卡 …1234」；發票為「電子發票」。 */
  account: string;
}

export interface ActivityExportResponse {
  from: string;
  to: string;
  currency: "TWD";
  generatedAt: string;
  months: ActivityMonthSummary[];
  items: ActivityExportItem[];
}
