import { describe, expect, it } from "vitest";
import { appendCathayDepositTransactions } from "../../src/connectors/cathaybk";
import { bankTransactionRecord } from "../../src/features/sync/record-mapper";

const FULL_OUT = "0000111100066666";
const FULL_IN = "0000333300088888";

function append(
  details: Parameters<typeof appendCathayDepositTransactions>[1],
) {
  const target: Parameters<typeof appendCathayDepositTransactions>[0] = [];
  appendCathayDepositTransactions(target, details, "bank:cathaybk:1234", "TWD");
  return target;
}

describe("Cathay deposit counterparties", () => {
  it("derives a masked counterparty for outgoing transfers", () => {
    const [transaction] = append([
      {
        txnDateTime: "2026/09/01T10:00:00",
        description: "電子轉出",
        expendAmt: 27000,
        expendBankId: "012",
        expendAcctNo: FULL_OUT,
        specialMemo: `(012)${FULL_OUT}；`,
        memo: "",
      },
    ]);

    expect(transaction).toMatchObject({
      description: "電子轉出",
      counterparty: "台北富邦 …66666",
      counterpartyAccount: { bankCode: "012", accountSuffix: "66666" },
      sourceId: "2026-09-01T10:00:00:bank:cathaybk:1234:-27000:電子轉出:1",
    });
    expect(transaction?.raw).toMatchObject({
      expendAcctNo: "…66666",
      specialMemo: "(012)…66666；",
      duplicateOccurrence: 1,
    });
    expect(JSON.stringify(transaction)).not.toContain(FULL_OUT);
    expect(JSON.stringify(transaction)).not.toContain("11100066666");
  });

  it("reads incoming transfers from the special memo", () => {
    const [transaction] = append([
      {
        txnDateTime: "2026/09/02T10:00:00",
        description: "跨行轉入",
        incomeAmt: 5000,
        expendBankId: "",
        expendAcctNo: "",
        specialMemo: `(807)${FULL_IN}；`,
      },
    ]);

    expect(transaction).toMatchObject({
      counterparty: "永豐 …88888",
      counterpartyAccount: { bankCode: "807", accountSuffix: "88888" },
    });
    expect(JSON.stringify(transaction)).not.toContain(FULL_IN);
  });

  it("keeps rows without an identifiable account unchanged", () => {
    const [cardless, wallet, description] = append([
      {
        txnDateTime: "2026/09/03T10:00:00",
        description: "無卡提款",
        memo: "0130VDBG",
        expendAmt: 1000,
        expendBankId: "   ",
        expendAcctNo: "0000000000000000",
      },
      {
        txnDateTime: "2026/09/03T11:00:00",
        description: "電支交易",
        memo: "街口儲值            P0000000000000011111",
        expendAmt: 500,
        expendBankId: "013",
        expendAcctNo: "0000000000000000",
        specialMemo: "(013)街口電子支付股份有限公司",
      },
      {
        txnDateTime: "2026/09/03T12:00:00",
        description: "轉帳",
        memo: "台新銀行          轉存款",
        expendAmt: 3000,
      },
    ]);

    for (const transaction of [cardless, wallet, description]) {
      expect(transaction?.counterparty).toBeUndefined();
      expect(transaction?.counterpartyAccount).toBeUndefined();
    }
    // Description and memo stay intact because they are part of sourceId.
    expect(wallet?.sourceId).toContain("P0000000000000011111");
  });

  it("writes the masked counterparty columns through the record mapper", () => {
    const [transaction] = append([
      {
        txnDateTime: "2026/09/01T10:00:00",
        description: "電子轉出",
        expendAmt: 27000,
        expendBankId: "012",
        expendAcctNo: FULL_OUT,
      },
    ]);
    const record = bankTransactionRecord(
      "cathaybk",
      transaction!,
      "2026-09-01T00:00:00.000Z",
    );

    expect(record.payload).toMatchObject({
      counterparty: "台北富邦 …66666",
      counterparty_bank_code: "012",
      counterparty_account_suffix: "66666",
    });
    expect(JSON.stringify(record.payload)).not.toContain(FULL_OUT);
  });
});
