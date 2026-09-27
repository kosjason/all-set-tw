import type { CardsSummaryResponse } from "@taiwan-fin-hub/core";
import { describe, expect, it } from "vitest";
import type { SyncJobRow } from "@/data/connectors/types";
import { summarizeSyncJobs, upcomingCardDues } from "./shell-status";

function job(overrides: Partial<SyncJobRow>): SyncJobRow {
  return {
    id: "job",
    connectorId: "esun",
    configured: true,
    scope: "all",
    enabled: true,
    intervalMinutes: 60,
    nextRunAt: "2026-09-27T00:00:00Z",
    scheduleMode: "inherit",
    preferredTime: "08:00",
    preferredWeekday: 1,
    lockedUntil: null,
    lockedBy: null,
    lockTrigger: null,
    lockScope: null,
    lastRunAt: null,
    lastSuccessAt: null,
    lastStatus: null,
    lastError: null,
    updatedAt: "2026-09-27T00:00:00Z",
    running: false,
    ...overrides,
  } as SyncJobRow;
}

describe("summarizeSyncJobs", () => {
  it("依連接器合併工作，失敗的來源排最前，並取最新成功時間", () => {
    const overview = summarizeSyncJobs([
      job({ id: "a", lastSuccessAt: "2026-09-26T01:00:00Z" }),
      job({ id: "b", lastSuccessAt: "2026-09-27T01:00:00+08:00" }),
      job({
        id: "c",
        connectorId: "taishin",
        lastStatus: "needs_user_action",
        lastSuccessAt: "2026-09-20T00:00:00Z",
      }),
      job({ id: "d", connectorId: "cathaybk", configured: false }),
      job({
        id: "e",
        connectorId: "hncb",
        enabled: false,
        lastSuccessAt: "2026-09-25T00:00:00Z",
      }),
    ]);

    expect(
      overview.sources.map((source) => [source.connectorId, source.health]),
    ).toEqual([
      ["taishin", "attention"],
      ["hncb", "unscheduled"],
      ["esun", "ok"],
    ]);
    expect(overview.unscheduled).toBe(1);
    expect(overview.sources[2]?.lastSuccessAt).toBe(
      "2026-09-27T01:00:00+08:00",
    );
    expect(overview.lastSuccessAt).toBe("2026-09-27T01:00:00+08:00");
    expect(overview.attention).toBe(1);
    expect(overview.running).toBe(false);
  });

  it("執行中與從未成功分別標示", () => {
    const overview = summarizeSyncJobs([
      job({ connectorId: "esun", running: true }),
      job({ connectorId: "taishin" }),
    ]);
    expect(
      Object.fromEntries(
        overview.sources.map((source) => [source.connectorId, source.health]),
      ),
    ).toEqual({ esun: "running", taishin: "never" });
    expect(overview.running).toBe(true);
    expect(overview.lastSuccessAt).toBeNull();
  });
});

describe("upcomingCardDues", () => {
  const issuer = (
    name: string,
    bill: Record<string, unknown> | null,
  ): CardsSummaryResponse["issuers"][number] =>
    ({ issuer: name, name, currentBill: bill }) as never;

  it("只列未繳清且截止日已知的帳單，依截止日排序", () => {
    const dues = upcomingCardDues({
      issuers: [
        issuer("a", {
          paymentStatus: "unpaid",
          paymentDueDate: "2026-10-10",
          daysUntilDue: 13,
          remainingAmount: 100,
        }),
        issuer("b", {
          paymentStatus: "partial",
          paymentDueDate: "2026-10-01",
          daysUntilDue: 4,
          remainingAmount: 50,
        }),
        issuer("c", {
          paymentStatus: "paid",
          paymentDueDate: "2026-10-02",
          daysUntilDue: 5,
          remainingAmount: 0,
        }),
        issuer("d", {
          paymentStatus: "unknown",
          paymentDueDate: "2026-10-03",
          daysUntilDue: 6,
          remainingAmount: null,
        }),
        issuer("e", {
          paymentStatus: "unpaid",
          paymentDueDate: null,
          daysUntilDue: null,
          remainingAmount: 10,
        }),
        issuer("f", null),
      ],
    } as never);

    expect(dues.map((due) => due.issuer)).toEqual(["b", "a"]);
  });
});
