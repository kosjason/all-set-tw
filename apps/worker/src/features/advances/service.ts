import { summarizeAdvances, taipeiDay } from "@taiwan-fin-hub/core";
import { loadRoleActivities, monthsBetween } from "../activity/summary-service";
import { earliestAdvanceDay } from "./repository";

/** 代墊彙總最多往回讀的月份數。 */
export const ADVANCE_LOOKBACK_MONTHS = 36;

function shiftMonth(month: string, offset: number) {
  const [year, value] = month.split("-").map(Number) as [number, number];
  const date = new Date(Date.UTC(year, value - 1 + offset, 1));
  return date.toISOString().slice(0, 7);
}

/**
 * 依對象彙總所有代墊與收回代墊（不分月份）。沿用月份活動的推導與去重（發票配對、
 * 即時消費入帳合併），因此金額與月 summary 的 advance／reimbursement 口徑一致。
 */
export async function getAdvances(db: D1Database, now = new Date()) {
  const today = taipeiDay(now);
  const current = today.slice(0, 7);
  const earliest = await earliestAdvanceDay(db);
  if (!earliest) {
    return {
      since: null,
      counterparties: [],
      outstanding: {},
      complete: true,
      incompleteReasons: [],
    };
  }
  const oldest = shiftMonth(current, -(ADVANCE_LOOKBACK_MONTHS - 1));
  const wanted = shiftMonth(earliest.slice(0, 7), -1);
  const months = monthsBetween(wanted > oldest ? wanted : oldest, current);
  const { items, dataIssues } = await loadRoleActivities(db, months, {
    includeTrades: false,
    today,
  });
  const counterparties = summarizeAdvances(items);
  const outstanding: Record<string, number> = {};
  for (const counterparty of counterparties)
    for (const [currency, balance] of Object.entries(counterparty.balances))
      outstanding[currency] =
        Math.round(((outstanding[currency] ?? 0) + balance) * 100) / 100;
  return {
    since: months[0]!,
    counterparties,
    outstanding,
    complete: dataIssues.length === 0 && wanted >= oldest,
    incompleteReasons: dataIssues,
  };
}
