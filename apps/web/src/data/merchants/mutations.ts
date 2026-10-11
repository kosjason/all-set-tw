import type { ApiClient } from "@/shared/api/client";
import { merchantPath } from "./queries";
import type { MerchantUpdateResponse } from "./types";

/**
 * `PUT /api/merchants/:merchantKey` 只改「這家都付現金」（其他規則保留）。成功後請讓
 * `queryKeys.bank` 失效：提款的未細分金額與發票的現金標示都由活動推導。
 */
export function setMerchantPaidInCashMutation(getApi: () => ApiClient) {
  return {
    mutationKey: ["merchant", "paid-in-cash"] as const,
    mutationFn: (input: { merchantKey: string; paidInCash: boolean }) =>
      getApi().put<MerchantUpdateResponse>(merchantPath(input.merchantKey), {
        paidInCash: input.paidInCash,
      }),
  };
}
