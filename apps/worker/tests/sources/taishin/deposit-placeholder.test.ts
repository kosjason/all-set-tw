import { describe, expect, it } from "vitest";
import { fetchTaishinDeposits } from "../../../src/sources/taishin/deposit-protocol";
import {
  bankNow,
  depositRequest,
  FX_ACCOUNT,
  fxOverview,
} from "./fixtures/bank-data";

// 實測：台新會在外幣帳戶清單放一筆幣別代碼空白（三個空白、無幣別名稱）的佔位明細。
const PLACEHOLDER_ACCOUNT = "0000999988887777";

function withPlaceholder(groups: unknown[]) {
  return async (path: string, body: Record<string, unknown> | string) => {
    if (path.endsWith("/getRB08000100Data")) {
      const overview = structuredClone(fxOverview);
      overview.data.FCS_ACCOUNT = groups as typeof overview.data.FCS_ACCOUNT;
      return overview;
    }
    return depositRequest(path, body);
  };
}

const placeholderDetail = {
  ACCOUNT_NO: PLACEHOLDER_ACCOUNT,
  CURRENCY_CODE: "   ",
  CURRENCY_NAME: "",
  BALANCE: "0",
};

describe("台新外幣帳戶清單的佔位明細", () => {
  it("略過只有佔位明細的帳戶，其他外幣帳戶照常同步", async () => {
    const data = await fetchTaishinDeposits(
      withPlaceholder([
        {
          ACCOUNT_NO: PLACEHOLDER_ACCOUNT,
          ACCOUNT_NAME: "外幣綜存",
          FCS_ACCOUNT_DETAIL: [placeholderDetail],
        },
        ...fxOverview.data.FCS_ACCOUNT,
      ]),
      bankNow,
    );
    expect(data.bankAccounts.map((row) => row.currency)).toEqual([
      "TWD",
      "USD",
      "JPY",
    ]);
    expect(JSON.stringify(data)).not.toContain(PLACEHOLDER_ACCOUNT);
  });

  it("同一帳戶裡的佔位明細不影響有效幣別", async () => {
    const [group] = fxOverview.data.FCS_ACCOUNT;
    const data = await fetchTaishinDeposits(
      withPlaceholder([
        {
          ...group,
          FCS_ACCOUNT_DETAIL: [
            { ...placeholderDetail, ACCOUNT_NO: FX_ACCOUNT },
            ...group!.FCS_ACCOUNT_DETAIL,
          ],
        },
      ]),
      bankNow,
    );
    expect(data.bankAccounts.map((row) => row.currency)).toEqual([
      "TWD",
      "USD",
      "JPY",
    ]);
  });

  it("非空白但格式錯誤的幣別仍然失敗", async () => {
    const [group] = fxOverview.data.FCS_ACCOUNT;
    await expect(
      fetchTaishinDeposits(
        withPlaceholder([
          {
            ...group,
            FCS_ACCOUNT_DETAIL: [
              { ...group!.FCS_ACCOUNT_DETAIL[0], CURRENCY_CODE: "usd" },
            ],
          },
        ]),
        bankNow,
      ),
    ).rejects.toThrow("台新存款外幣帳戶清單格式已改變。");
  });
});
