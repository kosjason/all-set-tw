import { expect, test } from "@playwright/test";
for (const width of [1440, 390])
  test(`bank verification feedback at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const job = {
      id: "nextbank:all",
      connectorId: "nextbank",
      scope: "all",
      configured: true,
      enabled: false,
      running: false,
      scheduleMode: "custom",
      intervalMinutes: 10080,
      preferredTime: "06:00",
      preferredWeekday: 1,
      preferredWeekdays: [1, 3, 5],
      lastStatus: "failed",
      lastError: "將來銀行 API：transport",
      lastRunAt: "2026-09-28T01:05:00Z",
      lastSuccessAt: "2026-09-27T01:05:00Z",
    };
    let captchaCalls = 0;
    let recover = false;
    let syncCalls = 0;
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (!path.startsWith("/api/")) return route.continue();
      if (path === "/api/connectors/nextbank/sync") {
        syncCalls++;
        return route.fulfill({
          status: 400,
          json: {
            error: {
              code: "NEXTBANK_CAPTCHA_REQUIRED",
              message: "請重新取得圖片。",
            },
          },
        });
      }
      if (path === "/api/connectors/nextbank/captcha") {
        captchaCalls++;
        if (recover)
          return route.fulfill({
            json: {
              captchaImage:
                "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1sAAAAASUVORK5CYII=",
              expiresAt: new Date(Date.now() + 120000).toISOString(),
              captchaLength: 5,
              captchaKind: "alphanumeric",
            },
          });
        return route.fulfill({
          status: 502,
          json: {
            error: {
              code: "TEST_TRANSPORT",
              message: "將來銀行 API：transport",
            },
          },
        });
      }
      const data =
        path === "/api/runtime"
          ? { demoMode: false }
          : path === "/api/sync-reports/latest"
            ? null
            : path === "/api/bank"
              ? { accounts: [], transactions: [] }
              : path === "/api/sync-jobs"
                ? [job]
                : path.endsWith("/settings")
                  ? {
                      configured: true,
                      credentialsComplete: true,
                      sessionAvailable: false,
                    }
                  : path === "/api/sync-schedule"
                    ? {
                        intervalMinutes: 10080,
                        preferredTime: "06:00",
                        preferredWeekday: 1,
                        preferredWeekdays: [1, 3, 5],
                      }
                    : path === "/api/notifications/config"
                      ? { enabled: false }
                      : [];
      await route.fulfill({ json: data });
    });
    await page.goto("/#/data-sources");
    // 桌面是精簡卡片「管理將來銀行」，手機是卡片上的「管理將來銀行設定」。
    await page
      .getByRole("button", { name: /^管理將來銀行(設定)?$/ })
      .first()
      .click();
    const progress = page.getByRole("region", { name: "同步進度" });
    await expect(progress).toContainText("最近同步結果：失敗");
    await expect(progress).toContainText("最近成功更新：");
    await page
      .getByRole("button", { name: "改用手動驗證", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("無法取得驗證碼");
    await expect(page.getByRole("alert")).toContainText(
      "手動驗證無法解決連線問題",
    );
    expect(captchaCalls).toBe(1);
    recover = true;
    await page.getByRole("button", { name: "同步帳戶", exact: true }).click();
    await expect(
      page.getByRole("img", { name: "將來圖形驗證碼" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "驗證並同步", exact: true }),
    ).toBeDisabled();
    expect(syncCalls).toBe(1);
    expect(captchaCalls).toBe(2);
    const imageY = (await page
      .getByRole("img", { name: "將來圖形驗證碼" })
      .boundingBox())!.y;
    const helpY = (await page
      .locator("summary:visible")
      .filter({ hasText: "使用說明" })
      .boundingBox())!.y;
    expect(imageY).toBeLessThan(helpY);
    await progress.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath("bank-verification.png"),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });

for (const source of [
  {
    id: "einvoice",
    title: "電子發票",
    scope: "all",
    path: "/api/connectors/einvoice/sync",
  },
  {
    id: "tdcc",
    title: "集保 e 存摺",
    scope: "bank",
    path: "/api/connectors/tdcc/sync/bank",
  },
]) {
  test(`${source.title} 停滯 run 可重試，沿用 scope 並追蹤到完成`, async ({
    page,
  }) => {
    const job = {
      id: `${source.id}:all`,
      connectorId: source.id,
      scope: "all",
      configured: true,
      enabled: false,
      running: true,
      phase: "stalled",
      runId: "existing-run",
      lockScope: source.scope,
      lastProgressAt: "2026-09-28T01:00:00Z",
      retryAfterSeconds: 0,
      scheduleMode: "custom",
      intervalMinutes: 1440,
      preferredTime: "06:00",
      preferredWeekday: 1,
      lastStatus: null as string | null,
      lastError: null,
      lastRunAt: null as string | null,
      lastSuccessAt: null as string | null,
    };
    let syncCalls = 0;
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (!path.startsWith("/api/")) return route.continue();
      if (path === source.path) {
        syncCalls++;
        job.phase = source.id === "tdcc" ? "bank" : "processing";
        return route.fulfill({
          status: 202,
          json: {
            success: true,
            connectorId: source.id,
            scope: source.scope,
            status: "queued",
            runId: "existing-run",
          },
        });
      }
      const data =
        path === "/api/runtime"
          ? { demoMode: false }
          : path === "/api/sync-jobs"
            ? [job]
            : path.endsWith("/settings")
              ? {
                  configured: true,
                  credentialsComplete: true,
                  sessionAvailable: job.lastStatus === "success",
                }
              : path === "/api/sync-schedule"
                ? {
                    intervalMinutes: 1440,
                    preferredTime: "06:00",
                    preferredWeekday: 1,
                  }
                : path === "/api/notifications/config"
                  ? { enabled: false }
                  : path === "/api/bank"
                    ? { accounts: [], transactions: [] }
                    : path === "/api/sync-reports/latest"
                      ? null
                      : [];
      return route.fulfill({ json: data });
    });
    await page.goto("/#/data-sources");
    await page
      .getByRole("button", { name: `管理${source.title}`, exact: true })
      .click();
    const details = page.getByRole("region", { name: "連接器詳情" });
    const retry = details.getByRole("button", {
      name: "重試同步",
      exact: true,
    });
    await expect(retry).toBeEnabled();
    await retry.click();
    await expect(
      details.getByText(
        source.id === "tdcc" ? "狀態：正在查詢銀行資料" : "狀態：同步中",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(retry).toHaveCount(0);
    job.running = false;
    job.lastStatus = "success";
    job.lastRunAt = "2026-09-28T01:05:00Z";
    job.lastSuccessAt = job.lastRunAt;
    await expect(
      details.getByText("狀態：正常", { exact: true }),
    ).toBeVisible();
    expect(syncCalls).toBe(1);
  });
}
