import { describe, expect, it } from "vitest";
import { isCardPaymentText } from "../../../src/features/bank/calculation-service";

describe("isCardPaymentText", () => {
  it("存款端摘要只有「銀行簡稱＋卡」時視為自動扣繳卡費", () => {
    expect(
      isCardPaymentText({ accountType: "savings", description: "中信卡" }),
    ).toBe(true);
    expect(
      isCardPaymentText({
        accountType: "savings",
        description: " 國泰世華卡 ",
      }),
    ).toBe(true);
  });

  it("信用卡端的本行扣繳入帳視為繳款", () => {
    expect(
      isCardPaymentText({ accountType: "credit", description: "本行扣繳" }),
    ).toBe(true);
    expect(
      isCardPaymentText({ accountType: "credit", description: "自動扣繳" }),
    ).toBe(true);
  });

  it("不把含其他文字的描述或信用卡端交易誤判為繳卡費", () => {
    expect(
      isCardPaymentText({ accountType: "savings", description: "中信卡友日" }),
    ).toBe(false);
    expect(
      isCardPaymentText({ accountType: "credit", description: "中信卡" }),
    ).toBe(false);
    expect(
      isCardPaymentText({ accountType: "savings", description: "悠遊卡" }),
    ).toBe(false);
  });
});
