import { describe, expect, it, vi } from "vitest";
import {
  CtbcWebImportNotConfiguredError,
  CtbcWebImportTriggerError,
  ctbcWebImportStatus,
  startCtbcWebImport,
} from "../../../src/features/sync/ctbc-web-import-trigger";

const env = {
  CTBC_IMPORT_TRIGGER_URL: "http://127.0.0.1:8799/",
  CTBC_IMPORT_TRIGGER_TOKEN: "trigger-token",
};

function respond(status: number, body: unknown) {
  return vi.fn().mockResolvedValue(Response.json(body, { status }));
}

describe("中信網銀匯入觸發器", () => {
  it("沒有設定時回報不可用，啟動則拒絕且不連線", async () => {
    const fetcher = vi.fn();
    await expect(ctbcWebImportStatus({}, fetcher)).resolves.toEqual({
      available: false,
    });
    await expect(startCtbcWebImport({}, fetcher)).rejects.toBeInstanceOf(
      CtbcWebImportNotConfiguredError,
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("只設定網址或 token 時視為設定錯誤", async () => {
    await expect(
      ctbcWebImportStatus({ CTBC_IMPORT_TRIGGER_URL: "http://127.0.0.1:8799" }),
    ).rejects.toThrow("設定不完整");
  });

  it("帶 Bearer token 查詢狀態並回傳最近一次結果", async () => {
    const fetcher = respond(200, {
      running: false,
      last: { finishedAt: "2026-10-08 21:12:03", exitCode: 1 },
    });
    await expect(ctbcWebImportStatus(env, fetcher)).resolves.toEqual({
      available: true,
      running: false,
      last: { finishedAt: "2026-10-08 21:12:03", exitCode: 1 },
    });
    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:8799/ctbc-import/status",
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer trigger-token" },
      }),
    );
  });

  it("啟動回傳是否真的開始；已在執行時不重複啟動", async () => {
    const fetcher = respond(202, { started: true, running: true });
    await expect(startCtbcWebImport(env, fetcher)).resolves.toEqual({
      started: true,
      running: true,
    });
    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:8799/ctbc-import/start",
      expect.objectContaining({ method: "POST" }),
    );
    await expect(
      startCtbcWebImport(env, respond(200, { started: false, running: true })),
    ).resolves.toEqual({ started: false, running: true });
  });

  it("連不上、非成功狀態或格式不符時回報觸發器錯誤，不洩漏 token", async () => {
    const failures = [
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
      respond(401, { error: "unauthorized" }),
      respond(200, { running: "yes" }),
    ];
    for (const fetcher of failures) {
      const error = await ctbcWebImportStatus(env, fetcher).catch((e) => e);
      expect(error).toBeInstanceOf(CtbcWebImportTriggerError);
      expect(String(error.message)).not.toContain("trigger-token");
    }
    await expect(
      startCtbcWebImport(env, respond(502, { error: "kickstart_failed" })),
    ).rejects.toThrow("launchd");
  });
});
