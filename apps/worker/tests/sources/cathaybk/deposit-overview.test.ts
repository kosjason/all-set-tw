import { describe, expect, it, vi } from "vitest";
import { openCathayDepositOverview } from "../../../src/sources/cathaybk/connector";

// 合成的假頁面：只模擬 goto、網址與兩種等待的結果。
function fakePage(options: {
  url?: string;
  urlAfterWait?: string;
  accountsReady?: boolean;
  networkIdle?: boolean;
}) {
  let current = options.url ?? "https://www.cathaybk.com.tw/MyBank/Deposit";
  return {
    goto: vi.fn().mockResolvedValue(null),
    url: vi.fn(() => current),
    waitForFunction: vi.fn(() =>
      options.accountsReady === false
        ? Promise.reject(new Error("Waiting failed: 30000ms exceeded"))
        : Promise.resolve(null),
    ),
    waitForNetworkIdle: vi.fn(() => {
      if (options.urlAfterWait) current = options.urlAfterWait;
      return options.networkIdle === false
        ? Promise.reject(new Error("Timeout of 10000 ms exceeded"))
        : Promise.resolve();
    }),
  };
}

describe("openCathayDepositOverview", () => {
  it("does not wait for network idle to navigate", async () => {
    const page = fakePage({});
    await expect(openCathayDepositOverview(page as never)).resolves.toEqual({
      accountsReady: true,
      networkIdle: true,
    });
    expect(page.goto).toHaveBeenCalledWith(
      expect.stringContaining("cathaybk.com.tw"),
      { waitUntil: "domcontentloaded", timeout: 60000 },
    );
    expect(page.waitForFunction).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 30000,
    });
  });

  it("continues when background connections never go idle", async () => {
    // 2026-10 起偶發：網路一直不靜止，以前等 networkidle2 就整次同步失敗。
    const page = fakePage({ networkIdle: false });
    await expect(openCathayDepositOverview(page as never)).resolves.toEqual({
      accountsReady: true,
      networkIdle: false,
    });
  });

  it("leaves missing account buttons to the caller, as before", async () => {
    const page = fakePage({ accountsReady: false });
    await expect(openCathayDepositOverview(page as never)).resolves.toEqual({
      accountsReady: false,
      networkIdle: true,
    });
  });

  it("still detects a forced logout, before or after waiting", async () => {
    await expect(
      openCathayDepositOverview(
        fakePage({
          url: "https://www.cathaybk.com.tw/OnlineBanking/Logout/SystemError",
        }) as never,
      ),
    ).rejects.toThrow("Cathay Bank forced logout");
    await expect(
      openCathayDepositOverview(
        fakePage({
          urlAfterWait:
            "https://www.cathaybk.com.tw/OnlineBanking/Logout/SystemError",
        }) as never,
      ),
    ).rejects.toThrow("Cathay Bank forced logout");
  });
});
