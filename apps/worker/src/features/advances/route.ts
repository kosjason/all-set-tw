import type { Hono } from "hono";
import type { AppBindings } from "../../platform/env";
import { honoFactory } from "../../platform/hono";
import { getAdvances } from "./service";

export const advanceRoutes = honoFactory.createApp();
registerAdvanceRoutes(advanceRoutes);

function registerAdvanceRoutes(api: Hono<AppBindings>) {
  // 代墊待收回：依對象彙總全部代墊與收回代墊，含各筆明細。
  api.get("/activity/advances", async (c) =>
    c.json(await getAdvances(c.env.DB)),
  );
}
