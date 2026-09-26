import { expect, test, type Page } from "@playwright/test";
import type { ActivityItem } from "@taiwan-fin-hub/core";
import { routeActivityApi } from "./activity-api";

async function mockSearch(
  page: Page,
  items: ActivityItem[],
  options = { failNext: false },
) {
  const requests: URL[] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (url.pathname === "/api/activity/search") {
      requests.push(url);
      if (options.failNext && url.searchParams.has("cursor"))
        return route.fulfill({
          status: 500,
          json: { error: { code: "FAILED", message: "搜尋暫時失敗" } },
        });
      const filtered = items.filter(
        (item) =>
          item.title
            .toLowerCase()
            .includes((url.searchParams.get("q") ?? "").toLowerCase()) &&
          (!url.searchParams.get("from") ||
            item.date >= url.searchParams.get("from")!) &&
          (!url.searchParams.get("to") ||
            item.date <= url.searchParams.get("to")!) &&
          (url.searchParams.get("source") !== "invoice" || item.invoiceId),
      );
      const offset = Number(url.searchParams.get("cursor") ?? 0);
      const visible = filtered.slice(offset, offset + 30);
      return route.fulfill({
        json: {
          items: visible,
          bank: { accounts: [], transactions: [] },
          invoices: [],
          trades: [],
          nextCursor:
            offset + 30 < filtered.length ? String(offset + 30) : null,
        },
      });
    }
    return route.fulfill({
      json:
        url.pathname === "/api/runtime"
          ? { demoMode: true }
          : url.pathname === "/api/bank"
            ? { accounts: [], transactions: [] }
            : [],
    });
  });
  await routeActivityApi(page);
  return requests;
}
const gas = (index: number): ActivityItem => ({
  id: `gas-${index}`,
  source: "card",
  date: `${2026 - Math.floor(index / 12)}-${String(12 - (index % 12)).padStart(2, "0")}-28`,
  title: "全國加油站昌平站",
  subtitle: "玉山信用卡",
  institutionName: "玉山銀行",
  accountName: "信用卡",
  amount: -131,
  currency: "TWD",
  category: "交通",
  status: "posted",
});

for (const width of [1440, 390, 320]) {
  test(`explicit search preserves history and filters at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const requests = await mockSearch(page, [
      {
        ...gas(0),
        id: "recent",
        source: "invoice",
        title: "AIRBNB stay",
        date: "2025-12-15",
        invoiceId: "invoice",
      },
      { ...gas(1), id: "old", title: "AIRBNB stay", date: "2024-06-15" },
    ]);
    await page.goto("/#/transactions");
    const month = page.getByLabel("選擇活動月份");
    await month.selectOption({ index: 1 });
    const selected = await month.inputValue();
    const roleFilter = page.getByRole("combobox", { name: "活動角色" });
    await roleFilter.selectOption("spending");
    await expect(page).toHaveURL(/role=spending/);
    const search = page.getByRole("searchbox", { name: "搜尋活動" });
    await search.fill("airbnb");
    await page.waitForTimeout(500); // Typing must not trigger the former debounce.
    expect(requests).toHaveLength(0);
    await expect(month).toHaveValue(selected);
    await search.press("Enter");
    await expect(
      page.getByRole("heading", { name: "已載入 2 筆", exact: true }),
    ).toBeVisible();
    expect(requests).toHaveLength(1);
    await expect(
      page.getByRole("button", { name: "載入更多", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "查看 AIRBNB stay 活動詳情" })
      .filter({ visible: true })
      .first()
      .click();
    await expect(
      page.getByRole("heading", { name: "活動明細", exact: true }),
    ).toBeVisible();
    await page.goBack();
    await expect(
      page.getByRole("heading", { name: "活動明細", exact: true }),
    ).toHaveCount(0);
    await expect(search).toHaveValue("airbnb");
    await page.goBack();
    await expect(month).toHaveValue(selected);
    await expect(roleFilter).toHaveValue("spending");
    await expect(search).toHaveValue("");
    await page.goForward();
    await expect(search).toHaveValue("airbnb");
    // 來源改為分頁：發票分頁只列發票紀錄，搜尋 API 也帶 source=invoice。
    await page.getByRole("tab", { name: "發票", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "已載入 1 筆", exact: true }),
    ).toBeVisible();
    expect(requests.at(-1)?.searchParams.get("source")).toBe("invoice");
    await page.getByRole("button", { name: "清空搜尋，返回月報" }).click();
    await expect(month).toHaveValue(selected);
    await page.getByRole("tab", { name: "總帳", exact: true }).click();
    await search.fill("airbnb");
    await search.press("Enter");
    // 搜尋時間範圍收在「篩選」（桌面為 popover、手機為 sheet）。
    await page.getByRole("button", { name: "篩選", exact: true }).click();
    await page
      .getByLabel("搜尋時間範圍")
      .filter({ visible: true })
      .selectOption("custom");
    await page
      .getByLabel("搜尋開始日期")
      .filter({ visible: true })
      .fill("2024-06-15");
    await page
      .getByLabel("搜尋結束日期")
      .filter({ visible: true })
      .fill("2024-06-15");
    await page.getByRole("button", { name: "查看結果", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "已載入 1 筆", exact: true }),
    ).toBeVisible();
    await search.fill("nothing");
    await page.waitForTimeout(500);
    expect(
      requests.some((url) => url.searchParams.get("q") === "nothing"),
    ).toBe(false);
    await expect(
      page.getByRole("heading", { name: "搜尋「airbnb」", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "搜尋", exact: true }).click();
    await expect(
      page
        .getByText("沒有符合條件的活動。", { exact: true })
        .filter({ visible: true }),
    ).toBeVisible();
    await search.fill("");
    await expect(month).toHaveValue(selected);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
  });
}
for (const total of [7, 30, 65]) {
  test(`one request per 30-result batch with ${total} cross-month matches`, async ({
    page,
  }) => {
    const requests = await mockSearch(
      page,
      Array.from({ length: total }, (_, i) => gas(i)),
    );
    await page.goto("/#/transactions");
    await page.getByRole("searchbox", { name: "搜尋活動" }).fill("加油");
    await page.getByRole("button", { name: "搜尋", exact: true }).click();
    await expect(
      page.getByRole("heading", {
        name: `已載入 ${Math.min(total, 30)} 筆`,
        exact: true,
      }),
    ).toBeVisible();
    await page.waitForTimeout(500); // No automatic monthly follow-up requests.
    expect(requests).toHaveLength(1);
    const more = page.getByTestId("search-load-more");
    if (total > 30) {
      await more.scrollIntoViewIfNeeded();
      await expect(
        page.getByRole("heading", { name: "已載入 60 筆", exact: true }),
      ).toBeVisible();
      expect(requests).toHaveLength(2);
      await more.scrollIntoViewIfNeeded();
      await expect(
        page.getByRole("heading", { name: "已載入 65 筆", exact: true }),
      ).toBeVisible();
      expect(requests).toHaveLength(3);
    }
    await expect(more).toHaveCount(0);
  });
}
test("failed next batch retains results and can be retried", async ({
  page,
}) => {
  const options = { failNext: true };
  const requests = await mockSearch(
    page,
    Array.from({ length: 35 }, (_, i) => gas(i)),
    options,
  );
  await page.goto("/#/transactions");
  await page.getByRole("searchbox", { name: "搜尋活動" }).fill("加油");
  await page.getByRole("button", { name: "搜尋", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "已載入 30 筆", exact: true }),
  ).toBeVisible();
  await page.getByTestId("search-load-more").scrollIntoViewIfNeeded();
  await expect(page.getByRole("alert")).toContainText("部分資料載入失敗", {
    timeout: 15000,
  });
  await expect(
    page.getByRole("heading", { name: "已載入 30 筆", exact: true }),
  ).toBeVisible();
  const failedRequestCount = requests.length;
  await page.waitForTimeout(500);
  expect(requests).toHaveLength(failedRequestCount);
  options.failNext = false;
  await page.getByRole("button", { name: "重試載入更多", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "已載入 35 筆", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("monthly search filters selected month without global requests", async ({
  page,
}) => {
  const requests = await mockSearch(page, []);
  // 所有活動都在本月（台北時間）；切到上個月時應看不到。
  const month = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
  })
    .format(new Date())
    .slice(0, 7);
  await page.route("**/api/bank**", async (route) => {
    await route.fulfill({
      json: {
        accounts: [
          {
            id: "card",
            connectorId: "esun",
            sourceId: "card",
            currency: "TWD",
            accountType: "credit_card",
          },
        ],
        transactions: ["咖啡", "午餐"].map((description, index) => ({
          id: `monthly-${index}`,
          connectorId: "esun",
          accountId: "card",
          sourceId: `monthly-${index}`,
          postedDate: `${month}-01`,
          amount: -100 - index,
          currency: "TWD",
          description,
          status: "posted",
        })),
      },
    });
  });
  await page.goto("/#/transactions");
  const coffee = page
    .getByRole("button", { name: "查看 咖啡 活動詳情" })
    .filter({ visible: true });
  const lunch = page
    .getByRole("button", { name: "查看 午餐 活動詳情" })
    .filter({ visible: true });
  await expect(coffee).toBeVisible();
  await expect(lunch).toBeVisible();
  const search = page.getByRole("searchbox", { name: "搜尋活動" });
  await search.fill("咖啡");
  await expect(coffee).toBeVisible();
  await expect(lunch).toHaveCount(0);
  await page.getByLabel("選擇活動月份").selectOption({ index: 1 });
  await expect(coffee).toHaveCount(0);
  await page.getByLabel("選擇活動月份").selectOption({ index: 0 });
  await expect(coffee).toBeVisible();
  await search.fill("");
  await expect(lunch).toBeVisible();
  expect(requests).toHaveLength(0);
});
