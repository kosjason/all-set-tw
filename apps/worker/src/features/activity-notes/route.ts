import type { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  ACTIVITY_NOTE_MAX_LENGTH,
  ECONOMIC_ROLE_TARGET_KINDS,
} from "@taiwan-fin-hub/core";
import type { AppBindings } from "../../platform/env";
import { honoFactory } from "../../platform/hono";
import { jsonError } from "../../platform/http";
import { validationHook } from "../../platform/validation";
import {
  ActivityNoteNotFoundError,
  ActivityNoteTargetNotFoundError,
  ActivityNoteTooLongError,
  getActivityNotes,
  removeActivityNote,
  setActivityNote,
} from "./service";

const paramsSchema = z.object({
  targetKind: z.enum(ECONOMIC_ROLE_TARGET_KINDS),
  targetId: z.string().trim().min(1).max(512),
});

/** 備註內容；空字串（或只有空白）代表刪除。前後空白與換行在 service 正規化。 */
export const activityNoteTextSchema = z
  .string()
  .max(ACTIVITY_NOTE_MAX_LENGTH * 2)
  .refine(
    (value) => [...value.trim()].length <= ACTIVITY_NOTE_MAX_LENGTH,
    `Note cannot exceed ${ACTIVITY_NOTE_MAX_LENGTH} characters.`,
  );

const noteBodySchema = z.object({ note: activityNoteTextSchema }).strict();

export function activityNoteError(error: unknown) {
  if (error instanceof ActivityNoteTargetNotFoundError)
    return jsonError("ACTIVITY_NOT_FOUND", "Activity was not found.", 404);
  if (error instanceof ActivityNoteNotFoundError)
    return jsonError(
      "ACTIVITY_NOTE_NOT_FOUND",
      "Activity note was not found.",
      404,
    );
  if (error instanceof ActivityNoteTooLongError)
    return jsonError(
      "INVALID_REQUEST",
      `Note cannot exceed ${ACTIVITY_NOTE_MAX_LENGTH} characters.`,
      400,
    );
  throw error;
}

export const activityNoteRoutes = honoFactory.createApp();
registerActivityNoteRoutes(activityNoteRoutes);

function registerActivityNoteRoutes(api: Hono<AppBindings>) {
  api.get(
    "/activity/notes",
    zValidator(
      "query",
      z
        .object({
          month: z
            .string()
            .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
            .optional(),
        })
        .strict(),
      validationHook("INVALID_REQUEST", "Invalid activity note month."),
    ),
    async (c) =>
      c.json(await getActivityNotes(c.env.DB, c.req.valid("query").month)),
  );

  api.put(
    "/activity/notes/:targetKind/:targetId",
    zValidator(
      "param",
      paramsSchema,
      validationHook("INVALID_REQUEST", "Activity reference is invalid."),
    ),
    zValidator(
      "json",
      noteBodySchema,
      validationHook("INVALID_REQUEST", "Activity note is invalid."),
    ),
    async (c) => {
      const { targetKind, targetId } = c.req.valid("param");
      try {
        return c.json(
          await setActivityNote(
            c.env.DB,
            targetKind,
            targetId,
            c.req.valid("json").note,
          ),
        );
      } catch (error) {
        return activityNoteError(error);
      }
    },
  );

  api.delete(
    "/activity/notes/:targetKind/:targetId",
    zValidator(
      "param",
      paramsSchema,
      validationHook("INVALID_REQUEST", "Activity reference is invalid."),
    ),
    async (c) => {
      const { targetKind, targetId } = c.req.valid("param");
      try {
        await removeActivityNote(c.env.DB, targetKind, targetId);
        return c.json({ success: true });
      } catch (error) {
        return activityNoteError(error);
      }
    },
  );
}
