import type { Env } from "../../platform/env";
import type { SyncTrigger } from "../../db";
import type { SyncOutcome } from "../../features/sync/types";
import {
  requireConnectorSettings,
  encryptConnectorConfig,
  serializePublicConfig,
} from "../../features/sync/config";
import { decryptJson } from "../../platform/crypto";
import { configEncryptionKey } from "../../platform/config";
import { parseCtbcConfig } from "./protocol";
import {
  parsePublicConnectorConfig,
  splitConnectorCursorState,
} from "../../features/sync/connector-state";
import {
  createCtbcConnector,
  CtbcVerificationRequiredError,
} from "./mobile-api";
import { createCtbcFetch } from "./connector";
import { NeedsUserActionError } from "../../features/sync/errors";
import { connectorStateStatement } from "../../features/sync/connector-repository";
import { writeCtbcSyncData } from "../../features/sync/ctbc-write";

export async function syncCtbc(
  env: Env,
  trigger: SyncTrigger,
): Promise<SyncOutcome> {
  const connectorId = "ctbc";
  const scope = "all";
  const settings = await requireConnectorSettings(env.DB, connectorId);
  const stored = await decryptJson<Record<string, unknown>>(
    settings.encrypted_config,
    configEncryptionKey(env),
  );
  const config = parseCtbcConfig({
    ...stored,
    ...parsePublicConnectorConfig(connectorId, settings.public_config),
  });

  console.log(
    `[sync] ${connectorId}/${scope}: starting trigger=${trigger} (cursor=${settings.sync_cursor ? "set" : "none"})`,
  );

  let result: Awaited<
    ReturnType<ReturnType<typeof createCtbcConnector>["sync"]>
  >;
  try {
    const fetcher = createCtbcFetch(env);
    const connector = fetcher
      ? createCtbcConnector(fetcher)
      : createCtbcConnector();
    result = await connector.sync(config, settings.sync_cursor ?? undefined);
  } catch (error) {
    if (error instanceof CtbcVerificationRequiredError) {
      throw new NeedsUserActionError(error.message);
    }
    throw error;
  }

  const now = new Date().toISOString();
  let persistedCursor: string | undefined;
  const finalizeStatements: D1PreparedStatement[] = [];
  if (result.cursor) {
    const cursorState = splitConnectorCursorState(connectorId, result.cursor);
    persistedCursor = cursorState.safeCursor;
    finalizeStatements.push(
      connectorStateStatement(
        env.DB,
        connectorId,
        await encryptConnectorConfig(env, connectorId, config),
        serializePublicConfig(connectorId, config),
        persistedCursor,
        now,
      ),
    );
  }

  const written = await writeCtbcSyncData(env.DB, result, {
    now,
    finalizeStatements,
  });

  return {
    success: true,
    connectorId,
    scope,
    records: written.records,
    newRecords: written.newRecords,
    cursorUpdated: Boolean(
      persistedCursor && persistedCursor !== settings.sync_cursor,
    ),
  };
}
