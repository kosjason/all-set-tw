import { afterEach, describe, expect, it, vi } from "vitest";

const puppeteerMock = vi.hoisted(() => ({
  connect: vi.fn(),
  launch: vi.fn(),
  sessions: vi.fn(),
}));

vi.mock("@cloudflare/puppeteer", () => ({ default: puppeteerMock }));

import {
  CathayOtpInvalidError,
  CathayOtpChannelRequiredError,
  CathayOtpRequiredError,
  CathayVerificationRequiredError,
  appendCathayDepositTransactions,
  captureCathayTrustedState,
  chooseCathayComboboxOption,
  completeCathayTrustedDeviceSetup,
  createCathaybkConnector,
  cathayAccountSelectorShape,
  cathayMenuStructure,
  dismissCathayTransactionModals,
  chooseCathayComboboxOptionWithDiagnostics,
  cathayPeriodDays,
  chooseCathayPeriodOption,
  dismissCathaySystemMessageIfPresent,
  pickCathayPeriodOption,
  redactCathayPeriodOptions,
  isCathayAuthenticatedUrl,
  loginCathay,
  normalizeCathayAuthorizedAt,
  normalizeCathayCreditCards,
  parseCathayCardOverview,
  restoreCathayTrustedState,
  sendCathayOtp,
  scrapeCreditCards,
  submitCathayLoginForm,
  submitCathayOtp,
  type TradeItem,
} from "../../src/connectors/cathaybk";

const credentials = {
  userId: "A123456789",
  account: "test-user",
  password: "test-password",
};

afterEach(() => vi.unstubAllGlobals());

function verificationPage() {
  return {
    click: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockImplementation(async (fn: unknown) => {
      const source = String(fn);
      if (source.includes("hasInput")) {
        return { hasInput: true, hasSubmit: true };
      }
      if (source.includes("normalizedText")) return false;
      return undefined;
    }),
    setViewport: vi.fn().mockResolvedValue(undefined),
    type: vi.fn().mockResolvedValue(undefined),
    waitForFunction: vi.fn().mockResolvedValue(undefined),
    waitForNavigation: vi.fn().mockResolvedValue(undefined),
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    url: vi
      .fn()
      .mockReturnValue("https://www.cathaybk.com.tw/MyBank/verification"),
  };
}

function browserForPage(page: ReturnType<typeof verificationPage>) {
  return {
    close: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    newPage: vi.fn().mockResolvedValue(page),
    pages: vi.fn().mockResolvedValue([page]),
    sessionId: vi.fn().mockReturnValue("cathay-session"),
  };
}

describe("Cathay system message modal", () => {
  it("dismisses the visible login message before continuing", async () => {
    const dismissButton = {
      click: vi.fn().mockResolvedValue(undefined),
    };
    const page = {
      $: vi.fn().mockResolvedValue(dismissButton),
      waitForSelector: vi.fn().mockResolvedValue(null),
    };

    await expect(dismissCathaySystemMessageIfPresent(page)).resolves.toBe(true);

    expect(page.$).toHaveBeenCalledWith(
      "#divSystemLoginMsgList.show button.btn-fill",
    );
    expect(dismissButton.click).toHaveBeenCalledOnce();
    expect(page.waitForSelector).toHaveBeenCalledWith(
      "#divSystemLoginMsgList",
      { hidden: true, timeout: 5000 },
    );
    expect(page.waitForSelector).toHaveBeenLastCalledWith(".modal-backdrop", {
      hidden: true,
      timeout: 5000,
    });
  });

  it("clicks through multiple login messages until the modal closes", async () => {
    // 三則公告：前兩次點擊是「下一則」，視窗仍開著；第三次「我知道了」才關閉。
    let shown = 3;
    const button = {
      click: vi.fn(async () => {
        shown -= 1;
      }),
    };
    const page = {
      $: vi.fn(async () => (shown > 0 ? button : null)),
      waitForSelector: vi.fn(async () => {
        if (shown > 0) throw new Error("Waiting failed: 1000ms exceeded");
        return null;
      }),
    } as unknown as Parameters<typeof dismissCathaySystemMessageIfPresent>[0];

    await expect(dismissCathaySystemMessageIfPresent(page)).resolves.toBe(true);
    expect(button.click).toHaveBeenCalledTimes(3);
  });

  it("gives up after too many login messages", async () => {
    const button = { click: vi.fn().mockResolvedValue(undefined) };
    const page = {
      $: vi.fn().mockResolvedValue(button),
      waitForSelector: vi
        .fn()
        .mockRejectedValue(new Error("Waiting failed: timeout")),
    };

    await expect(dismissCathaySystemMessageIfPresent(page)).rejects.toThrow(
      "Waiting failed",
    );
    expect(button.click).toHaveBeenCalledTimes(10);
  });

  it("does nothing when the login message is not visible", async () => {
    const page = {
      $: vi.fn().mockResolvedValue(null),
      waitForSelector: vi.fn(),
    };

    await expect(dismissCathaySystemMessageIfPresent(page)).resolves.toBe(
      false,
    );

    expect(page.waitForSelector).not.toHaveBeenCalled();
  });
});

describe("Cathay browser session lifecycle", () => {
  it("attempts to reconnect when the session list still has a connection id", async () => {
    const page = verificationPage();
    const browser = browserForPage(page);
    puppeteerMock.sessions.mockResolvedValueOnce([
      {
        sessionId: "cathay-session",
        connectionId: "stale-connection",
      },
    ]);
    puppeteerMock.connect.mockResolvedValueOnce(browser);

    await expect(
      createCathaybkConnector({} as Fetcher).sync({
        ...credentials,
        browserSessionId: "cathay-session",
        browserSessionExpiresAt: new Date(Date.now() + 120_000).toISOString(),
      }),
    ).rejects.toBeInstanceOf(CathayOtpChannelRequiredError);

    expect(puppeteerMock.connect).toHaveBeenCalledWith({}, "cathay-session");
    expect(browser.disconnect).toHaveBeenCalledOnce();
    expect(browser.close).not.toHaveBeenCalled();
  });

  it.each([
    [
      "pages",
      (browser: ReturnType<typeof browserForPage>) => {
        browser.pages.mockRejectedValue(new Error("pages failed"));
      },
    ],
    [
      "newPage",
      (browser: ReturnType<typeof browserForPage>) => {
        browser.pages.mockResolvedValue([]);
        browser.newPage.mockRejectedValue(new Error("new page failed"));
      },
    ],
  ] as const)(
    "closes a launched browser when %s setup fails",
    async (_stage, fail) => {
      const page = verificationPage();
      const browser = browserForPage(page);
      fail(browser);
      puppeteerMock.launch.mockResolvedValueOnce(browser);

      await expect(
        createCathaybkConnector({} as Fetcher).sync(credentials),
      ).rejects.toThrow();

      expect(puppeteerMock.launch).toHaveBeenCalledWith(
        expect.objectContaining({ fetch: expect.any(Function) }),
        { keep_alive: 120_000 },
      );
      expect(browser.close).toHaveBeenCalledOnce();
      expect(browser.disconnect).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      "missing OTP channel",
      { browserSessionId: "cathay-session" },
      CathayOtpChannelRequiredError,
    ],
    [
      "missing OTP",
      { browserSessionId: "cathay-session", otpChannel: "email" as const },
      CathayOtpRequiredError,
    ],
    [
      "invalid OTP",
      {
        browserSessionId: "cathay-session",
        otpChannel: "email" as const,
        otp: "123456",
      },
      CathayOtpInvalidError,
    ],
  ] as const)(
    "disconnects instead of closing for %s",
    async (_stage, options, errorType) => {
      const page = verificationPage();
      const browser = browserForPage(page);
      puppeteerMock.sessions.mockResolvedValueOnce([
        { sessionId: "cathay-session" },
      ]);
      puppeteerMock.connect.mockResolvedValueOnce(browser);

      await expect(
        createCathaybkConnector({} as Fetcher).sync({
          ...credentials,
          ...options,
          browserSessionExpiresAt: new Date(Date.now() + 120_000).toISOString(),
        }),
      ).rejects.toBeInstanceOf(errorType);

      expect(browser.disconnect).toHaveBeenCalledOnce();
      expect(browser.close).not.toHaveBeenCalled();
    },
  );
});

describe("Cathay login result", () => {
  it.each([
    "https://www.cathaybk.com.tw/OnlineBanking/",
    "https://www.cathaybk.com.tw/OnlineBanking/Home",
    "https://www.cathaybk.com.tw/MyBank/Quicklinks/Home",
  ])("recognizes an authenticated home URL: %s", (url) => {
    expect(isCathayAuthenticatedUrl(url)).toBe(true);
  });

  it.each([
    "https://www.cathaybk.com.tw/MyBank/Home/Login",
    "https://www.cathaybk.com.tw/MyBank/Home/Login?ReturnUrl=%2fMyBank%2fQuicklinks%2fHome",
    "https://www.cathaybk.com.tw/MyBank/Quicklinks/Home/NormalSignin",
  ])("does not treat a login URL as authenticated: %s", (url) => {
    expect(isCathayAuthenticatedUrl(url)).toBe(false);
  });

  it.each([
    [
      "/MyBank/Quicklinks/Home",
      "https://www.cathaybk.com.tw/MyBank/Quicklinks/Home",
    ],
    ["/OnlineBanking/", "https://www.cathaybk.com.tw/OnlineBanking/"],
  ])(
    "accepts an authenticated path in the login wait predicate: %s",
    async (pathname, url) => {
      const waitForFunction = vi
        .fn()
        .mockImplementation(async (predicate: () => boolean) => {
          vi.stubGlobal("window", { location: { pathname } });
          vi.stubGlobal("document", {
            body: { innerText: "" },
            querySelectorAll: () => [],
            querySelector: () => null,
          });
          expect(predicate()).toBe(true);
        });
      const page = {
        $: vi.fn().mockResolvedValue(null),
        click: vi.fn().mockResolvedValue(undefined),
        evaluate: vi
          .fn()
          .mockResolvedValueOnce(false)
          .mockResolvedValueOnce(true),
        goto: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
        type: vi.fn().mockResolvedValue(undefined),
        url: vi.fn().mockReturnValue(url),
        waitForFunction,
        waitForSelector: vi.fn().mockResolvedValue(null),
      };

      await expect(loginCathay(page, credentials)).resolves.toBeUndefined();
      expect(waitForFunction).toHaveBeenCalledWith(expect.any(Function), {
        timeout: 45_000,
      });
    },
  );

  it("invokes the bank login handler directly", async () => {
    const page = {
      click: vi.fn(),
      evaluate: vi.fn().mockResolvedValue(true),
    };

    await submitCathayLoginForm(page);

    expect(page.evaluate).toHaveBeenCalledOnce();
    expect(page.click).not.toHaveBeenCalled();
  });

  it("falls back to clicking the login button when the handler is unavailable", async () => {
    const page = {
      click: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue(false),
    };

    await submitCathayLoginForm(page);

    expect(page.click).toHaveBeenCalledWith(".js-login");
  });

  it("reports additional email or SMS verification without requiring a navigation event", async () => {
    const page = {
      $: vi.fn().mockResolvedValue(null),
      click: vi.fn().mockResolvedValue(undefined),
      evaluate: vi
        .fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true),
      goto: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      type: vi.fn().mockResolvedValue(undefined),
      url: vi
        .fn()
        .mockReturnValue(
          "https://www.cathaybk.com.tw/MyBank/Quicklinks/Home/NormalSignin",
        ),
      waitForNavigation: vi
        .fn()
        .mockRejectedValue(
          new Error("Navigation timeout of 60000 ms exceeded"),
        ),
      waitForFunction: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockResolvedValue(null),
    };

    await expect(loginCathay(page, credentials)).rejects.toMatchObject({
      name: CathayVerificationRequiredError.name,
      message: "國泰世華要求 Email 或簡訊額外驗證，請先完成人工驗證。",
    });

    expect(page.click).not.toHaveBeenCalledWith(".js-login");
    expect(page.waitForNavigation).not.toHaveBeenCalled();
    expect(page.waitForFunction).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 45000,
    });
  });

  it("logs only sanitized page state when the login result times out", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const page = {
      $: vi.fn().mockResolvedValue(null),
      click: vi.fn().mockResolvedValue(undefined),
      evaluate: vi
        .fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce({
          customerIdCleared: false,
          userIdCleared: true,
          passwordCleared: true,
          encryptedUserIdReady: true,
          encryptedPasswordReady: true,
          formMarkedSubmitting: true,
          hasVisibleValidation: false,
        }),
      goto: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      type: vi.fn().mockResolvedValue(undefined),
      url: vi
        .fn()
        .mockReturnValue(
          "https://www.cathaybk.com.tw/MyBank/Quicklinks/Home/NormalSignin?token=secret",
        ),
      waitForFunction: vi
        .fn()
        .mockRejectedValue(new Error("Waiting failed: 45000ms exceeded")),
      waitForSelector: vi.fn().mockResolvedValue(null),
    };

    await expect(loginCathay(page, credentials)).rejects.toThrow(
      "Waiting failed: 45000ms exceeded",
    );

    const diagnostic = String(consoleError.mock.calls.at(-1)?.[0]);
    expect(diagnostic).toContain('"event":"cathaybk_login_wait_failed"');
    expect(diagnostic).toContain(
      '"currentUrl":"https://www.cathaybk.com.tw/MyBank/Quicklinks/Home/NormalSignin"',
    );
    expect(diagnostic).not.toContain("token=secret");
    expect(diagnostic).not.toContain(credentials.userId);
    expect(diagnostic).not.toContain(credentials.account);
    expect(diagnostic).not.toContain(credentials.password);

    const pageErrorHandler = page.on.mock.calls.find(
      ([event]) => event === "pageerror",
    )?.[1] as ((error: Error) => void) | undefined;
    expect(pageErrorHandler).toBeTypeOf("function");
    pageErrorHandler?.(
      new Error(
        `Login failed for ${credentials.account}/${credentials.password} at https://www.cathaybk.com.tw/MyBank/?token=secret`,
      ),
    );
    const pageErrorDiagnostic = String(consoleError.mock.calls.at(-1)?.[0]);
    expect(pageErrorDiagnostic).toContain('"event":"cathaybk_page_error"');
    expect(pageErrorDiagnostic).not.toContain("token=secret");
    expect(pageErrorDiagnostic).not.toContain(credentials.account);
    expect(pageErrorDiagnostic).not.toContain(credentials.password);
  });
});

describe("Cathay additional verification", () => {
  it.each([
    ["email", "#js-otp-email-send"],
    ["sms", "#js-otp-send"],
  ] as const)(
    "sends the %s OTP with the bank's dedicated control",
    async (channel, selector) => {
      const page = {
        click: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(undefined),
        waitForSelector: vi.fn().mockResolvedValue(null),
      };

      await sendCathayOtp(page, channel);

      expect(page.waitForSelector).toHaveBeenNthCalledWith(1, selector, {
        visible: true,
        timeout: 15_000,
      });
      expect(page.click).toHaveBeenCalledWith(selector);
      expect(page.waitForSelector).toHaveBeenNthCalledWith(
        2,
        '.js-otp-view input:not([type="hidden"]), .login-otp input:not([type="hidden"]), input[autocomplete="one-time-code"], input[inputmode="numeric"], input[name*="otp" i], input[id*="otp" i], input[placeholder*="後6位數字"]',
        { timeout: 15_000 },
      );
    },
  );

  it("types a numeric OTP and submits the visible verification form", async () => {
    const page = {
      click: vi.fn().mockResolvedValue(undefined),
      evaluate: vi
        .fn()
        .mockResolvedValueOnce({
          hasInput: true,
          hasSubmit: true,
        })
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce({
          hasNext: false,
          hasNameInput: false,
          hasConfirm: false,
          success: true,
        }),
      type: vi.fn().mockResolvedValue(undefined),
      url: vi
        .fn()
        .mockReturnValue("https://www.cathaybk.com.tw/OnlineBanking/Home"),
      waitForFunction: vi.fn().mockResolvedValue(undefined),
      waitForNavigation: vi.fn().mockResolvedValue(undefined),
    };

    await submitCathayOtp(page, " 123456 ");

    expect(page.evaluate).toHaveBeenNthCalledWith(
      1,
      expect.any(Function),
      "驗證|確認|確定|送出|登入",
    );
    expect(page.click).toHaveBeenNthCalledWith(
      1,
      '[data-cathay-otp-input="true"]',
      { clickCount: 3 },
    );
    expect(page.type).toHaveBeenCalledWith(
      '[data-cathay-otp-input="true"]',
      "123456",
    );
    expect(page.click).toHaveBeenNthCalledWith(
      2,
      '[data-cathay-otp-submit="true"]',
    );
  });

  it("strips the bank's English prefix before typing the OTP suffix", async () => {
    const page = {
      click: vi.fn().mockResolvedValue(undefined),
      evaluate: vi
        .fn()
        .mockResolvedValueOnce({ hasInput: true, hasSubmit: true })
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce({
          hasNext: false,
          hasNameInput: false,
          hasConfirm: false,
          success: true,
        }),
      type: vi.fn().mockResolvedValue(undefined),
      url: vi
        .fn()
        .mockReturnValue("https://www.cathaybk.com.tw/OnlineBanking/Home"),
      waitForFunction: vi.fn().mockResolvedValue(undefined),
      waitForNavigation: vi.fn().mockResolvedValue(undefined),
    };

    await submitCathayOtp(page, "DAKY-310307");

    expect(page.type).toHaveBeenCalledWith(
      '[data-cathay-otp-input="true"]',
      "310307",
    );
  });

  it("rejects malformed OTP values before operating the bank page", async () => {
    const page = {
      click: vi.fn(),
      evaluate: vi.fn(),
      type: vi.fn(),
      url: vi.fn(),
      waitForFunction: vi.fn(),
      waitForNavigation: vi.fn(),
    };

    await expect(submitCathayOtp(page, "12AB")).rejects.toThrow(
      "請輸入驗證碼後 4 至 8 位數字；英文前綴可省略。",
    );
    await expect(submitCathayOtp(page, "12AB")).rejects.toBeInstanceOf(
      CathayOtpInvalidError,
    );
    expect(page.evaluate).not.toHaveBeenCalled();
  });

  it("classifies a rejected bank OTP as retryable", async () => {
    const page = {
      click: vi.fn().mockResolvedValue(undefined),
      evaluate: vi
        .fn()
        .mockResolvedValueOnce({ hasInput: true, hasSubmit: true })
        .mockResolvedValueOnce(false),
      type: vi.fn().mockResolvedValue(undefined),
      url: vi
        .fn()
        .mockReturnValue("https://www.cathaybk.com.tw/OnlineBanking/"),
      waitForFunction: vi.fn().mockResolvedValue(undefined),
      waitForNavigation: vi.fn().mockResolvedValue(undefined),
    };

    await expect(submitCathayOtp(page, "123456")).rejects.toBeInstanceOf(
      CathayOtpInvalidError,
    );
  });
});

describe("Cathay credit cards", () => {
  it("returns no card data when the overview has no card number", async () => {
    const page = {
      evaluate: vi.fn().mockResolvedValue("信用卡帳戶總覽 立即線上辦卡"),
      goto: vi.fn().mockResolvedValue(undefined),
      // The card block never appears for a customer without a card.
      waitForFunction: vi.fn().mockRejectedValue(new Error("timeout")),
    };

    await expect(
      scrapeCreditCards(
        page as unknown as Parameters<typeof scrapeCreditCards>[0],
      ),
    ).resolves.toEqual({
      bankAccounts: [],
      bankBalanceSnapshots: [],
      bankTransactions: [],
      creditCardBills: [],
    });
    expect(page.goto).toHaveBeenCalledOnce();
    expect(page.waitForFunction).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 15000,
    });
    expect(page.evaluate).toHaveBeenCalledOnce();
  });

  const overview = (cardLast4s: string[]) => ({
    cardDetected: cardLast4s.length > 0,
    last4: cardLast4s[0] ?? "",
    cardLast4s,
    creditLimit: 200000,
    availableCredit: 180000,
    unpaidAmount: 20000,
    paymentDueDate: "2026-08-06",
    noPaymentNeeded: false,
  });

  const trade = (
    cardNo: string | undefined,
    amount: number,
    desc: string,
  ): TradeItem => ({
    consumeDate: "2026-07-09T00:00:00",
    transDesc: desc,
    amount,
    currency: "TWD",
    ...(cardNo === undefined ? {} : { cardNo }),
    cardType: "VISA",
    cardHolderType: "Primary",
    detailType: "PrimaryCardConsume",
  });

  // 實際帳單明細的繳款列：卡號為空字串、原始金額為負。
  const payment = (amount: number): TradeItem => ({
    consumeDate: "2026-07-15T00:00:00",
    transDesc: "本行自動扣繳",
    amount,
    consumeAmount: 0,
    currency: "TWD",
    cardNo: "",
    cardType: "00",
    cardHolderType: "NoData",
    detailType: "PaymentAmount",
  });

  const billData = (trades: TradeItem[], payments: TradeItem[] = []) => ({
    allBills: [
      {
        billDate: "2026-07-23T00:00:00",
        twdAmount: 20000,
        usdAmount: null,
        billStatus: "Unpaid",
      },
      {
        billDate: "2026-06-23T00:00:00",
        twdAmount: 5000,
        usdAmount: null,
        billStatus: "Paid",
      },
    ],
    monthDetails: [
      {
        billDate: "2026-07-23T00:00:00",
        twdAmount: 20000,
        sections: [
          {
            detailType: "LastBillAmount",
            tradeData: [trade(undefined, 5000, "上期")],
          },
          { detailType: "PaymentAmount", tradeData: payments },
          { detailType: "PrimaryCardConsume", tradeData: trades },
        ],
      },
    ],
  });

  it("splits multiple cards into card accounts and keeps pooled data on the summary account", () => {
    const result = normalizeCathayCreditCards(
      overview(["1234", "5678"]),
      billData(
        [
          trade("4000123412341234", 320, "全家"),
          trade("4000123456785678", 1200, "高鐵"),
        ],
        [payment(-10853)],
      ),
      "2026-07-10T01:00:00.000Z",
    );

    expect(result.bankAccounts).toEqual([
      {
        sourceId: "credit:cathaybk:1234",
        institutionName: "國泰世華銀行",
        accountName: "國泰信用卡 1234",
        accountType: "credit",
        currency: "TWD",
      },
      {
        sourceId: "credit:cathaybk:5678",
        institutionName: "國泰世華銀行",
        accountName: "國泰信用卡 5678",
        accountType: "credit",
        currency: "TWD",
      },
      expect.objectContaining({
        sourceId: "credit:cathaybk:main",
        accountName: "國泰信用卡",
        creditLimit: 200000,
      }),
    ]);
    expect(
      result.bankTransactions.map(({ accountId, description }) => [
        accountId,
        description,
      ]),
    ).toEqual([
      ["credit:cathaybk:main", "本行自動扣繳"],
      ["credit:cathaybk:1234", "全家"],
      ["credit:cathaybk:5678", "高鐵"],
    ]);
    expect(result.bankBalanceSnapshots).toEqual([
      expect.objectContaining({
        accountId: "credit:cathaybk:main",
        balance: -20000,
        availableBalance: 180000,
      }),
    ]);
    expect(
      result.creditCardBills.map(({ accountId, sourceId }) => [
        accountId,
        sourceId,
      ]),
    ).toEqual([
      ["credit:cathaybk:main", "credit:cathaybk:main:bill:2026-07"],
      ["credit:cathaybk:main", "credit:cathaybk:main:bill:2026-06"],
    ]);
    expect(result.bankTransactions[1]?.raw).toMatchObject({
      cardLast4: "1234",
    });
    expect(JSON.stringify(result)).not.toContain("4000123412341234");
    expect(JSON.stringify(result)).not.toContain("4000123456785678");
  });

  it("puts the pooled balance and bills on the only physical card", () => {
    const result = normalizeCathayCreditCards(
      overview(["1234"]),
      billData([trade("4000123412341234", 320, "全家")], [payment(-10853)]),
      "2026-07-10T01:00:00.000Z",
    );

    expect(result.bankAccounts).toEqual([
      expect.objectContaining({
        sourceId: "credit:cathaybk:1234",
        accountName: "國泰信用卡 1234",
        creditLimit: 200000,
      }),
    ]);
    expect(
      new Set([
        ...result.bankTransactions.map(({ accountId }) => accountId),
        ...result.bankBalanceSnapshots.map(({ accountId }) => accountId),
        ...result.creditCardBills.map(({ accountId }) => accountId),
      ]),
    ).toEqual(new Set(["credit:cathaybk:1234"]));
  });

  it("stores payments and credits as positive card entries without changing sourceId", () => {
    const result = normalizeCathayCreditCards(
      overview(["1234", "5678"]),
      billData(
        [
          trade("4000123412341234", 115, "全家"),
          trade("4000123412341234", -200, "退款 全家"),
        ],
        [payment(-10853)],
      ),
      "2026-07-10T01:00:00.000Z",
    );

    expect(
      result.bankTransactions.map(
        ({ accountId, sourceId, amount, description, counterparty }) => ({
          accountId,
          sourceId,
          amount,
          description,
          counterparty,
        }),
      ),
    ).toEqual([
      {
        accountId: "credit:cathaybk:main",
        sourceId:
          "2026-07-15T00:00:00:credit:cathaybk:main:-10853:本行自動扣繳:1",
        amount: 10853,
        description: "本行自動扣繳",
        counterparty: "國泰世華信用卡繳款",
      },
      {
        accountId: "credit:cathaybk:1234",
        sourceId: "2026-07-09T00:00:00:credit:cathaybk:main:115:全家:1",
        amount: -115,
        description: "全家",
        counterparty: undefined,
      },
      {
        accountId: "credit:cathaybk:1234",
        sourceId: "2026-07-09T00:00:00:credit:cathaybk:main:-200:退款 全家:1",
        amount: 200,
        description: "退款 全家",
        counterparty: undefined,
      },
    ]);
  });

  it("adds cards found only in bill details", () => {
    const result = normalizeCathayCreditCards(
      overview(["1234"]),
      billData([
        trade("4000123412341234", 320, "全家"),
        trade("4000-1234-5678-9999", 80, "悠遊卡加值"),
      ]),
      "2026-07-10T01:00:00.000Z",
    );

    expect(result.bankAccounts.map(({ sourceId }) => sourceId)).toEqual([
      "credit:cathaybk:1234",
      "credit:cathaybk:9999",
      "credit:cathaybk:main",
    ]);
    expect(result.bankTransactions[1]?.accountId).toBe("credit:cathaybk:9999");
  });

  it("keeps date-only card transactions without fake midnight and preserves sourceId", () => {
    const result = normalizeCathayCreditCards(
      overview(["1234", "5678"]),
      billData([
        trade("4000123412341234", 320, "全家"),
        trade("4000123412341234", 320, "全家"),
        { ...trade("4000123412341234", 50, "7-11"), consumeDate: "2026/07/08" },
      ]),
      "2026-07-10T01:00:00.000Z",
    );

    expect(
      result.bankTransactions.map(
        ({ sourceId, postedDate, authorizedAt, amount }) => ({
          sourceId,
          postedDate,
          authorizedAt,
          amount,
        }),
      ),
    ).toEqual([
      {
        sourceId: "2026-07-09T00:00:00:credit:cathaybk:main:320:全家:1",
        postedDate: "2026-07-09",
        authorizedAt: "2026-07-09",
        amount: -320,
      },
      {
        sourceId: "2026-07-09T00:00:00:credit:cathaybk:main:320:全家:2",
        postedDate: "2026-07-09",
        authorizedAt: "2026-07-09",
        amount: -320,
      },
      {
        sourceId: "2026-07-08T00:00:00.000Z:credit:cathaybk:main:50:7-11:1",
        postedDate: "2026-07-08",
        authorizedAt: "2026-07-08",
        amount: -50,
      },
    ]);
  });

  it("parses every card on the overview page before reading bill details", async () => {
    vi.useFakeTimers();
    const overviewText = [
      "CUBE COMBO悠遊白金卡 (原KOKO卡)Visa 正卡 卡片末四碼：1234",
      "世界卡 Mastercard 正卡 卡片末四碼：5678",
      "永久信用額度 TWD 200,000",
      "剩餘可用額度 TWD 180,000",
      "本期應繳金額 TWD 20,000",
      "繳款截止日 2026/08/06",
    ].join("\n");
    const page = {
      evaluate: vi
        .fn()
        .mockResolvedValueOnce(overviewText)
        .mockResolvedValueOnce(
          billData(
            [
              trade("4000123412341234", 320, "全家"),
              trade("4000123456785678", 1200, "高鐵"),
            ],
            [payment(-10853)],
          ),
        ),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForFunction: vi.fn().mockResolvedValue(undefined),
    };

    try {
      const pending = scrapeCreditCards(
        page as unknown as Parameters<typeof scrapeCreditCards>[0],
      );
      await vi.advanceTimersByTimeAsync(4_000);
      const result = await pending;

      expect(result.bankAccounts.map(({ sourceId }) => sourceId)).toEqual([
        "credit:cathaybk:1234",
        "credit:cathaybk:5678",
        "credit:cathaybk:main",
      ]);
      expect(result.bankBalanceSnapshots[0]).toMatchObject({
        accountId: "credit:cathaybk:main",
        balance: -20000,
        availableBalance: 180000,
        paymentDueDate: "2026-08-06",
      });
      expect(
        result.bankTransactions.map(
          ({ accountId, sourceId, authorizedAt, postedDate, amount }) => ({
            accountId,
            sourceId,
            authorizedAt,
            postedDate,
            amount,
          }),
        ),
      ).toEqual([
        {
          accountId: "credit:cathaybk:main",
          sourceId:
            "2026-07-15T00:00:00:credit:cathaybk:main:-10853:本行自動扣繳:1",
          authorizedAt: "2026-07-15",
          postedDate: "2026-07-15",
          amount: 10853,
        },
        {
          accountId: "credit:cathaybk:1234",
          // 與拆卡前的 sourceId 相同，重新同步不會新增重複交易。
          sourceId: "2026-07-09T00:00:00:credit:cathaybk:main:320:全家:1",
          authorizedAt: "2026-07-09",
          postedDate: "2026-07-09",
          amount: -320,
        },
        {
          accountId: "credit:cathaybk:5678",
          sourceId: "2026-07-09T00:00:00:credit:cathaybk:main:1200:高鐵:1",
          authorizedAt: "2026-07-09",
          postedDate: "2026-07-09",
          amount: -1200,
        },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Cathay transaction timestamps", () => {
  it("uses Taiwan time at true midnight without changing the source identity", () => {
    const target: Parameters<typeof appendCathayDepositTransactions>[0] = [];

    appendCathayDepositTransactions(
      target,
      [
        {
          txnDateTime: "2026/07/05T00:00:00",
          incomeAmt: 252,
          description: "薪資",
        },
      ],
      "bank:cathaybk:1234",
      "TWD",
    );

    expect(target[0]).toMatchObject({
      authorizedAt: "2026-07-05T00:00:00+08:00",
      postedDate: "2026-07-05T00:00:00",
      sourceId: "2026-07-05T00:00:00:bank:cathaybk:1234:252:薪資:1",
    });
  });

  it("normalizes offsets and leaves date-only values without fake midnight", () => {
    expect(normalizeCathayAuthorizedAt("2026/07/05T01:02:03+0800")).toBe(
      "2026-07-05T01:02:03+08:00",
    );
    expect(normalizeCathayAuthorizedAt("2026-07-05T01:02:03Z")).toBe(
      "2026-07-05T01:02:03Z",
    );
    expect(normalizeCathayAuthorizedAt("2026/07/05")).toBe("2026-07-05");
    expect(normalizeCathayAuthorizedAt("2026-07-05T25:02:03")).toBeUndefined();
    expect(normalizeCathayAuthorizedAt("2026-02-30T01:02:03")).toBeUndefined();
  });
});

describe("Cathay trusted device state", () => {
  it("restores only the Cathay trusted-device cookie", async () => {
    const page = {
      setCookie: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      restoreCathayTrustedState(page, {
        sessionCookies: JSON.stringify([
          {
            name: "CUB.eBank.DeviceId",
            value: "device-1",
            domain: ".cathaybk.com.tw",
          },
          { name: "active-session", value: "no", domain: ".cathaybk.com.tw" },
          { name: "foreign", value: "no", domain: ".example.com" },
        ]),
      }),
    ).resolves.toBe(true);

    expect(page.setCookie).toHaveBeenCalledWith({
      name: "CUB.eBank.DeviceId",
      value: "device-1",
      domain: ".cathaybk.com.tw",
    });
  });

  it("captures encrypted cursor state without OTP fields", async () => {
    const page = {
      cookies: vi.fn().mockResolvedValue([
        {
          name: "CUB.eBank.DeviceId",
          value: "device-1",
          domain: ".cathaybk.com.tw",
          expires: 1_800_000_000,
        },
      ]),
    };

    await expect(captureCathayTrustedState(page)).resolves.toEqual({
      sessionCookies: JSON.stringify([
        {
          name: "CUB.eBank.DeviceId",
          value: "device-1",
          domain: ".cathaybk.com.tw",
          expires: 1_800_000_000,
        },
      ]),
      sessionExpiresAt: new Date(1_800_000_000 * 1000).toISOString(),
    });
  });

  it("names and confirms a detected trusted-device setup step", async () => {
    const page = {
      click: vi.fn().mockResolvedValue(undefined),
      evaluate: vi
        .fn()
        .mockResolvedValueOnce({
          hasNext: false,
          hasNameInput: true,
          hasConfirm: true,
          success: false,
        })
        .mockResolvedValueOnce(true),
      type: vi.fn().mockResolvedValue(undefined),
      waitForFunction: vi.fn().mockResolvedValue(undefined),
    };

    await expect(completeCathayTrustedDeviceSetup(page)).resolves.toBe(true);
    expect(page.evaluate).toHaveBeenNthCalledWith(1, expect.any(Function), {
      context:
        "登入安全再升級|立即啟用|信任裝置|設定裝置名稱|裝置名稱|裝置暱稱|確定加入",
      confirm: "確定加入|確認加入|完成設定|^確定$|^確認$|^完成$",
    });
    expect(page.type).toHaveBeenCalledWith(
      '[data-cathay-trust-name="true"]',
      "ALL SET 同步",
    );
    expect(page.click).toHaveBeenLastCalledWith(
      '[data-cathay-trust-confirm="true"]',
    );
  });

  it("does not claim success when no trusted-device result is present", async () => {
    const page = {
      click: vi.fn(),
      evaluate: vi.fn().mockResolvedValue({
        hasNext: false,
        hasNameInput: false,
        hasConfirm: false,
        success: false,
      }),
      type: vi.fn(),
      waitForFunction: vi.fn().mockRejectedValue(new Error("timeout")),
    };

    await expect(completeCathayTrustedDeviceSetup(page)).resolves.toBe(false);
    expect(page.click).not.toHaveBeenCalled();
  });
});

describe("Cathay credit card overview", () => {
  const overview = [
    "信用卡 > 信用卡帳戶總覽",
    "最近一期帳單",
    "繳款截止日",
    "2026/10/06",
    "2026年09月",
    "臺幣帳單",
    "TWD",
    "12,345",
    "我要繳費",
    "下期帳單",
    "未出帳明細",
    "TWD",
    "0",
    "我的額度",
    "剩餘可用額度",
    "TWD",
    "180,000",
    "永久信用額度",
    "TWD",
    "200,000",
    "CUBE卡Visa 正卡 卡片末四碼：1234",
  ].join("\n");

  it("reads the unpaid statement from the current 臺幣帳單 layout", () => {
    expect(parseCathayCardOverview(overview)).toMatchObject({
      cardDetected: true,
      last4: "1234",
      unpaidAmount: 12345,
      paymentDueDate: "2026-10-06",
      creditLimit: 200000,
      availableCredit: 180000,
      noPaymentNeeded: false,
    });
  });

  it("lists every card's last four digits", () => {
    expect(
      parseCathayCardOverview(
        `${overview}\n世界卡 Mastercard 正卡 卡片末四碼：5678\nCUBE卡Visa 正卡 卡片末四碼：1234`,
      ).cardLast4s,
    ).toEqual(["1234", "5678"]);
  });

  it("keeps the older 應繳金額 wording", () => {
    expect(
      parseCathayCardOverview(
        "應繳金額 TWD 5,678 繳款截止日 2026/10/06 卡片末四碼：1234",
      ).unpaidAmount,
    ).toBe(5678);
  });

  it("reports no amount due when the bank says no payment is needed", () => {
    expect(parseCathayCardOverview(`${overview}\n無需繳費`)).toMatchObject({
      unpaidAmount: 0,
      noPaymentNeeded: true,
    });
  });
});

describe("Cathay transaction period options", () => {
  it.each([
    ["近 30 天", 30],
    ["近90天", 90],
    ["近 3 個月", 90],
    ["近三個月", 90],
    ["近六個月", 180],
    ["近十二個月", 360],
    ["近 1 年", 365],
    ["近一週", 7],
    ["最近 90 日", 90],
    ["近90天內", 90],
  ])("reads %s as %i days", (label, days) => {
    expect(cathayPeriodDays(label)).toBe(days);
  });

  it.each(["自訂", "2026/09/01", "近期", "近十一十天", ""])(
    "does not read %s",
    (label) => {
      expect(cathayPeriodDays(label)).toBeUndefined();
    },
  );

  it("picks the shortest option that covers the window", () => {
    expect(
      pickCathayPeriodOption(
        ["近 1 個月", "近 3 個月", "近 6 個月", "自訂"],
        90,
      ),
    ).toBe(1);
    expect(
      pickCathayPeriodOption(["近 30 天", "近 90 天", "近 1 年"], 90),
    ).toBe(1);
    expect(pickCathayPeriodOption(["近 1 年", "近 6 個月"], 90)).toBe(1);
  });

  it("falls back to the longest option when none is long enough", () => {
    expect(pickCathayPeriodOption(["近 7 天", "近 30 天", "自訂"], 90)).toBe(1);
  });

  it("returns -1 when no option is recognised", () => {
    expect(pickCathayPeriodOption(["自訂", "全部"], 90)).toBe(-1);
    expect(pickCathayPeriodOption([], 90)).toBe(-1);
  });
});

describe("Cathay period combobox", () => {
  type FakeElement = {
    id: string;
    textContent: string;
    dataset: Record<string, string | undefined>;
    parentElement: { innerText: string; parentElement: null };
    getAttribute: (name: string) => string | null;
    click: ReturnType<typeof vi.fn>;
  };

  function element(id: string, label: string): FakeElement {
    return {
      id,
      textContent: label,
      dataset: {},
      parentElement: { innerText: label, parentElement: null },
      getAttribute: () => null,
      click: vi.fn(),
    };
  }

  function setup(options: Array<[string, string]>, applyOnClick = true) {
    const period = element("react-select-3-input", "近 30 天");
    const account = element("react-select-2-input", "123456789012 活期存款");
    const optionElements = options.map(([id, text]) => {
      const option = element(id, text);
      option.click = vi.fn(() => {
        if (applyOnClick) period.parentElement.innerText = text;
      });
      return option;
    });
    const inputs = [account, period];
    vi.stubGlobal("document", {
      querySelectorAll: (selector: string) => {
        if (selector.includes("data-cathay-combobox"))
          return inputs.filter((input) => input.dataset.cathayCombobox);
        if (selector.includes("combobox")) return inputs;
        return optionElements;
      },
      querySelector: () =>
        inputs.find((input) => input.dataset.cathayCombobox === "period") ??
        null,
      getElementById: () => null,
    });
    const page = {
      evaluate: vi.fn(
        async (fn: (...args: unknown[]) => unknown, ...args: unknown[]) =>
          fn(...args),
      ),
      focus: vi.fn().mockResolvedValue(undefined),
      keyboard: { press: vi.fn().mockResolvedValue(undefined) },
      click: vi.fn().mockResolvedValue(undefined),
    };
    return { page, period, account, optionElements };
  }

  const fast = { keyboardMs: 0, optionsMs: 0, labelMs: 0 };

  it("reads only the period menu's options and confirms the selection", async () => {
    const { page, period, account, optionElements } = setup([
      ["react-select-2-option-0", "123456789012 活期存款"],
      ["react-select-3-option-0", "近 1 個月"],
      ["react-select-3-option-1", "近 3 個月"],
    ]);

    await expect(
      chooseCathayPeriodOption(page as never, 90, fast),
    ).resolves.toEqual({
      found: true,
      options: ["近 1 個月", "近 3 個月"],
      chosen: "近 3 個月",
      applied: true,
    });
    expect(period.dataset.cathayCombobox).toBe("period");
    expect(account.dataset.cathayCombobox).toBeUndefined();
    expect(optionElements[2]!.click).toHaveBeenCalledOnce();
    expect(page.keyboard.press).not.toHaveBeenCalledWith("Escape");
  });

  it("reports a click that did not change the selected period", async () => {
    const { page } = setup([["react-select-3-option-0", "近 90 天"]], false);

    await expect(
      chooseCathayPeriodOption(page as never, 90, fast),
    ).resolves.toMatchObject({ chosen: "近 90 天", applied: false });
  });

  it("opens the period menu with the mouse when the keyboard does not", async () => {
    const { page, period } = setup([]);
    const control = {
      dataset: {} as Record<string, string>,
      getAttribute: (name: string) =>
        name === "class" ? "css-13cymwt-control" : null,
      innerText: "近 30 天",
      parentElement: null,
    };
    (period as unknown as { parentElement: unknown }).parentElement = control;
    const option = {
      id: "",
      textContent: "近3個月",
      offsetParent: {},
      getAttribute: (name: string) =>
        name === "class" ? "css-d7l1ni-option" : null,
      click: vi.fn(() => {
        control.innerText = "近3個月";
      }),
    };
    let open = false;
    page.click = vi.fn(async () => {
      open = true;
    });
    period.getAttribute = (name: string) =>
      name === "aria-expanded" ? (open ? "true" : "false") : null;
    const base = globalThis.document as unknown as {
      querySelectorAll: (selector: string) => unknown[];
    };
    const original = base.querySelectorAll;
    base.querySelectorAll = (selector: string) =>
      selector.includes("[class*='option']")
        ? open
          ? [option]
          : []
        : original(selector);

    await expect(
      chooseCathayPeriodOption(page as never, 90, fast),
    ).resolves.toMatchObject({ chosen: "近3個月", applied: true });
    expect(page.click).toHaveBeenCalledWith('[data-cathay-control="period"]');
  });

  it("closes the menu when no option could be read", async () => {
    const { page } = setup([]);

    await expect(
      chooseCathayPeriodOption(page as never, 90, fast),
    ).resolves.toMatchObject({ found: true, options: [] });
    expect(page.keyboard.press).toHaveBeenLastCalledWith("Escape");
  });

  it("reads visible options inside the period selector's container", async () => {
    const { page, period, optionElements } = setup([]);
    const visible = element("menu-option-a", "近3個月");
    const hidden = element("menu-option-b", "近 1 年");
    (visible as unknown as { offsetParent: unknown }).offsetParent = {};
    (hidden as unknown as { offsetParent: unknown }).offsetParent = null;
    visible.click = vi.fn(() => {
      period.parentElement.innerText = "近3個月";
    });
    (
      period.parentElement as unknown as {
        querySelectorAll: () => unknown[];
      }
    ).querySelectorAll = () => [hidden, visible];
    expect(optionElements).toEqual([]);

    await expect(
      chooseCathayPeriodOption(page as never, 90, fast),
    ).resolves.toMatchObject({
      options: ["近3個月"],
      chosen: "近3個月",
      applied: true,
    });
  });

  it("ignores period-like options elsewhere while the menu is not expanded", async () => {
    // 頁面其他地方的選項（id 與輸入框前綴不同）在選單沒展開時不算，仍走預設期間。
    const { page, optionElements } = setup([
      ["other-select-option-0", "近 3 個月"],
    ]);
    for (const option of optionElements) {
      (option as unknown as { offsetParent: unknown }).offsetParent = {};
    }

    await expect(
      chooseCathayPeriodOption(page as never, 90, fast),
    ).resolves.toMatchObject({ found: true, options: [] });
    expect(optionElements[0]!.click).not.toHaveBeenCalled();
  });

  it("falls back to visible options when ids do not follow the input id", async () => {
    // 自訂 inputId 時，選項 id 與輸入框 id 前綴對不上；改讀目前看得到的選項。
    const { page, period, optionElements } = setup([
      ["react-select-7-option-0", "近1個月"],
      ["react-select-7-option-1", "近3個月"],
    ]);
    for (const option of optionElements) {
      (option as unknown as { offsetParent: unknown }).offsetParent = {};
    }
    // 選單展開時 react-select 會設 aria-expanded，才會讀整頁的選項。
    period.getAttribute = (name: string) =>
      name === "aria-expanded" ? "true" : null;

    await expect(
      chooseCathayPeriodOption(page as never, 90, fast),
    ).resolves.toMatchObject({ chosen: "近3個月", applied: true });
    expect(optionElements[1]!.click).toHaveBeenCalledOnce();
  });

  it("closes the menu when no option is recognised", async () => {
    const { page } = setup([["react-select-3-option-0", "自訂"]]);

    await expect(
      chooseCathayPeriodOption(page as never, 90, fast),
    ).resolves.toEqual({ found: true, options: ["自訂"] });
    expect(page.keyboard.press).toHaveBeenLastCalledWith("Escape");
  });
});

it("redacts anything but recognisable period labels from logs", () => {
  expect(
    redactCathayPeriodOptions([
      "近 90 天",
      "123456789012",
      "1234-5678-9012",
      "近三個月",
      "王小明",
    ]),
  ).toEqual(["近 90 天", "[redacted]", "[redacted]", "近三個月", "[redacted]"]);
});

it("describes the account selector without exposing account text", () => {
  const input = {
    dataset: { cathayCombobox: "account" },
    parentElement: {
      innerText: "1234-5678-9012 王小明 餘額 1,234,567",
      parentElement: null,
    },
  };
  const option = {
    textContent: "123456789012 活期存款",
    offsetParent: {},
  };
  vi.stubGlobal("document", {
    querySelectorAll: (selector: string) =>
      selector.includes("combobox") ? [input] : [option],
  });

  const shape = cathayAccountSelectorShape(12);
  expect(shape).toEqual({
    accountLength: 12,
    markedAccount: true,
    comboboxLabelShapes: [[4, 4, 4]],
    optionCount: 1,
    visibleOptionCount: 1,
    optionShapes: [[12]],
  });
  expect(JSON.stringify(shape)).not.toMatch(/王小明|1234|活期/);
});

/** 小型假 DOM：支援 combobox 流程用到的屬性選擇器。 */
type FakeNode = {
  tag: string;
  id: string;
  attrs: Record<string, string>;
  dataset: Record<string, string | undefined>;
  textContent: string;
  innerText: string;
  offsetParent: unknown;
  parentElement: FakeNode | null;
  children: FakeNode[];
  click: ReturnType<typeof vi.fn>;
  getAttribute: (name: string) => string | null;
  hasAttribute: (name: string) => boolean;
  contains: (other: FakeNode) => boolean;
  querySelectorAll: (selector: string) => FakeNode[];
  querySelector: (selector: string) => FakeNode | null;
};

function fakeNode(
  tag: string,
  attrs: Record<string, string> = {},
  text = "",
): FakeNode {
  const node: FakeNode = {
    tag,
    id: attrs.id ?? "",
    attrs,
    dataset: {},
    textContent: text,
    innerText: text,
    offsetParent: {},
    parentElement: null,
    children: [],
    click: vi.fn(),
    getAttribute: (name) => {
      if (name.startsWith("data-")) {
        const key = name
          .slice(5)
          .replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
        return node.dataset[key] ?? null;
      }
      return node.attrs[name] ?? null;
    },
    hasAttribute: (name) => node.getAttribute(name) !== null,
    contains: (other) =>
      node.children.some((child) => child === other || child.contains(other)),
    querySelectorAll: (selector) =>
      descendants(node).filter((candidate) => matches(candidate, selector)),
    querySelector: (selector) => node.querySelectorAll(selector)[0] ?? null,
  };
  return node;
}

function append(parent: FakeNode, ...children: FakeNode[]) {
  for (const child of children) {
    child.parentElement = parent;
    parent.children.push(child);
  }
  return parent;
}

function descendants(node: FakeNode): FakeNode[] {
  return node.children.flatMap((child) => [child, ...descendants(child)]);
}

function matches(node: FakeNode, selector: string): boolean {
  return selector.split(",").some((part) => {
    const simple = part.trim();
    if (simple === "*") return true;
    const tag = /^[a-z]+/.exec(simple)?.[0];
    if (tag && node.tag !== tag) return false;
    return Array.from(
      simple.matchAll(/\[([\w-]+)(?:([*]?=)['"]([^'"]*)['"])?\]/g),
    ).every(([, name, op, value]) => {
      const actual = node.getAttribute(name!);
      if (!op) return actual !== null;
      if (actual === null) return false;
      return op === "=" ? actual === value : actual.includes(value!);
    });
  });
}

function fakeDocument(root: FakeNode) {
  return {
    querySelectorAll: (selector: string) => root.querySelectorAll(selector),
    querySelector: (selector: string) => root.querySelector(selector),
    getElementById: (id: string) =>
      descendants(root).find((node) => node.id === id) ?? null,
    elementFromPoint: () => null,
  };
}

function comboboxPage(onClick?: (selector: string) => void) {
  return {
    evaluate: vi.fn(
      async (fn: (...args: unknown[]) => unknown, ...args: unknown[]) =>
        fn(...args),
    ),
    focus: vi.fn().mockResolvedValue(undefined),
    keyboard: { press: vi.fn().mockResolvedValue(undefined) },
    click: vi.fn(async (selector: string) => onClick?.(selector)),
  };
}

const quick = { keyboardMs: 0, openMs: 0, labelMs: 0 };

/** 帳號 combobox：control（含顯示文字）> input；選項放在 menu 裡。 */
function accountSelector(selected: string) {
  const root = fakeNode("div");
  const container = fakeNode("div", { class: "css-b62m3t-container" });
  const control = fakeNode(
    "div",
    { class: "css-13cymwt-control" },
    `${selected} 活期儲蓄存款`,
  );
  const input = fakeNode("input", {
    role: "combobox",
    id: "account-select",
  });
  append(control, input);
  append(container, control);
  append(root, container);
  const select = (text: string) => {
    control.innerText = text;
    control.textContent = text;
  };
  return { root, container, control, input, select };
}

describe("Cathay account combobox", () => {
  it("opens with the keyboard, picks the whole account number and confirms it", async () => {
    const { root, container, input, select } = accountSelector("111111111111");
    const menu = fakeNode("div", { class: "css-26l3qy-menu" });
    const longer = fakeNode(
      "div",
      { role: "option", id: "react-select-2-option-0" },
      "1234567890123 其他帳戶",
    );
    const exact = fakeNode(
      "div",
      { role: "option", id: "react-select-2-option-1" },
      "123456789012 子帳戶",
    );
    exact.click = vi.fn(() => select("123456789012 子帳戶"));
    append(menu, longer, exact);
    append(container, menu);
    vi.stubGlobal("document", fakeDocument(root));
    const page = comboboxPage();

    await expect(
      chooseCathayComboboxOption(
        page as never,
        "account",
        "123456789012",
        quick,
      ),
    ).resolves.toBe(true);
    expect(input.dataset.cathayCombobox).toBe("account");
    expect(longer.click).not.toHaveBeenCalled();
    expect(exact.click).toHaveBeenCalledOnce();
    expect(page.click).not.toHaveBeenCalled();
  });

  it("clicks the control when the keyboard does not open the menu", async () => {
    const { root, container, control, select } =
      accountSelector("111111111111");
    // 改版後選項沒有 role／id，只有 react-select 的 class 命名；之前留下的隱藏選項不算。
    const stale = fakeNode(
      "div",
      { class: "css-1n7v3ny-option" },
      "123456789012",
    );
    stale.offsetParent = null;
    append(container, stale);
    const option = fakeNode(
      "div",
      { class: "css-d7l1ni-option" },
      "123456789012 活期儲蓄存款",
    );
    option.click = vi.fn(() => select("123456789012 活期儲蓄存款"));
    const menu = fakeNode("div", { class: "css-26l3qy-menu" });
    vi.stubGlobal("document", fakeDocument(root));
    const page = comboboxPage(() => {
      append(menu, option);
      append(container, menu);
    });

    await expect(
      chooseCathayComboboxOption(
        page as never,
        "account",
        "123456789012",
        quick,
      ),
    ).resolves.toBe(true);
    expect(control.dataset.cathayControl).toBe("account");
    expect(page.click).toHaveBeenCalledWith('[data-cathay-control="account"]');
    expect(stale.click).not.toHaveBeenCalled();
    expect(option.click).toHaveBeenCalledOnce();
  });

  it("ignores hidden stale options that share the react-select id", async () => {
    const { root, container, input, select } = accountSelector("111111111111");
    input.attrs.id = "react-select-5-input";
    input.id = "react-select-5-input";
    const stale = fakeNode(
      "div",
      { role: "option", id: "react-select-5-option-0" },
      "123456789012 活期儲蓄存款",
    );
    stale.offsetParent = null;
    append(root, stale);
    const option = fakeNode(
      "div",
      { role: "option", id: "react-select-5-option-1" },
      "123456789012 活期儲蓄存款",
    );
    option.click = vi.fn(() => select("123456789012 活期儲蓄存款"));
    vi.stubGlobal("document", fakeDocument(root));
    const page = comboboxPage(() => append(container, option));

    await expect(
      chooseCathayComboboxOption(
        page as never,
        "account",
        "123456789012",
        quick,
      ),
    ).resolves.toBe(true);
    expect(page.click).toHaveBeenCalledWith('[data-cathay-control="account"]');
    expect(stale.click).not.toHaveBeenCalled();
    expect(option.click).toHaveBeenCalledOnce();
  });

  it("does not treat options elsewhere on the page as this menu being open", async () => {
    const { root, input } = accountSelector("111111111111");
    input.attrs["aria-expanded"] = "false";
    const tab = fakeNode("div");
    append(tab, fakeNode("div", { role: "option" }, "123456789012"));
    append(root, tab);
    vi.stubGlobal("document", fakeDocument(root));
    const page = comboboxPage();

    await expect(
      chooseCathayComboboxOption(
        page as never,
        "account",
        "123456789012",
        quick,
      ),
    ).resolves.toBe(false);
    // 頁面其他地方的選項不算這個選單開了，所以仍會嘗試點 control。
    expect(page.click).toHaveBeenCalledWith('[data-cathay-control="account"]');
  });

  it("does not click an already expanded control and reports diagnostics", async () => {
    const { root, input } = accountSelector("111111111111");
    input.attrs["aria-expanded"] = "true";
    vi.stubGlobal("document", fakeDocument(root));
    const page = comboboxPage();

    const result = await chooseCathayComboboxOptionWithDiagnostics(
      page as never,
      "account",
      "123456789012",
      quick,
    );
    expect(result.selected).toBe(false);
    expect(page.click).not.toHaveBeenCalled();
    expect(result.diagnostics).toMatchObject({
      afterKeyboard: { expanded: "true", marked: true },
    });
    expect(JSON.stringify(result.diagnostics)).not.toMatch(/1111|活期/);
  });

  it("fails when the click does not change the selected account", async () => {
    const { root, container } = accountSelector("111111111111");
    const menu = fakeNode("div", { class: "css-26l3qy-menu" });
    append(
      menu,
      fakeNode("div", { role: "option" }, "123456789012 活期儲蓄存款"),
    );
    append(container, menu);
    vi.stubGlobal("document", fakeDocument(root));

    await expect(
      chooseCathayComboboxOptionWithDiagnostics(
        comboboxPage() as never,
        "account",
        "123456789012",
        quick,
      ),
    ).resolves.toMatchObject({
      selected: false,
      diagnostics: { clicked: true, applied: false },
    });
  });

  it("reports a missing selector without opening anything", async () => {
    const root = fakeNode("div");
    append(root, fakeNode("input", { role: "combobox" }));
    vi.stubGlobal("document", fakeDocument(root));
    const page = comboboxPage();

    await expect(
      chooseCathayComboboxOption(
        page as never,
        "account",
        "123456789012",
        quick,
      ),
    ).resolves.toBe(false);
    expect(page.focus).not.toHaveBeenCalled();
  });

  it("describes the menu structure with counts and class words only", () => {
    const { root, input } = accountSelector("123456789012");
    input.dataset.cathayCombobox = "account";
    input.attrs["aria-expanded"] = "false";
    vi.stubGlobal("document", fakeDocument(root));

    const structure = cathayMenuStructure("account");
    expect(structure).toMatchObject({
      marked: true,
      expanded: "false",
      roleOptionCount: 0,
      selectOptionCounts: [],
      ancestorClasses: ["css-13cymwt-control", "css-b62m3t-container", ""],
    });
    expect(JSON.stringify(structure)).not.toMatch(/1234|活期/);
  });

  it("drops class words that carry long numbers from diagnostics", () => {
    const { root, input, control } = accountSelector("123456789012");
    input.dataset.cathayCombobox = "account";
    control.attrs.class = "css-13cymwt-control account-123456789012";
    vi.stubGlobal("document", fakeDocument(root));

    expect(cathayMenuStructure("account").ancestorClasses[0]).toBe(
      "css-13cymwt-control",
    );
  });
});

describe("Cathay transaction page modal", () => {
  function modalPage(root: FakeNode, onEscape?: () => void) {
    vi.stubGlobal("document", fakeDocument(root));
    return {
      evaluate: vi.fn(
        async (fn: (...args: unknown[]) => unknown, ...args: unknown[]) =>
          fn(...args),
      ),
      keyboard: {
        press: vi.fn(async (key: string) => {
          if (key === "Escape") onEscape?.();
        }),
      },
    };
  }

  function dialog(...buttons: FakeNode[]) {
    const container = fakeNode("div", {
      class: "chakra-modal__content-container css-1a6i8n5",
    });
    append(container, ...buttons);
    return container;
  }

  it("does nothing when no modal is open", async () => {
    const page = modalPage(fakeNode("div"));
    await expect(
      dismissCathayTransactionModals(page as never, 0),
    ).resolves.toEqual({ before: 0, after: 0 });
    expect(page.keyboard.press).not.toHaveBeenCalled();
  });

  it("closes the modal with Escape", async () => {
    const root = fakeNode("div");
    const modal = dialog(fakeNode("button", {}, "我知道了"));
    append(root, modal);
    const page = modalPage(root, () => {
      modal.offsetParent = null;
    });

    await expect(
      dismissCathayTransactionModals(page as never, 0),
    ).resolves.toEqual({ before: 1, after: 0, method: "escape" });
  });

  it("falls back to the close button when Escape does not work", async () => {
    const root = fakeNode("div");
    const close = fakeNode("button", {
      class: "chakra-modal__close-btn css-1ik4h6n",
    });
    const confirm = fakeNode("button", {}, "確定");
    const modal = dialog(confirm, close);
    close.click = vi.fn(() => {
      modal.offsetParent = null;
    });
    append(root, modal);
    const page = modalPage(root);

    await expect(
      dismissCathayTransactionModals(page as never, 0),
    ).resolves.toEqual({ before: 1, after: 0, method: "close-icon" });
    expect(close.click).toHaveBeenCalledOnce();
    expect(confirm.click).not.toHaveBeenCalled();
  });

  it("only presses buttons that do not agree to anything", async () => {
    const root = fakeNode("div");
    const confirm = fakeNode("button", {}, "確定");
    const later = fakeNode("button", {}, "稍後再說");
    const modal = dialog(confirm, later);
    later.click = vi.fn(() => {
      modal.offsetParent = null;
    });
    append(root, modal);

    await dismissCathayTransactionModals(modalPage(root) as never, 0);
    expect(later.click).toHaveBeenCalledOnce();
    expect(confirm.click).not.toHaveBeenCalled();
  });

  it("logs only counts and the method, never button text", async () => {
    const root = fakeNode("div");
    append(
      root,
      dialog(
        fakeNode("button", {}, "確定"),
        fakeNode("button", {}, "王小明 轉入 123456789012"),
      ),
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await dismissCathayTransactionModals(modalPage(root) as never, 0);
    const line = String(log.mock.calls.at(-1)?.[0]);
    expect(JSON.parse(line)).toEqual({
      event: "cathaybk_modal_detected",
      before: 1,
      after: 1,
      dismissed: false,
      method: "none",
    });
    expect(line).not.toMatch(/確定|王小明|1234/);
    log.mockRestore();
  });

  it("ignores non-modal dialogs, hidden dialogs and counts a modal once", async () => {
    const root = fakeNode("div");
    // Chakra Popover：role=dialog 但沒有 aria-modal。
    append(root, fakeNode("section", { role: "dialog" }));
    // 藏在 aria-hidden 祖先下的 modal。
    const hiddenWrap = fakeNode("div", { "aria-hidden": "true" });
    append(
      hiddenWrap,
      fakeNode("section", { role: "dialog", "aria-modal": "true" }),
    );
    append(root, hiddenWrap);
    // 同一個 Chakra modal：container 內還有 role=dialog。
    const modal = dialog();
    append(
      modal,
      fakeNode("section", { role: "dialog", "aria-modal": "true" }),
    );
    append(root, modal);
    const page = modalPage(root, () => {
      modal.offsetParent = null;
      for (const child of modal.children) child.offsetParent = null;
    });

    await expect(
      dismissCathayTransactionModals(page as never, 0),
    ).resolves.toEqual({ before: 1, after: 0, method: "escape" });
  });
});
