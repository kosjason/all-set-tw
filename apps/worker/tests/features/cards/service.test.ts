import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CardIssuerSummary } from "@taiwan-fin-hub/core";
import { cardRoutes } from "../../../src/features/cards/route";
import { loadBankRange } from "../../../src/features/bank/service";
import {
  getCardIssuerBills,
  getCardsSummary,
} from "../../../src/features/cards/service";
import { honoFactory } from "../../../src/platform/hono";
import { apiErrorResponse } from "../../../src/platform/http";
import type { Env } from "../../../src/platform/env";
import { createTestD1 } from "../../../../../packages/db/testing/d1";
import {
  accountStatement,
  accounts,
  billStatement,
  bills,
  NOW,
  seedCards,
  transactionStatement,
  transactions,
} from "./fixtures";

describe("credit card summary", () => {
  let harness: Awaited<ReturnType<typeof createTestD1>>;
  let db: D1Database;
  const app = honoFactory.createApp();
  app.route("/api", cardRoutes);
  app.onError(apiErrorResponse);

  beforeAll(async () => {
    harness = await createTestD1();
    db = harness.binding;
    await seedCards(db);
  }, 60_000);

  afterAll(async () => {
    await harness?.mf.dispose();
  });

  async function issuers() {
    const summary = await getCardsSummary(db, NOW);
    return {
      summary,
      byIssuer: new Map(
        summary.issuers.map((issuer) => [issuer.issuer, issuer]),
      ) as Map<string, CardIssuerSummary>,
    };
  }

  it("groups Cathay's four cards under one combined statement and counts one payment once", async () => {
    const { byIssuer } = await issuers();
    const cathay = byIssuer.get("cathaybk")!;
    expect(cathay).toMatchObject({
      name: "國泰世華銀行",
      bankCode: "013",
      combinedStatement: true,
      estimated: false,
      estimatedReasons: [],
      source: { connectorId: "cathaybk", mode: "sync", lastStatus: "success" },
      lastUpdatedAt: "2026-09-25T22:00:00.000Z",
    });
    expect(cathay.currentBill).toMatchObject({
      billingPeriod: "2026-09",
      statementBalance: 30000,
      minimumPayment: 3000,
      statementClosingDate: "2026-09-06",
      paymentDueDate: "2026-10-01",
      daysUntilDue: 5,
      // 存款端 10000 與卡片端 10000 是同一筆錢。
      paidAmount: 10000,
      remainingAmount: 20000,
      paymentStatus: "partial",
      minimumPaid: true,
    });
    expect(
      cathay.currentBill!.payments.map((payment) => payment.side).sort(),
    ).toEqual(["bank", "card"]);
    expect(cathay.cards.map((card) => card.last4).sort()).toEqual([
      "1111",
      "2222",
      "3333",
      "4444",
    ]);
  });

  it("sums unbilled spending after the closing date including pending, per card", async () => {
    const { byIssuer } = await issuers();
    const cathay = byIssuer.get("cathaybk")!;
    // 1111：1200 − 退貨 200；2222：待入帳 800；4444：結帳日後才入帳的 300；3333 已出帳。
    expect(cathay.unbilled).toMatchObject({
      since: "2026-09-07",
      amount: 2100,
      pendingAmount: 800,
      transactionCount: 4,
      missingCurrencies: [],
    });
    const cards = new Map(cathay.cards.map((card) => [card.last4, card]));
    expect(cards.get("1111")).toMatchObject({
      name: "國泰信用卡 1111",
      unbilledAmount: 1000,
      pendingAmount: 0,
      transactionCount: 2,
      activityFilter: {
        q: "國泰信用卡 1111",
        source: "card",
        from: "2026-09-07",
      },
      activityFilterExact: true,
    });
    expect(cards.get("2222")).toMatchObject({
      unbilledAmount: 800,
      pendingAmount: 800,
    });
    expect(cards.get("3333")).toMatchObject({
      unbilledAmount: 0,
      transactionCount: 0,
    });
    expect(cards.get("4444")).toMatchObject({ unbilledAmount: 300 });

    const taishin = byIssuer.get("taishin")!;
    expect(taishin.unbilled).toMatchObject({
      since: "2026-09-11",
      amount: 1000,
      pendingAmount: 400,
    });
    const taishinCards = new Map(
      taishin.cards.map((card) => [card.last4, card]),
    );
    expect(taishinCards.get("5555")).toMatchObject({
      name: "台新信用卡 5555",
      unbilledAmount: 600,
      activityFilter: { q: "台新信用卡" },
      // 交易 API 帶逐筆 cardLast4，多卡共用帳戶也能精準篩到該卡。
      activityFilterExact: true,
    });
    expect(taishinCards.get("6666")).toMatchObject({
      unbilledAmount: 400,
      pendingAmount: 400,
    });
  });

  it("sums each card's spending within the current statement period", async () => {
    const { byIssuer } = await issuers();
    const cathay = byIssuer.get("cathaybk")!;
    // 上期結帳 08-06、本期結帳 09-06。
    expect(cathay.statementPeriod).toEqual({
      from: "2026-08-07",
      to: "2026-09-06",
    });
    const cards = new Map(cathay.cards.map((card) => [card.last4, card]));
    // 3333 在結帳日前刷卡入帳，屬於本期；4444 結帳日後才入帳，屬於下一期。
    expect(cards.get("3333")).toMatchObject({
      statementAmount: 500,
      statementTransactionCount: 1,
      unbilledAmount: 0,
    });
    expect(cards.get("4444")).toMatchObject({
      statementAmount: 0,
      unbilledAmount: 300,
    });
    expect(cards.get("1111")).toMatchObject({ statementAmount: 0 });

    // 玉山上期結帳 08-15、本期結帳 09-15。
    const esun = byIssuer.get("esun")!;
    expect(esun.statementPeriod).toEqual({
      from: "2026-08-16",
      to: "2026-09-15",
    });
    expect(
      esun.cards.reduce((sum, card) => sum + (card.statementAmount ?? 0), 0),
    ).toBe(2000);
  });

  it("exposes each card transaction's last four digits without the full number", async () => {
    const bank = await loadBankRange(db, {
      from: "2026-09-01",
      to: "2026-09-30",
    });
    const byId = new Map(
      bank.transactions.map((transaction) => [transaction.id, transaction]),
    );
    expect(byId.get("t5555-shop")?.cardLast4).toBe("5555");
    expect(byId.get("t6666-pending")?.cardLast4).toBe("6666");
    expect(byId.get("c1111-shop")?.cardLast4).toBe("1111");
    expect(byId.get("c4444-late-post")?.cardLast4).toBe("4444");
    // 沒有卡號的刷卡與存款交易不帶 cardLast4。
    expect(byId.get("c3333-billed")?.cardLast4 ?? null).toBeNull();
    expect(byId.get("cathay-pay-bank")?.cardLast4 ?? null).toBeNull();
  });

  it("derives paid, unpaid, unknown and estimated statuses", async () => {
    const { byIssuer } = await issuers();
    expect(byIssuer.get("taishin")!.currentBill).toMatchObject({
      paymentStatus: "paid",
      paidAmount: 8000,
      remainingAmount: 0,
      daysUntilDue: 2,
    });
    expect(byIssuer.get("ctbc")).toMatchObject({
      estimated: true,
      estimatedReasons: ["manual_import"],
      source: { mode: "manual_import" },
      currentBill: {
        paymentStatus: "unpaid",
        paidAmount: 0,
        remainingAmount: 5000,
        minimumPaid: false,
        daysUntilDue: 4,
      },
    });
    expect(byIssuer.get("ctbc")!.cards).toMatchObject([
      { last4: "7777", name: "LINE Pay卡 7777" },
    ]);
    expect(byIssuer.get("esun")).toMatchObject({
      estimated: true,
      estimatedReasons: ["statement_from_transactions"],
      currentBill: {
        statementBalance: 2000,
        statementEstimated: true,
        paymentStatus: "unpaid",
      },
    });
    expect(byIssuer.get("sinopac")!.currentBill).toMatchObject({
      statementBalance: null,
      paymentStatus: "unknown",
      remainingAmount: null,
    });
  });

  it("totals the statements and picks the nearest unpaid due date", async () => {
    const { summary } = await issuers();
    expect(summary.asOf).toBe("2026-09-26");
    expect(summary.totals).toEqual({
      statementBalance: 30000 + 8000 + 5000 + 2000,
      remainingAmount: 20000 + 5000 + 2000,
      unbilledAmount: 2100 + 1000,
    });
    // 台新 09-28 已繳，最近未繳的是中信 09-30。
    expect(summary.nextDue).toEqual({
      issuer: "ctbc",
      name: "中國信託銀行",
      paymentDueDate: "2026-09-30",
      daysUntilDue: 4,
      remainingAmount: 5000,
      paymentStatus: "unpaid",
    });
  });

  it("marks the bill paid once the remaining payment arrives on either side", async () => {
    await db.batch([
      transactionStatement(db, {
        id: "cathay-pay-2",
        account: "cathay-main",
        connector: "cathaybk",
        day: "2026-09-25",
        amount: 20000,
        description: "本行自動扣繳",
        counterparty: "國泰世華信用卡繳款",
      }),
    ]);
    const { byIssuer } = await issuers();
    expect(byIssuer.get("cathaybk")!.currentBill).toMatchObject({
      paidAmount: 30000,
      remainingAmount: 0,
      paymentStatus: "paid",
    });
    await db
      .prepare("DELETE FROM bank_transactions WHERE id = 'cathay-pay-2'")
      .run();
  });

  it("returns bill history per issuer and a 404 for unknown issuers", async () => {
    const history = await getCardIssuerBills(db, "cathaybk", NOW);
    expect(history).toMatchObject({ issuer: "cathaybk", name: "國泰世華銀行" });
    expect(history.bills.map((bill) => bill.billingPeriod)).toEqual([
      "2026-09",
      "2026-08",
    ]);
    expect(history.bills[1]).toMatchObject({
      statementBalance: 20000,
      paymentStatus: "paid",
    });

    const missing = await app.request("/api/cards/unknown/bills", {}, {
      DB: db,
    } as Env);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({
      error: { code: "CARD_ISSUER_NOT_FOUND" },
    });
    const invalid = await app.request("/api/cards/Bad%20Issuer/bills", {}, {
      DB: db,
    } as Env);
    expect(invalid.status).toBe(400);
    const summary = await app.request("/api/cards/summary", {}, {
      DB: db,
    } as Env);
    expect(summary.status).toBe(200);
  });
});

describe("statement period without a previous bill", () => {
  it("loads and sums a lone issuer's spending back to one month before the closing date", async () => {
    const harness = await createTestD1();
    try {
      const db = harness.binding;
      await db.batch([
        ...accounts
          .filter((account) => account.connector === "esun")
          .map((account) => accountStatement(db, account)),
        ...bills
          .filter(
            (bill) => bill.connector === "esun" && bill.period === "2026-09",
          )
          .map((bill) => billStatement(db, bill)),
        ...transactions
          .filter((tx) => tx.connector === "esun")
          .map((tx) => transactionStatement(db, tx)),
      ]);
      const summary = await getCardsSummary(db, NOW);
      const esun = summary.issuers.find((issuer) => issuer.issuer === "esun")!;
      // 沒有上期帳單：由 09-15 往前一個月推算為 08-16 起，08-20 的刷卡也要載入並計入。
      expect(esun.statementPeriod).toEqual({
        from: "2026-08-16",
        to: "2026-09-15",
      });
      expect(
        esun.cards.reduce((sum, card) => sum + (card.statementAmount ?? 0), 0),
      ).toBe(2000);
    } finally {
      await harness.mf.dispose();
    }
  }, 60_000);
});
