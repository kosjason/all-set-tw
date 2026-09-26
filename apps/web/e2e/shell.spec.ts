import { expect, test, type Page } from "@playwright/test";
import { routeActivityApi, routeNavigationApi } from "./activity-api";

function taipeiMonth() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
    })
      .formatToParts(new Date())
      .map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}`;
}

/** 本月頁收支區塊的標題（例如「9 月收支」），與「近 6 個月收支」區分。 */
function monthCashFlowName() {
  return `${Number(taipeiMonth().slice(5))} 月收支`;
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith("/api/")) {
      await route.continue();
      return;
    }
    let body: unknown;
    if (path === "/api/runtime") body = { demoMode: true };
    else if (path === "/api/summary")
      body = {
        totalAssetsTwd: 0,
        totalLiabilitiesTwd: 0,
        netWorthTwd: 0,
        monthlyIncomeTwd: 0,
        monthlyExpenseTwd: 0,
        accounts: 0,
        investments: 0,
        transactions: 0,
      };
    else if (path === "/api/bank") body = { accounts: [], transactions: [] };
    else if (path === "/api/investments") body = [];
    else if (path === "/api/investment-transactions") body = [];
    else if (path === "/api/invoices") body = [];
    else if (path === "/api/activity/invoice-mappings") body = [];
    else if (path === "/api/manual-assets") body = [];
    else if (path === "/api/exchange-rates") body = [];
    else if (path === "/api/history/net-worth/chart") body = [];
    else if (path === "/api/sync-jobs") body = [];
    else if (path === "/api/sync-reports/latest") body = null;
    else if (path === "/api/sync-schedule")
      body = {
        intervalMinutes: 1440,
        preferredTime: "09:00",
        preferredWeekday: 1,
        timezone: "Asia/Taipei",
        updatedAt: "2026-08-15T01:00:00.000Z",
      };
    else if (path === "/api/classification/categories")
      // 0067 起消費只有 8 個頂層分類（沒有子類），另有收入子類與未分類。
      body = [
        ["food", "餐飲", "🍜"],
        ["transport", "交通", "🚇"],
        ["housing", "居住", "🏠"],
        ["shopping", "購物", "🛍️"],
        ["tech", "3C 數位", "💻"],
        ["entertainment", "娛樂", "🎬"],
        ["health", "醫療保險", "🩺"],
        ["misc", "其他", "📌"],
      ]
        .map(([id, label, emoji], index) => ({
          id,
          label,
          emoji,
          sortOrder: index + 1,
          isSystem: true,
          parentId: null,
          topLevelId: id,
          kind: "spending",
        }))
        .concat([
          {
            id: "income.salary",
            label: "薪資",
            emoji: "💼",
            sortOrder: 101,
            isSystem: true,
            parentId: "income",
            topLevelId: "income",
            kind: "income",
          },
          {
            id: "other",
            label: "未分類",
            emoji: "❔",
            sortOrder: 200,
            isSystem: true,
            parentId: null,
            topLevelId: "other",
            kind: "uncategorized",
          },
        ]);
    else if (path === "/api/classification/rules") body = [];
    else if (path.includes("/connectors/") && path.endsWith("/settings"))
      body = { configured: false, publicConfig: {} };
    else throw new Error(`Unexpected API request in E2E mock: ${path}`);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  await routeActivityApi(page);
  await routeNavigationApi(page);
});

async function expectSelectedConnectorInView(
  page: Page,
  connectorId: string,
  title: string,
) {
  await expect(page).toHaveURL(/#\/data-sources(\?.*)?$/);
  const connectorSettings = page.locator(
    `[data-connector-settings="${connectorId}"]`,
  );
  await expect(connectorSettings).toBeVisible({ timeout: 15_000 });
  await expect(
    connectorSettings.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await expect(
    connectorSettings.getByRole("button", {
      name: "收合台新銀行設定",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    connectorSettings.getByRole("heading", {
      name: "連線與同步",
      exact: true,
    }),
  ).toBeVisible();

  const scrollPosition = () =>
    page.evaluate(() =>
      document.documentElement.classList.contains("is-standalone")
        ? (document.getElementById("root")?.scrollTop ?? 0)
        : window.scrollY,
    );
  await expect
    .poll(async () => {
      const before = await scrollPosition();
      await page.waitForTimeout(120);
      const after = await scrollPosition();
      return after > 0 && Math.abs(after - before) <= 1;
    })
    .toBe(true);

  const position = await connectorSettings.evaluate((element) => {
    const header = document.querySelector("header");
    return {
      targetTop: element.getBoundingClientRect().top,
      headerBottom: header?.getBoundingClientRect().bottom ?? 0,
    };
  });
  expect(position.targetTop).toBeGreaterThanOrEqual(position.headerBottom - 1);
  expect(position.targetTop).toBeLessThanOrEqual(position.headerBottom + 96);

  const pageWidth = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(pageWidth.scroll).toBe(pageWidth.client);
}

for (const { hash, heading } of [
  { hash: "/#/transactions", heading: "載入活動中" },
  { hash: "/#/assets", heading: "載入資產清冊中" },
]) {
  test(`shows a paper loading state for ${heading}`, async ({ page }) => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/bank**", async (route) => {
      await pending;
      await route.fulfill({
        json: { accounts: [], transactions: [] },
      });
    });

    await page.goto(hash);
    const loading = page.getByRole("heading", { name: heading, exact: true });
    await expect(loading).toBeVisible();
    const section = loading.locator("xpath=ancestor::section[1]");
    await expect(section).not.toHaveClass(/bg-white/);
    await expect(section).not.toHaveClass(/border-dashed/);
    await expect(section).not.toHaveClass(/rounded-xl/);

    release();
    await expect(loading).toHaveCount(0);
  });
}

test("month page uses one monthly bank request for net worth and the six-month summary API", async ({
  page,
}) => {
  const bankRequests: URL[] = [];
  const summaryRequests: URL[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/activity/summary") summaryRequests.push(url);
  });
  await page.route("**/api/bank**", async (route) => {
    const url = new URL(route.request().url());
    // 活動 API 替身組 summary 時的請求不算頁面自己的請求。
    if (!url.searchParams.has("_source")) bankRequests.push(url);
    await route.fulfill({
      json: {
        accounts: [
          {
            id: "overview-account",
            connectorId: "esun",
            sourceId: "overview-account",
            accountType: "savings",
            balance: 12345,
            currency: "TWD",
          },
        ],
        transactions: [],
      },
    });
  });

  await page.goto("/#/month");
  await expect(page.getByTestId("month-net-worth")).toContainText("NT$12,345");
  expect(bankRequests).toHaveLength(1);
  expect(bankRequests[0].searchParams.get("from")).toMatch(/^\d{4}-\d{2}$/);
  expect(bankRequests[0].searchParams.get("to")).toBe(
    bankRequests[0].searchParams.get("from"),
  );
  const pageSummaryRequests = summaryRequests.filter(
    (url) => !url.searchParams.has("_source"),
  );
  expect(pageSummaryRequests).toHaveLength(1);
  expect(pageSummaryRequests[0].searchParams.get("to")).toBe(taipeiMonth());
});

test("loads the responsive shell and changes primary views", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("不用記帳").first()).toBeVisible();
  await expect(page.getByText("ALL SET").first()).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "本月", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/#\/month$/);

  await page
    .getByRole("button", { name: "資產", exact: true })
    .filter({ visible: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "資產", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/#\/assets$/);

  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "本月", exact: true }),
  ).toBeVisible();
});

test("renders the mobile bottom navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("navigation", { name: "主要導覽" }),
  ).toBeVisible();
  const tabs = page.getByRole("navigation", { name: "主要導覽" });
  await expect(tabs.getByRole("button")).toHaveText([
    "本月",
    "交易",
    "信用卡",
    "資產",
    "更多",
  ]);
  await tabs.getByRole("button", { name: "更多" }).click();
  await expect(
    page.getByRole("heading", { name: "更多", exact: true }),
  ).toBeVisible();
  const more = page.getByRole("navigation", { name: "更多功能" });
  await expect(more.getByRole("button", { name: /資料來源/ })).toBeVisible();
  await expect(more.getByRole("button", { name: /待處理/ })).toBeVisible();
  await expect(more.getByRole("button", { name: /設定/ })).toBeVisible();
});

test("redirects old hashes to the new pages and keeps the query", async ({
  page,
}) => {
  await page.goto("/#/month");
  await expect(page).toHaveURL(/#\/month$/);
  await page.goto("/#/activity?review=1");
  await expect(page).toHaveURL(/#\/transactions\?review=1$/);
  await expect(
    page.getByRole("heading", { name: "交易", exact: true }),
  ).toBeVisible();
  await page.goto("/#/settings/classification-rules");
  await expect(page).toHaveURL(/#\/transactions\/rules$/);
  await page.goto("/#/settings/data-sources");
  await expect(page).toHaveURL(/#\/data-sources$/);
  await page.goto("/#/own-accounts");
  await expect(
    page.getByRole("heading", { name: "我的其他帳戶", exact: true }),
  ).toBeVisible();
  await page.goto("/#/sync-notifications");
  await expect(page).toHaveURL(/#\/settings$/);
});

test("opens and scrolls to the selected connector from mobile more", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/more");

  await page
    .getByRole("navigation", { name: "更多功能" })
    .getByRole("button", { name: /資料來源/ })
    .click();
  // 更多選單只導向資料來源頁；手機版在該頁以連接器卡片的「管理設定」展開。
  await page
    .locator('[data-connector-settings="taishin"]')
    .getByRole("button", { name: "管理台新銀行設定", exact: true })
    .click();

  await expectSelectedConnectorInView(page, "taishin", "台新銀行");
});

test("opens and scrolls to the actionable connector from the mobile inbox", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/sync-jobs", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "taishin:all",
          connectorId: "taishin",
          configured: true,
          scope: "all",
          enabled: true,
          intervalMinutes: 1440,
          nextRunAt: "2026-08-16T01:00:00.000Z",
          scheduleMode: "inherit",
          preferredTime: "09:00",
          preferredWeekday: 1,
          lockedUntil: null,
          lockedBy: null,
          lockTrigger: null,
          lockScope: null,
          lastRunAt: "2026-08-15T01:00:00.000Z",
          lastSuccessAt: "2026-08-14T01:00:00.000Z",
          lastStatus: "needs_user_action",
          lastError: "需要重新驗證",
          updatedAt: "2026-08-15T01:00:00.000Z",
          running: false,
        },
      ]),
    });
  });
  await page.route("**/api/sync-schedule", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        intervalMinutes: 1440,
        preferredTime: "09:00",
        preferredWeekday: 1,
        timezone: "Asia/Taipei",
        updatedAt: "2026-08-15T01:00:00.000Z",
      }),
    });
  });
  await page.route("**/api/inbox", async (route) => {
    await route.fulfill({
      json: {
        counts: { blocking: 1, tidy: 0 },
        months: [],
        unavailable: [],
        items: [
          {
            id: "connector_needs_user_action:taishin:1",
            kind: "connector_needs_user_action",
            severity: "blocking",
            title: "台新銀行需要你完成驗證",
            detail: "需要重新驗證",
            target: { view: "data-sources", query: { connector: "taishin" } },
            createdAt: "2026-08-15T01:00:00.000Z",
            action: { kind: "open_connector", label: "前往驗證" },
          },
        ],
      },
    });
  });
  await page.goto("/#/month");

  await page.getByRole("button", { name: /待處理（1 件需要處理）/ }).click();
  await page.getByRole("button", { name: "前往驗證" }).click();

  await expectSelectedConnectorInView(page, "taishin", "台新銀行");
});

test("warns about a missing exchange rate only when the foreign balance is positive", async ({
  page,
}) => {
  let hkdBalance = 0;
  await page.route("**/api/bank**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        accounts: [
          {
            id: "hkd-account",
            connectorId: "esun",
            sourceId: "hkd-account",
            institutionName: "玉山銀行",
            accountName: "港幣帳戶",
            accountType: "savings",
            balance: hkdBalance,
            currency: "HKD",
          },
        ],
        transactions: [],
      }),
    });
  });

  const warning = page.getByText(/缺少 HKD 匯率/);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/assets");
  await expect(page.getByRole("region", { name: "淨資產" })).toBeVisible();
  await expect(warning).toHaveCount(0);

  hkdBalance = 100;
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(warning).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(warning).toBeVisible();

  hkdBalance = 0;
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(warning).toHaveCount(0);
});

test("does not show a missing-rate warning while exchange rates are loading", async ({
  page,
}) => {
  await page.route("**/api/bank**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        accounts: [
          {
            id: "hkd-account",
            connectorId: "esun",
            sourceId: "hkd-account",
            accountType: "savings",
            balance: 100,
            currency: "HKD",
          },
        ],
        transactions: [],
      }),
    });
  });

  let releaseRates!: () => void;
  const pendingRates = new Promise<void>((resolve) => {
    releaseRates = resolve;
  });
  await page.route("**/api/exchange-rates", async (route) => {
    await pendingRates;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    });
  });

  await page.goto("/#/assets");
  const warning = page.getByText(/缺少 HKD 匯率/);
  await expect(
    page.getByRole("heading", { name: "載入資產清冊中", exact: true }),
  ).toBeVisible();
  await expect(warning).toHaveCount(0);

  releaseRates();
  await expect(warning).toBeVisible();
});

test("shows a loading state while a connector sync is pending", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/runtime", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ demoMode: false }),
    }),
  );
  await page.route("**/api/connectors/ctbc/settings", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        connectorId: "ctbc",
        configured: true,
        credentialsComplete: true,
        sessionAvailable: false,
        publicConfig: {},
      }),
    }),
  );

  let releaseSync!: () => void;
  const pendingSync = new Promise<void>((resolve) => {
    releaseSync = resolve;
  });
  await page.route("**/api/connectors/ctbc/sync", async (route) => {
    await pendingSync;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        connectorId: "ctbc",
        scope: "all",
        records: 0,
        cursorUpdated: true,
      }),
    });
  });

  await page.goto("/#/data-sources");
  const ctbcCard = page.locator("div.rounded-xl").filter({
    has: page.getByRole("heading", { name: "中國信託銀行", exact: true }),
  });
  await ctbcCard
    .getByRole("button", { name: "管理中國信託銀行設定", exact: true })
    .click();
  const syncButton = page.getByRole("button", {
    name: "同步",
    exact: true,
  });
  await syncButton.click();

  const pendingButton = page.getByRole("button", { name: "同步中…" });
  await expect(pendingButton).toBeDisabled();
  await expect(pendingButton.locator("svg")).toHaveClass(/animate-spin/);

  releaseSync();
  await expect(syncButton).toBeEnabled();
});

test("keeps the desktop month page within the viewport with long data", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route("**/api/bank**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        accounts: [],
        transactions: [
          {
            id: "long-transaction",
            connectorId: "cathaybk",
            accountId: "account-1",
            sourceId: "long-source-id",
            postedDate: new Date().toISOString().slice(0, 10),
            amount: -88,
            currency: "TWD",
            description:
              "YSSL80300000051500038491812BDF7C03202607172521LONGACTIVITY",
            institutionName: "測試銀行",
            status: "posted",
          },
        ],
      }),
    });
  });

  await page.goto("/#/month");
  await expect(
    page.getByRole("heading", { name: monthCashFlowName(), exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "最近交易" })).toBeVisible();
  await expect(page.getByText("LONGACTIVITY", { exact: false })).toBeVisible();
  const pageWidth = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(pageWidth.scroll).toBe(pageWidth.client);
});

test("keeps net worth comparison details readable across viewports", async ({
  page,
}) => {
  await page.route("**/api/history/net-worth/chart", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          date: "2026-08-13",
          netWorth: 2_254_854,
          assetType: "deposit",
          source: "bank",
        },
        {
          date: "2026-08-14",
          netWorth: 2_249_504,
          assetType: "deposit",
          source: "bank",
        },
      ]),
    });
  });

  const comparisonRows = [
    { label: "目前", date: undefined, value: "NT$2,249,504" },
    { label: "較昨日", date: "2026/8/13", value: "NT$2,254,854" },
    { label: "變化", date: undefined, value: "−NT$5,350 （−0.2%）" },
  ] as const;

  for (const viewport of [
    { width: 320, height: 740 },
    { width: 390, height: 844 },
    { width: 1280, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/#/assets");

    await expect(page.getByRole("heading", { name: "資產走勢" })).toBeVisible();
    const settings = page.getByRole("button", { name: "顯示設定" });
    await expect(settings).toHaveAttribute("aria-expanded", "false");
    await expect(
      page.getByRole("tab", { name: "分類", exact: true }),
    ).toBeHidden();
    await settings.click();
    await page.getByRole("tab", { name: "分類", exact: true }).click();
    await expect(
      page.getByRole("tab", { name: "分類", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByRole("button", { name: "存款", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await settings.click();
    await expect(
      page.getByRole("tab", { name: "分類", exact: true }),
    ).toBeHidden();
    await expect(page.getByText("目前", { exact: true })).toBeHidden();
    await page.locator("summary").filter({ hasText: "比較明細" }).click();
    const comparisonCard = page
      .getByText("目前", { exact: true })
      .locator("../..");

    for (const { label, date, value } of comparisonRows) {
      const labelElement = comparisonCard.getByText(label, { exact: true });
      const row = labelElement.locator(
        "xpath=ancestor::div[contains(@class, 'grid')][1]",
      );
      const amount = row.getByText(value, { exact: true });
      const visibleElements = [labelElement, amount];

      if (date) {
        const dateElement = row.getByText(date, { exact: true });
        await expect(dateElement).toBeVisible();
        visibleElements.push(dateElement);
      }

      await expect(labelElement).toBeVisible();
      await expect(amount).toBeVisible();
      for (const element of visibleElements) {
        expect(
          await element.evaluate((node) => node.scrollWidth),
          `${label} should not be truncated at ${viewport.width}px`,
        ).toBeLessThanOrEqual(
          await element.evaluate((node) => node.clientWidth),
        );
      }
    }

    const pageWidth = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(pageWidth.scroll).toBe(pageWidth.client);
    await page.locator("summary").filter({ hasText: "比較明細" }).click();
    await expect(page.getByText("目前", { exact: true })).toBeHidden();
  }
});

test("keeps partial sync financial changes readable on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/sync-reports/*/activities", async (route) => {
    await route.fulfill({
      json: {
        sources: Object.fromEntries(
          ["esun", "taishin", "einvoice"].map((connectorId) => [
            connectorId,
            { availability: "available", items: [] },
          ]),
        ),
      },
    });
  });
  await page.route("**/api/sync-reports/latest", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "scheduled:mobile-partial-report",
        startedAt: "2026-08-15T00:00:00.000Z",
        completedAt: "2026-08-15T00:05:00.000Z",
        status: "failed",
        sources: [
          {
            connectorId: "esun",
            status: "success",
            completedAt: "2026-08-15T00:03:00.000Z",
            recoveredAt: null,
            newRecords: {
              invoices: 0,
              bankTransactions: 3,
              investmentTransactions: 0,
            },
          },
          {
            connectorId: "taishin",
            status: "failed",
            completedAt: "2026-08-15T00:04:00.000Z",
            recoveredAt: null,
            newRecords: {
              invoices: 0,
              bankTransactions: 0,
              investmentTransactions: 0,
            },
          },
          {
            connectorId: "einvoice",
            status: "success",
            completedAt: "2026-08-15T00:05:00.000Z",
            recoveredAt: null,
            newRecords: {
              invoices: 2,
              bankTransactions: 0,
              investmentTransactions: 0,
            },
          },
        ],
        sourceSummary: {
          total: 3,
          success: 2,
          failed: 1,
          needsUserAction: 0,
        },
        newRecords: {
          invoices: 2,
          bankTransactions: 3,
          investmentTransactions: 0,
        },
        financialChange: {
          assets: -1_234_567,
          creditCardDebt: 7_654_321,
          netWorth: -8_888_888,
        },
        financialChangeUnavailableReason: null,
        missingCurrencies: [],
        recoveredAt: null,
      }),
    });
  });

  await page.goto("/#/data-sources");
  await expect(
    page.getByText("依 2/3 已更新來源計算，其餘沿用上次資料"),
  ).toBeVisible();

  for (const value of ["−NT$1,234,567", "+NT$7,654,321", "−NT$8,888,888"]) {
    const amount = page.getByText(value, { exact: true });
    await expect(amount).toBeVisible();
    expect(
      await amount.evaluate((element) => element.scrollWidth),
      `${value} should not be truncated`,
    ).toBeLessThanOrEqual(
      await amount.evaluate((element) => element.clientWidth),
    );
  }

  const pageWidth = () =>
    page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
  expect((await pageWidth()).scroll).toBe((await pageWidth()).client);

  await page.getByText("查看各資料來源", { exact: true }).click();
  await expect(page.getByText("收合各資料來源", { exact: true })).toBeVisible();
  // 資料來源頁同時列出連接器卡片，因此只在同步報告區塊內確認各來源。
  const report = page.getByRole("region", {
    name: "最近一次排程同步",
    exact: true,
  });
  await expect(report.getByText("玉山銀行", { exact: true })).toBeVisible();
  await expect(report.getByText("台新銀行", { exact: true })).toBeVisible();
  expect((await pageWidth()).scroll).toBe((await pageWidth()).client);
});

test("shows this month's cash flow equation on the month page and opens transactions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const month = taipeiMonth();
  await page.route("**/api/bank**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        accounts: [],
        transactions: [
          {
            id: "monthly-income",
            connectorId: "cathaybk",
            accountId: "account-1",
            sourceId: "monthly-income",
            postedDate: `${month}-02`,
            amount: 50_000,
            currency: "TWD",
            description: "薪資",
            status: "posted",
          },
          {
            id: "monthly-expense",
            connectorId: "cathaybk",
            accountId: "account-1",
            sourceId: "monthly-expense",
            postedDate: `${month}-03`,
            amount: -12_000,
            currency: "TWD",
            description: "生活支出",
            status: "posted",
          },
        ],
      }),
    });
  });

  await page.goto("/#/month");
  const cashFlowSection = page.getByRole("region", {
    name: monthCashFlowName(),
    exact: true,
  });
  await expect(cashFlowSection).toBeVisible();
  // 收入 − 消費 ＝ 存下來，數字來自 summary API；投資是存下來的去向。
  await expect(cashFlowSection.getByTestId("cash-flow-income")).toHaveText(
    "NT$50,000",
  );
  await expect(cashFlowSection.getByTestId("cash-flow-spending")).toHaveText(
    "NT$12,000",
  );
  await expect(cashFlowSection.getByTestId("cash-flow-saved")).toHaveText(
    "NT$38,000",
  );
  await expect(
    cashFlowSection.getByTestId("cash-flow-destination"),
  ).toContainText("留在帳戶");
  await expect(page.getByText(/消費高於收入/)).toHaveCount(0);

  await page.getByRole("button", { name: "查看全部交易 →" }).click();
  await expect(page).toHaveURL(/#\/transactions$/);
});

test("separates bank and card records into tabs and filters the ledger by role", async ({
  page,
}) => {
  const month = taipeiMonth();
  await page.route("**/api/bank**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        accounts: [
          {
            id: "deposit-account",
            connectorId: "cathaybk",
            sourceId: "deposit-account",
            accountType: "deposit",
            currency: "TWD",
          },
          {
            id: "card-account",
            connectorId: "cathaybk",
            sourceId: "card-account",
            accountType: "credit",
            currency: "TWD",
          },
        ],
        transactions: [
          {
            id: "bank-income",
            connectorId: "cathaybk",
            accountId: "deposit-account",
            sourceId: "bank-income",
            postedDate: `${month}-02`,
            amount: 50_000,
            currency: "TWD",
            description: "薪資入帳",
            status: "posted",
          },
          {
            id: "bank-expense",
            connectorId: "cathaybk",
            accountId: "deposit-account",
            sourceId: "bank-expense",
            postedDate: `${month}-03`,
            amount: -18_000,
            currency: "TWD",
            description: "房租支出",
            status: "posted",
          },
          {
            id: "card-income",
            connectorId: "cathaybk",
            accountId: "card-account",
            sourceId: "card-income",
            postedDate: `${month}-04`,
            amount: 300,
            currency: "TWD",
            description: "信用卡退款",
            status: "posted",
          },
          {
            id: "card-expense",
            connectorId: "cathaybk",
            accountId: "card-account",
            sourceId: "card-expense",
            postedDate: `${month}-05`,
            amount: -600,
            currency: "TWD",
            description: "信用卡消費",
            status: "posted",
          },
        ],
      }),
    });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/transactions");

  const activityRows = page.locator("tbody tr");
  const roleFilter = page.getByRole("combobox", { name: "活動角色" });

  await expect(activityRows).toHaveCount(4);
  // 1440px 時工具列維持一列、搜尋框至少 240px。
  const toolbarRow = page.getByTestId("activity-toolbar-row");
  const searchBox = page.getByRole("searchbox", { name: "搜尋活動" });
  const rowBox = await toolbarRow.boundingBox();
  const searchBoxSize = await searchBox.boundingBox();
  expect(rowBox?.height ?? 0).toBeLessThan(56);
  expect(searchBoxSize?.width ?? 0).toBeGreaterThanOrEqual(240);

  await roleFilter.selectOption("income");
  await expect(activityRows.filter({ hasText: "薪資入帳" })).toBeVisible();
  await expect(activityRows.filter({ hasText: "房租支出" })).toHaveCount(0);
  await expect(page).toHaveURL(/role=income/);

  await roleFilter.selectOption("all");
  await page.getByRole("tab", { name: "銀行" }).click();
  await expect(page).toHaveURL(/tab=bank/);
  await expect(page.getByTestId("raw-records-note")).toContainText(
    "原始紀錄，不等於消費",
  );
  const sourceRows = page.getByTestId("source-row");
  await expect(sourceRows).toHaveCount(2);
  await expect(sourceRows.filter({ hasText: "薪資入帳" })).toBeVisible();
  await expect(sourceRows.filter({ hasText: "房租支出" })).toBeVisible();
  await expect(page.getByRole("region", { name: /月收支$/ })).toHaveCount(0);

  await page.getByRole("tab", { name: "信用卡" }).click();
  await expect(sourceRows).toHaveCount(2);
  await expect(sourceRows.filter({ hasText: "信用卡消費" })).toBeVisible();
  await expect(sourceRows.filter({ hasText: "信用卡退款" })).toBeVisible();
});

test("shows reliable activity times and sorts them on desktop and mobile", async ({
  page,
}) => {
  const month = taipeiMonth();
  const activityDate = `${month}-10`;
  const invoice = {
    id: "invoice-time-only",
    connectorId: "einvoice",
    sourceId: "invoice-time-only-source",
    invoiceDate: `${activityDate}T23:45:00+08:00`,
    invoiceNumber: "TIME-0001",
    sellerName: "配對發票提供時間",
    amount: 860,
  };

  await page.route("**/api/bank**", async (route) => {
    await route.fulfill({
      json: {
        accounts: [
          {
            id: "time-card",
            connectorId: "sinopac",
            sourceId: "time-card-source",
            institutionName: "測試銀行",
            accountName: "時間測試卡",
            accountType: "credit",
            currency: "TWD",
          },
        ],
        transactions: [
          {
            id: "legacy-date-only",
            connectorId: "sinopac",
            accountId: "time-card",
            sourceId: "legacy-date-only-source",
            postedDate: `${month}-11T00:00:00.000Z`,
            amount: -50,
            currency: "TWD",
            description: "舊資料活動",
            status: "posted",
            excludedFromCalculation: false,
          },
          {
            id: "timed-activity",
            connectorId: "sinopac",
            accountId: "time-card",
            sourceId: "timed-activity-source",
            postedDate: activityDate,
            authorizedAt: `${activityDate}T14:30:00+08:00`,
            amount: -120,
            currency: "TWD",
            description: "有時間活動",
            status: "posted",
            excludedFromCalculation: false,
          },
          {
            id: "midnight-activity",
            connectorId: "sinopac",
            accountId: "time-card",
            sourceId: "midnight-activity-source",
            postedDate: activityDate,
            authorizedAt: `${activityDate}T00:00:00+08:00`,
            amount: -100,
            currency: "TWD",
            description: "真午夜活動",
            status: "posted",
            excludedFromCalculation: false,
          },
          {
            id: "matched-date-only",
            connectorId: "sinopac",
            accountId: "time-card",
            sourceId: "matched-date-only-source",
            postedDate: activityDate,
            amount: -860,
            currency: "TWD",
            description: "無授權時間配對",
            status: "posted",
            excludedFromCalculation: false,
          },
        ],
      },
    });
  });
  await page.route("**/api/invoices**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({
      json: path === "/api/invoices" ? [invoice] : { ...invoice, items: [] },
    });
  });

  await page.goto("/#/transactions");

  const desktopRows = page.locator("tbody tr");
  const tabs = page.getByRole("tablist", { name: "交易分頁" });
  // 總帳只列去重後的 4 筆交易；已配對的發票併入刷卡交易，只在發票分頁的原始
  // 紀錄列出並標示已對應（不重複計算）。
  await expect(desktopRows).toHaveCount(4);
  await expect(page.getByRole("region", { name: "活動列表" })).toContainText(
    "另 1 筆重複已併入（見發票分頁）",
  );
  await tabs.getByRole("tab", { name: "發票", exact: true }).click();
  const invoiceRows = page.getByTestId("source-row");
  await expect(invoiceRows).toHaveCount(1);
  await expect(invoiceRows).toContainText("配對發票提供時間");
  await expect(invoiceRows.getByTestId("match-status")).toHaveText(
    "已對應刷卡",
  );
  await tabs.getByRole("tab", { name: "總帳", exact: true }).click();
  await expect(desktopRows).toHaveCount(4);
  await expect(desktopRows.filter({ hasText: "有時間活動" })).toContainText(
    "14:30",
  );
  await expect(desktopRows.filter({ hasText: "真午夜活動" })).toContainText(
    "00:00",
  );
  await expect(desktopRows.filter({ hasText: "舊資料活動" })).not.toContainText(
    "00:00",
  );
  // 已配對發票的交易以發票商家命名，時間取自發票。
  await expect(
    desktopRows.filter({ hasText: "配對發票提供時間" }),
  ).toContainText("23:45");

  const desktopRowTexts = await desktopRows.allTextContents();
  expect(desktopRowTexts.findIndex((text) => text.includes("舊資料活動"))).toBe(
    0,
  );
  expect(
    desktopRowTexts.findIndex((text) => text.includes("有時間活動")),
  ).toBeLessThan(
    desktopRowTexts.findIndex((text) => text.includes("真午夜活動")),
  );
  expect(
    desktopRowTexts.findIndex((text) => text.includes("配對發票提供時間")),
  ).toBeLessThan(
    desktopRowTexts.findIndex((text) => text.includes("有時間活動")),
  );

  await desktopRows
    .filter({ hasText: "配對發票提供時間" })
    .getByRole("button", { name: "查看 配對發票提供時間 活動詳情" })
    .click();
  const desktopDetail = page.getByRole("dialog", { name: "活動明細" });
  await expect(desktopDetail).toBeVisible();
  await expect(desktopDetail).toContainText("23:45");
  await page.getByRole("button", { name: "關閉活動明細" }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const mobileTimed = page.getByRole("button", {
    name: "查看 有時間活動 活動詳情",
  });
  const mobileMidnight = page.getByRole("button", {
    name: "查看 真午夜活動 活動詳情",
  });
  const mobileLegacy = page.getByRole("button", {
    name: "查看 舊資料活動 活動詳情",
  });
  const mobileMatched = page.getByRole("button", {
    name: "查看 配對發票提供時間 活動詳情",
  });
  await expect(mobileTimed).toContainText("14:30");
  await expect(mobileMidnight).toContainText("00:00");
  await expect(mobileLegacy).not.toContainText("00:00");
  await expect(mobileMatched).toContainText("23:45");
});

test("uses app-like scrolling and history only in standalone display mode", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("html")).not.toHaveClass(/is-standalone/);
  await expect(page.locator("html")).toHaveCSS("touch-action", "manipulation");

  await page.addInitScript(() => {
    const nativeMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query: string) => {
      if (query !== "(display-mode: standalone)")
        return nativeMatchMedia(query);
      return {
        matches: true,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => true,
      };
    };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();

  await expect(page.locator("html")).toHaveClass(/is-standalone/);
  await expect(page.locator("html")).toHaveCSS("overflow", "hidden");
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  await expect(page.locator("#root")).toHaveCSS("touch-action", "manipulation");
  await expect(page.locator("#root")).toHaveCSS("overflow-y", "auto");
  await expect(page.locator("#root")).toHaveCSS("overscroll-behavior", "none");

  const historyLength = await page.evaluate(() => window.history.length);
  await page.getByRole("button", { name: "資產", exact: true }).last().click();
  await expect(page).toHaveURL(/#\/assets$/);
  await expect(
    page.getByRole("heading", { name: "資產", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.history.length)).toBe(historyLength);
});

test("redirects the removed invoices route to the month page", async ({
  page,
}) => {
  await page.goto("/#/invoices");
  await expect(page).toHaveURL(/#\/month$/);
  await expect(
    page.getByRole("heading", { name: "本月", exact: true }),
  ).toBeVisible();
});

test("excludes a bank transaction from activity calculations and restores it", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", {
      configurable: true,
      value: true,
    });
  });
  let excludedFromCalculation = false;
  const month = taipeiMonth();

  await page.route("**/api/bank**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        accounts: [
          {
            id: "account-1",
            connectorId: "cathaybk",
            sourceId: "account-source-1",
            institutionName: "測試銀行",
            accountName: "活期帳戶",
            accountType: "checking",
            currency: "TWD",
          },
        ],
        transactions: [
          {
            id: "transaction-1",
            connectorId: "cathaybk",
            accountId: "account-1",
            sourceId: "transaction-source-1",
            postedDate: `${month}-07`,
            amount: -8318,
            currency: "TWD",
            description: "台新卡費",
            status: "posted",
            excludedFromCalculation,
            classification: {
              categoryId: "other",
              label: "未分類",
              source: "fallback",
            },
          },
        ],
      }),
    });
  });
  await page.route(
    "**/api/bank/transactions/transaction-1/calculation",
    async (route) => {
      const body = route.request().postDataJSON() as {
        excludedFromCalculation: boolean;
      };
      excludedFromCalculation = body.excludedFromCalculation;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, excludedFromCalculation }),
      });
    },
  );

  await page.goto("/#/transactions");
  await expect(page.locator("html")).toHaveClass(/is-standalone/);
  const spending = page.getByTestId("cash-flow-spending");
  await expect(spending).toHaveText("NT$8,318");

  await page.getByRole("button", { name: "查看 台新卡費 活動詳情" }).click();
  await expect(page.getByRole("heading", { name: "活動明細" })).toBeVisible();
  const desktopDetailDialog = page.getByRole("dialog", { name: "活動明細" });
  await page
    .getByRole("button", { name: "關閉活動明細" })
    .click({ position: { x: 20, y: 200 } });
  await expect(desktopDetailDialog).toBeHidden();

  await page.getByRole("button", { name: "查看 台新卡費 活動詳情" }).click();
  await page
    .getByRole("checkbox", { name: "排除 台新卡費 的統計計算" })
    .click();
  const calculationDialog = page.getByRole("dialog", {
    name: "排除統計計算",
  });
  await expect(calculationDialog).toBeVisible();
  await expect(
    calculationDialog.getByRole("checkbox", {
      name: "同時新增分類規則",
    }),
  ).not.toBeChecked();
  await calculationDialog.getByRole("button", { name: "取消" }).click();
  await expect(calculationDialog).toBeHidden();
  await expect(
    page.getByRole("checkbox", { name: "排除 台新卡費 的統計計算" }),
  ).not.toBeChecked();
  await expect(spending).toHaveText("NT$8,318");

  await page
    .getByRole("checkbox", { name: "排除 台新卡費 的統計計算" })
    .click();
  await calculationDialog.getByRole("button", { name: "確認排除" }).click();
  await expect(calculationDialog).toBeHidden();
  await expect(
    page.getByRole("checkbox", { name: "恢復 台新卡費 的統計計算" }),
  ).toBeChecked();
  await page.getByRole("button", { name: "返回活動列表" }).click();
  // 排除後不再是消費：消費為 0，摘要列列入「轉到自己帳戶」。
  const noSpending = spending.filter({ hasText: "NT$0" });
  await expect(noSpending).toBeVisible();
  await expect(page.getByRole("region", { name: /月收支$/ })).toContainText(
    "另有 轉到自己帳戶 NT$8,318 未計入",
  );
  await page.getByRole("button", { name: "查看 台新卡費 活動詳情" }).click();
  await expect(
    page.getByRole("checkbox", { name: "恢復 台新卡費 的統計計算" }),
  ).toBeChecked();

  await page.reload();
  await expect(noSpending).toBeVisible();
  // Standalone navigation restores the open detail from browser history.
  await expect(desktopDetailDialog).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "恢復 台新卡費 的統計計算" }),
  ).toBeChecked();

  await page
    .getByRole("checkbox", { name: "恢復 台新卡費 的統計計算" })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "排除 台新卡費 的統計計算" }),
  ).not.toBeChecked();
  await expect(spending).toHaveText("NT$8,318");

  await page.getByRole("button", { name: "返回活動列表" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("combobox", { name: "更新 台新卡費 分類" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "查看 台新卡費 活動詳情" }).click();
  const detailDialog = page.getByRole("dialog", { name: "活動明細" });
  const detailBox = await detailDialog.boundingBox();
  if (!detailBox) throw new Error("Mobile activity detail is not visible.");
  expect(detailBox.width).toBe(390);
  expect(detailBox.height).toBe(844);
  await expect(
    page.getByRole("combobox", { name: "更新 台新卡費 分類" }),
  ).toBeVisible();

  await detailDialog.evaluate((element) => {
    const start = new Touch({
      identifier: 1,
      target: element,
      clientX: 8,
      clientY: 300,
    });
    const end = new Touch({
      identifier: 1,
      target: element,
      clientX: 38,
      clientY: 420,
    });
    element.dispatchEvent(
      new TouchEvent("touchstart", {
        bubbles: true,
        cancelable: true,
        changedTouches: [start],
        targetTouches: [start],
        touches: [start],
      }),
    );
    element.dispatchEvent(
      new TouchEvent("touchend", {
        bubbles: true,
        cancelable: true,
        changedTouches: [end],
        targetTouches: [],
        touches: [],
      }),
    );
  });
  await expect(detailDialog).toBeVisible();

  await detailDialog.evaluate((element) => {
    const start = new Touch({
      identifier: 2,
      target: element,
      clientX: 8,
      clientY: 300,
    });
    const end = new Touch({
      identifier: 2,
      target: element,
      clientX: 108,
      clientY: 312,
    });
    element.dispatchEvent(
      new TouchEvent("touchstart", {
        bubbles: true,
        cancelable: true,
        changedTouches: [start],
        targetTouches: [start],
        touches: [start],
      }),
    );
    element.dispatchEvent(
      new TouchEvent("touchend", {
        bubbles: true,
        cancelable: true,
        changedTouches: [end],
        targetTouches: [],
        touches: [],
      }),
    );
  });
  await expect(detailDialog).toBeHidden();
});

test("can add a classification rule while excluding a transaction", async ({
  page,
}) => {
  const month = taipeiMonth();
  let ruleBody: Record<string, unknown> | undefined;
  let overrideBody: Record<string, unknown> | undefined;

  await page.route("**/api/bank**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        accounts: [],
        transactions: [
          {
            id: "fallback-transaction",
            connectorId: "cathaybk",
            accountId: "account-1",
            sourceId: "fallback-source",
            postedDate: `${month}-08`,
            amount: -1200,
            currency: "TWD",
            description: "每月家庭轉帳",
            status: "posted",
            excludedFromCalculation: false,
            classification: {
              categoryId: "other",
              label: "未分類",
              source: "fallback",
            },
          },
        ],
      }),
    });
  });
  await page.route(
    "**/api/bank/transactions/fallback-transaction/calculation",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          excludedFromCalculation: true,
        }),
      });
    },
  );
  await page.route(
    "**/api/classification/overrides/bank_transaction/fallback-transaction",
    async (route) => {
      overrideBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    },
  );
  await page.route("**/api/classification/rules", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    ruleBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ id: "user:new-rule", success: true }),
    });
  });

  await page.goto("/#/transactions");
  await page
    .getByRole("button", { name: "查看 每月家庭轉帳 活動詳情" })
    .click();
  await page
    .getByRole("checkbox", { name: "排除 每月家庭轉帳 的統計計算" })
    .click();

  const dialog = page.getByRole("dialog", { name: "排除統計計算" });
  await dialog.getByRole("combobox", { name: "分類" }).selectOption("misc");
  await dialog.getByRole("checkbox", { name: "同時新增分類規則" }).check();
  await dialog.getByRole("textbox").fill("每月家庭轉帳");
  await dialog.getByRole("button", { name: "確認排除" }).click();

  await expect(dialog).toBeHidden();
  expect(overrideBody).toEqual({ categoryId: "misc" });
  expect(ruleBody).toMatchObject({
    categoryId: "misc",
    targetType: "bank_transaction",
    field: "any_text",
    operator: "contains",
    pattern: "每月家庭轉帳",
    excludedFromCalculation: true,
  });
});

test("can modify an existing user rule while excluding a transaction", async ({
  page,
}) => {
  const month = taipeiMonth();
  let updatedRuleBody: Record<string, unknown> | undefined;

  await page.route("**/api/bank**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        accounts: [],
        transactions: [
          {
            id: "rule-transaction",
            connectorId: "cathaybk",
            accountId: "account-1",
            sourceId: "rule-source",
            postedDate: `${month}-09`,
            amount: -350,
            currency: "TWD",
            description: "固定轉帳",
            status: "posted",
            excludedFromCalculation: false,
            classification: {
              categoryId: "transfer",
              label: "轉帳",
              source: "user_rule",
              ruleId: "user:transfer-rule",
            },
          },
        ],
      }),
    });
  });
  await page.route(
    "**/api/bank/transactions/rule-transaction/calculation",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          excludedFromCalculation: true,
        }),
      });
    },
  );
  await page.route(
    "**/api/classification/rules/user%3Atransfer-rule",
    async (route) => {
      updatedRuleBody = route.request().postDataJSON() as Record<
        string,
        unknown
      >;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    },
  );

  await page.goto("/#/transactions");
  await page.getByRole("button", { name: "查看 固定轉帳 活動詳情" }).click();
  await page
    .getByRole("checkbox", { name: "排除 固定轉帳 的統計計算" })
    .click();

  const dialog = page.getByRole("dialog", { name: "排除統計計算" });
  await expect(
    dialog.getByRole("checkbox", { name: "同時修改目前分類規則" }),
  ).not.toBeChecked();
  await dialog.getByRole("checkbox", { name: "同時修改目前分類規則" }).check();
  await dialog.getByRole("button", { name: "確認排除" }).click();

  await expect(dialog).toBeHidden();
  expect(updatedRuleBody).toEqual({
    categoryId: "transfer",
    excludedFromCalculation: true,
  });
});

test("merges a matching invoice and counts an unmatched invoice as expense", async ({
  page,
}) => {
  const month = taipeiMonth();
  await page.route("**/api/bank**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        accounts: [
          {
            id: "card-1",
            connectorId: "sinopac",
            sourceId: "card-source-1",
            institutionName: "測試銀行",
            accountName: "測試信用卡",
            accountType: "credit",
            currency: "TWD",
          },
        ],
        transactions: [
          {
            id: "transaction-1",
            connectorId: "sinopac",
            accountId: "card-1",
            sourceId: "transaction-source-1",
            postedDate: `${month}-10`,
            authorizedAt: `${month}-10T12:00:00.000Z`,
            amount: -860,
            currency: "TWD",
            description: "信用卡消費",
            counterparty: "好食餐飲",
            status: "posted",
            excludedFromCalculation: false,
            classification: {
              categoryId: "food",
              label: "餐飲",
              source: "fallback",
            },
          },
        ],
      }),
    });
  });
  await page.route("**/api/invoices**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "invoice-matched",
          connectorId: "einvoice",
          sourceId: "invoice-source-1",
          invoiceDate: `${month}-10`,
          invoiceNumber: "AB12345678",
          sellerName: "好食餐飲有限公司",
          amount: 860,
          items: [],
        },
        {
          id: "invoice-unmatched",
          connectorId: "einvoice",
          sourceId: "invoice-source-2",
          invoiceDate: `${month}-08`,
          invoiceNumber: "CD12345678",
          sellerName: "未支援銀行商店",
          amount: 1490,
          items: [],
        },
      ]),
    });
  });

  await page.goto("/#/transactions");

  await expect(page.getByTestId("cash-flow-spending")).toHaveText("NT$2,350");

  await expect(page.getByRole("region", { name: /月收支$/ })).toContainText(
    "重複發票 NT$860",
  );

  const activityRows = page.locator("tbody tr");
  // 總帳去重：已併入刷卡的發票不再單獨列出。
  await expect(activityRows).toHaveCount(2);
  // 列表主標是清理後的商家名稱（交易對象），原始說明留在明細。
  const matchedActivityRow = activityRows.filter({
    has: page.getByRole("button", {
      name: "查看 好食餐飲 活動詳情",
      exact: true,
    }),
  });
  await expect(matchedActivityRow).toContainText("測試銀行");
  await expect(matchedActivityRow).toContainText("測試信用卡");
  await expect(matchedActivityRow).toContainText("已配對發票");
  await expect(matchedActivityRow).not.toContainText("好食餐飲有限公司");
  await expect(page.getByText(/另 1 筆重複已併入（見發票分頁）/)).toBeVisible();
  await expect(
    activityRows.filter({ hasText: "未支援銀行商店" }),
  ).toContainText("−NT$1,490");

  await page.getByRole("tab", { name: "發票" }).click();
  const sourceRows = page.getByTestId("source-row");
  await expect(sourceRows).toHaveCount(2);
  await expect(
    sourceRows
      .filter({ hasText: "好食餐飲有限公司" })
      .getByTestId("match-status"),
  ).toHaveText("已對應刷卡");
  await expect(
    sourceRows
      .filter({ hasText: "未支援銀行商店" })
      .getByTestId("match-status"),
  ).toHaveText("未對應");
  await page.getByRole("tab", { name: "信用卡" }).click();
  await expect(sourceRows).toHaveCount(1);
});

test("manually maps, manages, and separates a same-day invoice transaction on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const month = taipeiMonth();
  let mappings: Array<{
    invoiceId: string;
    transactionId: string | null;
    decision: "linked" | "separate";
    updatedAt: string;
  }> = [];

  await page.route("**/api/activity/invoice-mappings**", async (route) => {
    const request = route.request();
    const invoiceId = new URL(request.url()).pathname.split("/").at(-1)!;
    if (request.method() === "PUT") {
      const body = request.postDataJSON() as { transactionId: string };
      const preference = {
        invoiceId,
        transactionId: body.transactionId,
        decision: "linked" as const,
        updatedAt: new Date().toISOString(),
      };
      mappings = [preference];
      await route.fulfill({ json: preference });
      return;
    }
    if (request.method() === "DELETE") {
      const preference = {
        invoiceId,
        transactionId: null,
        decision: "separate" as const,
        updatedAt: new Date().toISOString(),
      };
      mappings = [preference];
      await route.fulfill({ json: preference });
      return;
    }
    await route.fulfill({ json: mappings });
  });
  await page.route("**/api/bank**", async (route) => {
    await route.fulfill({
      json: {
        accounts: [
          {
            id: "card-1",
            connectorId: "sinopac",
            sourceId: "card-source-1",
            institutionName: "測試銀行",
            accountName: "信用卡",
            accountType: "credit",
            currency: "TWD",
          },
        ],
        transactions: [
          {
            id: "synthetic-drink",
            connectorId: "sinopac",
            accountId: "card-1",
            sourceId: "transaction-source-1",
            postedDate: `${month}-06`,
            amount: 100,
            currency: "TWD",
            description: "測試飲料店",
            counterparty: "測試飲料店",
            status: "posted",
            excludedFromCalculation: false,
            classification: {
              categoryId: "food",
              label: "餐飲",
              source: "fallback",
            },
          },
          {
            id: "synthetic-meal",
            connectorId: "sinopac",
            accountId: "card-1",
            sourceId: "transaction-source-2",
            postedDate: `${month}-06`,
            amount: -250,
            currency: "TWD",
            description: "測試餐飲店",
            counterparty: "測試餐飲店",
            status: "posted",
            excludedFromCalculation: false,
            classification: {
              categoryId: "food",
              label: "餐飲",
              source: "fallback",
            },
          },
        ],
      },
    });
  });
  await page.route("**/api/invoices**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const invoice = {
      id: "invoice-1",
      connectorId: "einvoice",
      sourceId: "invoice-source-1",
      invoiceDate: `${month}-06T12:00:00.000Z`,
      invoiceNumber: "TEST-0001",
      sellerName: "合成發票商店",
      amount: 120,
    };
    await route.fulfill({
      json:
        path === "/api/invoices/invoice-1"
          ? {
              ...invoice,
              items: [
                {
                  id: "invoice-line-1",
                  sourceId: "invoice-line-source-1",
                  lineNumber: 1,
                  description: "測試品項",
                  quantity: 1,
                  unitPrice: 120,
                  amount: 120,
                },
              ],
            }
          : [invoice],
    });
  });

  await page.goto("/#/transactions");
  await page
    .getByRole("button", { name: "查看 合成發票商店 活動詳情" })
    .click();
  await expect(page.getByText("測試品項", { exact: true })).toBeVisible();
  await expect(page.getByText("尚未找到銀行／信用卡交易")).toBeVisible();
  await page.getByRole("button", { name: "配對交易" }).click();
  await expect(
    page.getByRole("heading", { name: "選擇候選交易" }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: /^測試飲料店 測試銀行/,
    })
    .click();
  await page.getByRole("button", { name: "下一步" }).click();
  await expect(
    page.getByRole("heading", { name: "確認合併這兩筆？" }),
  ).toBeVisible();
  await expect(page.getByText("差額 NT$20", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "確認配對" }).click();

  await expect(page.getByText("已完成配對，發票不再重複計算")).toBeVisible();
  // 已配對的交易以發票商家為準命名，並併入發票（總帳不再另列發票）。
  const mappedActivityRow = page.getByRole("button", {
    name: "查看 合成發票商店 活動詳情",
    exact: true,
  });
  await expect(mappedActivityRow).toHaveCount(1);
  await expect(mappedActivityRow).toContainText("測試銀行 · 信用卡");
  await expect(
    mappedActivityRow.locator("[data-category-label]"),
  ).toContainText("餐飲");
  await expect(mappedActivityRow).toContainText("已配對發票");
  await mappedActivityRow.click();
  const detail = page.getByRole("dialog", { name: "活動明細" });
  await expect(
    detail
      .getByText("銀行／信用卡原始名稱")
      .locator("..")
      .getByText("測試飲料店", { exact: true }),
  ).toBeVisible();
  await expect(
    detail
      .getByText("發票商家名稱")
      .locator("..")
      .getByText("合成發票商店", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "管理配對" }).click();
  await page.getByRole("button", { name: "解除並保持分開" }).click();
  await expect(page.getByText("已解除配對，兩筆活動將保持分開")).toBeVisible();
  // 解除後兩筆各自列出；交易主標是清理後的商家名稱（去掉尾端「店」）。
  await expect(
    page.getByRole("button", {
      name: "查看 合成發票商店 活動詳情",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "查看 測試飲料店 活動詳情", exact: true }),
  ).toBeVisible();
});

test("loads invoice line items only after opening an activity", async ({
  page,
}) => {
  const month = taipeiMonth();
  let detailRequests = 0;
  const invoice = {
    id: "lazy-invoice",
    connectorId: "einvoice",
    sourceId: "lazy-source",
    invoiceDate: `${month}-12T10:00:00.000Z`,
    invoiceNumber: "AB12345678",
    sellerName: "延遲載入商店",
    amount: 120,
  };
  await page.route("**/api/invoices**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/invoices/lazy-invoice") {
      detailRequests += 1;
      await route.fulfill({
        json: {
          ...invoice,
          items: [
            {
              id: "lazy-line",
              sourceId: "lazy-line-source",
              lineNumber: 1,
              description: "延遲載入品項",
              quantity: 1,
              unitPrice: 120,
              amount: 120,
            },
          ],
        },
      });
      return;
    }
    await route.fulfill({ json: [invoice] });
  });

  await page.goto("/#/transactions");
  const activity = page.getByRole("button", {
    name: "查看 延遲載入商店 活動詳情",
  });
  await expect(activity).toBeVisible();
  expect(detailRequests).toBe(0);

  await activity.click();
  await expect(page.getByText("延遲載入品項", { exact: true })).toBeVisible();
  expect(detailRequests).toBe(1);
});

test.describe("mobile chart tooltip", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test("dismisses on scroll and allows selecting a point again", async ({
    page,
  }) => {
    await page.route("**/api/history/net-worth/chart", async (route) => {
      await route.fulfill({
        json: [
          {
            date: "2026-08-13",
            netWorth: 2000000,
            assetType: "deposit",
            source: "bank",
          },
          {
            date: "2026-08-14",
            netWorth: 2200000,
            assetType: "deposit",
            source: "bank",
          },
        ],
      });
    });
    await page.goto("/#/assets"); // 資產走勢在資產頁頂
    await page.getByRole("tab", { name: "全部", exact: true }).click();
    const chart = page
      .getByRole("region", { name: "資產走勢" })
      .locator("[data-chart]");
    await chart.scrollIntoViewIfNeeded();
    await chart.tap({ position: { x: 150, y: 100 } });
    const tooltip = page.locator(".lc-tooltip-root");
    await expect(tooltip).toBeVisible();
    await page.evaluate(() => window.scrollBy(0, 120));
    await expect(tooltip).toBeHidden();
    await chart.scrollIntoViewIfNeeded();
    await chart.tap({ position: { x: 150, y: 100 } });
    await expect(tooltip).toBeVisible();
    await chart.dispatchEvent("pointercancel", { pointerType: "touch" });
    await expect(tooltip).toBeHidden();
  });
});

test("sets double-tap protection before app scripts and styles load", async ({
  page,
}) => {
  await page.route("**/*", async (route) => {
    if (["script", "stylesheet"].includes(route.request().resourceType())) {
      await route.abort();
      return;
    }
    await route.fallback();
  });
  await page.goto("/");
  for (const selector of ["html", "body", "#root"]) {
    await expect(page.locator(selector)).toHaveCSS(
      "touch-action",
      "manipulation",
    );
  }
  await expect(page.locator("html")).not.toHaveClass(/is-standalone/);
});

test("focuses asset categories without changing their total", async ({
  page,
}) => {
  await page.route("**/api/history/net-worth/chart", async (route) => {
    await route.fulfill({
      json: [
        {
          date: "2026-08-13",
          netWorth: 1800000,
          assetType: "stock",
          source: "investment",
        },
        {
          date: "2026-08-14",
          netWorth: 1900000,
          assetType: "stock",
          source: "investment",
        },
        {
          date: "2026-08-13",
          netWorth: 350000,
          assetType: "deposit",
          source: "bank",
        },
        {
          date: "2026-08-14",
          netWorth: 380000,
          assetType: "deposit",
          source: "bank",
        },
      ],
    });
  });
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto("/#/assets"); // 資產走勢在資產頁頂
  const chart = page.getByRole("region", { name: "資產走勢" });
  await page.getByRole("tab", { name: "全部", exact: true }).click();
  await page.getByRole("button", { name: "顯示設定" }).click();
  await page.getByRole("tab", { name: "分類", exact: true }).click();
  const legend = page.getByLabel("分類資產圖例");
  const stocks = legend.getByRole("button", { name: "股票/ETF NT$1,900,000" });
  await expect(legend.getByRole("button")).toHaveCount(2);
  await expect(chart.locator("g[opacity] > path")).toHaveCount(2);
  await stocks.click();
  await expect(stocks).toHaveAttribute("aria-pressed", "true");
  await expect(
    chart.locator("p").filter({ hasText: "NT$2,280,000" }),
  ).toBeVisible();
  await expect(chart.locator('g[opacity="0.2"]')).toHaveCount(1);
  await chart.locator("[data-chart]").hover({ position: { x: 180, y: 100 } });
  await expect(page.locator(".lc-tooltip-root")).toContainText("股票/ETF");
  await stocks.click();
  await expect(stocks).toHaveAttribute("aria-pressed", "false");
  await expect(chart.locator('g[opacity="0.2"]')).toHaveCount(0);
});
