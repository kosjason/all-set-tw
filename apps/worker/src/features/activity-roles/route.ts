import type { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  ECONOMIC_ROLE_TARGET_KINDS,
  ECONOMIC_ROLES,
} from "@taiwan-fin-hub/core";
import type { AppBindings } from "../../platform/env";
import { honoFactory } from "../../platform/hono";
import { jsonError } from "../../platform/http";
import { validationHook } from "../../platform/validation";
import {
  activityNoteError,
  activityNoteTextSchema,
} from "../activity-notes/route";
import { ActivityNoteTooLongError } from "../activity-notes/service";
import {
  ActivityRoleDuplicateNotFoundError,
  ActivityRoleOverrideNotFoundError,
  ActivityRoleSelfDuplicateError,
  ActivityRoleTargetNotFoundError,
  getActivityRoleOverrides,
  removeActivityRoleOverride,
  setActivityRoleOverride,
} from "./service";

const kindSchema = z.enum(ECONOMIC_ROLE_TARGET_KINDS);
const paramsSchema = z.object({
  targetKind: kindSchema,
  targetId: z.string().trim().min(1).max(512),
});
const overrideSchema = z
  .object({
    economicRole: z.enum(ECONOMIC_ROLES),
    duplicateOf: z
      .object({ kind: kindSchema, id: z.string().trim().min(1).max(512) })
      .strict()
      .nullable()
      .optional(),
    /** 一併寫入活動備註；空字串或 null 刪除，省略則不變更。 */
    note: activityNoteTextSchema.nullable().optional(),
  })
  .strict();

function roleOverrideError(error: unknown) {
  if (error instanceof ActivityRoleTargetNotFoundError)
    return jsonError("ACTIVITY_NOT_FOUND", "Activity was not found.", 404);
  if (error instanceof ActivityRoleDuplicateNotFoundError)
    return jsonError(
      "DUPLICATE_ACTIVITY_NOT_FOUND",
      "The activity referenced by duplicateOf was not found.",
      404,
    );
  if (error instanceof ActivityRoleSelfDuplicateError)
    return jsonError(
      "INVALID_REQUEST",
      "An activity cannot be a duplicate of itself.",
      400,
    );
  if (error instanceof ActivityNoteTooLongError)
    return activityNoteError(error);
  if (error instanceof ActivityRoleOverrideNotFoundError)
    return jsonError(
      "ACTIVITY_ROLE_OVERRIDE_NOT_FOUND",
      "Activity role override was not found.",
      404,
    );
  throw error;
}

export const activityRoleRoutes = honoFactory.createApp();
registerActivityRoleRoutes(activityRoleRoutes);

function registerActivityRoleRoutes(api: Hono<AppBindings>) {
  api.get("/activity/role-overrides", async (c) =>
    c.json(await getActivityRoleOverrides(c.env.DB)),
  );

  api.put(
    "/activity/role-overrides/:targetKind/:targetId",
    zValidator(
      "param",
      paramsSchema,
      validationHook("INVALID_REQUEST", "Activity reference is invalid."),
    ),
    zValidator(
      "json",
      overrideSchema,
      validationHook("INVALID_REQUEST", "Activity role override is invalid."),
    ),
    async (c) => {
      const { targetKind, targetId } = c.req.valid("param");
      try {
        return c.json(
          await setActivityRoleOverride(
            c.env.DB,
            targetKind,
            targetId,
            c.req.valid("json"),
          ),
        );
      } catch (error) {
        return roleOverrideError(error);
      }
    },
  );

  api.delete(
    "/activity/role-overrides/:targetKind/:targetId",
    zValidator(
      "param",
      paramsSchema,
      validationHook("INVALID_REQUEST", "Activity reference is invalid."),
    ),
    async (c) => {
      const { targetKind, targetId } = c.req.valid("param");
      try {
        await removeActivityRoleOverride(c.env.DB, targetKind, targetId);
        return c.json({ success: true });
      } catch (error) {
        return roleOverrideError(error);
      }
    },
  );
}
