import type { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  CASH_EXPENSE_AMOUNT_MAX,
  CASH_EXPENSE_DESCRIPTION_MAX,
} from "@taiwan-fin-hub/shared";
import type { AppBindings } from "../../platform/env";
import { honoFactory } from "../../platform/hono";
import { jsonError } from "../../platform/http";
import { validationHook } from "../../platform/validation";
import {
  addCashExpense,
  CashExpenseCategoryError,
  CashExpenseInvalidError,
  CashExpenseNotFoundError,
  editCashExpense,
  removeCashExpense,
} from "./service";

const bodySchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    amount: z.number().int().min(1).max(CASH_EXPENSE_AMOUNT_MAX),
    categoryId: z.string().trim().min(1).max(64),
    // 正規化（合併空白）後才檢查字數上限，這裡只擋明顯過長的輸入。
    description: z
      .string()
      .max(CASH_EXPENSE_DESCRIPTION_MAX * 4)
      .nullable()
      .optional(),
  })
  .strict();

const idSchema = z.object({ id: z.string().uuid() });

// 訊息會直接顯示在記帳對話框，因此用中文。

function cashExpenseError(error: unknown) {
  if (error instanceof CashExpenseNotFoundError)
    return jsonError(
      "CASH_EXPENSE_NOT_FOUND",
      "找不到這筆現金支出，可能已被刪除。",
      404,
    );
  if (error instanceof CashExpenseCategoryError)
    return jsonError("INVALID_CATEGORY", "請選擇消費分類。", 400);
  if (error instanceof CashExpenseInvalidError)
    return jsonError("INVALID_REQUEST", error.message, 400);
  throw error;
}

export const cashExpenseRoutes = honoFactory.createApp();
registerCashExpenseRoutes(cashExpenseRoutes);

function registerCashExpenseRoutes(api: Hono<AppBindings>) {
  // 現金支出列在活動（/activity/items、summary）中；這裡只負責寫入。
  api.post(
    "/cash-expenses",
    zValidator(
      "json",
      bodySchema,
      validationHook("INVALID_REQUEST", "現金支出的內容不正確。"),
    ),
    async (c) => {
      try {
        return c.json(await addCashExpense(c.env.DB, c.req.valid("json")), 201);
      } catch (error) {
        return cashExpenseError(error);
      }
    },
  );

  api.put(
    "/cash-expenses/:id",
    zValidator(
      "param",
      idSchema,
      validationHook(
        "CASH_EXPENSE_NOT_FOUND",
        "找不到這筆現金支出，可能已被刪除。",
        404,
      ),
    ),
    zValidator(
      "json",
      bodySchema,
      validationHook("INVALID_REQUEST", "現金支出的內容不正確。"),
    ),
    async (c) => {
      try {
        return c.json(
          await editCashExpense(
            c.env.DB,
            c.req.valid("param").id,
            c.req.valid("json"),
          ),
        );
      } catch (error) {
        return cashExpenseError(error);
      }
    },
  );

  api.delete(
    "/cash-expenses/:id",
    zValidator(
      "param",
      idSchema,
      validationHook(
        "CASH_EXPENSE_NOT_FOUND",
        "找不到這筆現金支出，可能已被刪除。",
        404,
      ),
    ),
    async (c) => {
      try {
        await removeCashExpense(c.env.DB, c.req.valid("param").id);
        return c.json({ success: true });
      } catch (error) {
        return cashExpenseError(error);
      }
    },
  );
}
