import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CardIssuerSummary } from "@taiwan-fin-hub/core";
import { getCardsSummary } from "../../../src/features/cards/service";
import { createTestD1 } from "../../../../../packages/db/testing/d1";
import { CREATED, NOW, seedCards } from "./fixtures";

describe("credit card page ignores excluded activities", () => {
  let harness: Awaited<ReturnType<typeof createTestD1>>;
  let db: D1Database;

  beforeAll(async () => {
    harness = await createTestD1();
    db = harness.binding;
    await seedCards(db);
  }, 60_000);

  afterAll(async () => {
    await harness?.mf.dispose();
  });

  async function byIssuer() {
    const summary = await getCardsSummary(db, NOW);
    return new Map<string, CardIssuerSummary>(
      summary.issuers.map((issuer) => [issuer.issuer, issuer]),
    );
  }

  function exclude(id: string) {
    return db
      .prepare(
        "INSERT INTO activity_role_overrides (target_kind, target_id, economic_role, review_status, created_at, updated_at) VALUES ('bank_transaction', ?1, 'excluded', 'confirmed', ?2, ?2)",
      )
      .bind(id, CREATED);
  }

  it("drops excluded spending from unbilled totals and statement estimates, and excluded payments from bills", async () => {
    const before = await byIssuer();
    const cathayBefore = before.get("cathaybk")!;
    const esunBefore = before.get("esun")!;
    expect(cathayBefore.currentBill?.paidAmount).toBe(10000);

    await db.batch([
      // 國泰未出帳的 1200 消費、玉山推估帳單內的 500 消費、國泰本期兩端繳款。
      exclude("c1111-shop"),
      exclude("esun-b"),
      exclude("cathay-pay-bank"),
      exclude("cathay-pay-card"),
    ]);
    const after = await byIssuer();
    const cathay = after.get("cathaybk")!;
    expect(cathay.unbilled.amount).toBe(cathayBefore.unbilled.amount - 1200);
    expect(cathay.unbilled.transactionCount).toBe(
      cathayBefore.unbilled.transactionCount - 1,
    );
    expect(
      cathay.cards.find((card) => card.last4 === "1111")?.unbilledAmount,
    ).toBe(-200);
    expect(cathay.currentBill).toMatchObject({
      paidAmount: 0,
      payments: [],
      paymentStatus: "unpaid",
    });
    const esun = after.get("esun")!;
    expect(esun.currentBill?.statementEstimated).toBe(true);
    expect(esun.currentBill?.statementBalance).toBe(
      esunBefore.currentBill!.statementBalance! - 500,
    );
  });
});
