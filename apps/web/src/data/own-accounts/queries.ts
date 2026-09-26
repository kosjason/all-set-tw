import { queryOptions } from "@tanstack/svelte-query";
import type { OwnAccount } from "@taiwan-fin-hub/core";
import type { ApiClient } from "@/shared/api/client";
import { queryKeys } from "@/shared/api/query-keys";

type ApiProvider = () => ApiClient;

export const ownAccountsQuery = (getApi: ApiProvider) =>
  queryOptions({
    queryKey: queryKeys.ownAccounts,
    queryFn: () => getApi().get<OwnAccount[]>("/api/own-accounts"),
  });
