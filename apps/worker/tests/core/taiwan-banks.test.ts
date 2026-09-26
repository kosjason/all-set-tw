import { describe, expect, it } from "vitest";
import {
  TAIWAN_BANKS,
  buildActivityItems,
  counterpartyAccountLabel,
  deriveCounterpartyAccount,
  findOwnAccount,
  matchesOwnAccount,
  ownAccountDisplayName,
  formatCounterpartyAccount,
  maskAccountNumbers,
  parseBankAccountMemo,
  taiwanBankName,
  taiwanBankShortName,
} from "@taiwan-fin-hub/core";

describe("Taiwan bank codes", () => {
  it("covers common banks with unique three-digit codes", () => {
    const codes = TAIWAN_BANKS.map((bank) => bank.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((code) => /^\d{3}$/.test(code))).toBe(true);
    expect(
      Object.fromEntries(
        [
          "004",
          "005",
          "006",
          "007",
          "008",
          "009",
          "012",
          "013",
          "017",
          "700",
          "803",
          "807",
          "808",
          "810",
          "812",
          "822",
          "824",
          "826",
        ].map((code) => [code, taiwanBankShortName(code)]),
      ),
    ).toEqual({
      "004": "臺灣銀行",
      "005": "土地銀行",
      "006": "合作金庫",
      "007": "第一銀行",
      "008": "華南銀行",
      "009": "彰化銀行",
      "012": "台北富邦",
      "013": "國泰世華",
      "017": "兆豐",
      "700": "中華郵政",
      "803": "聯邦",
      "807": "永豐",
      "808": "玉山",
      "810": "星展",
      "812": "台新",
      "822": "中國信託",
      "824": "連線商業銀行",
      "826": "樂天",
    });
  });

  it("keeps full institution names and falls back to the numeric code", () => {
    expect(taiwanBankName("012")).toBe("台北富邦銀行");
    expect(taiwanBankName("999")).toBeUndefined();
    expect(taiwanBankName(null)).toBeUndefined();
    expect(taiwanBankShortName("999")).toBe("999");
  });
});

describe("counterparty accounts", () => {
  const full = "0000111100066666";

  it("keeps only the bank code and last five digits", () => {
    const account = deriveCounterpartyAccount(" 012 ", full);
    expect(account).toEqual({ bankCode: "012", accountSuffix: "66666" });
    expect(JSON.stringify(account)).not.toContain(full);
    expect(formatCounterpartyAccount(account!)).toBe("台北富邦 …66666");
    expect(
      formatCounterpartyAccount({ bankCode: "999", accountSuffix: "12345" }),
    ).toBe("999 …12345");
  });

  it("rejects missing, short, non-numeric and all-zero accounts", () => {
    expect(deriveCounterpartyAccount("", full)).toBeUndefined();
    expect(deriveCounterpartyAccount("   ", full)).toBeUndefined();
    expect(deriveCounterpartyAccount("12", full)).toBeUndefined();
    expect(deriveCounterpartyAccount("012", "1234567")).toBeUndefined();
    expect(deriveCounterpartyAccount("012", "0130VDBG")).toBeUndefined();
    expect(
      deriveCounterpartyAccount("013", "0000000000000000"),
    ).toBeUndefined();
    expect(deriveCounterpartyAccount(null, full)).toBeUndefined();
    expect(deriveCounterpartyAccount("012", 11100066666)).toBeUndefined();
  });

  it("parses bank-account memos and ignores names", () => {
    expect(parseBankAccountMemo(`(807)0000333300088888；`)).toEqual({
      bankCode: "807",
      accountSuffix: "88888",
    });
    expect(parseBankAccountMemo(`（807）0000333300088888;`)).toEqual({
      bankCode: "807",
      accountSuffix: "88888",
    });
    expect(
      parseBankAccountMemo("(013)街口電子支付股份有限公司"),
    ).toBeUndefined();
    expect(parseBankAccountMemo("台新銀行 轉存款")).toBeUndefined();
    expect(parseBankAccountMemo(undefined)).toBeUndefined();
  });

  it("masks long digit runs for diagnostics", () => {
    expect(maskAccountNumbers(`(012)${full}；`)).toBe("(012)…66666；");
    expect(maskAccountNumbers("P0000000000000011111")).toBe("P…11111");
    expect(maskAccountNumbers("12345 ABC")).toBe("12345 ABC");
  });

  it("labels the transfer direction", () => {
    expect(
      counterpartyAccountLabel({
        amount: -27000,
        counterpartyBankCode: "012",
        counterpartyAccountSuffix: "66666",
      }),
    ).toBe("→ 台北富邦 …66666");
    expect(
      counterpartyAccountLabel({
        amount: 5000,
        counterpartyBankCode: "807",
        counterpartyAccountSuffix: "88888",
      }),
    ).toBe("← 永豐 …88888");
    expect(counterpartyAccountLabel({ amount: -1 })).toBeUndefined();
  });
});

describe("own account matching helpers", () => {
  const own = { bankCode: "012", accountSuffix: "77777" };

  it("matches the same bank and suffix only", () => {
    expect(
      matchesOwnAccount({ bankCode: "012", accountSuffix: "77777" }, own),
    ).toBe(true);
    expect(
      matchesOwnAccount({ bankCode: "012", accountSuffix: "66666" }, own),
    ).toBe(false);
    expect(
      matchesOwnAccount({ bankCode: "013", accountSuffix: "77777" }, own),
    ).toBe(false);
    expect(
      matchesOwnAccount(
        { bankCode: "012", accountSuffix: "77777" },
        { bankCode: "012", accountSuffix: "777" },
      ),
    ).toBe(false);
  });

  it("prefers the most specific declared suffix", () => {
    const short = { id: "short", bankCode: "812", accountSuffix: "2345" };
    const long = { id: "long", bankCode: "812", accountSuffix: "12345" };
    expect(
      findOwnAccount({ bankCode: "812", accountSuffix: "12345" }, [short, long])
        ?.id,
    ).toBe("long");
    expect(
      findOwnAccount({ bankCode: "812", accountSuffix: "92345" }, [short, long])
        ?.id,
    ).toBe("short");
    expect(findOwnAccount(undefined, [short])).toBeUndefined();
  });

  it("names accounts by label or masked bank suffix", () => {
    expect(ownAccountDisplayName({ ...own, label: " 富邦活存 " })).toBe(
      "富邦活存",
    );
    expect(ownAccountDisplayName({ ...own, label: null })).toBe(
      "台北富邦 …77777",
    );
  });

  it("marks own-account and unsynced-card activities", () => {
    const base = {
      connectorId: "cathaybk",
      sourceId: "source",
      accountId: "deposit",
      currency: "TWD",
      status: "posted",
      description: "電子轉出",
      counterpartyBankCode: "012",
      counterpartyAccountSuffix: "77777",
    };
    const items = buildActivityItems(
      [
        {
          ...base,
          id: "own",
          amount: -100,
          ownAccount: { id: "o", kind: "own_account", label: "富邦活存" },
        },
        {
          ...base,
          id: "card",
          amount: -200,
          ownAccount: { id: "c", kind: "unsynced_card", label: "星展信用卡" },
        },
        { ...base, id: "in", amount: 300 },
      ],
      [],
      [],
      new Map([["deposit", { id: "deposit", accountType: "savings" }]]),
      { transactionToInvoice: new Map(), invoiceToTransactionId: new Map() },
    );
    expect(
      items
        .map((item) => [
          item.id,
          item.counterpartyAccount,
          item.ownAccountTransfer?.marker,
        ])
        .sort(),
    ).toEqual([
      ["card", "→ 台北富邦 …77777", "未同步的卡片"],
      ["in", "← 台北富邦 …77777", undefined],
      ["own", "→ 台北富邦 …77777", "轉到自己的帳戶"],
    ]);
  });
});
