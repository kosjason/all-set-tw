import type {
  ActivityNoteWriteResult,
  ActivityRef,
  EconomicRole,
  EconomicRoleOverride,
  EconomicRoleTargetKind,
} from "@taiwan-fin-hub/core";
import type { ApiClient } from "@/shared/api/client";
import type {
  CategorizeRequest,
  CategorizeResponse,
} from "@/data/merchants/types";

/**
 * `POST /api/activity/categorize`：改分類。`applyToMerchant = false` 寫入個別覆寫；
 * `true` 寫入商家規則（回溯套用到該商家所有活動）並移除這些活動的個別覆寫。
 */
export function categorizeActivitiesMutation(getApi: () => ApiClient) {
  return {
    mutationKey: ["activity", "categorize"] as const,
    mutationFn: (body: CategorizeRequest) =>
      getApi().post<CategorizeResponse>("/api/activity/categorize", body),
  };
}

/**
 * 活動相關的 mutation options（交給 `createMutation`）。成功後請讓 `queryKeys.bank`
 * 失效：活動列表、summary、收件匣、信用卡頁都由交易推導。
 */

export interface ActivityTarget {
  targetKind: EconomicRoleTargetKind;
  targetId: string;
}

function targetPath(resource: string, target: ActivityTarget) {
  return `/api/activity/${resource}/${target.targetKind}/${encodeURIComponent(target.targetId)}`;
}

export interface ActivityNoteInput extends ActivityTarget {
  /** 最多 1000 字；空字串刪除備註。 */
  note: string;
}

/** `PUT /api/activity/notes/:targetKind/:targetId`；空字串刪除。 */
export function saveActivityNoteMutation(getApi: () => ApiClient) {
  return {
    mutationKey: ["activity-note", "save"] as const,
    mutationFn: ({ note, ...target }: ActivityNoteInput) =>
      getApi().put<ActivityNoteWriteResult>(targetPath("notes", target), {
        note,
      }),
  };
}

/** `DELETE /api/activity/notes/:targetKind/:targetId`；不存在時回 404。 */
export function deleteActivityNoteMutation(getApi: () => ApiClient) {
  return {
    mutationKey: ["activity-note", "delete"] as const,
    mutationFn: (target: ActivityTarget) =>
      getApi().delete<{ success: true }>(targetPath("notes", target)),
  };
}

export interface ActivityRoleOverrideInput extends ActivityTarget {
  /** 含 `excluded`（不計入：沒有實際付款、已退款作廢、測試等）。 */
  economicRole: EconomicRole;
  duplicateOf?: ActivityRef | null;
  /** 一併寫入備註；空字串或 null 刪除，省略則不變更。 */
  note?: string | null;
}

export type ActivityRoleOverrideResult = EconomicRoleOverride & {
  /** 有傳 note 時回傳寫入後的備註（刪除為 null）。 */
  note?: string | null;
};

/** `PUT /api/activity/role-overrides/:targetKind/:targetId`，可附帶備註。 */
export function setActivityRoleOverrideMutation(getApi: () => ApiClient) {
  return {
    mutationKey: ["activity-role-override", "set"] as const,
    mutationFn: ({
      targetKind,
      targetId,
      ...body
    }: ActivityRoleOverrideInput) =>
      getApi().put<ActivityRoleOverrideResult>(
        targetPath("role-overrides", { targetKind, targetId }),
        body,
      ),
  };
}
