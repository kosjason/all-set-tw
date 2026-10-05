import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestD1 } from "../../helpers/d1";
import { syncScheduleRoutes } from "../../../src/features/sync/scheduling/route";

describe("sync job schedule route", () => {
  let harness: Awaited<ReturnType<typeof createTestD1>>;

  beforeAll(async () => {
    harness = await createTestD1();
  }, 60_000);

  afterAll(async () => {
    await harness?.mf.dispose();
  });

  const patch = (path: string, body: unknown) =>
    syncScheduleRoutes.request(
      path,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      { DB: harness.binding },
    );

  it("refuses to enable the CTBC schedule", async () => {
    const response = await patch("/sync-jobs/ctbc/all", { enabled: true });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "SYNC_SCHEDULE_UNSUPPORTED",
        message: expect.stringContaining("半自動匯入"),
      },
    });
    const row = await harness.binding
      .prepare("SELECT enabled FROM sync_jobs WHERE id = 'ctbc:all'")
      .first<{ enabled: number }>();
    expect(row?.enabled).toBe(0);
  });

  it("still allows disabling CTBC and enabling other connectors", async () => {
    expect(
      (await patch("/sync-jobs/ctbc/all", { enabled: false })).status,
    ).toBe(200);
    expect(
      (await patch("/sync-jobs/taishin/all", { enabled: true })).status,
    ).toBe(200);
  });
});
