import { parseCtbcData, type CtbcPayloads } from "@taiwan-fin-hub/connectors";
import {
  getConnectorSettings,
  upsertConnectorSettings,
} from "@taiwan-fin-hub/db";
import { configEncryptionKey } from "../../platform/config";
import { encryptJson } from "../../platform/crypto";
import type { Env } from "../../platform/env";
import { writeCtbcSyncData } from "./ctbc-write";
import type { SyncOutcome } from "./service";

const CONNECTOR_ID = "ctbc";

export const CTBC_DEPOSIT_TRANSACTIONS_UNAVAILABLE_WARNING =
  "中信網銀匯入未取得存款交易明細，本次僅更新餘額與信用卡資料。";

/** 匯入資料無法解析或不含任何帳戶；訊息固定，不包含原始資料。 */
export class CtbcImportPayloadError extends Error {
  constructor(message = "中國信託匯入資料格式不符，未寫入任何資料。") {
    super(message);
    this.name = "CtbcImportPayloadError";
  }
}

export type CtbcImportOptions = {
  depositTransactionsUnavailable?: boolean;
  now?: Date;
};

/**
 * 將本機小工具從使用者已登入的網銀頁面取得的原始回應，以既有 `parseCtbcData`
 * 解析後走與自動同步相同的寫入路徑。不讀取或更新帳密與 cursor。
 *
 * 尚未建立中信設定列時會建立一筆空設定（中信設定欄位皆為選填），讓設定頁顯示
 * 「已設定」與上次匯入時間；自動同步排程預設停用，不會因此以空帳密登入。
 */
export async function importCtbcPayloads(
  env: Env,
  payloads: CtbcPayloads,
  options: CtbcImportOptions = {},
): Promise<SyncOutcome> {
  const now = options.now ?? new Date();
  let parsed: ReturnType<typeof parseCtbcData>;
  try {
    parsed = parseCtbcData(payloads, now);
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "ctbc_import_parse_failed",
        kind: error instanceof Error ? error.name : typeof error,
      }),
    );
    throw new CtbcImportPayloadError();
  }
  if (parsed.bankAccounts.length === 0) {
    throw new CtbcImportPayloadError(
      "中國信託匯入資料沒有任何存款或信用卡帳戶，未寫入任何資料。",
    );
  }

  await ensureCtbcConnectorSettings(env, now.toISOString());
  const written = await writeCtbcSyncData(env.DB, parsed, {
    now: now.toISOString(),
  });

  return {
    success: true,
    connectorId: CONNECTOR_ID,
    scope: "all",
    records: written.records,
    newRecords: written.newRecords,
    cursorUpdated: false,
    ...(options.depositTransactionsUnavailable
      ? { warnings: [CTBC_DEPOSIT_TRANSACTIONS_UNAVAILABLE_WARNING] }
      : {}),
  };
}

async function ensureCtbcConnectorSettings(env: Env, now: string) {
  if (await getConnectorSettings(env.DB, CONNECTOR_ID)) return;
  await upsertConnectorSettings(env.DB, {
    id: crypto.randomUUID(),
    connectorId: CONNECTOR_ID,
    encryptedConfig: await encryptJson({}, configEncryptionKey(env)),
    publicConfig: null,
    now,
  });
}
