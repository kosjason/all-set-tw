import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObankConnectionError } from "../../../src/sources/obank/mobile-api";
import { SkbankConnectionError } from "../../../src/sources/skbank/mobile-api";
import { BrowserRunCapacityError } from "../../../src/sources/browser";
import {
  FirstbankBrowserCapacityError,
  FirstbankConnectionError,
} from "../../../src/sources/firstbank/connector";
import {
  HncbBrowserCapacityError,
  HncbConnectionError,
} from "../../../src/sources/hncb/connector";
import {
  KgibankBrowserCapacityError,
  KgibankConnectionError,
} from "../../../src/sources/kgibank/connector";
import {
  CathayOtpChannelRequiredError,
  CathayOtpInvalidError,
  CathayOtpRequiredError,
  CathayOtpSessionExpiredError,
} from "../../../src/sources/cathaybk/connector";
import {
  TaishinBrowserCapacityError,
  TaishinConnectionError,
} from "../../../src/sources/taishin/connector";
import type { Env } from "../../../src/platform/env";
import type { SyncEnv } from "../../../src/features/sync/execution";

const mocks = vi.hoisted(() => ({
  cancelQueuedEinvoiceSyncRun: vi.fn(),
  cancelQueuedTdccSyncRun: vi.fn(),
  enqueueEinvoiceSyncChunk: vi.fn(),
  enqueueTdccSyncChunk: vi.fn(),
  prepareSinopacCaptchaSession: vi.fn(),
  prepareTaishinCaptchaSession: vi.fn(),
  prepareHncbCaptchaSession: vi.fn(),
  prepareKgibankCaptchaSession: vi.fn(),
  prepareObankCaptchaSession: vi.fn(),
  prepareMegabankCaptchaSession: vi.fn(),
  prepareNextbankCaptchaSession: vi.fn(),
  syncNextbank: vi.fn(),
  prepareFirstbankCaptchaSession: vi.fn(),
  startEinvoiceSyncRun: vi.fn(),
  startTdccSyncRun: vi.fn(),
  syncCtbc: vi.fn(),
  importCtbcPayloads: vi.fn(),
  syncCathaybk: vi.fn(),
  syncEsun: vi.fn(),
  syncObank: vi.fn(),
  syncMegabank: vi.fn(),
  syncFirstbank: vi.fn(),
  syncHncb: vi.fn(),
  syncKgibank: vi.fn(),
  syncSinopac: vi.fn(),
  syncTaishin: vi.fn(),
  syncSkbank: vi.fn(),
  // withManualSyncLock 交給 task 的 lock-scoped env（e0295fc 起由
  // createSyncExecution 建立）；與 request env 不同，確保 route 把它傳給同步。
  syncEnv: { syncSignal: new AbortController().signal },
}));

vi.mock("../../../src/features/sync/ctbc-import", () => ({
  CtbcImportPayloadError: class CtbcImportPayloadError extends Error {},
  importCtbcPayloads: mocks.importCtbcPayloads,
}));

vi.mock("../../../src/sources/einvoice/sync", () => ({
  cancelQueuedEinvoiceSyncRun: mocks.cancelQueuedEinvoiceSyncRun,
  startEinvoiceSyncRun: mocks.startEinvoiceSyncRun,
}));

vi.mock("../../../src/sources/tdcc/sync", () => ({
  cancelQueuedTdccSyncRun: mocks.cancelQueuedTdccSyncRun,
  startTdccSyncRun: mocks.startTdccSyncRun,
}));

vi.mock("../../../src/features/sync/scheduling/queue", () => ({
  enqueueEinvoiceSyncChunk: mocks.enqueueEinvoiceSyncChunk,
  enqueueTdccSyncChunk: mocks.enqueueTdccSyncChunk,
}));

vi.mock("../../../src/features/sync/errors", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../src/features/sync/errors")
  >()),
  NeedsUserActionError: class NeedsUserActionError extends Error {},
  NextbankCaptchaRequiredError: class NextbankCaptchaRequiredError extends Error {},
  CtbcAutoSyncPausedError: class CtbcAutoSyncPausedError extends Error {
    constructor() {
      super("中信不支援自動同步，請改用網銀半自動匯入。");
    }
  },
  safeErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
  SyncAlreadyRunningError: class SyncAlreadyRunningError extends Error {},
}));

vi.mock("../../../src/features/sync/manual-sync", () => ({
  withManualSyncLock: async (
    _env: Env,
    _connectorId: string,
    _scope: string,
    task: (syncEnv: SyncEnv) => Promise<unknown>,
  ) => task(mocks.syncEnv as unknown as SyncEnv),
}));

vi.mock("../../../src/sources/sinopac/sync", () => ({
  prepareSinopacCaptchaSession: mocks.prepareSinopacCaptchaSession,
  syncSinopac: mocks.syncSinopac,
}));
vi.mock("../../../src/sources/hncb/sync", () => ({
  prepareHncbCaptchaSession: mocks.prepareHncbCaptchaSession,
  syncHncb: mocks.syncHncb,
}));
vi.mock("../../../src/sources/kgibank/sync", () => ({
  prepareKgibankCaptchaSession: mocks.prepareKgibankCaptchaSession,
  syncKgibank: mocks.syncKgibank,
}));
vi.mock("../../../src/sources/taishin/sync", () => ({
  prepareTaishinCaptchaSession: mocks.prepareTaishinCaptchaSession,
  syncTaishin: mocks.syncTaishin,
}));
vi.mock("../../../src/sources/obank/sync", () => ({
  prepareObankCaptchaSession: mocks.prepareObankCaptchaSession,
  syncObank: mocks.syncObank,
}));
vi.mock("../../../src/sources/megabank/sync", () => ({
  prepareMegabankCaptchaSession: mocks.prepareMegabankCaptchaSession,
  syncMegabank: mocks.syncMegabank,
}));
vi.mock("../../../src/sources/nextbank/sync", () => ({
  prepareNextbankCaptchaSession: mocks.prepareNextbankCaptchaSession,
  syncNextbank: mocks.syncNextbank,
}));
vi.mock("../../../src/sources/firstbank/sync", () => ({
  prepareFirstbankCaptchaSession: mocks.prepareFirstbankCaptchaSession,
  syncFirstbank: mocks.syncFirstbank,
}));
vi.mock("../../../src/sources/cathaybk/sync", () => ({
  syncCathaybk: mocks.syncCathaybk,
}));
vi.mock("../../../src/sources/ctbc/sync", () => ({
  syncCtbc: mocks.syncCtbc,
}));
vi.mock("../../../src/sources/esun/sync", () => ({
  syncEsun: mocks.syncEsun,
}));
vi.mock("../../../src/sources/skbank/sync", () => ({
  syncSkbank: mocks.syncSkbank,
}));

import { CtbcImportPayloadError } from "../../../src/features/sync/ctbc-import";
import {
  CTBC_IMPORT_MAX_BYTES,
  syncRoutes,
} from "../../../src/features/sync/route";
import { NextbankCaptchaRequiredError } from "../../../src/features/sync/errors";

const env = {} as Env;
const syncEnv = mocks.syncEnv as unknown as SyncEnv;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.startEinvoiceSyncRun.mockResolvedValue({
    run: { id: "einvoice-run-1" },
    created: true,
  });
  mocks.enqueueEinvoiceSyncChunk.mockResolvedValue(undefined);
  mocks.cancelQueuedEinvoiceSyncRun.mockResolvedValue(undefined);
  mocks.startTdccSyncRun.mockResolvedValue({
    run: { id: "tdcc-run-1" },
    created: true,
  });
  mocks.enqueueTdccSyncChunk.mockResolvedValue(undefined);
  mocks.cancelQueuedTdccSyncRun.mockResolvedValue(undefined);
  mocks.prepareTaishinCaptchaSession.mockResolvedValue({
    captchaImage: "data:image/jpeg;base64,AQID",
    expiresAt: "2026-07-23T12:02:00.000Z",
    digitCount: 6,
  });
  mocks.prepareHncbCaptchaSession.mockResolvedValue({
    captchaImage: "data:image/jpeg;base64,AQID",
    expiresAt: "2026-08-19T08:02:00.000Z",
    digitCount: 4,
    captchaKind: "numeric",
  });
  mocks.prepareKgibankCaptchaSession.mockResolvedValue({
    captchaImage: "data:image/png;base64,AQID",
    expiresAt: "2026-09-23T08:02:00.000Z",
    digitCount: 6,
    captchaKind: "numeric",
  });
  mocks.syncKgibank.mockResolvedValue({
    success: true,
    connectorId: "kgibank",
    scope: "all",
    records: 3,
    newRecords: {
      invoices: 0,
      bankTransactions: 1,
      investmentTransactions: 0,
    },
    cursorUpdated: true,
  });
  mocks.syncHncb.mockResolvedValue({
    success: true,
    connectorId: "hncb",
    scope: "all",
    records: 3,
    newRecords: {
      invoices: 0,
      bankTransactions: 3,
      investmentTransactions: 0,
    },
    cursorUpdated: true,
  });
  mocks.syncTaishin.mockResolvedValue({
    success: true,
    connectorId: "taishin",
    scope: "all",
    records: 3,
    newRecords: {
      invoices: 0,
      bankTransactions: 3,
      investmentTransactions: 0,
    },
    cursorUpdated: true,
  });
  mocks.syncCtbc.mockResolvedValue({
    success: true,
    connectorId: "ctbc",
    scope: "all",
    records: 4,
    newRecords: {
      invoices: 0,
      bankTransactions: 4,
      investmentTransactions: 0,
    },
    cursorUpdated: true,
  });
  mocks.syncEsun.mockResolvedValue({
    success: true,
    connectorId: "esun",
    scope: "all",
    records: 4,
    newRecords: {
      invoices: 0,
      bankTransactions: 4,
      investmentTransactions: 0,
    },
    cursorUpdated: true,
  });
  mocks.prepareObankCaptchaSession.mockResolvedValue({
    captchaImage: "data:image/png;base64,AQID",
    expiresAt: "2026-08-08T12:02:00.000Z",
    captchaLength: 4,
    captchaKind: "alphanumeric",
  });
  mocks.syncObank.mockResolvedValue({
    success: true,
    connectorId: "obank",
    scope: "all",
    records: 3,
    newRecords: {
      invoices: 0,
      bankTransactions: 3,
      investmentTransactions: 0,
    },
    cursorUpdated: true,
  });
  mocks.prepareMegabankCaptchaSession.mockResolvedValue({
    captchaImage: "data:image/jpeg;base64,AQID",
    expiresAt: "2026-09-25T12:02:00.000Z",
    captchaLength: 5,
    captchaKind: "numeric",
  });
  mocks.syncMegabank.mockResolvedValue({
    success: true,
    connectorId: "megabank",
    scope: "all",
    records: 4,
    newRecords: {
      invoices: 0,
      bankTransactions: 2,
      investmentTransactions: 0,
    },
    cursorUpdated: true,
  });
  mocks.prepareFirstbankCaptchaSession.mockResolvedValue({
    captchaImage: "data:image/jpeg;base64,AQID",
    expiresAt: "2026-08-25T12:02:00.000Z",
    captchaLength: 4,
    captchaKind: "alphanumeric",
  });
  mocks.syncFirstbank.mockResolvedValue({
    success: true,
    connectorId: "firstbank",
    scope: "all",
    records: 2,
    newRecords: {
      invoices: 0,
      bankTransactions: 0,
      investmentTransactions: 0,
    },
    cursorUpdated: true,
  });
});

describe("e-invoice sync route", () => {
  it("queues a newly-created manual durable run and returns its run ID", async () => {
    const response = await syncRoutes.request(
      "/connectors/einvoice/sync",
      { method: "POST" },
      env,
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      connectorId: "einvoice",
      scope: "all",
      status: "queued",
      runId: "einvoice-run-1",
    });
    expect(mocks.startEinvoiceSyncRun).toHaveBeenCalledWith(env, {
      trigger: "manual",
    });
    expect(mocks.enqueueEinvoiceSyncChunk).toHaveBeenCalledWith(
      env,
      "einvoice-run-1",
    );
  });

  // 上游 e0295fc 起，重用中的 run 也會重新 enqueue，讓中斷的 Queue 鏈能恢復
  // （與 TDCC 相同）；只有新建的 run 在 enqueue 失敗時才取消。
  it("requeues a reused active run so an orphaned Queue chain can resume", async () => {
    mocks.startEinvoiceSyncRun.mockResolvedValueOnce({
      run: { id: "einvoice-running" },
      created: false,
    });

    const response = await syncRoutes.request(
      "/connectors/einvoice/sync",
      { method: "POST" },
      env,
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      status: "queued",
      runId: "einvoice-running",
    });
    expect(mocks.enqueueEinvoiceSyncChunk).toHaveBeenCalledWith(
      env,
      "einvoice-running",
    );
    expect(mocks.cancelQueuedEinvoiceSyncRun).not.toHaveBeenCalled();
  });

  it("does not cancel a reused run when its recovery enqueue fails", async () => {
    mocks.startEinvoiceSyncRun.mockResolvedValueOnce({
      run: { id: "einvoice-running" },
      created: false,
    });
    mocks.enqueueEinvoiceSyncChunk.mockRejectedValueOnce(
      new Error("Queue unavailable"),
    );

    const response = await syncRoutes.request(
      "/connectors/einvoice/sync",
      { method: "POST" },
      env,
    );

    expect(response.status).toBe(500);
    expect(mocks.cancelQueuedEinvoiceSyncRun).not.toHaveBeenCalled();
  });

  it("cancels only its newly-created run when Queue enqueueing fails", async () => {
    const error = new Error("Queue unavailable");
    mocks.enqueueEinvoiceSyncChunk.mockRejectedValueOnce(error);

    const response = await syncRoutes.request(
      "/connectors/einvoice/sync",
      { method: "POST" },
      env,
    );

    expect(response.status).toBe(500);
    expect(mocks.cancelQueuedEinvoiceSyncRun).toHaveBeenCalledWith(
      env,
      "einvoice-run-1",
      error,
    );
  });
});

describe("TDCC sync route", () => {
  it("queues a newly-created manual durable run", async () => {
    const response = await syncRoutes.request(
      "/connectors/tdcc/sync",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
      env,
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      connectorId: "tdcc",
      scope: "all",
      status: "queued",
      runId: "tdcc-run-1",
    });
    expect(mocks.enqueueTdccSyncChunk).toHaveBeenCalledWith(env, "tdcc-run-1");
  });

  it("requeues a reused active run so an orphaned Queue chain can resume", async () => {
    mocks.startTdccSyncRun.mockResolvedValueOnce({
      run: { id: "tdcc-running" },
      created: false,
    });

    const response = await syncRoutes.request(
      "/connectors/tdcc/sync",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
      env,
    );

    expect(response.status).toBe(202);
    expect(mocks.enqueueTdccSyncChunk).toHaveBeenCalledWith(
      env,
      "tdcc-running",
    );
    expect(mocks.cancelQueuedTdccSyncRun).not.toHaveBeenCalled();
  });

  it("does not fail a reused run when its recovery enqueue fails", async () => {
    mocks.startTdccSyncRun.mockResolvedValueOnce({
      run: { id: "tdcc-running" },
      created: false,
    });
    mocks.enqueueTdccSyncChunk.mockRejectedValueOnce(
      new Error("Queue unavailable"),
    );

    const response = await syncRoutes.request(
      "/connectors/tdcc/sync",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
      env,
    );

    expect(response.status).toBe(500);
    expect(mocks.cancelQueuedTdccSyncRun).not.toHaveBeenCalled();
  });
});

describe("CTBC sync route", () => {
  it("rejects automatic sync and points to the semi-automatic import", async () => {
    const response = await syncRoutes.request(
      "/connectors/ctbc/sync",
      { method: "POST" },
      env,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "CTBC_AUTO_SYNC_PAUSED",
        message: expect.stringContaining("半自動匯入"),
      },
    });
    expect(mocks.syncCtbc).not.toHaveBeenCalled();
  });
});

describe("CTBC web import route", () => {
  const secretAccount = "9990001112223334";
  const validBody = {
    payloads: {
      depositOverview: { rsData: { marker: secretAccount } },
      depositTransactions: { rsData: { detailList: [] } },
      creditCards: { rsData: {} },
      unbilled: { rsData: { allItems: [] } },
      realtime: { rsData: { allItems: [] } },
    },
    depositTransactionsUnavailable: true,
  };

  function postImport(body: string) {
    return syncRoutes.request(
      "/connectors/ctbc/import",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      },
      env,
    );
  }

  it("imports validated payloads under the manual sync lock", async () => {
    mocks.importCtbcPayloads.mockResolvedValueOnce({
      success: true,
      connectorId: "ctbc",
      scope: "all",
      records: 7,
      newRecords: {
        invoices: 0,
        bankTransactions: 3,
        investmentTransactions: 0,
      },
      cursorUpdated: false,
    });

    const response = await postImport(JSON.stringify(validBody));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      connectorId: "ctbc",
      records: 7,
    });
    expect(mocks.importCtbcPayloads).toHaveBeenCalledWith(
      syncEnv,
      validBody.payloads,
      { depositTransactionsUnavailable: true },
    );
  });

  it.each([
    ["missing payloads", {}],
    [
      "missing required response",
      { payloads: { depositOverview: { marker: secretAccount } } },
    ],
    [
      "array instead of response object",
      {
        payloads: {
          ...validBody.payloads,
          depositOverview: [secretAccount],
        },
      },
    ],
    [
      "unknown top-level field",
      { ...validBody, password: `secret-${secretAccount}` },
    ],
  ])("rejects %s without echoing data", async (_name, body) => {
    const response = await postImport(JSON.stringify(body));
    const text = await response.text();

    expect(response.status).toBe(400);
    expect(JSON.parse(text)).toMatchObject({
      success: false,
      error: { code: "INVALID_REQUEST" },
    });
    expect(text).not.toContain(secretAccount);
    expect(mocks.importCtbcPayloads).not.toHaveBeenCalled();
  });

  it("rejects bodies above the size limit", async () => {
    const body = JSON.stringify({
      payloads: {
        ...validBody.payloads,
        depositOverview: { padding: "x".repeat(CTBC_IMPORT_MAX_BYTES) },
      },
    });

    const response = await postImport(body);

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "PAYLOAD_TOO_LARGE" },
    });
    expect(mocks.importCtbcPayloads).not.toHaveBeenCalled();
  });

  it("maps unparsable payloads to a fixed message", async () => {
    mocks.importCtbcPayloads.mockRejectedValueOnce(
      new CtbcImportPayloadError("中國信託匯入資料格式不符，未寫入任何資料。"),
    );

    const response = await postImport(JSON.stringify(validBody));
    const text = await response.text();

    expect(response.status).toBe(400);
    expect(JSON.parse(text)).toMatchObject({
      error: { code: "CTBC_IMPORT_INVALID" },
    });
    expect(text).not.toContain(secretAccount);
  });
});

describe("SKBank sync route", () => {
  it("dispatches a manual sync", async () => {
    const response = await syncRoutes.request(
      "/connectors/skbank/sync",
      { method: "POST" },
      env,
    );

    expect(response.status).toBe(200);
    expect(mocks.syncSkbank).toHaveBeenCalledWith(syncEnv, "manual");
  });

  it("maps App API connection failures", async () => {
    mocks.syncSkbank.mockRejectedValueOnce(new SkbankConnectionError());
    const response = await syncRoutes.request(
      "/connectors/skbank/sync",
      { method: "POST" },
      env,
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "SKBANK_CONNECTION_FAILED" },
    });
  });
});

describe("E.SUN sync route", () => {
  it("returns the same safe error message persisted by the sync service", async () => {
    mocks.syncEsun.mockRejectedValueOnce(
      new Error(
        "E.SUN browser login: duplicate-login dialog kept reappearing.",
      ),
    );

    const response = await syncRoutes.request(
      "/connectors/esun/sync",
      { method: "POST" },
      env,
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "SYNC_FAILED",
        message:
          "E.SUN browser login: duplicate-login dialog kept reappearing.",
      },
    });
  });

  it.each([
    ["esun", mocks.syncEsun],
    ["cathaybk", mocks.syncCathaybk],
  ])("maps %s Browser Run capacity failures", async (connectorId, sync) => {
    sync.mockRejectedValueOnce(new BrowserRunCapacityError("rate_limit", 20));

    const response = await syncRoutes.request(
      `/connectors/${connectorId}/sync`,
      { method: "POST" },
      env,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("20");
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "BROWSER_BUSY",
        message: "Cloudflare 瀏覽器暫時達到使用上限，請稍後再試。",
      },
    });
  });
});

describe("Cathay sync routes", () => {
  it("dispatches a manual sync without OTP overrides", async () => {
    const response = await syncRoutes.request(
      "/connectors/cathaybk/sync",
      { method: "POST" },
      env,
    );

    expect(response.status).toBe(200);
    expect(mocks.syncCathaybk).toHaveBeenCalledWith(syncEnv, "manual", {});
  });

  it("passes the selected OTP channel and code to the sync service", async () => {
    const response = await syncRoutes.request(
      "/connectors/cathaybk/sync",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otpChannel: "email", otp: "123456" }),
      },
      env,
    );

    expect(response.status).toBe(200);
    expect(mocks.syncCathaybk).toHaveBeenCalledWith(syncEnv, "manual", {
      otpChannel: "email",
      otp: "123456",
    });
  });

  it("rejects a malformed OTP channel before dispatch", async () => {
    const response = await syncRoutes.request(
      "/connectors/cathaybk/sync",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otpChannel: "push" }),
      },
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });
    expect(mocks.syncCathaybk).not.toHaveBeenCalled();
  });

  it.each([
    [
      new CathayOtpChannelRequiredError(
        "請選擇驗證方式。",
        "pending-session",
        "2026-08-22T12:00:00.000Z",
      ),
      "CATHAY_OTP_CHANNEL_REQUIRED",
    ],
    [
      new CathayOtpRequiredError("Email 驗證碼已寄出。", "email"),
      "CATHAY_EMAIL_OTP_REQUIRED",
    ],
    [
      new CathayOtpRequiredError("簡訊驗證碼已寄出。", "sms"),
      "CATHAY_SMS_OTP_REQUIRED",
    ],
    [new CathayOtpSessionExpiredError(), "CATHAY_OTP_SESSION_EXPIRED"],
    [new CathayOtpInvalidError(), "CATHAY_OTP_INVALID"],
  ])("maps %s to %s", async (error, code) => {
    mocks.syncCathaybk.mockRejectedValueOnce(error);
    const response = await syncRoutes.request(
      "/connectors/cathaybk/sync",
      { method: "POST" },
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code },
    });
  });
});

describe("Taishin sync routes", () => {
  it("accepts an empty sync body and dispatches the manual sync", async () => {
    const response = await syncRoutes.request(
      "/connectors/taishin/sync",
      { method: "POST" },
      env,
    );

    expect(response.status).toBe(200);
    expect(mocks.syncTaishin).toHaveBeenCalledWith(syncEnv, "manual", {});
  });

  it("rejects malformed manual CAPTCHA input", async () => {
    const response = await syncRoutes.request(
      "/connectors/taishin/sync",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ captcha: "12AB" }),
      },
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });
    expect(mocks.syncTaishin).not.toHaveBeenCalled();
  });

  it("returns the manual CAPTCHA metadata", async () => {
    const response = await syncRoutes.request(
      "/connectors/taishin/captcha",
      { method: "POST" },
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      digitCount: 6,
      captchaImage: "data:image/jpeg;base64,AQID",
    });
  });

  it("maps Browser Rendering capacity and connection failures", async () => {
    mocks.prepareTaishinCaptchaSession.mockRejectedValueOnce(
      new TaishinBrowserCapacityError("browser busy", 17),
    );
    const busy = await syncRoutes.request(
      "/connectors/taishin/captcha",
      { method: "POST" },
      env,
    );
    expect(busy.status).toBe(429);
    expect(busy.headers.get("Retry-After")).toBe("17");
    await expect(busy.json()).resolves.toMatchObject({
      error: { code: "TAISHIN_BROWSER_BUSY" },
    });

    mocks.syncTaishin.mockRejectedValueOnce(
      new TaishinConnectionError("schema drift"),
    );
    const failed = await syncRoutes.request(
      "/connectors/taishin/sync",
      { method: "POST" },
      env,
    );
    expect(failed.status).toBe(502);
    await expect(failed.json()).resolves.toMatchObject({
      error: { code: "TAISHIN_CONNECTION_FAILED" },
    });
  });
});

describe("HNCB sync routes", () => {
  it("returns the manual CAPTCHA metadata", async () => {
    const response = await syncRoutes.request(
      "/connectors/hncb/captcha",
      { method: "POST" },
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      digitCount: 4,
      captchaKind: "numeric",
      captchaImage: "data:image/jpeg;base64,AQID",
    });
  });

  it("accepts four numeric digits and rejects malformed input", async () => {
    const valid = await syncRoutes.request(
      "/connectors/hncb/sync",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ captcha: "1234" }),
      },
      env,
    );
    expect(valid.status).toBe(200);
    expect(mocks.syncHncb).toHaveBeenCalledWith(syncEnv, "manual", {
      captcha: "1234",
    });

    const invalid = await syncRoutes.request(
      "/connectors/hncb/sync",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ captcha: "12AB" }),
      },
      env,
    );
    expect(invalid.status).toBe(400);
    expect(mocks.syncHncb).toHaveBeenCalledTimes(1);
  });

  it("maps Browser Rendering capacity and connection failures", async () => {
    mocks.prepareHncbCaptchaSession.mockRejectedValueOnce(
      new HncbBrowserCapacityError("browser busy", 17),
    );
    const busy = await syncRoutes.request(
      "/connectors/hncb/captcha",
      { method: "POST" },
      env,
    );
    expect(busy.status).toBe(429);
    expect(busy.headers.get("Retry-After")).toBe("17");
    await expect(busy.json()).resolves.toMatchObject({
      error: { code: "HNCB_BROWSER_BUSY" },
    });

    mocks.syncHncb.mockRejectedValueOnce(
      new HncbConnectionError("schema drift"),
    );
    const failed = await syncRoutes.request(
      "/connectors/hncb/sync",
      { method: "POST" },
      env,
    );
    expect(failed.status).toBe(502);
    await expect(failed.json()).resolves.toMatchObject({
      error: { code: "HNCB_CONNECTION_FAILED" },
    });
  });
});

describe("KGI Bank sync routes", () => {
  it("returns the manual CAPTCHA metadata", async () => {
    const response = await syncRoutes.request(
      "/connectors/kgibank/captcha",
      { method: "POST" },
      env,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      digitCount: 6,
      captchaKind: "numeric",
    });
  });

  it("accepts six numeric digits and rejects malformed input", async () => {
    const valid = await syncRoutes.request(
      "/connectors/kgibank/sync",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ captcha: "123456" }),
      },
      env,
    );
    expect(valid.status).toBe(200);
    expect(mocks.syncKgibank).toHaveBeenCalledWith(syncEnv, "manual", {
      captcha: "123456",
    });

    const invalid = await syncRoutes.request(
      "/connectors/kgibank/sync",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ captcha: "1234" }),
      },
      env,
    );
    expect(invalid.status).toBe(400);
    expect(mocks.syncKgibank).toHaveBeenCalledTimes(1);
  });

  it("maps Browser Rendering capacity and connection failures", async () => {
    mocks.prepareKgibankCaptchaSession.mockRejectedValueOnce(
      new KgibankBrowserCapacityError("browser busy", 9),
    );
    const busy = await syncRoutes.request(
      "/connectors/kgibank/captcha",
      { method: "POST" },
      env,
    );
    expect(busy.status).toBe(429);
    expect(busy.headers.get("Retry-After")).toBe("9");

    mocks.syncKgibank.mockRejectedValueOnce(
      new KgibankConnectionError("schema drift"),
    );
    const failed = await syncRoutes.request(
      "/connectors/kgibank/sync",
      { method: "POST" },
      env,
    );
    expect(failed.status).toBe(502);
    await expect(failed.json()).resolves.toMatchObject({
      error: { code: "KGIBANK_CONNECTION_FAILED" },
    });
  });
});

describe("Nextbank sync routes", () => {
  it("returns a challenge and forwards the manual answer to the runtime", async () => {
    mocks.prepareNextbankCaptchaSession.mockResolvedValueOnce({
      captchaImage: "data:image/png;base64,AQID",
      captchaLength: 5,
      captchaKind: "alphanumeric",
    });
    const challenge = await syncRoutes.request(
      "/connectors/nextbank/captcha",
      { method: "POST" },
      env,
    );
    expect(challenge.status).toBe(200);
    expect(await challenge.json()).toMatchObject({ captchaLength: 5 });
    mocks.syncNextbank.mockResolvedValueOnce({
      success: true,
      connectorId: "nextbank",
      scope: "all",
      records: 0,
    });
    const synced = await syncRoutes.request(
      "/connectors/nextbank/sync",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ captcha: "A1b2C" }),
      },
      env,
    );
    expect(synced.status).toBe(200);
    expect(mocks.syncNextbank).toHaveBeenCalledWith(syncEnv, "manual", {
      captcha: "A1b2C",
    });
  });
  it("rejects invalid answers before reaching the bank runtime", async () => {
    const response = await syncRoutes.request(
      "/connectors/nextbank/sync",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ captcha: "abcdef" }),
      },
      env,
    );
    expect(response.status).toBe(400);
    expect(mocks.syncNextbank).not.toHaveBeenCalled();
  });
  it("returns a stable code when a new CAPTCHA is required", async () => {
    mocks.syncNextbank.mockRejectedValueOnce(
      new NextbankCaptchaRequiredError("請重新取得驗證碼。"),
    );
    const response = await syncRoutes.request(
      "/connectors/nextbank/sync",
      { method: "POST" },
      env,
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "NEXTBANK_CAPTCHA_REQUIRED" },
    });
  });
});

describe("O-Bank sync routes", () => {
  it("returns the App API CAPTCHA metadata", async () => {
    const response = await syncRoutes.request(
      "/connectors/obank/captcha",
      { method: "POST" },
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      captchaLength: 4,
      captchaKind: "alphanumeric",
      captchaImage: "data:image/png;base64,AQID",
    });
  });

  it("accepts four alphanumeric characters and rejects malformed input", async () => {
    const valid = await syncRoutes.request(
      "/connectors/obank/sync",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ captcha: "A1b2" }),
      },
      env,
    );
    expect(valid.status).toBe(200);
    expect(mocks.syncObank).toHaveBeenCalledWith(syncEnv, "manual", {
      captcha: "A1b2",
    });

    const invalid = await syncRoutes.request(
      "/connectors/obank/sync",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ captcha: "12345" }),
      },
      env,
    );
    expect(invalid.status).toBe(400);
  });

  it("maps App API connection failures", async () => {
    mocks.syncObank.mockRejectedValueOnce(
      new ObankConnectionError("schema drift"),
    );
    const response = await syncRoutes.request(
      "/connectors/obank/sync",
      { method: "POST" },
      env,
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "OBANK_CONNECTION_FAILED" },
    });
  });
});

describe("Mega Bank sync routes", () => {
  it("returns a five-digit CAPTCHA challenge", async () => {
    const response = await syncRoutes.request(
      "/connectors/megabank/captcha",
      { method: "POST" },
      env,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      captchaLength: 5,
      captchaKind: "numeric",
    });
  });

  it("dispatches manual sync only with a valid five-digit CAPTCHA", async () => {
    const valid = await syncRoutes.request(
      "/connectors/megabank/sync",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ captcha: "12345" }),
      },
      env,
    );
    expect(valid.status).toBe(200);
    expect(mocks.syncMegabank).toHaveBeenCalledWith(syncEnv, "manual", {
      captcha: "12345",
    });
    const invalid = await syncRoutes.request(
      "/connectors/megabank/sync",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ captcha: "1234" }),
      },
      env,
    );
    expect(invalid.status).toBe(400);
  });
});

describe("First Bank web sync routes", () => {
  it("returns alphanumeric CAPTCHA metadata", async () => {
    const response = await syncRoutes.request(
      "/connectors/firstbank/captcha",
      { method: "POST" },
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      captchaLength: 4,
      captchaKind: "alphanumeric",
      captchaImage: "data:image/jpeg;base64,AQID",
    });
  });

  it("maps browser capacity while preparing CAPTCHA", async () => {
    mocks.prepareFirstbankCaptchaSession.mockRejectedValueOnce(
      new FirstbankBrowserCapacityError("browser busy", 17),
    );
    const response = await syncRoutes.request(
      "/connectors/firstbank/captcha",
      { method: "POST" },
      env,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("17");
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "FIRSTBANK_BROWSER_BUSY" },
    });
  });

  it("accepts four to eight alphanumeric characters and rejects malformed input", async () => {
    const valid = await syncRoutes.request(
      "/connectors/firstbank/sync",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ captcha: "XVSH" }),
      },
      env,
    );
    expect(valid.status).toBe(200);
    expect(mocks.syncFirstbank).toHaveBeenCalledWith(syncEnv, "manual", {
      captcha: "XVSH",
    });

    const invalid = await syncRoutes.request(
      "/connectors/firstbank/sync",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ captcha: "A1-_" }),
      },
      env,
    );
    expect(invalid.status).toBe(400);
  });

  it("maps web connection failures", async () => {
    mocks.syncFirstbank.mockRejectedValueOnce(
      new FirstbankConnectionError("schema drift"),
    );
    const response = await syncRoutes.request(
      "/connectors/firstbank/sync",
      { method: "POST" },
      env,
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "FIRSTBANK_CONNECTION_FAILED" },
    });
  });

  it("maps browser capacity during sync", async () => {
    mocks.syncFirstbank.mockRejectedValueOnce(
      new FirstbankBrowserCapacityError("browser busy", 9),
    );
    const response = await syncRoutes.request(
      "/connectors/firstbank/sync",
      { method: "POST" },
      env,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("9");
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "FIRSTBANK_BROWSER_BUSY" },
    });
  });
});

describe("shared Browser Run capacity responses", () => {
  it.each([
    ["esun", mocks.syncEsun],
    ["cathaybk", mocks.syncCathaybk],
    ["sinopac", mocks.syncSinopac],
    ["taishin", mocks.syncTaishin],
    ["hncb", mocks.syncHncb],
    ["kgibank", mocks.syncKgibank],
    ["firstbank", mocks.syncFirstbank],
  ])("maps %s sync failures to BROWSER_BUSY", async (connectorId, sync) => {
    sync.mockRejectedValueOnce(new BrowserRunCapacityError("rate_limit", 20));
    const response = await syncRoutes.request(
      `/connectors/${connectorId}/sync`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
      env,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("20");
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "BROWSER_BUSY" },
    });
  });

  it.each([
    ["sinopac", mocks.prepareSinopacCaptchaSession],
    ["taishin", mocks.prepareTaishinCaptchaSession],
    ["hncb", mocks.prepareHncbCaptchaSession],
    ["kgibank", mocks.prepareKgibankCaptchaSession],
    ["firstbank", mocks.prepareFirstbankCaptchaSession],
  ])(
    "maps %s CAPTCHA failures to BROWSER_BUSY",
    async (connectorId, prepare) => {
      prepare.mockRejectedValueOnce(
        new BrowserRunCapacityError("acquisition_rate_limit", 17),
      );
      const response = await syncRoutes.request(
        `/connectors/${connectorId}/captcha`,
        { method: "POST" },
        env,
      );

      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).toBe("17");
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "BROWSER_BUSY" },
      });
    },
  );
});
