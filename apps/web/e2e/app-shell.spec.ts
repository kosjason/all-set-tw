import { expect, test } from "@playwright/test";
import { routeActivityApi, routeNavigationApi } from "./activity-api";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith("/api/")) {
      await route.continue();
      return;
    }
    let body: unknown;
    if (path === "/api/runtime") body = { demoMode: true };
    else if (path === "/api/bank") body = { accounts: [], transactions: [] };
    else if (path.startsWith("/api/bank/")) body = [];
    else if (path === "/api/investments") body = [];
    else if (path === "/api/investment-transactions") body = [];
    else if (path === "/api/invoices") body = [];
    else if (path === "/api/activity/invoice-mappings") body = [];
    else if (path === "/api/activity/advances")
      body = {
        since: null,
        counterparties: [],
        outstanding: {},
        complete: true,
        incompleteReasons: [],
      };
    else if (path === "/api/manual-assets") body = [];
    else if (path === "/api/exchange-rates") body = [];
    else if (path === "/api/classification/categories") body = [];
    else if (path === "/api/history/net-worth/chart") body = [];
    else throw new Error(`Unexpected API request in app-shell test: ${path}`);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  await routeActivityApi(page);
  await routeNavigationApi(page);
});

test("概況欄在 1680px 以上常駐，較窄時為抽屜並管理焦點", async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 900 });
  await page.goto("/#/month");
  const rail = page.getByRole("complementary", { name: "概況" });
  await expect(rail).toBeVisible();
  await expect(rail.getByText("目前沒有待處理的事項。")).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(rail).toBeHidden();
  const toggle = page.getByRole("button", { name: "開啟概況欄" });
  await toggle.click();
  const drawer = page.getByRole("dialog", { name: "概況" });
  await expect(drawer).toBeVisible();
  await expect(page.getByRole("button", { name: "關閉概況欄" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(toggle).toBeFocused();

  // 抽屜開著時跨出 1280–1679px：自動關閉，焦點不留在已移除的元素上。
  await toggle.click();
  await expect(drawer).toBeVisible();
  await page.setViewportSize({ width: 1000, height: 900 });
  await expect(drawer).toBeHidden();
  await expect(page.locator("main")).toBeFocused();

  await page.setViewportSize({ width: 1440, height: 900 });
  await toggle.click();
  await expect(drawer).toBeVisible();
  await page.setViewportSize({ width: 1800, height: 900 });
  await expect(drawer).toBeHidden();
  await expect(rail).toBeVisible();
});
