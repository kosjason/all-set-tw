import {
  TAIWAN_BANKS,
  isTaiwanBankCode,
  isValidOwnAccountSuffix,
  type OwnAccountInput,
  type OwnAccountKind,
} from "@taiwan-fin-hub/core";

export const OTHER_BANK_OPTION = "other";
export const OWN_ACCOUNT_LABEL_MAX_LENGTH = 40;

export const ownAccountKindOptions: ReadonlyArray<{
  value: OwnAccountKind;
  label: string;
  description: string;
}> = [
  {
    value: "own_account",
    label: "自己的存款／電子錢包",
    description: "例如台新活存、電子支付帳戶；互轉不計入收支。",
  },
  {
    value: "unsynced_card",
    label: "未同步的信用卡",
    description:
      "例如用轉帳繳款或儲值的卡片；轉入款項仍計入支出，並標示為這張卡的繳卡費。",
  },
];

export interface OwnAccountFormState {
  kind: OwnAccountKind;
  /** 銀行選單的值：三碼代碼，或選擇「其他」時為 OTHER_BANK_OPTION。 */
  bankOption: string;
  /** 選擇「其他」時自行輸入的三碼代碼。 */
  customBankCode: string;
  accountSuffix: string;
  label: string;
}

export type OwnAccountFormErrors = Partial<
  Record<"bankCode" | "accountSuffix" | "label", string>
>;

export type OwnAccountFormResult =
  | { valid: true; input: OwnAccountInput }
  | { valid: false; errors: OwnAccountFormErrors };

export const ownAccountBankOptions = TAIWAN_BANKS.map((bank) => ({
  value: bank.code,
  label: `${bank.code} ${bank.name}`,
}));

export function emptyOwnAccountForm(): OwnAccountFormState {
  return {
    kind: "own_account",
    bankOption: "",
    customBankCode: "",
    accountSuffix: "",
    label: "",
  };
}

export function ownAccountFormFrom(account: {
  kind: OwnAccountKind;
  bankCode: string;
  accountSuffix: string;
  label: string | null;
}): OwnAccountFormState {
  const known = TAIWAN_BANKS.some((bank) => bank.code === account.bankCode);
  return {
    kind: account.kind,
    bankOption: known ? account.bankCode : OTHER_BANK_OPTION,
    customBankCode: known ? "" : account.bankCode,
    accountSuffix: account.accountSuffix,
    label: account.label ?? "",
  };
}

function toHalfWidthDigits(value: string) {
  return value.normalize("NFKC").replace(/[\s-]/g, "");
}

export function validateOwnAccountForm(
  form: OwnAccountFormState,
): OwnAccountFormResult {
  const errors: OwnAccountFormErrors = {};
  const bankCode = toHalfWidthDigits(
    form.bankOption === OTHER_BANK_OPTION
      ? form.customBankCode
      : form.bankOption,
  );
  if (!bankCode) errors.bankCode = "請選擇銀行。";
  else if (!isTaiwanBankCode(bankCode))
    errors.bankCode = "銀行代碼需為 3 位數字。";

  const accountSuffix = toHalfWidthDigits(form.accountSuffix);
  if (!accountSuffix) errors.accountSuffix = "請輸入帳號末 4–5 碼。";
  else if (!/^\d+$/.test(accountSuffix))
    errors.accountSuffix = "帳號末碼只能是數字。";
  else if (accountSuffix.length > 5)
    // 不接受完整帳號，也不自動截斷，避免使用者誤以為完整帳號會被保存。
    errors.accountSuffix = "只需輸入末 4–5 碼，請勿輸入完整帳號。";
  else if (!isValidOwnAccountSuffix(accountSuffix))
    errors.accountSuffix = "請輸入至少 4 碼。";

  const label = form.label.trim();
  if (label.length > OWN_ACCOUNT_LABEL_MAX_LENGTH)
    errors.label = `名稱最多 ${OWN_ACCOUNT_LABEL_MAX_LENGTH} 個字。`;

  if (Object.keys(errors).length > 0) return { valid: false, errors };
  return {
    valid: true,
    input: { kind: form.kind, bankCode, accountSuffix, label: label || null },
  };
}
