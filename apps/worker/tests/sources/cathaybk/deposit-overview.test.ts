import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CATHAY_DEPOSITS_NOT_LOADED_WARNING,
  cathayDepositOverviewComplete,
  openCathayDepositOverview,
  scrapeDeposits,
} from "../../../src/sources/cathaybk/connector";

// 合成資料：虛構帳號與金額。

/** 假的帳號按鈕：所在列的文字為 rowText（null 表示這一列還沒畫出來）。 */
function accountButton(acctNo: string, rowText: string | null) {
  const row =
    rowText == null ? null : { innerText: rowText, parentElement: null };
  return {
    textContent: acctNo,
    parentElement: row ? { innerText: acctNo, parentElement: row } : null,
  };
}

function setButtons(buttons: unknown[]) {
  vi.stubGlobal("document", { querySelectorAll: () => buttons });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete (globalThis as { __cathayDepositOverview?: unknown })
    .__cathayDepositOverview;
});

describe("cathayDepositOverviewComplete", () => {
  it("waits until every account row has an amount and the count is stable", () => {
    vi.useFakeTimers({ now: 0 });
    setButtons([
      accountButton("123456789012", "活期存款 123456789012 $12,345"),
    ]);
    // 第一次看到完整的帳戶時開始計時，連續 1.5 秒沒有變化才算完成。
    expect(cathayDepositOverviewComplete()).toBe(false);
    vi.setSystemTime(1_000);
    expect(cathayDepositOverviewComplete()).toBe(false);
    // 第二個帳戶晚一點才出現：重新計時，不能只讀到第一個。
    setButtons([
      accountButton("123456789012", "活期存款 123456789012 $12,345"),
      accountButton("987654321098", "綜存 987654321098 $500"),
    ]);
    vi.setSystemTime(1_600);
    expect(cathayDepositOverviewComplete()).toBe(false);
    vi.setSystemTime(3_200);
    expect(cathayDepositOverviewComplete()).toBe(true);
  });

  it("is not complete while an amount is still loading", () => {
    vi.useFakeTimers({ now: 0 });
    setButtons([
      accountButton("123456789012", "活期存款 123456789012 $12,345"),
      // 列已出現、金額還沒載入（只有 $）：不能讀成 0。
      accountButton("987654321098", "綜存 987654321098 $"),
    ]);
    expect(cathayDepositOverviewComplete()).toBe(false);
    vi.setSystemTime(5_000);
    expect(cathayDepositOverviewComplete()).toBe(false);
    // 同一列的餘額與可用餘額只載入了其中一個，也還不能讀。
    for (const row of [
      "活期存款 123456789012 $12,345 $",
      "活期存款 123456789012 $ $12,345",
    ]) {
      setButtons([accountButton("123456789012", row)]);
      vi.setSystemTime(10_000);
      expect(cathayDepositOverviewComplete()).toBe(false);
      vi.setSystemTime(20_000);
      expect(cathayDepositOverviewComplete()).toBe(false);
    }
    // 兩個都載入了（含 NT$ 寫法）才開始計時。
    setButtons([
      accountButton(
        "123456789012",
        "活期存款 123456789012 NT$12,345 NT$12,000",
      ),
    ]);
    vi.setSystemTime(30_000);
    expect(cathayDepositOverviewComplete()).toBe(false);
    vi.setSystemTime(31_500);
    expect(cathayDepositOverviewComplete()).toBe(true);
  });

  it("ignores number buttons without an amount row, like the scraper", () => {
    vi.useFakeTimers({ now: 0 });
    // 沒有金額列的按鈕本來就不會被讀取；不能因此永遠等不到完成、每天略過存款。
    setButtons([
      accountButton("123456789012", "活期存款 123456789012 $12,345"),
      accountButton("5555666677778888", null),
    ]);
    expect(cathayDepositOverviewComplete()).toBe(false);
    vi.setSystemTime(1_500);
    expect(cathayDepositOverviewComplete()).toBe(true);
  });

  it("is not complete without any account button", () => {
    setButtons([{ textContent: "登出", parentElement: null }]);
    expect(cathayDepositOverviewComplete()).toBe(false);
  });
});

// 合成的假頁面：只模擬 goto、網址與兩種等待的結果。
function fakePage(options: {
  url?: string;
  urlAfterWait?: string;
  accountsReady?: boolean;
  networkIdle?: boolean;
  gotoError?: Error;
}) {
  let current = options.url ?? "https://www.cathaybk.com.tw/MyBank/Deposit";
  return {
    goto: vi.fn(() =>
      options.gotoError
        ? Promise.reject(options.gotoError)
        : Promise.resolve(null),
    ),
    url: vi.fn(() => current),
    evaluate: vi.fn(),
    waitForFunction: vi.fn(() =>
      options.accountsReady === false
        ? Promise.reject(new Error("Waiting failed: 30000ms exceeded"))
        : Promise.resolve(null),
    ),
    waitForNetworkIdle: vi.fn(() => {
      if (options.urlAfterWait) current = options.urlAfterWait;
      return options.networkIdle === false
        ? Promise.reject(new Error("Timeout of 5000 ms exceeded"))
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
      navigationTimedOut: false,
    });
    expect(page.goto).toHaveBeenCalledWith(
      expect.stringContaining("cathaybk.com.tw"),
      { waitUntil: "domcontentloaded", timeout: 30000 },
    );
    expect(page.waitForFunction).toHaveBeenCalledWith(
      cathayDepositOverviewComplete,
      { timeout: 30000, polling: 250 },
    );
  });

  it("continues when background connections never go idle", async () => {
    // 2026-10 起偶發：網路一直不靜止，以前等 networkidle2 就整次同步失敗。
    const page = fakePage({ networkIdle: false });
    await expect(openCathayDepositOverview(page as never)).resolves.toEqual({
      accountsReady: true,
      networkIdle: false,
      navigationTimedOut: false,
    });
  });

  it("reports an overview that never finished loading", async () => {
    const page = fakePage({ accountsReady: false });
    await expect(openCathayDepositOverview(page as never)).resolves.toEqual({
      accountsReady: false,
      networkIdle: true,
      navigationTimedOut: false,
    });
  });

  it("keeps going when opening the page times out, if the accounts still load", async () => {
    // 2026-11-23、25：這頁連 DOMContentLoaded 都等不到，以前整次同步失敗。
    const timeout = Object.assign(
      new Error("Navigation timeout of 30000 ms exceeded"),
      {
        name: "TimeoutError",
      },
    );
    await expect(
      openCathayDepositOverview(fakePage({ gotoError: timeout }) as never),
    ).resolves.toEqual({
      accountsReady: true,
      networkIdle: true,
      navigationTimedOut: true,
    });
    await expect(
      openCathayDepositOverview(
        fakePage({ gotoError: timeout, accountsReady: false }) as never,
      ),
    ).resolves.toMatchObject({
      accountsReady: false,
      navigationTimedOut: true,
    });
  });

  it("still fails on other navigation errors", async () => {
    await expect(
      openCathayDepositOverview(
        fakePage({ gotoError: new Error("net::ERR_ABORTED") }) as never,
      ),
    ).rejects.toThrow("net::ERR_ABORTED");
  });

  it("still detects a forced logout, before or after waiting", async () => {
    const logout =
      "https://www.cathaybk.com.tw/OnlineBanking/Logout/SystemError";
    await expect(
      openCathayDepositOverview(fakePage({ url: logout }) as never),
    ).rejects.toThrow("Cathay Bank forced logout");
    await expect(
      openCathayDepositOverview(fakePage({ urlAfterWait: logout }) as never),
    ).rejects.toThrow("Cathay Bank forced logout");
  });
});

describe("scrapeDeposits", () => {
  it("skips deposits with a warning when the page never opens", async () => {
    const timeout = Object.assign(
      new Error("Navigation timeout of 30000 ms exceeded"),
      {
        name: "TimeoutError",
      },
    );
    const page = fakePage({ gotoError: timeout, accountsReady: false });
    await expect(scrapeDeposits(page as never, 90)).resolves.toMatchObject({
      bankAccounts: [],
      warnings: [CATHAY_DEPOSITS_NOT_LOADED_WARNING],
    });
  });

  it("skips deposits with a warning instead of reading a half-loaded page", async () => {
    const page = fakePage({ accountsReady: false });
    await expect(scrapeDeposits(page as never, 90)).resolves.toEqual({
      bankAccounts: [],
      bankBalanceSnapshots: [],
      bankTransactions: [],
      creditCardBills: [],
      warnings: [CATHAY_DEPOSITS_NOT_LOADED_WARNING],
    });
    // 沒有讀 DOM、也沒有點帳號。
    expect(page.evaluate).not.toHaveBeenCalled();
  });
});
