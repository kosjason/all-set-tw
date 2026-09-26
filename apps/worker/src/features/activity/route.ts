import type { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { AppBindings } from "../../platform/env";
import { honoFactory } from "../../platform/hono";
import { jsonError, parseKeysetPagination } from "../../platform/http";
import { validationHook } from "../../platform/validation";
import { currentActivityMonthKey } from "@taiwan-fin-hub/core";
import { searchActivity } from "./search-service";
import { exportActivity } from "./export-service";
import {
  ACTIVITY_SOURCE_VIEWS,
  getActivityMonth,
  getActivitySources,
  getActivitySummary,
  monthsBetween,
} from "./summary-service";
import { listInvoiceTransactionPreferences } from "./repository";
import { categorizeActivities } from "../merchants/service";
import { merchantError } from "../merchants/route";
import {
  keepInvoiceSeparate,
  linkInvoiceToTransaction,
  MappingDateMismatchError,
  MappingInvoiceNotFoundError,
  MappingTransactionNotExpenseError,
  MappingTransactionNotFoundError,
  MappingTransactionUnavailableError,
} from "./service";

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const summaryQuerySchema = z
  .object({
    month: monthSchema.optional(),
    from: monthSchema.optional(),
    to: monthSchema.optional(),
    months: z.coerce.number().int().min(1).max(12).optional(),
  })
  .strict()
  .refine(
    (query) =>
      [query.month, query.from ?? query.to, query.months].filter(
        (value) => value !== undefined,
      ).length <= 1,
    "Use only one of month, from/to or months.",
  )
  .refine(
    (query) => (query.from === undefined) === (query.to === undefined),
    "from and to must be provided together.",
  )
  .refine(
    (query) =>
      !query.from ||
      !query.to ||
      (query.from <= query.to &&
        monthsBetween(query.from, query.to).length <= 12),
    "The requested range must be ordered and cannot exceed 12 months.",
  );

/** 解析 summary 查詢：單月、起訖月份，或以本月（台北時間）為終點的最近 N 個月。 */
function summaryMonths(query: z.infer<typeof summaryQuerySchema>) {
  if (query.month) return [query.month];
  if (query.from && query.to) return monthsBetween(query.from, query.to);
  const current = currentActivityMonthKey();
  const count = query.months ?? 1;
  const [year, month] = current.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - count, 1));
  return monthsBetween(start.toISOString().slice(0, 7), current);
}

const exportQuerySchema = z
  .object({ from: monthSchema, to: monthSchema })
  .strict()
  .refine(
    (query) =>
      query.from <= query.to &&
      monthsBetween(query.from, query.to).length <= 12,
    "The requested range must be ordered and cannot exceed 12 months.",
  );

const mappingSchema = z.object({
  transactionId: z.string().trim().min(1),
});

const categorizeSchema = z
  .object({
    targets: z
      .array(
        z
          .object({
            kind: z.enum(["bank_transaction", "invoice"]),
            id: z.string().trim().min(1).max(256),
            categoryId: z.string().min(1).max(64).nullable().optional(),
            merchantKey: z.string().min(5).max(125).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(500),
    categoryId: z.string().min(1).max(64).nullable().optional(),
    applyToMerchant: z.boolean().optional(),
  })
  .strict();

export const activityRoutes = honoFactory.createApp();
registerActivityRoutes(activityRoutes);
activityRoutes.onError((error) => mappingError(error));

function registerActivityRoutes(api: Hono<AppBindings>) {
  api.get(
    "/activity/search",
    zValidator(
      "query",
      z
        .object({
          q: z.string().trim().min(1).max(200),
          from: z.string().date().optional(),
          to: z.string().date().optional(),
          source: z.enum(["all", "bank", "card", "invoice"]).optional(),
          flow: z.enum(["all", "income", "expense"]).optional(),
          category: z.string().max(100).optional(),
        })
        .refine(
          (value) => !value.from || !value.to || value.from <= value.to,
          "Invalid date range.",
        ),
      validationHook("INVALID_REQUEST", "Invalid activity search."),
    ),
    async (c) => {
      const { cursor } = parseKeysetPagination(
        c.req.query(),
        z.object({
          id: z.string().min(1),
          source: z.enum(["bank", "card", "invoice", "investment"]),
          date: z.string().min(1).max(64),
          dateHasTime: z.boolean().optional(),
        }),
        30,
      );
      return c.json(
        await searchActivity(c.env.DB, c.req.valid("query"), cursor),
      );
    },
  );

  api.get(
    "/activity/summary",
    zValidator(
      "query",
      summaryQuerySchema,
      validationHook("INVALID_REQUEST", "Invalid activity summary range."),
    ),
    async (c) =>
      c.json(
        await getActivitySummary(c.env.DB, summaryMonths(c.req.valid("query"))),
      ),
  );

  api.get(
    "/activity/items",
    zValidator(
      "query",
      z.object({ month: monthSchema }).strict(),
      validationHook("INVALID_REQUEST", "Invalid activity month."),
    ),
    async (c) =>
      c.json(await getActivityMonth(c.env.DB, c.req.valid("query").month)),
  );

  // 給 LLM 分析用的精簡 JSON：不含帳號、卡號（只有末四碼）與 raw。
  api.get(
    "/activity/export",
    zValidator(
      "query",
      exportQuerySchema,
      validationHook("INVALID_REQUEST", "Invalid activity export range."),
    ),
    async (c) => {
      const { from, to } = c.req.valid("query");
      return c.json(await exportActivity(c.env.DB, from, to));
    },
  );

  // 批次指定分類／接受建議；applyToMerchant 同時寫入商家規則（回溯套用）。
  api.post(
    "/activity/categorize",
    zValidator(
      "json",
      categorizeSchema,
      validationHook("INVALID_REQUEST", "Categorize request is invalid."),
    ),
    async (c) => {
      try {
        return c.json(
          await categorizeActivities(c.env.DB, c.req.valid("json")),
        );
      } catch (error) {
        return merchantError(error);
      }
    },
  );

  api.get(
    "/activity/sources",
    zValidator(
      "query",
      z
        .object({ month: monthSchema, source: z.enum(ACTIVITY_SOURCE_VIEWS) })
        .strict(),
      validationHook("INVALID_REQUEST", "Invalid activity source view."),
    ),
    async (c) => {
      const { month, source } = c.req.valid("query");
      return c.json(await getActivitySources(c.env.DB, month, source));
    },
  );

  api.get("/activity/invoice-mappings", async (c) =>
    c.json(await listInvoiceTransactionPreferences(c.env.DB)),
  );

  api.put(
    "/activity/invoice-mappings/:invoiceId",
    zValidator(
      "json",
      mappingSchema,
      validationHook("INVALID_REQUEST", "Invoice mapping is invalid."),
    ),
    async (c) =>
      c.json(
        await linkInvoiceToTransaction(
          c.env.DB,
          c.req.param("invoiceId"),
          c.req.valid("json").transactionId,
        ),
      ),
  );

  api.delete("/activity/invoice-mappings/:invoiceId", async (c) =>
    c.json(await keepInvoiceSeparate(c.env.DB, c.req.param("invoiceId"))),
  );
}

function mappingError(error: unknown) {
  if (error instanceof MappingInvoiceNotFoundError)
    return jsonError("INVOICE_NOT_FOUND", "Invoice was not found.", 404);
  if (error instanceof MappingTransactionNotFoundError)
    return jsonError(
      "BANK_TRANSACTION_NOT_FOUND",
      "Bank transaction was not found.",
      404,
    );
  if (error instanceof MappingTransactionUnavailableError)
    return jsonError(
      "BANK_TRANSACTION_ALREADY_MAPPED",
      "Bank transaction is already mapped to another invoice.",
      409,
    );
  if (error instanceof MappingDateMismatchError)
    return jsonError(
      "MAPPING_DATE_MISMATCH",
      "Invoice and bank transaction must be on the same day.",
      400,
    );
  if (error instanceof MappingTransactionNotExpenseError)
    return jsonError(
      "MAPPING_TRANSACTION_NOT_EXPENSE",
      "Only TWD expense transactions can be mapped to an invoice.",
      400,
    );
  throw error;
}
