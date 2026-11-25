import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { InvestmentPerformance } from "@taiwan-fin-hub/shared";
import { investmentRoutes } from "../../../src/features/investments/route";
import { honoFactory } from "../../../src/platform/hono";
import { apiErrorResponse } from "../../../src/platform/http";
import type { Env } from "../../../src/platform/env";
import { createTestD1 } from "../../helpers/d1";

// 合成資料：虛構券商帳號。
const KEY = "1234:7654321:0056";

describe("investment performance API", () => {
  let harness: Awaited<ReturnType<typeof createTestD1>>;
  let env: Env;
  const app = honoFactory.createApp();
  app.route("/api", investmentRoutes);
  app.onError(apiErrorResponse);

  beforeAll(async () => {
    harness = await createTestD1();
    env = { DB: harness.binding } as Env;
  }, 60_000);
  afterAll(async () => {
    await harness?.mf.dispose();
  });

  const send = (method: string, path: string, body?: unknown) =>
    app.request(
      path,
      {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      env,
    );

  it("沒有投資資料時回傳空的績效", async () => {
    const response = await app.request("/api/investments/performance", {}, env);
    expect(response.status).toBe(200);
    const body = (await response.json()) as InvestmentPerformance;
    expect(body).toMatchObject({
      asOfDate: null,
      holdings: [],
      closed: [],
      pricesPending: false,
      totals: { marketValue: 0, costBasis: 0, dividends: 0 },
    });
  });

  it("期初成本以編碼後的 key 設定與清除", async () => {
    const path = `/api/investments/opening-costs/${encodeURIComponent(KEY)}`;
    expect((await send("PUT", path, { cost: 20_000 })).status).toBe(200);
    const stored = await harness.binding
      .prepare("SELECT holding_key, cost FROM investment_opening_costs")
      .all();
    expect(stored.results).toEqual([{ holding_key: KEY, cost: 20_000 }]);
    expect((await send("DELETE", path)).status).toBe(200);
    const cleared = await harness.binding
      .prepare("SELECT count(*) AS n FROM investment_opening_costs")
      .first<{ n: number }>();
    expect(cleared?.n).toBe(0);
  });

  it("拒絕非正整數的成本與格式不對的 key", async () => {
    const path = `/api/investments/opening-costs/${encodeURIComponent(KEY)}`;
    expect((await send("PUT", path, { cost: 0 })).status).toBe(400);
    expect((await send("PUT", path, { cost: 12.5 })).status).toBe(400);
    expect(
      (await send("PUT", "/api/investments/opening-costs/0056", { cost: 1 }))
        .status,
    ).toBe(400);
  });
});
