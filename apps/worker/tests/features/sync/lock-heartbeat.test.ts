import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const renewSyncJobLock = vi.hoisted(() => vi.fn());
vi.mock("../../../src/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/db")>()),
  renewSyncJobLock,
}));

import {
  startSyncLockHeartbeat,
  SYNC_LOCK_LEASE_MS,
  SYNC_MAX_DURATION_MS,
} from "../../../src/features/sync/lock";

const db = {} as D1Database;

describe("sync lock heartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    renewSyncJobLock.mockReset().mockResolvedValue(true);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps leases short and no longer than a run may last", () => {
    expect(SYNC_LOCK_LEASE_MS).toBe(10 * 60 * 1000);
    expect(SYNC_LOCK_LEASE_MS).toBeLessThanOrEqual(SYNC_MAX_DURATION_MS);
  });

  it("renews every two minutes with the short lease until stopped", async () => {
    const onLost = vi.fn();
    const stop = startSyncLockHeartbeat(db, "esun:all", "run-1", onLost);

    await vi.advanceTimersByTimeAsync(2 * 60 * 1000 - 1);
    expect(renewSyncJobLock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(renewSyncJobLock).toHaveBeenCalledExactlyOnceWith(db, {
      lockRowId: "esun:all",
      runId: "run-1",
      leaseMs: SYNC_LOCK_LEASE_MS,
    });

    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    expect(renewSyncJobLock).toHaveBeenCalledTimes(2);

    stop();
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(renewSyncJobLock).toHaveBeenCalledTimes(2);
    expect(onLost).not.toHaveBeenCalled();
  });

  it("reports a lost or failed renewal so the run can stop", async () => {
    const onLost = vi.fn();
    renewSyncJobLock
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error("D1 unavailable"));
    const stop = startSyncLockHeartbeat(db, "esun:all", "run-1", onLost);

    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    stop();

    expect(onLost).toHaveBeenCalledTimes(2);
    expect(
      onLost.mock.calls.map(([error]) => (error as Error).message),
    ).toEqual(["同步鎖已失效，請重新同步。", "同步鎖續租失敗，請重新同步。"]);
  });
});
