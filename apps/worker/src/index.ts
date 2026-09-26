import { activityRoutes } from "./features/activity/route";
import { activityNoteRoutes } from "./features/activity-notes/route";
import { activityRoleRoutes } from "./features/activity-roles/route";
import { bankCalculationRoutes } from "./features/bank/calculation-route";
import { bankRoutes } from "./features/bank/route";
import { cardRoutes } from "./features/cards/route";
import { classificationRoutes } from "./features/classification/route";
import { connectorRoutes } from "./features/connectors/route";
import { dashboardRoutes } from "./features/dashboard/route";
import { exchangeRateRoutes } from "./features/exchange-rates/route";
import { inboxRoutes } from "./features/inbox/route";
import { investmentRoutes } from "./features/investments/route";
import { invoiceRoutes } from "./features/invoices/route";
import { manualAssetRoutes } from "./features/manual-assets/route";
import { merchantRoutes } from "./features/merchants/route";
import { netWorthRoutes } from "./features/net-worth/route";
import { ensureScheduledBankDepositHistory } from "./features/net-worth/service";
import { notificationRoutes } from "./features/notifications/route";
import { ocrRoutes } from "./features/ocr/route";
import { ownAccountRoutes } from "./features/own-accounts/route";
import { syncRoutes } from "./features/sync/route";
import { syncScheduleRoutes } from "./features/sync/schedule-route";
import {
  consumeScheduledSyncQueue,
  enqueueScheduledSync,
} from "./features/sync/scheduler-queue";
import { accessMiddleware } from "./middleware/access";
import { connectorContextMiddleware } from "./middleware/connector-context";
import type { Env, ScheduledSyncQueueMessage } from "./platform/env";
import { honoFactory } from "./platform/hono";
import { apiErrorResponse, demoReadOnlyMiddleware } from "./platform/http";

export const app = honoFactory.createApp();
export const api = honoFactory.createApp();

api.use("*", accessMiddleware);
api.use("*", demoReadOnlyMiddleware);
api.use("/connectors/:connectorId/*", connectorContextMiddleware);

api.route("/", manualAssetRoutes);
api.route("/", exchangeRateRoutes);
api.route("/", invoiceRoutes);
api.route("/", classificationRoutes);
api.route("/", ownAccountRoutes);
api.route("/", activityRoutes);
api.route("/", activityRoleRoutes);
api.route("/", activityNoteRoutes);
api.route("/", merchantRoutes);
api.route("/", bankCalculationRoutes);
api.route("/", dashboardRoutes);
api.route("/", ocrRoutes);
api.route("/", investmentRoutes);
api.route("/", bankRoutes);
api.route("/", cardRoutes);
api.route("/", inboxRoutes);
api.route("/", netWorthRoutes);
api.route("/", notificationRoutes);
api.route("/", connectorRoutes);
api.route("/", syncScheduleRoutes);
api.route("/", syncRoutes);

api.onError(apiErrorResponse);
app.route("/api", api);
app.get("*", async (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(enqueueScheduledSync(env));
    ctx.waitUntil(ensureScheduledBankDepositHistory(env));
  },
  async queue(batch: MessageBatch<ScheduledSyncQueueMessage>, env) {
    await consumeScheduledSyncQueue(batch, env);
  },
} satisfies ExportedHandler<Env, ScheduledSyncQueueMessage>;
