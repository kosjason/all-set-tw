import { z } from "zod";
import type { Env } from "../../platform/env";

/**
 * fork 自架環境：中信網銀半自動匯入要在 mini 的螢幕開 Chrome 讓使用者登入，Worker 無法
 * 自己啟動。這裡把網頁按鈕轉給 mini 本機的觸發器（只監聽 127.0.0.1、需 Bearer token），
 * 由它啟動既有的 ctbc-import launchd 工作。未設定觸發器時回報不可用，網頁維持原本的說明。
 */
type TriggerEnv = Pick<
  Env,
  "CTBC_IMPORT_TRIGGER_URL" | "CTBC_IMPORT_TRIGGER_TOKEN"
>;
type TriggerFetch = typeof globalThis.fetch;

const TRIGGER_TIMEOUT_MS = 5_000;

const lastResultSchema = z
  .object({
    finishedAt: z.string().max(32),
    exitCode: z.number().int(),
  })
  .nullable();

const statusSchema = z.object({
  running: z.boolean(),
  last: lastResultSchema,
});

const startSchema = z.object({
  started: z.boolean(),
  running: z.boolean(),
});

export type CtbcWebImportStatus =
  { available: false } | ({ available: true } & z.infer<typeof statusSchema>);

export type CtbcWebImportStart = z.infer<typeof startSchema>;

export class CtbcWebImportNotConfiguredError extends Error {
  constructor() {
    super("這個部署沒有設定中信網銀匯入觸發器。");
    this.name = "CtbcWebImportNotConfiguredError";
  }
}

export class CtbcWebImportTriggerError extends Error {
  constructor(message = "無法連到 mini 上的中信匯入觸發器，請稍後再試。") {
    super(message);
    this.name = "CtbcWebImportTriggerError";
  }
}

function triggerConfig(env: TriggerEnv) {
  const url = env.CTBC_IMPORT_TRIGGER_URL?.trim().replace(/\/+$/, "");
  const token = env.CTBC_IMPORT_TRIGGER_TOKEN?.trim();
  if (!url && !token) return null;
  if (!url || !token) {
    throw new CtbcWebImportTriggerError("中信網銀匯入觸發器設定不完整。");
  }
  return { url, token };
}

async function callTrigger<T>(
  config: { url: string; token: string },
  path: string,
  method: "GET" | "POST",
  schema: z.ZodType<T>,
  fetcher: TriggerFetch,
): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(`${config.url}${path}`, {
      method,
      headers: { Authorization: `Bearer ${config.token}` },
      signal: AbortSignal.timeout(TRIGGER_TIMEOUT_MS),
    });
  } catch {
    throw new CtbcWebImportTriggerError();
  }
  if (!response.ok) {
    console.warn(
      JSON.stringify({
        event: "ctbc_web_import_trigger_failed",
        path,
        status: response.status,
      }),
    );
    throw new CtbcWebImportTriggerError(
      response.status === 502
        ? "mini 無法啟動中信匯入工作，請到 mini 檢查 launchd 設定。"
        : undefined,
    );
  }
  const parsed = schema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) {
    throw new CtbcWebImportTriggerError("中信匯入觸發器回應格式不符。");
  }
  return parsed.data;
}

export async function ctbcWebImportStatus(
  env: TriggerEnv,
  fetcher: TriggerFetch = globalThis.fetch.bind(globalThis),
): Promise<CtbcWebImportStatus> {
  const config = triggerConfig(env);
  if (!config) return { available: false };
  const status = await callTrigger(
    config,
    "/ctbc-import/status",
    "GET",
    statusSchema,
    fetcher,
  );
  return { available: true, ...status };
}

export async function startCtbcWebImport(
  env: TriggerEnv,
  fetcher: TriggerFetch = globalThis.fetch.bind(globalThis),
): Promise<CtbcWebImportStart> {
  const config = triggerConfig(env);
  if (!config) throw new CtbcWebImportNotConfiguredError();
  return callTrigger(
    config,
    "/ctbc-import/start",
    "POST",
    startSchema,
    fetcher,
  );
}
