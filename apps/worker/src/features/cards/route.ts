import type { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { AppBindings } from "../../platform/env";
import { honoFactory } from "../../platform/hono";
import { jsonError } from "../../platform/http";
import { validationHook } from "../../platform/validation";
import {
  CardIssuerNotFoundError,
  getCardIssuerBills,
  getCardsSummary,
} from "./service";

const issuerParamSchema = z.object({
  issuer: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_-]{0,31}$/),
});

export const cardRoutes = honoFactory.createApp();
registerCardRoutes(cardRoutes);

function registerCardRoutes(api: Hono<AppBindings>) {
  api.get("/cards/summary", async (c) =>
    c.json(await getCardsSummary(c.env.DB)),
  );

  api.get(
    "/cards/:issuer/bills",
    zValidator(
      "param",
      issuerParamSchema,
      validationHook("INVALID_REQUEST", "Invalid card issuer."),
    ),
    async (c) => {
      try {
        return c.json(
          await getCardIssuerBills(c.env.DB, c.req.valid("param").issuer),
        );
      } catch (error) {
        if (error instanceof CardIssuerNotFoundError)
          return jsonError(
            "CARD_ISSUER_NOT_FOUND",
            "找不到這個發卡行的信用卡。",
            404,
          );
        throw error;
      }
    },
  );
}
