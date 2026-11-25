import type { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { AppBindings } from "../../platform/env";
import { honoFactory } from "../../platform/hono";
import {
  encodePageCursor,
  parseKeysetPagination,
  setKeysetPaginationHeaders,
} from "../../platform/http";
import {
  monthRangeQuerySchema,
  resolveMonthDateRange,
} from "../../platform/month-range";
import { validationHook } from "../../platform/validation";
import {
  clearInvestmentOpeningCost,
  getInvestmentPerformance,
  setInvestmentOpeningCost,
} from "./performance-service";
import {
  getInvestmentPage,
  getInvestmentTransactionPage,
  getInvestmentTransactionsRange,
} from "./service";

const investmentPageCursorSchema = z.object({
  asOfDate: z.string(),
  assetType: z.string(),
  name: z.string(),
  id: z.string(),
});

const openingCostKeySchema = z.object({
  key: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[^\s:]+:[^\s:]+:[^\s:]+$/u),
});

const openingCostBodySchema = z
  .object({ cost: z.number().int().min(1).max(10_000_000_000) })
  .strict();

const transactionPageCursorSchema = z.object({
  effectiveDate: z.string(),
  updatedAt: z.string(),
  id: z.string(),
});

export const investmentRoutes = honoFactory.createApp();
registerInvestmentRoutes(investmentRoutes);

function registerInvestmentRoutes(api: Hono<AppBindings>) {
  // 持股的本金、損益與配息；收盤價只讀快取（由排程補抓）。
  api.get("/investments/performance", async (c) =>
    c.json(await getInvestmentPerformance(c.env.DB)),
  );

  api.put(
    "/investments/opening-costs/:key",
    zValidator(
      "param",
      openingCostKeySchema,
      validationHook("INVALID_REQUEST", "找不到這個持股。"),
    ),
    zValidator(
      "json",
      openingCostBodySchema,
      validationHook("INVALID_REQUEST", "請輸入正整數的成本金額。"),
    ),
    async (c) => {
      await setInvestmentOpeningCost(
        c.env.DB,
        c.req.valid("param").key,
        c.req.valid("json").cost,
      );
      return c.body(null, 204);
    },
  );

  api.delete(
    "/investments/opening-costs/:key",
    zValidator(
      "param",
      openingCostKeySchema,
      validationHook("INVALID_REQUEST", "找不到這個持股。"),
    ),
    async (c) => {
      await clearInvestmentOpeningCost(c.env.DB, c.req.valid("param").key);
      return c.body(null, 204);
    },
  );

  api.get("/investments", async (c) => {
    const { limit, cursor } = parseKeysetPagination(
      c.req.query(),
      investmentPageCursorSchema,
      100,
    );
    const page = await getInvestmentPage(c.env.DB, limit, cursor);
    setKeysetPaginationHeaders((name, value) => c.header(name, value), {
      hasMore: page.hasMore,
      nextCursor:
        page.hasMore && page.last
          ? encodePageCursor({
              asOfDate: page.last.asOfDate,
              assetType: page.last.assetType,
              name: page.last.name,
              id: page.last.id,
            })
          : undefined,
    });
    return c.json(page.positions);
  });

  api.get(
    "/investment-transactions",
    zValidator(
      "query",
      monthRangeQuerySchema,
      validationHook("INVALID_REQUEST", "Invalid month range."),
    ),
    async (c) => {
      const range = resolveMonthDateRange(c.req.valid("query"));
      if (range)
        return c.json(await getInvestmentTransactionsRange(c.env.DB, range));

      const { limit, cursor } = parseKeysetPagination(
        c.req.query(),
        transactionPageCursorSchema,
        100,
      );
      const page = await getInvestmentTransactionPage(c.env.DB, limit, cursor);
      setKeysetPaginationHeaders((name, value) => c.header(name, value), {
        hasMore: page.hasMore,
        nextCursor:
          page.hasMore && page.last
            ? encodePageCursor({
                effectiveDate: page.last.effectiveDate,
                updatedAt: page.last.updatedAt,
                id: page.last.id,
              })
            : undefined,
      });
      return c.json(page.transactions);
    },
  );
}
