import type { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { taipeiDay, weekStartOf } from "@taiwan-fin-hub/core";
import type { AppBindings } from "../../platform/env";
import { honoFactory } from "../../platform/hono";
import { jsonError } from "../../platform/http";
import { validationHook } from "../../platform/validation";
import {
  getBudget,
  getWeeklyReview,
  removeBudgetMerchant,
  saveBudgetMerchant,
  saveBudgetSettings,
  WeekInFutureError,
} from "./service";

const MAX_AMOUNT = 1_000_000_000;
const amount = z.number().finite().min(0).max(MAX_AMOUNT);

const settingsSchema = z
  .object({
    monthlyBudget: amount.nullable(),
    expectedIncome: amount.nullable(),
    annualReserve: amount,
  })
  .strict();

const merchantKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^(ban|name):/);

const merchantSchema = z
  .object({
    kind: z.enum(["monthly", "annual", "not_fixed"]),
    displayName: z.string().trim().min(1).max(200),
    expectedAmount: amount.nullable(),
  })
  .strict();

const weekQuerySchema = z
  .object({
    start: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
      .refine(
        (day) =>
          !Number.isNaN(Date.parse(`${day}T00:00:00Z`)) &&
          new Date(`${day}T00:00:00Z`).toISOString().startsWith(day) &&
          weekStartOf(day) === day,
        "Week must start on a Monday.",
      )
      .optional(),
  })
  .strict();

export const budgetRoutes = honoFactory.createApp();
registerBudgetRoutes(budgetRoutes);

function registerBudgetRoutes(api: Hono<AppBindings>) {
  api.get("/budget", async (c) => c.json(await getBudget(c.env.DB)));

  api.put(
    "/budget/settings",
    zValidator(
      "json",
      settingsSchema,
      validationHook("INVALID_REQUEST", "Budget settings are invalid."),
    ),
    async (c) =>
      c.json(await saveBudgetSettings(c.env.DB, c.req.valid("json"))),
  );

  api.put(
    "/budget/merchants/:merchantKey",
    zValidator(
      "param",
      z.object({ merchantKey: merchantKeySchema }),
      validationHook("INVALID_REQUEST", "Merchant key is invalid."),
    ),
    zValidator(
      "json",
      merchantSchema,
      validationHook("INVALID_REQUEST", "Budget merchant is invalid."),
    ),
    async (c) =>
      c.json(
        await saveBudgetMerchant(c.env.DB, {
          merchantKey: c.req.valid("param").merchantKey,
          ...c.req.valid("json"),
        }),
      ),
  );

  api.delete(
    "/budget/merchants/:merchantKey",
    zValidator(
      "param",
      z.object({ merchantKey: merchantKeySchema }),
      validationHook("INVALID_REQUEST", "Merchant key is invalid."),
    ),
    async (c) => {
      const removed = await removeBudgetMerchant(
        c.env.DB,
        c.req.valid("param").merchantKey,
      );
      return removed
        ? c.json({ success: true })
        : jsonError(
            "BUDGET_MERCHANT_NOT_FOUND",
            "Budget merchant was not found.",
            404,
          );
    },
  );

  api.get(
    "/budget/week",
    zValidator(
      "query",
      weekQuerySchema,
      validationHook("INVALID_REQUEST", "Week must be a Monday (YYYY-MM-DD)."),
    ),
    async (c) => {
      const start =
        c.req.valid("query").start ?? weekStartOf(taipeiDay(new Date()));
      try {
        return c.json(await getWeeklyReview(c.env.DB, start));
      } catch (error) {
        if (error instanceof WeekInFutureError)
          return jsonError("INVALID_REQUEST", "Week is in the future.", 400);
        throw error;
      }
    },
  );
}
