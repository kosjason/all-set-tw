import type { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { isMerchantKey, RULE_ECONOMIC_ROLES } from "@taiwan-fin-hub/core";
import type { AppBindings } from "../../platform/env";
import { honoFactory } from "../../platform/hono";
import { jsonError } from "../../platform/http";
import { validationHook } from "../../platform/validation";
import {
  CategorizeCategoryRequiredError,
  CategorizeTargetNotFoundError,
  MerchantCategoryNotFoundError,
  MerchantKeyInvalidError,
  MerchantNotFoundError,
  getMerchant,
  listMerchants,
  removeMerchant,
  updateMerchant,
} from "./service";

const merchantKeyParamSchema = z.object({
  merchantKey: z.string().min(5).max(125).refine(isMerchantKey),
});

const updateMerchantSchema = z
  .object({
    displayName: z.string().trim().max(60).nullable().optional(),
    categoryId: z.string().min(1).max(64).nullable().optional(),
    economicRole: z.enum(RULE_ECONOMIC_ROLES).nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0);

export const merchantRoutes = honoFactory.createApp();
registerMerchantRoutes(merchantRoutes);
merchantRoutes.onError((error) => merchantError(error));

function registerMerchantRoutes(api: Hono<AppBindings>) {
  api.get(
    "/merchants",
    zValidator(
      "query",
      z
        .object({
          query: z.string().trim().max(100).optional(),
          months: z.coerce.number().int().min(1).max(12).optional(),
        })
        .strict(),
      validationHook("INVALID_REQUEST", "Invalid merchant query."),
    ),
    async (c) => c.json(await listMerchants(c.env.DB, c.req.valid("query"))),
  );

  api.get(
    "/merchants/:merchantKey",
    zValidator(
      "param",
      merchantKeyParamSchema,
      validationHook("INVALID_REQUEST", "Invalid merchant key."),
    ),
    async (c) =>
      c.json(await getMerchant(c.env.DB, c.req.valid("param").merchantKey)),
  );

  api.put(
    "/merchants/:merchantKey",
    zValidator(
      "param",
      merchantKeyParamSchema,
      validationHook("INVALID_REQUEST", "Invalid merchant key."),
    ),
    zValidator(
      "json",
      updateMerchantSchema,
      validationHook("INVALID_REQUEST", "Merchant update is invalid."),
    ),
    async (c) =>
      c.json(
        await updateMerchant(
          c.env.DB,
          c.req.valid("param").merchantKey,
          c.req.valid("json"),
        ),
      ),
  );

  api.delete(
    "/merchants/:merchantKey",
    zValidator(
      "param",
      merchantKeyParamSchema,
      validationHook("INVALID_REQUEST", "Invalid merchant key."),
    ),
    async (c) => {
      await removeMerchant(c.env.DB, c.req.valid("param").merchantKey);
      return c.json({ success: true });
    },
  );
}

export function merchantError(error: unknown) {
  if (error instanceof MerchantNotFoundError)
    return jsonError("MERCHANT_NOT_FOUND", "Merchant rule was not found.", 404);
  if (error instanceof MerchantKeyInvalidError)
    return jsonError("INVALID_REQUEST", "Invalid merchant key.", 400);
  if (error instanceof MerchantCategoryNotFoundError)
    return jsonError(
      "CATEGORY_NOT_FOUND",
      "Classification category was not found.",
      404,
    );
  if (error instanceof CategorizeCategoryRequiredError)
    return jsonError(
      "INVALID_REQUEST",
      "categoryId is required for every target.",
      400,
    );
  if (error instanceof CategorizeTargetNotFoundError)
    return jsonError("ACTIVITY_NOT_FOUND", "Activity was not found.", 404);
  throw error;
}
