import { describe, expect, it } from "vitest";
import {
  OTHER_BANK_OPTION,
  emptyOwnAccountForm,
  ownAccountBankOptions,
  ownAccountFormFrom,
  validateOwnAccountForm,
} from "./own-account-form";

describe("own account form", () => {
  it("accepts a known bank with the last five digits and trims the label", () => {
    expect(
      validateOwnAccountForm({
        ...emptyOwnAccountForm(),
        bankOption: "812",
        accountSuffix: " 12345 ",
        label: "  台新活存 ",
      }),
    ).toEqual({
      valid: true,
      input: {
        kind: "own_account",
        bankCode: "812",
        accountSuffix: "12345",
        label: "台新活存",
      },
    });
  });

  it("accepts four digits, full-width digits and a custom bank code", () => {
    expect(
      validateOwnAccountForm({
        kind: "unsynced_card",
        bankOption: OTHER_BANK_OPTION,
        customBankCode: "１１８",
        accountSuffix: "０１２３",
        label: "",
      }),
    ).toEqual({
      valid: true,
      input: {
        kind: "unsynced_card",
        bankCode: "118",
        accountSuffix: "0123",
        label: null,
      },
    });
  });

  it("rejects full account numbers instead of truncating them", () => {
    const result = validateOwnAccountForm({
      ...emptyOwnAccountForm(),
      bankOption: "012",
      accountSuffix: "0111100066666",
    });
    expect(result).toEqual({
      valid: false,
      errors: { accountSuffix: "只需輸入末 4–5 碼，請勿輸入完整帳號。" },
    });
  });

  it("reports missing and malformed fields", () => {
    expect(validateOwnAccountForm(emptyOwnAccountForm())).toEqual({
      valid: false,
      errors: {
        bankCode: "請選擇銀行。",
        accountSuffix: "請輸入帳號末 4–5 碼。",
      },
    });
    expect(
      validateOwnAccountForm({
        kind: "own_account",
        bankOption: OTHER_BANK_OPTION,
        customBankCode: "12",
        accountSuffix: "12a4",
        label: "x".repeat(41),
      }),
    ).toEqual({
      valid: false,
      errors: {
        bankCode: "銀行代碼需為 3 位數字。",
        accountSuffix: "帳號末碼只能是數字。",
        label: "名稱最多 40 個字。",
      },
    });
    expect(
      validateOwnAccountForm({
        ...emptyOwnAccountForm(),
        bankOption: "812",
        accountSuffix: "123",
      }),
    ).toMatchObject({
      valid: false,
      errors: { accountSuffix: "請輸入至少 4 碼。" },
    });
  });

  it("restores edit state for known and unknown bank codes", () => {
    expect(
      ownAccountFormFrom({
        kind: "own_account",
        bankCode: "812",
        accountSuffix: "12345",
        label: null,
      }),
    ).toEqual({
      kind: "own_account",
      bankOption: "812",
      customBankCode: "",
      accountSuffix: "12345",
      label: "",
    });
    expect(
      ownAccountFormFrom({
        kind: "unsynced_card",
        bankCode: "118",
        accountSuffix: "1234",
        label: "板信",
      }),
    ).toEqual({
      kind: "unsynced_card",
      bankOption: OTHER_BANK_OPTION,
      customBankCode: "118",
      accountSuffix: "1234",
      label: "板信",
    });
  });

  it("lists bank options with code and name", () => {
    expect(ownAccountBankOptions).toContainEqual({
      value: "812",
      label: "812 台新銀行",
    });
  });
});
