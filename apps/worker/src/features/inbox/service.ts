import {
  activityDateKey,
  activitySignedAmountTwd,
  connectorCatalog,
  currentActivityMonthKey,
  isConnectorId,
  type ActivityItem,
  type CardsSummaryResponse,
  type InboxItem,
  type InboxItemKind,
  type InboxResponse,
  type InboxSource,
  TRANSFER_HINT_RULE_ID,
} from "@taiwan-fin-hub/core";
import { getRoleActivitiesForMonths } from "../activity/summary-service";
import { getCardsSummary, MANUAL_IMPORT_CONNECTORS } from "../cards/service";
import {
  hasActiveAccounts,
  listConfiguredConnectorIds,
  listSyncJobResults,
  type InboxSyncJobRow,
} from "./repository";

/** 超過此天數沒有成功匯入，提醒重新匯入中信資料。 */
export const CTBC_IMPORT_STALE_DAYS = 7;
/** 截止日在此天數內（含已逾期）且尚未繳清的帳單列入待處理。 */
export const CARD_DUE_SOON_DAYS = 7;
/** 逾期超過此天數的帳單視為資料過期，不再提醒。 */
const CARD_OVERDUE_LIMIT_DAYS = 31;
/** 「未分類」分類 id，與交易頁「只看未分類」相同。 */
const UNCATEGORIZED_CATEGORY_ID = "other";

/**
 * 真正未分類：沒有任何分類來源（自動套用的建議不算未分類）。沒有 categorySource
 * 的舊項目以 categoryId 判斷。
 */
function isUncategorized(item: ActivityItem) {
  if (item.categorySource) return item.categorySource === "none";
  return (
    (item.categoryId ?? UNCATEGORIZED_CATEGORY_ID) === UNCATEGORIZED_CATEGORY_ID
  );
}

const KIND_ORDER: readonly InboxItemKind[] = [
  "connector_needs_user_action",
  "connector_error",
  "card_due_unpaid",
  "ctbc_import_stale",
  "needs_review",
  "duplicate_ambiguous",
  "uncategorized",
];

function previousMonth(month: string) {
  const [year, value] = month.split("-").map(Number) as [number, number];
  return value === 1
    ? `${year - 1}-12`
    : `${year}-${String(value - 1).padStart(2, "0")}`;
}

function connectorName(connectorId: string) {
  return isConnectorId(connectorId)
    ? connectorCatalog[connectorId].title
    : connectorId;
}

function latestByConnector(rows: InboxSyncJobRow[]) {
  const result = new Map<string, InboxSyncJobRow>();
  for (const row of rows) {
    const current = result.get(row.connectorId);
    if (
      !current ||
      (row.lastRunAt ?? row.updatedAt) >
        (current.lastRunAt ?? current.updatedAt)
    )
      result.set(row.connectorId, row);
  }
  return result;
}

/** 同步失敗與需要使用者操作（驗證碼、OTP、裝置驗證、重新登入）。 */
function syncItems(
  rows: InboxSyncJobRow[],
  configured: ReadonlySet<string>,
): InboxItem[] {
  const items: InboxItem[] = [];
  for (const [connectorId, row] of latestByConnector(
    rows.filter(
      (row) =>
        configured.has(row.connectorId) &&
        (row.lastStatus === "failed" || row.lastStatus === "needs_user_action"),
    ),
  )) {
    const name = connectorName(connectorId);
    const createdAt = row.lastRunAt ?? row.updatedAt;
    const target = { view: "data-sources", query: { connector: connectorId } };
    if (row.lastStatus === "needs_user_action") {
      items.push({
        id: `connector_needs_user_action:${connectorId}:${createdAt}`,
        kind: "connector_needs_user_action",
        severity: "blocking",
        title: `${name}需要你完成驗證`,
        detail:
          row.lastError?.trim() ||
          "需要輸入驗證碼、OTP 或完成裝置驗證後才能繼續同步。",
        target,
        createdAt,
        action: { kind: "open_connector", label: "前往驗證" },
      });
    } else {
      items.push({
        id: `connector_error:${connectorId}:${createdAt}`,
        kind: "connector_error",
        severity: "blocking",
        title: `${name}同步失敗`,
        detail: row.lastError?.trim() || "最近一次同步沒有成功。",
        target,
        createdAt,
        action: { kind: "open_connector", label: "查看資料來源" },
      });
    }
  }
  return items;
}

async function ctbcImportItem(
  db: D1Database,
  rows: InboxSyncJobRow[],
  configured: ReadonlySet<string>,
  now: Date,
): Promise<InboxItem | null> {
  const connectorId = "ctbc";
  if (!MANUAL_IMPORT_CONNECTORS.has(connectorId)) return null;
  if (
    !configured.has(connectorId) &&
    !(await hasActiveAccounts(db, connectorId))
  )
    return null;
  const lastSuccessAt = rows
    .filter((row) => row.connectorId === connectorId && row.lastSuccessAt)
    .map((row) => row.lastSuccessAt!)
    .sort()
    .at(-1);
  const staleBefore = now.getTime() - CTBC_IMPORT_STALE_DAYS * 86_400_000;
  if (lastSuccessAt && Date.parse(lastSuccessAt) >= staleBefore) return null;
  const days = lastSuccessAt
    ? Math.floor((now.getTime() - Date.parse(lastSuccessAt)) / 86_400_000)
    : null;
  return {
    id: `ctbc_import_stale:${lastSuccessAt ?? "never"}`,
    kind: "ctbc_import_stale",
    severity: "blocking",
    title: "中信資料需要重新匯入",
    detail:
      days == null
        ? "還沒有成功匯入過中信網銀資料，信用卡帳單與存款餘額可能不完整。"
        : `已 ${days} 天沒有匯入中信網銀資料，帳單與繳款狀態可能過期。`,
    target: { view: "data-sources", query: { connector: connectorId } },
    createdAt: lastSuccessAt ?? now.toISOString(),
    action: { kind: "run_ctbc_import", label: "匯入中信資料" },
  };
}

function cardDueItems(summary: CardsSummaryResponse): InboxItem[] {
  const items: InboxItem[] = [];
  for (const issuer of summary.issuers) {
    const bill = issuer.currentBill;
    if (
      !bill?.paymentDueDate ||
      bill.daysUntilDue == null ||
      (bill.paymentStatus !== "unpaid" && bill.paymentStatus !== "partial") ||
      bill.daysUntilDue > CARD_DUE_SOON_DAYS ||
      bill.daysUntilDue < -CARD_OVERDUE_LIMIT_DAYS
    )
      continue;
    const when =
      bill.daysUntilDue < 0
        ? `已逾期 ${-bill.daysUntilDue} 天`
        : bill.daysUntilDue === 0
          ? "今天到期"
          : `${bill.daysUntilDue} 天後到期`;
    items.push({
      id: `card_due_unpaid:${issuer.issuer}:${bill.billingPeriod}`,
      kind: "card_due_unpaid",
      severity: "blocking",
      title: `${issuer.name}卡費${bill.paymentStatus === "partial" ? "尚未繳清" : "尚未繳款"}`,
      detail: `${bill.billingPeriod} 帳單 ${when}（截止日 ${bill.paymentDueDate}）${issuer.estimated ? "；資料為推估" : ""}。`,
      target: { view: "cards", query: { issuer: issuer.issuer } },
      createdAt: bill.statementClosingDate ?? bill.paymentDueDate,
      action: { kind: "open_card", label: "查看帳單" },
      ...(bill.remainingAmount != null
        ? { amount: bill.remainingAmount, currency: bill.currency }
        : {}),
    });
  }
  return items;
}

/** 符合轉帳關鍵字、角色待確認的活動（0055 前為分類「轉帳」）。 */
function isTransferHint(item: ActivityItem) {
  return item.classificationRuleId === TRANSFER_HINT_RULE_ID;
}

function reviewReason(item: ActivityItem) {
  switch (item.roleReason) {
    case "possible_unsynced_card":
      return "繳卡費對應不到已同步的信用卡，可能是未同步的卡片";
    case "sign":
      return isTransferHint(item)
        ? "像是轉帳，但對方不是登記的自有帳戶"
        : "無法確定這筆活動的性質";
    default:
      return "需要確認這筆活動的性質";
  }
}

function activityTarget(item: ActivityItem, month: string) {
  return {
    view: "activity",
    query: { month, activity: `${item.source}:${item.id}` },
  };
}

/** 待辦顯示的金額：外幣以系統匯率換算成台幣；缺匯率時保留原幣。 */
function activityAmount(item: ActivityItem) {
  if (item.amount == null) return {};
  const twd = activitySignedAmountTwd(item);
  return twd == null
    ? { amount: Math.abs(item.amount), currency: item.currency }
    : { amount: Math.abs(twd), currency: "TWD" };
}

/**
 * 活動類：待確認角色、發票配對歧義（逐筆），與未分類消費（彙總一項）。
 * 只看本月與上月，避免久遠的舊資料永遠清不掉。
 */
function activityItems(items: ActivityItem[], months: string[]): InboxItem[] {
  const monthSet = new Set(months);
  const result: InboxItem[] = [];
  const uncategorized: ActivityItem[] = [];
  for (const item of items) {
    const day = activityDateKey(item);
    const month = day.slice(0, 7);
    if (!monthSet.has(month)) continue;
    // 「不計入」的活動不需要整理：不列待確認，也不算未分類消費。
    if (item.economicRole === "excluded") continue;
    if (item.reviewStatus === "needs_review") {
      if (item.roleReason === "invoice_ambiguous") {
        result.push({
          id: `duplicate_ambiguous:${item.source}:${item.id}`,
          kind: "duplicate_ambiguous",
          severity: "tidy",
          title: `確認發票是否重複：${item.title}`,
          detail: `${day} 的發票在前後 3 天內有多筆同金額刷卡，無法自動判斷是否為同一筆消費。`,
          target: activityTarget(item, month),
          createdAt: item.date,
          action: { kind: "review_activity", label: "確認配對" },
          ...activityAmount(item),
        });
      } else if (item.roleReason === "invoice_repeat") {
        result.push({
          id: `duplicate_ambiguous:${item.source}:${item.id}`,
          kind: "duplicate_ambiguous",
          severity: "tidy",
          title: `確認發票是否重複開立：${item.title}`,
          detail: `${day} · 同一筆消費可能重複開立發票，只有一張對應到付款；確認前不計入消費。`,
          target: activityTarget(item, month),
          createdAt: item.date,
          action: { kind: "review_activity", label: "確認" },
          ...activityAmount(item),
        });
      } else {
        result.push({
          id: `needs_review:${item.source}:${item.id}`,
          kind: "needs_review",
          severity: "tidy",
          title: `確認活動：${item.title}`,
          detail: `${day} · ${reviewReason(item)}。`,
          target: activityTarget(item, month),
          createdAt: item.date,
          action: { kind: "review_activity", label: "確認" },
          ...activityAmount(item),
        });
      }
    }
    if (
      item.transactionId &&
      isUncategorized(item) &&
      item.economicRole === "spending" &&
      // 轉帳提示已列為待確認，確認角色前不另算未分類消費。
      !isTransferHint(item) &&
      !item.duplicateOf &&
      !item.excludedFromCalculation
    )
      uncategorized.push(item);
  }
  if (uncategorized.length > 0) {
    const [current] = months.slice(-1);
    const latest = uncategorized
      .map((item) => activityDateKey(item))
      .sort()
      .at(-1)!;
    const perMonth = months
      .map((month) => ({
        month,
        count: uncategorized.filter((item) =>
          activityDateKey(item).startsWith(month),
        ).length,
      }))
      .filter((entry) => entry.count > 0);
    const targetMonth = perMonth.some((entry) => entry.month === current)
      ? current!
      : perMonth[0]!.month;
    // 外幣消費以系統匯率換算；缺匯率者不計入金額。
    const twdAmount = uncategorized.reduce(
      (sum, item) => sum + Math.abs(activitySignedAmountTwd(item) ?? 0),
      0,
    );
    result.push({
      id: `uncategorized:${months.join(",")}:${uncategorized.length}`,
      kind: "uncategorized",
      severity: "tidy",
      title: `${uncategorized.length} 筆消費尚未分類`,
      detail: perMonth
        .map((entry) => `${entry.month} ${entry.count} 筆`)
        .join("、"),
      target: {
        view: "activity",
        query: { month: targetMonth, uncategorized: "1" },
      },
      createdAt: latest,
      action: { kind: "categorize", label: "分類" },
      amount: Math.round(twdAmount * 100) / 100,
      currency: "TWD",
      count: uncategorized.length,
    });
  }
  return result;
}

function sortItems(items: InboxItem[]) {
  return items.sort(
    (left, right) =>
      (left.severity === right.severity
        ? 0
        : left.severity === "blocking"
          ? -1
          : 1) ||
      KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind) ||
      right.createdAt.localeCompare(left.createdAt) ||
      left.id.localeCompare(right.id),
  );
}

async function settle<T>(
  source: InboxSource,
  unavailable: InboxSource[],
  task: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await task();
  } catch (error) {
    console.error(`[inbox] load ${source} failed:`, error);
    unavailable.push(source);
    return undefined;
  }
}

export async function getInbox(
  db: D1Database,
  now = new Date(),
): Promise<InboxResponse> {
  const current = currentActivityMonthKey(now);
  const months = [previousMonth(current), current];
  const unavailable: InboxSource[] = [];
  const [sync, cards, activity] = await Promise.all([
    settle("sync", unavailable, async () => {
      const [rows, configured] = await Promise.all([
        listSyncJobResults(db),
        listConfiguredConnectorIds(db),
      ]);
      const ctbc = await ctbcImportItem(db, rows, configured, now);
      return [...syncItems(rows, configured), ...(ctbc ? [ctbc] : [])];
    }),
    settle("cards", unavailable, async () =>
      cardDueItems(await getCardsSummary(db, now)),
    ),
    settle("activity", unavailable, async () =>
      activityItems(
        (await getRoleActivitiesForMonths(db, months)).items,
        months,
      ),
    ),
  ]);
  const items = sortItems([
    ...(sync ?? []),
    ...(cards ?? []),
    ...(activity ?? []),
  ]);
  return {
    counts: {
      blocking: items.filter((item) => item.severity === "blocking").length,
      tidy: items.filter((item) => item.severity === "tidy").length,
    },
    months,
    items,
    unavailable: unavailable.sort(),
  };
}
