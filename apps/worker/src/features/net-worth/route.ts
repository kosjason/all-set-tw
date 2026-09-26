import type { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { AppBindings } from "../../platform/env";
import { honoFactory } from "../../platform/hono";
import { validationHook } from "../../platform/validation";
import {
  encodePageCursor,
  parseKeysetPagination,
  setKeysetPaginationHeaders,
} from "../../platform/http";
import {
  getNetWorthChartHistory,
  getNetWorthPage,
  rebuildBankDepositHistoryRange,
  refreshBankDepositHistory,
} from "./service";

const netWorthPageCursorSchema = z.object({
  date: z.string(),
  source: z.string(),
  assetType: z.string(),
  id: z.string(),
});

const bankHistoryRebuildBodySchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const netWorthRoutes = honoFactory.createApp();
registerNetWorthRoutes(netWorthRoutes);

function registerNetWorthRoutes(api: Hono<AppBindings>) {
  api.get("/history/net-worth/chart", async (c) =>
    c.json(await getNetWorthChartHistory(c.env.DB)),
  );

  api.get("/history/net-worth", async (c) => {
    const { limit, cursor } = parseKeysetPagination(
      c.req.query(),
      netWorthPageCursorSchema,
      100,
    );
    const page = await getNetWorthPage(c.env.DB, limit, cursor);
    setKeysetPaginationHeaders((name, value) => c.header(name, value), {
      hasMore: page.hasMore,
      nextCursor:
        page.hasMore && page.last
          ? encodePageCursor({
              date: page.last.date,
              source: page.last.source,
              assetType: page.last.assetType,
              id: page.last.id,
            })
          : undefined,
    });
    return c.json(page.history);
  });

  api.post(
    "/history/net-worth/rebuild-bank",
    zValidator(
      "json",
      bankHistoryRebuildBodySchema,
      validationHook("INVALID_REQUEST", "from/to must use YYYY-MM-DD"),
    ),
    async (c) => {
      const body = c.req.valid("json");
      return c.json({
        success: true,
        ...(await rebuildBankDepositHistoryRange(c.env.DB, body.from, body.to)),
      });
    },
  );

  // 由交易明細推算第一筆真實快照之前的每日存款餘額，並把存款歷史重算到今天。
  // 回應只含帳戶末四碼、日期、天數與方法，不含金額。
  api.post("/history/net-worth/backfill", async (c) => {
    const { backfill, history } = await refreshBankDepositHistory(c.env.DB);
    return c.json({
      success: backfill !== null,
      history,
      derivedSnapshots: backfill?.derivedSnapshots ?? 0,
      accounts: (backfill?.accounts ?? []).map(
        ({ accountId: _accountId, ...report }) => report,
      ),
    });
  });
}
