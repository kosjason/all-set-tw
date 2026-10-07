import type { ConnectorId } from "@taiwan-fin-hub/shared";

export type ScheduledSyncQueueMessage =
  | { type: "run-next-scheduled-sync" }
  | { type: "run-einvoice-chunk"; runId: string }
  | { type: "run-tdcc-chunk"; runId: string };

export interface Env {
  DB: D1Database;
  SYNC_QUEUE: Queue<ScheduledSyncQueueMessage>;
  ASSETS: Fetcher;
  BROWSER: Fetcher;
  AI: Ai;
  CONFIG_ENCRYPTION_KEY?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  TEAM_DOMAIN?: string;
  POLICY_AUD?: string;
  POLICY_AUDS?: string;
  DEMO_MODE?: string | boolean;
  LOCAL_DEV_MODE?: string | boolean;
  CTBC_API_RELAY_URL?: string;
  CTBC_API_RELAY_TOKEN?: string;
  /** fork 自架：mini 本機中信網銀匯入觸發器（只監聽 127.0.0.1）。 */
  CTBC_IMPORT_TRIGGER_URL?: string;
  CTBC_IMPORT_TRIGGER_TOKEN?: string;
}

export type Variables = {
  connectorId: ConnectorId;
};

export type AppBindings = {
  Bindings: Env;
  Variables: Variables;
};
