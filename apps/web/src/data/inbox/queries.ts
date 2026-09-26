import type { InboxResponse } from "@taiwan-fin-hub/core";
import { queryOptions } from "@tanstack/svelte-query";
import type { ApiClient } from "@/shared/api/client";
import { queryKeys } from "@/shared/api/query-keys";

export type {
  InboxAction,
  InboxItem,
  InboxItemKind,
  InboxResponse,
  InboxSeverity,
  InboxSource,
  InboxTarget,
} from "@taiwan-fin-hub/core";

/**
 * 待處理收件匣（`GET /api/inbox`）。counts 供頂端 badge 使用；
 * 活動類項目只計本月與上月。
 */
export const inboxQuery = (getApi: () => ApiClient) =>
  queryOptions({
    queryKey: queryKeys.inbox,
    queryFn: () => getApi().get<InboxResponse>("/api/inbox"),
  });
