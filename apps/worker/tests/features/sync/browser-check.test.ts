import type { Browser } from "@cloudflare/puppeteer";
import puppeteer from "@cloudflare/puppeteer";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BrowserCheckError,
  checkSyncBrowser,
} from "../../../src/features/sync/browser-check";
import { syncRoutes } from "../../../src/features/sync/route";
import { honoFactory } from "../../../src/platform/hono";
import type { Env } from "../../../src/platform/env";

vi.mock("@cloudflare/puppeteer", () => ({
  default: { launch: vi.fn(), limits: vi.fn() },
}));

const launch = vi.mocked(puppeteer.launch);

function fakeBrowser(text = "ok") {
  const page = {
    setContent: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(text),
  };
  return {
    browser: {
      sessionId: () => "session-1",
      version: vi.fn().mockResolvedValue("HeadlessChrome/126.0.6478.182"),
      newPage: vi.fn().mockResolvedValue(page),
      close: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      once: vi.fn(),
    } as unknown as Browser,
    page,
  };
}

function binding() {
  const fetch = vi.fn(async () => new Response(null, { status: 200 }));
  return { BROWSER: { fetch } as unknown as Fetcher, fetch };
}

afterEach(() => {
  vi.useRealTimers();
  launch.mockReset();
});

describe("checkSyncBrowser", () => {
  it("launches, renders a blank page and closes the session", async () => {
    const { browser } = fakeBrowser();
    launch.mockResolvedValue(browser as never);
    const env = binding();
    const result = await checkSyncBrowser(env);
    expect(result).toMatchObject({
      ok: true,
      version: "HeadlessChrome/126.0.6478.182",
    });
    expect(browser.close).toHaveBeenCalled();
    // 遠端工作階段也會關閉（DELETE /v1/devtools/browser/:id）。
    expect(env.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/v1/devtools/browser/session-1"),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("reports launch failures", async () => {
    launch.mockRejectedValue(new Error("Chrome exited with code 137"));
    await expect(checkSyncBrowser(binding())).rejects.toMatchObject({
      name: "BrowserCheckError",
      stage: "launch",
      message: "瀏覽器啟動失敗：Chrome exited with code 137",
    });
  });

  it("reports a page that does not render and still closes the browser", async () => {
    const { browser } = fakeBrowser("blank");
    launch.mockResolvedValue(browser as never);
    await expect(checkSyncBrowser(binding())).rejects.toMatchObject({
      stage: "page",
    });
    expect(browser.close).toHaveBeenCalled();
  });

  it("times out when the launch never finishes, and closes a late browser", async () => {
    vi.useFakeTimers();
    const { browser } = fakeBrowser();
    let finishLaunch: (value: Browser) => void = () => undefined;
    launch.mockReturnValue(
      new Promise<Browser>((resolve) => {
        finishLaunch = resolve;
      }) as never,
    );
    const checking = checkSyncBrowser(binding(), 1_000);
    const assertion = expect(checking).rejects.toMatchObject({
      stage: "timeout",
      message: "瀏覽器在 1 秒內沒有完成啟動與開頁。",
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
    // 逾時後才啟動完成的瀏覽器仍會被關閉，不會留下工作階段。
    finishLaunch(browser);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(browser.close).toHaveBeenCalled();
  });
});

describe("POST /api/sync/browser-check", () => {
  const app = honoFactory.createApp();
  app.route("/api", syncRoutes);

  it("rejects cross-site and non-JSON requests", async () => {
    const env = binding() as unknown as Env;
    const crossSite = await app.request(
      "/api/sync/browser-check",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Sec-Fetch-Site": "cross-site",
        },
        body: "{}",
      },
      env,
    );
    expect(crossSite.status).toBe(403);
    const form = await app.request(
      "/api/sync/browser-check",
      { method: "POST", body: "a=1" },
      env,
    );
    expect(form.status).toBe(403);
    expect(launch).not.toHaveBeenCalled();
  });

  it("returns 200 on success and 502 with the reason on failure", async () => {
    const env = binding() as unknown as Env;
    const request = () =>
      app.request(
        "/api/sync/browser-check",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
        env,
      );
    launch.mockResolvedValue(fakeBrowser().browser as never);
    const ok = await request();
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true });

    launch.mockRejectedValue(new Error("spawn failed"));
    const failed = await request();
    expect(failed.status).toBe(502);
    expect(await failed.json()).toMatchObject({
      error: {
        code: "BROWSER_CHECK_FAILED",
        message: "瀏覽器啟動失敗：spawn failed",
      },
    });
    expect(new BrowserCheckError("x", "launch")).toBeInstanceOf(Error);
  });
});
