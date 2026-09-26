import { honoFactory } from "../../platform/hono";
import { getInbox } from "./service";

export const inboxRoutes = honoFactory.createApp();

inboxRoutes.get("/inbox", async (c) => c.json(await getInbox(c.env.DB)));
