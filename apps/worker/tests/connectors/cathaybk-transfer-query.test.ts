import { describe, expect, it } from "vitest";
import {
  classifyCathayReplay,
  describeCathayTransferQuery,
  replayableHeaders,
  rewriteCathayTransferQuery,
} from "../../src/connectors/cathaybk-transfer-query";

const NOW = new Date("2026-10-04T04:00:00.000Z");
const rewrite = (body: unknown, options = {}) =>
  rewriteCathayTransferQuery(JSON.stringify(body), {
    fromAccount: "111122223333",
    toAccount: "444455556666",
    lookbackDays: 90,
    now: NOW,
    ...options,
  });

describe("rewriteCathayTransferQuery", () => {
  it("swaps the zero-padded account and extends the start date", () => {
    const result = rewrite({
      header: { channel: "WEB" },
      body: {
        accountNumber: "0000111122223333",
        startDate: "2026/09/04",
        endDate: "2026/10/04",
        pageSize: "20",
      },
    });
    expect(result.accountReplaced).toBe(true);
    expect(result.accountKeys).toEqual(["accountNumber"]);
    expect(result.datesExtended).toBe(true);
    expect(JSON.parse(result.body)).toEqual({
      header: { channel: "WEB" },
      body: {
        accountNumber: "0000444455556666",
        startDate: "2026/07/06",
        endDate: "2026/10/04",
        pageSize: "20",
      },
    });
  });

  it("handles plain account numbers, compact and ROC dates", () => {
    expect(
      JSON.parse(
        rewrite({ acct: "111122223333", from: "20261004", to: "20260904" })
          .body,
      ),
    ).toEqual({ acct: "444455556666", from: "20261004", to: "20260706" });
    expect(
      JSON.parse(
        rewrite({ acct: "111122223333", s: "1150904", e: "1151004" }).body,
      ),
    ).toEqual({ acct: "444455556666", s: "1150706", e: "1151004" });
  });

  it("only extends a recent, same-format start and end pair", () => {
    // 格式不同
    expect(
      rewrite({ acct: "111122223333", s: "2026/09/04", e: "20261004" })
        .datesExtended,
    ).toBe(false);
    // 同一天（可能是系統日或交易日，不是區間）
    expect(
      rewrite({ acct: "111122223333", s: "2026/10/04", e: "2026/10/04" })
        .datesExtended,
    ).toBe(false);
    // 結束日不在最近 3 天內
    expect(
      rewrite({ acct: "111122223333", s: "2026/08/01", e: "2026/09/01" })
        .datesExtended,
    ).toBe(false);
  });

  it("only swaps currency values in currency fields", () => {
    expect(
      JSON.parse(
        rewrite(
          { acct: "111122223333", curCode: "TWD", note: "TWD" },
          { fromCurrency: "TWD", toCurrency: "USD" },
        ).body,
      ),
    ).toEqual({ acct: "444455556666", curCode: "USD", note: "TWD" });
  });

  it("swaps the currency only together with a different account currency", () => {
    expect(
      JSON.parse(
        rewrite(
          { acct: "111122223333", currency: "TWD" },
          { fromCurrency: "TWD", toCurrency: "TWD" },
        ).body,
      ),
    ).toEqual({ acct: "444455556666", currency: "TWD" });
  });

  it("does not touch other numbers or longer account numbers", () => {
    const result = rewrite({
      other: "9111122223333",
      amount: "111122223333000",
      count: "20",
    });
    expect(result.accountReplaced).toBe(false);
    expect(JSON.parse(result.body)).toEqual({
      other: "9111122223333",
      amount: "111122223333000",
      count: "20",
    });
  });

  it("keeps the dates when the template has no clear start and end", () => {
    expect(rewrite({ acct: "111122223333", period: "1M" }).datesExtended).toBe(
      false,
    );
    expect(
      rewrite({
        acct: "111122223333",
        a: "2026/09/01",
        b: "2026/09/15",
        c: "2026/10/01",
      }).datesExtended,
    ).toBe(false);
    // 不在合理範圍內的「日期」（例如其他代碼）不算。
    expect(
      rewrite({ acct: "111122223333", a: "19990101", b: "20991231" })
        .datesExtended,
    ).toBe(false);
  });

  it("does not shorten a window that is already long enough", () => {
    expect(
      JSON.parse(
        rewrite({ acct: "111122223333", s: "2026/01/01", e: "2026/10/04" })
          .body,
      ).s,
    ).toBe("2026/01/01");
  });

  it("returns the original body when the template is not JSON", () => {
    expect(
      rewriteCathayTransferQuery("acct=111122223333", {
        fromAccount: "111122223333",
        toAccount: "444455556666",
        lookbackDays: 90,
      }),
    ).toEqual({
      body: "acct=111122223333",
      accountReplaced: false,
      accountKeys: [],
      datesExtended: false,
    });
  });
});

describe("describeCathayTransferQuery", () => {
  it("reports only field names and value shapes", () => {
    const description = describeCathayTransferQuery(
      JSON.stringify({
        body: {
          accountNumber: "0000111122223333",
          startDate: "2026/09/04",
          currency: "TWD",
          memo: "王小明",
          items: [{ id: 1 }],
        },
      }),
    );
    expect(description).toEqual({
      parsed: true,
      shape: {
        body: {
          accountNumber: "digits16",
          startDate: "date10",
          currency: "alpha3",
          memo: "text3",
          items: [{ id: "number" }],
        },
      },
    });
    expect(JSON.stringify(description)).not.toMatch(/1111|王小明|TWD|2026/);
  });

  it("does not echo unparsable bodies", () => {
    expect(describeCathayTransferQuery("acct=111122223333")).toEqual({
      parsed: false,
      length: 17,
    });
    expect(describeCathayTransferQuery(undefined)).toEqual({ parsed: false });
  });
});

it("drops browser-managed and identifying headers before replay", () => {
  expect(
    replayableHeaders({
      ":authority": "www.cathaybk.com.tw",
      "content-type": "application/json",
      accept: "application/json",
      "x-csrf-token": "token",
      cookie: "a=b",
      referer: "https://www.cathaybk.com.tw/",
      "sec-ch-ua": "x",
      "user-agent": "x",
    }),
  ).toEqual({
    "content-type": "application/json",
    accept: "application/json",
    "x-csrf-token": "token",
  });
});

describe("classifyCathayReplay", () => {
  const replay = (
    overrides: Partial<
      Parameters<typeof classifyCathayReplay>[0] & object
    > = {},
  ) => ({
    status: 200,
    url: "https://www.cathaybk.com.tw/api/B_ACCT_Q_TransferDetail",
    redirected: false,
    contentType: "application/json",
    text: JSON.stringify({
      content: {
        datas: [{ accountNumber: "0000444455556666", details: [{}] }],
      },
    }),
    ...overrides,
  });
  const account = "444455556666";

  it("accepts transactions that all belong to the account", () => {
    expect(classifyCathayReplay(replay(), account)).toMatchObject({
      kind: "ok",
    });
  });

  it("treats redirects to login and 401/403 as a logged-out session", () => {
    expect(
      classifyCathayReplay(
        replay({
          redirected: true,
          url: "https://www.cathaybk.com.tw/MyBank/",
          contentType: "text/html",
          text: "<html>",
        }),
        account,
      ),
    ).toEqual({ kind: "logged-out" });
    expect(
      classifyCathayReplay(
        replay({
          url: "https://www.cathaybk.com.tw/OnlineBanking/Logout/SystemError",
        }),
        account,
      ),
    ).toEqual({ kind: "logged-out" });
    expect(classifyCathayReplay(replay({ status: 403 }), account)).toEqual({
      kind: "logged-out",
    });
  });

  it("fails on errors, HTML and missing data", () => {
    expect(classifyCathayReplay(null, account)).toMatchObject({
      kind: "failed",
      reason: "no-response",
    });
    expect(
      classifyCathayReplay(replay({ status: 500 }), account),
    ).toMatchObject({
      kind: "failed",
      reason: "status-500",
    });
    expect(
      classifyCathayReplay(replay({ text: "<html>error</html>" }), account),
    ).toMatchObject({ kind: "failed", reason: "not-json" });
    expect(
      classifyCathayReplay(
        replay({ text: JSON.stringify({ content: null }) }),
        account,
      ),
    ).toMatchObject({ kind: "failed", reason: "no-datas" });
  });

  it("rejects transactions for another account", () => {
    expect(
      classifyCathayReplay(
        replay({
          text: JSON.stringify({
            content: { datas: [{ accountNumber: "0000111122223333" }] },
          }),
        }),
        account,
      ),
    ).toMatchObject({ kind: "mismatch" });
  });

  it("only accepts an empty result that names the account", () => {
    expect(
      classifyCathayReplay(
        replay({
          text: JSON.stringify({
            content: { datas: [], query: { acct: "0000444455556666" } },
          }),
        }),
        account,
      ),
    ).toMatchObject({ kind: "ok", datas: [] });
    expect(
      classifyCathayReplay(
        replay({ text: JSON.stringify({ content: { datas: [] } }) }),
        account,
      ),
    ).toMatchObject({ kind: "unverified" });
  });
});
