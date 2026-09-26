import { expect, test, type Page, type Request } from "@playwright/test";
import type { ActivityItem } from "@taiwan-fin-hub/core";
import { summaryFixture } from "../src/testing/activity-summary";
import { routeNavigationApi } from "./activity-api";

/**
 * 交易頁的備註、「不計入」、商家名稱／品項與單層分類選單。活動列表與 summary
 * 直接回傳固定資料（含 note、displayName、itemsPreview 等讀取時才加上的欄位）。
 */
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

const month = taipeiMonth();

function activity(overrides: Partial<ActivityItem>): ActivityItem {
  return {
    id: "item",
    source: "card",
    date: `${month}-02`,
    title: "活動",
    subtitle: "",
    institutionName: "玉山銀行",
    accountName: "信用卡",
    amount: -100,
    currency: "TWD",
    category: "未分類",
    categoryId: "other",
    status: "posted",
    economicRole: "spending",
    reviewStatus: "auto",
    duplicateOf: null,
    investmentEventKind: null,
    roleReason: "sign",
    ...overrides,
  };
}

const items: ActivityItem[] = [
  activity({
    id: "tx-latte",
    transactionId: "tx-latte",
    invoiceId: "inv-latte",
    title: "連支＊路易莎咖啡-信義門市",
    displayName: "路易莎咖啡",
    itemsPreview: ["拿鐵", "可頌"],
    category: "餐飲",
    categoryId: "food",
    categorySource: "auto_suggestion",
    note: "請同事喝",
    noteTarget: { kind: "bank_transaction", id: "tx-latte" },
  }),
  activity({
    id: "tx-godaddy",
    transactionId: "tx-godaddy",
    date: `${month}-03`,
    title: "GODADDY.COM",
    amount: -600,
    category: "3C 數位",
    categoryId: "tech",
  }),
  activity({
    id: "inv-breakfast",
    source: "invoice",
    invoiceId: "inv-breakfast",
    date: `${month}-04`,
    title: "巷口早餐店",
    institutionName: "電子發票",
    accountName: "AB00000001",
    amount: 85,
    merchantKey: "ban:12345678",
    displayName: "巷口早餐店",
    roleReason: "invoice",
  }),
  activity({
    id: "inv-breakfast-2",
    source: "invoice",
    invoiceId: "inv-breakfast-2",
    date: `${month}-05`,
    title: "巷口早餐店",
    institutionName: "電子發票",
    amount: 60,
    merchantKey: "ban:12345678",
    roleReason: "invoice",
  }),
];

async function mockActivity(page: Page) {
  const writes: Request[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (request.method() !== "GET") {
      writes.push(request);
      return route.fulfill({ json: {} });
    }
    if (url.pathname === "/api/activity/items")
      return route.fulfill({
        json: { month, items, summary: summaryFixture(month) },
      });
    if (url.pathname === "/api/activity/summary")
      return route.fulfill({
        json: {
          months: [
            summaryFixture(month, { excludedAmount: 600, excludedCount: 1 }),
          ],
        },
      });
    return route.fulfill({
      json:
        url.pathname === "/api/runtime"
          ? { demoMode: false }
          : url.pathname === "/api/bank"
            ? { accounts: [], transactions: [] }
            : [],
    });
  });
  await routeNavigationApi(page);
  return writes;
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

test("shows names, items, notes and auto categories in the ledger", async ({
  page,
}) => {
  await mockActivity(page);
  await page.goto("/#/transactions");
  const latte = page.getByRole("button", {
    name: "查看 路易莎咖啡 活動詳情",
    exact: true,
  });
  const row = page.getByRole("table").getByRole("row").filter({ has: latte });
  await expect(latte).toBeVisible();
  await expect(row.locator("[data-activity-items]")).toHaveText("拿鐵、可頌");
  await expect(row.locator("[data-activity-note]")).toContainText(
    "📝 備註：請同事喝",
  );
  // 可改分類的 chip 以角落圓點標示自動分類（文字只給螢幕閱讀器）。
  await expect(row.locator("[data-category-auto]")).toHaveText("自動分類");
  await expect(
    row.getByRole("combobox", { name: "變更「路易莎咖啡」的分類" }),
  ).toContainText("🍜 餐飲");
  await expect(page.getByLabel("搜尋活動")).toHaveAttribute(
    "placeholder",
    /含備註/,
  );
  await expect(page.getByRole("region", { name: /收支$/ })).toContainText(
    "不計入 NT$600",
  );
});

test("autosaves a note and marks a charge as 不計入 with a reason", async ({
  page,
}) => {
  const writes = await mockActivity(page);
  await page.goto("/#/transactions");
  await page
    .getByRole("table")
    .getByRole("button", { name: "查看 GODADDY.COM 活動詳情" })
    .click();
  const detail = page.getByRole("dialog", { name: "活動明細" });
  const note = detail.getByRole("textbox", { name: "GODADDY.COM 的備註" });
  await note.fill("SSL 自動續約");
  await expect(detail.getByText("已儲存")).toBeVisible();
  const saved = writes.find((request) =>
    request.url().endsWith("/api/activity/notes/bank_transaction/tx-godaddy"),
  );
  expect(saved?.method()).toBe("PUT");
  expect(saved?.postDataJSON()).toEqual({ note: "SSL 自動續約" });

  await detail
    .getByRole("button", { name: "不計入（未實際付款、已作廢）" })
    .click();
  const reason = page.getByRole("dialog", {
    name: "這筆是「不計入（未實際付款、已作廢）」",
  });
  await reason
    .getByLabel("原因（選填，會存成備註）")
    .fill("SSL 自動續約，實際未扣款");
  await reason.getByRole("button", { name: "確定" }).click();
  await expect(reason).toBeHidden();
  const override = writes.find((request) =>
    request
      .url()
      .endsWith("/api/activity/role-overrides/bank_transaction/tx-godaddy"),
  );
  expect(override?.postDataJSON()).toEqual({
    economicRole: "excluded",
    note: "SSL 自動續約，實際未扣款",
  });
});

test("categorizes a cash invoice and remembers the seller", async ({
  page,
}) => {
  const writes = await mockActivity(page);
  await page.goto("/#/transactions");
  // 列表依日期新到舊：最後一個 chip 是 inv-breakfast（4 日）。
  const chip = page
    .getByRole("combobox", { name: "變更「巷口早餐店」的分類" })
    .last();
  await chip.selectOption("food");
  const prompt = page.getByTestId("merchant-category-prompt");
  await expect(prompt).toHaveText(
    "將『巷口早餐店』的其他 1 筆也設為「餐飲」，並記住這個商家？",
  );
  await page.getByRole("button", { name: "套用並記住" }).click();
  await expect(prompt).toBeHidden();
  const categorize = writes
    .filter((request) => request.url().endsWith("/api/activity/categorize"))
    .map((request) => request.postDataJSON());
  expect(categorize).toEqual([
    {
      targets: [
        { kind: "invoice", id: "inv-breakfast", merchantKey: "ban:12345678" },
      ],
      categoryId: "food",
      applyToMerchant: false,
    },
    {
      targets: [
        { kind: "invoice", id: "inv-breakfast", merchantKey: "ban:12345678" },
      ],
      categoryId: "food",
      applyToMerchant: true,
    },
  ]);
});
