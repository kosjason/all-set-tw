import { BANK_SYNC_MONTHS } from "@taiwan-fin-hub/connectors";
import type { Env } from "../../platform/env";
import { isDemoMode } from "../../platform/http";
import {
  addDays,
  planDepositBackfill,
  taipeiDay,
  type AccountBackfillReport,
} from "./backfill";
import {
  findBankHistoryDateBounds,
  findDerivedBalanceDateBounds,
  findLatestBankDepositHistoryDate,
  listDepositBackfillAccounts,
  listDepositBackfillTransactions,
  listDepositHistorySnapshots,
  listNetWorthChartHistory,
  listNetWorthHistory,
  replaceDerivedBalanceSnapshots,
  upsertBankDepositHistory,
  type NetWorthPageCursor,
} from "./repository";

/**
 * 圖表資料：存款列若落在推算區間（由交易明細推算的日子）會帶 `derived: true`。
 */
export async function getNetWorthChartHistory(db: D1Database) {
  const [rows, derived] = await Promise.all([
    listNetWorthChartHistory(db),
    findDerivedBalanceDateBounds(db),
  ]);
  const until = derived?.until ?? null;
  if (!until) return rows;
  return rows.map((row) =>
    row.source === "bank" && row.assetType === "deposit" && row.date <= until
      ? { ...row, derived: true as const }
      : row,
  );
}

export async function getNetWorthPage(
  db: D1Database,
  limit: number,
  cursor?: NetWorthPageCursor,
) {
  const rows = await listNetWorthHistory(db, limit + 1, cursor);
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    hasMore,
    last,
    history: page.map(({ id: _id, ...row }) => row).reverse(),
  };
}

export function dateFromIso(iso: string) {
  return iso.slice(0, 10);
}

type DepositSnapshot = Awaited<
  ReturnType<typeof listDepositHistorySnapshots>
>[number];

/**
 * 與 calculateBankDepositValue 相同的規則：每個存款帳戶取 as_of_at 日期 ≤ date 的最新快照，
 * 外幣以目前匯率換算，沒有匯率的外幣略過。一次載入快照後在記憶體內逐日計算。
 */
export function computeBankDepositSeries(
  snapshots: DepositSnapshot[],
  dates: string[],
) {
  const byAccount = new Map<string, DepositSnapshot[]>();
  for (const snapshot of snapshots) {
    const list = byAccount.get(snapshot.accountId) ?? [];
    list.push(snapshot);
    byAccount.set(snapshot.accountId, list);
  }
  for (const list of byAccount.values()) {
    list.sort(
      (a, b) =>
        a.asOfAt.localeCompare(b.asOfAt) ||
        a.updatedAt.localeCompare(b.updatedAt),
    );
  }
  const sortedDates = [...dates].sort();
  const cursors = new Map<string, number>();
  const points: Array<{ date: string; netWorth: number }> = [];
  for (const date of sortedDates) {
    let total = 0;
    for (const [accountId, list] of byAccount) {
      let index = cursors.get(accountId) ?? -1;
      while (
        index + 1 < list.length &&
        list[index + 1]!.asOfAt.slice(0, 10) <= date
      )
        index += 1;
      cursors.set(accountId, index);
      const snapshot = list[index];
      if (!snapshot) continue;
      const currency = snapshot.currency || "TWD";
      if (currency === "TWD") total += snapshot.balance;
      else if (snapshot.rateToTwd)
        total += snapshot.balance * snapshot.rateToTwd;
    }
    points.push({ date, netWorth: Math.round(total) });
  }
  return points;
}

export async function rebuildBankDepositHistory(
  db: D1Database,
  dates: string[],
) {
  if (dates.length === 0) return;
  const snapshots = await listDepositHistorySnapshots(db);
  await upsertBankDepositHistory(
    db,
    computeBankDepositSeries(snapshots, dates),
    new Date().toISOString(),
  );
}

/**
 * 重算存款歷史；未指定 `to` 時算到今天（台北日期），沒有同步的日子延續最後已知餘額。
 */
export async function rebuildBankDepositHistoryRange(
  db: D1Database,
  from?: string,
  to?: string,
  now = new Date(),
) {
  const bounds = await findBankHistoryDateBounds(db);
  if (!bounds?.minDate || !bounds.maxDate) return { dates: 0 };
  const today = taipeiDay(now);
  const resolvedFrom = from ?? bounds.minDate;
  const resolvedTo = to ?? (bounds.maxDate > today ? bounds.maxDate : today);
  if (resolvedFrom > resolvedTo) return { dates: 0 };
  const dates = enumerateDates(resolvedFrom, resolvedTo);
  await rebuildBankDepositHistory(db, dates);
  return { dates: dates.length, from: resolvedFrom, to: resolvedTo };
}

export type BankDepositBackfillResult = {
  accounts: AccountBackfillReport[];
  derivedSnapshots: number;
};

/** 由交易明細推算真實快照之前的每日存款餘額，寫成推算快照（冪等）。 */
export async function backfillBankDepositSnapshots(
  db: D1Database,
  now = new Date(),
): Promise<BankDepositBackfillResult> {
  const [accounts, transactions] = await Promise.all([
    listDepositBackfillAccounts(db),
    listDepositBackfillTransactions(db),
  ]);
  const plan = planDepositBackfill({
    accounts,
    transactions,
    syncMonths: BANK_SYNC_MONTHS,
  });
  await replaceDerivedBalanceSnapshots(db, plan, now.toISOString());
  for (const report of plan.accounts) {
    if (report.crossCheck?.mismatchDays) {
      // 只記帳戶末四碼與日期，不記金額。
      console.warn(
        JSON.stringify({
          event: "net_worth_backfill_cross_check_mismatch",
          connectorId: report.connectorId,
          accountLast4: report.accountLast4,
          status: report.status,
          mismatchDays: report.crossCheck.mismatchDays,
          firstMismatch: report.crossCheck.firstMismatch,
          lastMismatch: report.crossCheck.lastMismatch,
        }),
      );
    }
  }
  return { accounts: plan.accounts, derivedSnapshots: plan.snapshots.length };
}

/**
 * 同步寫入後與手動 API 使用：先推算每日餘額，再把存款歷史從最早日重算到今天。
 * 推算失敗不影響同步結果，仍會重算歷史。
 */
export async function refreshBankDepositHistory(
  db: D1Database,
  now = new Date(),
) {
  let backfill: BankDepositBackfillResult | null = null;
  try {
    backfill = await backfillBankDepositSnapshots(db, now);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "net_worth_backfill_failed",
        kind: error instanceof Error ? error.name : typeof error,
      }),
    );
  }
  const history = await rebuildBankDepositHistoryRange(
    db,
    undefined,
    undefined,
    now,
  );
  return { backfill, history };
}

/**
 * 排程使用：今天（台北日期）還沒有存款歷史點時，從最後一點的隔天補到今天。
 * 已有今天的點只花一次查詢。
 */
export async function ensureBankDepositHistoryToday(
  db: D1Database,
  now = new Date(),
) {
  const today = taipeiDay(now);
  const latestDate = await findLatestBankDepositHistoryDate(db);
  if (!latestDate || latestDate >= today) return { dates: 0 };
  const dates = enumerateDates(addDays(latestDate, 1), today);
  await rebuildBankDepositHistory(db, dates);
  return { dates: dates.length, from: dates[0], to: today };
}

/** Cron 入口：每次排程觸發時確認今天有存款歷史點；失敗只記錄，不影響同步排程。 */
export async function ensureScheduledBankDepositHistory(
  env: Pick<Env, "DB" | "DEMO_MODE">,
  now = new Date(),
) {
  if (isDemoMode(env)) return;
  try {
    await ensureBankDepositHistoryToday(env.DB, now);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "net_worth_daily_point_failed",
        kind: error instanceof Error ? error.name : typeof error,
      }),
    );
  }
}

function enumerateDates(from: string, to: string) {
  const dates: string[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
  return dates;
}
