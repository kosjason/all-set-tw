import type { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { OWN_ACCOUNT_KINDS } from "@taiwan-fin-hub/core";
import type { AppBindings } from "../../platform/env";
import { honoFactory } from "../../platform/hono";
import { jsonError } from "../../platform/http";
import { validationHook } from "../../platform/validation";
import {
  OwnAccountExistsError,
  OwnAccountNotFoundError,
  createOwnAccount,
  editOwnAccount,
  getOwnAccounts,
  removeOwnAccount,
} from "./service";

// 只接受末 4–5 碼；完整帳號一律拒絕，避免被寫入資料庫。
const bankCodeSchema = z.string().regex(/^\d{3}$/);
const accountSuffixSchema = z.string().regex(/^\d{4,5}$/);
const labelSchema = z.string().trim().max(40).nullable().optional();
const kindSchema = z.enum(OWN_ACCOUNT_KINDS);

const createSchema = z
  .object({
    kind: kindSchema.default("own_account"),
    bankCode: bankCodeSchema,
    accountSuffix: accountSuffixSchema,
    label: labelSchema,
  })
  .strict();
const updateSchema = z
  .object({
    kind: kindSchema.optional(),
    bankCode: bankCodeSchema.optional(),
    accountSuffix: accountSuffixSchema.optional(),
    label: labelSchema,
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0);

function ownAccountError(error: unknown) {
  if (error instanceof OwnAccountNotFoundError)
    return jsonError("OWN_ACCOUNT_NOT_FOUND", "Own account not found.", 404);
  if (error instanceof OwnAccountExistsError)
    return jsonError(
      "OWN_ACCOUNT_EXISTS",
      "An own account with the same bank and account suffix already exists.",
      409,
    );
  throw error;
}

export const ownAccountRoutes = honoFactory.createApp();
registerOwnAccountRoutes(ownAccountRoutes);

function registerOwnAccountRoutes(api: Hono<AppBindings>) {
  api.get("/own-accounts", async (c) => c.json(await getOwnAccounts(c.env.DB)));

  api.post(
    "/own-accounts",
    zValidator(
      "json",
      createSchema,
      validationHook("INVALID_REQUEST", "Own account is invalid."),
    ),
    async (c) => {
      try {
        return c.json(
          await createOwnAccount(c.env.DB, c.req.valid("json")),
          201,
        );
      } catch (error) {
        return ownAccountError(error);
      }
    },
  );

  api.put(
    "/own-accounts/:id",
    zValidator(
      "json",
      updateSchema,
      validationHook("INVALID_REQUEST", "Own account update is invalid."),
    ),
    async (c) => {
      try {
        return c.json(
          await editOwnAccount(
            c.env.DB,
            c.req.param("id"),
            c.req.valid("json"),
          ),
        );
      } catch (error) {
        return ownAccountError(error);
      }
    },
  );

  api.delete("/own-accounts/:id", async (c) => {
    try {
      await removeOwnAccount(c.env.DB, c.req.param("id"));
      return c.json({ success: true });
    } catch (error) {
      return ownAccountError(error);
    }
  });
}
