import { describe, expect, it } from "vitest";
import {
  billingDay,
  cardPaymentSide,
  evaluateBill,
  mergeIssuerBills,
  transactionDay,
  type BillInput,
  type CardTransaction,
} from "../../../src/features/cards/billing";

const bill: BillInput = {
  billingPeriod: "2026-09",
  currency: "TWD",
  statementAmount: 10000,
  statementEstimated: false,
  minimumPayment: 1000,
  paymentDueDate: "2026-09-30",
  statementClosingDate: "2026-09-10",
  sourcePaidAmount: null,
  sourceIsPaid: false,
};

const payment = (amount: number, side: "bank" | "card") => ({
  transactionId: `${side}-${amount}`,
  date: "2026-09-20",
  amount,
  side,
  description: null,
});

describe("evaluateBill", () => {
  it("does not add the bank debit and the card credit of the same payment", () => {
    expect(
      evaluateBill(bill, [payment(4000, "bank"), payment(4000, "card")]),
    ).toMatchObject({ paidAmount: 4000, paymentStatus: "partial" });
  });

  it("uses the larger side when only one side has synced", () => {
    expect(
      evaluateBill(bill, [payment(3000, "bank"), payment(10000, "card")]),
    ).toMatchObject({ paidAmount: 10000, paymentStatus: "paid" });
  });

  it("trusts a source paid flag but never treats a false flag as unpaid evidence", () => {
    expect(evaluateBill({ ...bill, sourceIsPaid: true }, [])).toMatchObject({
      paymentStatus: "paid",
      remainingAmount: 0,
    });
    expect(
      evaluateBill({ ...bill, statementAmount: null, sourceIsPaid: true }, []),
    ).toMatchObject({ paymentStatus: "paid" });
    expect(
      evaluateBill({ ...bill, statementAmount: null }, [payment(1, "bank")]),
    ).toMatchObject({ paymentStatus: "unknown", remainingAmount: null });
  });

  it("treats a zero statement as paid and reports minimum payment coverage", () => {
    expect(evaluateBill({ ...bill, statementAmount: 0 }, [])).toMatchObject({
      paymentStatus: "paid",
    });
    expect(evaluateBill({ ...bill, sourcePaidAmount: 500 }, [])).toMatchObject({
      paymentStatus: "partial",
      minimumPaid: false,
    });
    expect(evaluateBill(bill, [])).toMatchObject({
      paymentStatus: "unpaid",
      remainingAmount: 10000,
      minimumPaid: false,
    });
  });
});

describe("mergeIssuerBills", () => {
  const row = {
    billingPeriod: "2026-09",
    currency: "TWD",
    statementAmount: 100,
    minimumPayment: null,
    paidAmount: null,
    isPaid: null,
    paymentDueDate: "2026-09-30",
    statementClosingDate: "2026-09-10",
    updatedAt: "2026-09-11T00:00:00.000Z",
  };

  it("prefers TWD bills and sums same-period accounts", () => {
    const merged = mergeIssuerBills([
      row,
      { ...row, statementAmount: -50, paymentDueDate: "2026-09-28" },
      { ...row, currency: "USD", statementAmount: 3 },
      { ...row, billingPeriod: "2026-08", isPaid: 1 },
    ]);
    expect(merged.map((bill) => bill.billingPeriod)).toEqual([
      "2026-09",
      "2026-08",
    ]);
    expect(merged[0]).toMatchObject({
      currency: "TWD",
      statementAmount: 150,
      minimumPayment: null,
      paymentDueDate: "2026-09-28",
      sourceIsPaid: false,
    });
    expect(merged[1]!.sourceIsPaid).toBe(true);
  });
});

describe("transaction days", () => {
  it("uses the Taipei date of timestamped authorizations and the posting date for billing", () => {
    const tx = {
      authorizedAt: "2026-09-10T17:30:00.000Z",
      postedDate: "2026-09-12",
      status: "posted" as const,
    };
    expect(transactionDay(tx)).toBe("2026-09-11");
    expect(billingDay(tx)).toBe("2026-09-12");
    expect(billingDay({ ...tx, status: "pending" })).toBe("2026-09-11");
  });
});

describe("cardPaymentSide", () => {
  const issuer = { accountIds: new Set(["card"]), bankCode: "812" };
  const base: CardTransaction = {
    id: "t",
    accountId: "dep",
    accountType: "savings",
    amount: -1000,
    currency: "TWD",
    status: "posted",
    postedDate: "2026-09-20",
    authorizedAt: "2026-09-20",
    description: "台新卡費",
    counterparty: null,
    economicRole: "card_payment",
    duplicateOf: null,
  };

  it("matches deposit debits by issuer bank and card credits by account", () => {
    expect(cardPaymentSide(base, issuer)).toBe("bank");
    expect(
      cardPaymentSide({ ...base, description: "國泰卡費" }, issuer),
    ).toBeNull();
    expect(
      cardPaymentSide(
        { ...base, accountId: "card", accountType: "credit", amount: 1000 },
        issuer,
      ),
    ).toBe("card");
    expect(
      cardPaymentSide({ ...base, economicRole: "own_transfer" }, issuer),
    ).toBeNull();
  });
});
