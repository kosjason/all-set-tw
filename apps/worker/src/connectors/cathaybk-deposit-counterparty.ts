import {
  deriveCounterpartyAccount,
  formatCounterpartyAccount,
  maskAccountNumbers,
  parseBankAccountMemo,
  type CounterpartyAccount,
} from "@taiwan-fin-hub/core";

/** 國泰世華 B_ACCT_Q_TransferDetail 中與交易對手帳號相關的欄位。 */
export interface CathayDepositCounterpartyFields {
  expendBankId?: unknown;
  expendAcctNo?: unknown;
  specialMemo?: unknown;
}

/**
 * 轉出優先使用 expendBankId／expendAcctNo；轉入（或轉出缺少欄位）時解析
 * specialMemo 的「(銀行代碼)帳號；」。只回傳代碼與帳號末五碼。
 */
export function deriveCathayDepositCounterparty(
  detail: CathayDepositCounterpartyFields,
  amount: number,
):
  | { counterparty: string; counterpartyAccount: CounterpartyAccount }
  | undefined {
  const account =
    (amount < 0
      ? deriveCounterpartyAccount(detail.expendBankId, detail.expendAcctNo)
      : undefined) ?? parseBankAccountMemo(detail.specialMemo);
  if (!account) return undefined;
  return {
    counterparty: formatCounterpartyAccount(account),
    counterpartyAccount: account,
  };
}

/** raw 只保留遮罩後的帳號欄位，避免完整帳號寫入資料庫。 */
export function maskCathayDepositRaw<T extends CathayDepositCounterpartyFields>(
  detail: T,
): T {
  const masked: CathayDepositCounterpartyFields = { ...detail };
  for (const key of ["expendAcctNo", "specialMemo"] as const) {
    const value = detail[key];
    if (typeof value === "string") masked[key] = maskAccountNumbers(value);
  }
  return masked as T;
}
