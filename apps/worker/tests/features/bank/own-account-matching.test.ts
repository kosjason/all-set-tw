import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getBankRange } from "../../../src/features/bank/service";
import { resolveCalculationExclusion } from "../../../src/features/bank/calculation-service";
import { appendCathayDepositTransactions } from "../../../src/connectors/cathaybk";
import { bankTransactionRecord } from "../../../src/features/sync/record-mapper";
import { createTestD1 } from "../../../../../packages/db/testing/d1";

const range = { from: "2026-09-01", to: "2026-10-01" };
const now = "2026-09-01T00:00:00.000Z";

type Row = {
  id: string;
  amount: number;
  bankCode?: string;
  suffix?: string;
  description?: string;
  accountId?: string;
};

describe("own account matching", () => {
  let harness: Awaited<ReturnType<typeof createTestD1>>;

  beforeAll(async () => {
    harness = await createTestD1();
  }, 60_000);

  afterAll(async () => {
    await harness?.mf.dispose();
  });

  beforeEach(async () => {
    const db = harness.binding;
    await db.batch(
      [
        "DELETE FROM classification_overrides",
        "DELETE FROM bank_transaction_preferences",
        "DELETE FROM bank_transactions",
        "DELETE FROM bank_accounts",
        "DELETE FROM own_accounts",
      ].map((sql) => db.prepare(sql)),
    );
    await db.batch([
      db
        .prepare(
          "INSERT INTO bank_accounts (id, connector_id, source_id, institution_name, account_type, created_at, updated_at) VALUES ('deposit', 'cathaybk', 'bank:cathaybk:1234', '國泰世華', 'savings', ?, ?), ('card', 'cathaybk', 'card:cathaybk:1234', '國泰世華', 'credit', ?, ?)",
        )
        .bind(now, now, now, now),
      db
        .prepare(
          "INSERT INTO own_accounts (id, kind, bank_code, account_suffix, label, created_at, updated_at) VALUES ('own:fubon', 'own_account', '012', '77777', NULL, ?, ?), ('own:taishin', 'own_account', '812', '2345', '台新活存', ?, ?), ('own:dbs', 'unsynced_card', '810', '99999', '星展信用卡', ?, ?)",
        )
        .bind(now, now, now, now, now, now),
    ]);
  });

  async function insert(rows: Row[]) {
    const db = harness.binding;
    await db.batch(
      rows.map((row, index) =>
        db
          .prepare(
            "INSERT INTO bank_transactions (id, connector_id, account_id, source_id, posted_date, amount, currency, description, counterparty_bank_code, counterparty_account_suffix, created_at, updated_at) VALUES (?, 'cathaybk', ?, ?, ?, ?, 'TWD', ?, ?, ?, ?, ?)",
          )
          .bind(
            row.id,
            row.accountId ?? "deposit",
            row.id,
            `2026-09-${String(index + 1).padStart(2, "0")}`,
            row.amount,
            row.description ?? "電子轉出",
            row.bankCode ?? null,
            row.suffix ?? null,
            now,
            now,
          ),
      ),
    );
  }

  async function presented() {
    const { transactions } = await getBankRange(harness.binding, range);
    return new Map(transactions.map((row) => [row.id, row]));
  }

  it("excludes transfers to and from declared own accounts with strict suffix matching", async () => {
    await insert([
      { id: "own-out", amount: -27000, bankCode: "012", suffix: "77777" },
      {
        id: "own-in",
        amount: 3000,
        bankCode: "012",
        suffix: "77777",
        description: "跨行轉入",
      },
      { id: "other-suffix", amount: -5000, bankCode: "012", suffix: "66666" },
      { id: "other-bank", amount: -6000, bankCode: "013", suffix: "77777" },
      { id: "four-digit", amount: -7000, bankCode: "812", suffix: "12345" },
      { id: "no-account", amount: -8000, description: "轉帳 台新銀行 轉存款" },
    ]);

    const rows = await presented();
    expect(rows.get("own-out")).toMatchObject({
      excludedFromCalculation: true,
      classification: {
        categoryId: "other",
        source: "own_account",
        excludedFromCalculation: true,
      },
      ownAccount: {
        id: "own:fubon",
        kind: "own_account",
        label: "台北富邦 …77777",
      },
    });
    expect(rows.get("own-in")).toMatchObject({
      excludedFromCalculation: true,
      ownAccount: { id: "own:fubon" },
    });
    expect(rows.get("four-digit")).toMatchObject({
      excludedFromCalculation: true,
      ownAccount: { id: "own:taishin", label: "台新活存" },
    });
    for (const id of ["other-suffix", "other-bank", "no-account"]) {
      const row = rows.get(id);
      expect(row?.ownAccount, id).toBeUndefined();
      expect(row?.excludedFromCalculation, id).toBe(false);
      expect(row?.classification?.source, id).not.toBe("own_account");
    }
  });

  it("keeps unsynced card payments as labelled spending and refunds as income", async () => {
    await insert([
      { id: "card-pay", amount: -1200, bankCode: "810", suffix: "99999" },
      {
        id: "card-refund",
        amount: 200,
        bankCode: "810",
        suffix: "99999",
        description: "跨行轉入",
      },
    ]);

    const rows = await presented();
    expect(rows.get("card-pay")).toMatchObject({
      excludedFromCalculation: false,
      classification: {
        categoryId: "other",
        label: "繳卡費（星展信用卡）",
        source: "unsynced_card",
        excludedFromCalculation: false,
      },
      ownAccount: { id: "own:dbs", kind: "unsynced_card", label: "星展信用卡" },
    });
    expect(rows.get("card-refund")).toMatchObject({
      excludedFromCalculation: false,
      classification: {
        label: "卡片退款（星展信用卡）",
        source: "unsynced_card",
      },
    });
  });

  it("lets per-transaction preferences and category overrides win", async () => {
    await insert([
      { id: "include-own", amount: -4000, bankCode: "012", suffix: "77777" },
      { id: "exclude-card", amount: -800, bankCode: "810", suffix: "99999" },
      { id: "override-own", amount: -9000, bankCode: "012", suffix: "77777" },
      {
        id: "credit-card-row",
        accountId: "card",
        amount: -100,
        bankCode: "012",
        suffix: "77777",
      },
    ]);
    const db = harness.binding;
    await db.batch([
      db
        .prepare(
          "INSERT INTO bank_transaction_preferences (transaction_id, excluded_from_calculation, created_at, updated_at) VALUES ('include-own', 0, ?, ?), ('exclude-card', 1, ?, ?)",
        )
        .bind(now, now, now, now),
      db
        .prepare(
          "INSERT INTO classification_overrides (id, target_type, target_id, category_id, created_at, updated_at) VALUES ('override:1', 'bank_transaction', 'override-own', 'housing', ?, ?)",
        )
        .bind(now, now),
    ]);

    const rows = await presented();
    expect(rows.get("include-own")).toMatchObject({
      excludedFromCalculation: false,
      ownAccount: { id: "own:fubon" },
    });
    expect(rows.get("exclude-card")).toMatchObject({
      excludedFromCalculation: true,
      ownAccount: { id: "own:dbs" },
    });
    expect(rows.get("override-own")).toMatchObject({
      excludedFromCalculation: true,
      classification: { categoryId: "housing", source: "override" },
    });
    expect(rows.get("credit-card-row")?.ownAccount).toBeUndefined();
  });

  it("applies retroactively when own accounts are added or removed", async () => {
    await insert([
      { id: "later", amount: -27000, bankCode: "012", suffix: "77777" },
    ]);
    expect((await presented()).get("later")?.excludedFromCalculation).toBe(
      true,
    );

    await harness.binding
      .prepare("DELETE FROM own_accounts WHERE id = 'own:fubon'")
      .run();
    expect((await presented()).get("later")).toMatchObject({
      excludedFromCalculation: false,
      ownAccount: undefined,
    });
  });

  it("classifies Cathay transfers end to end from the connector payload", async () => {
    const scraped: Parameters<typeof appendCathayDepositTransactions>[0] = [];
    appendCathayDepositTransactions(
      scraped,
      [
        {
          txnDateTime: "2026/09/05T10:00:00",
          description: "電子轉出",
          expendAmt: 1500,
          expendBankId: "810",
          expendAcctNo: "0000444400099999",
        },
        {
          txnDateTime: "2026/09/06T10:00:00",
          description: "電子轉出",
          expendAmt: 27000,
          expendBankId: "012",
          expendAcctNo: "0000999900077777",
        },
        {
          txnDateTime: "2026/09/07T10:00:00",
          description: "電子轉出",
          expendAmt: 5000,
          expendBankId: "012",
          expendAcctNo: "0000111100066666",
        },
      ],
      "bank:cathaybk:1234",
      "TWD",
    );
    const db = harness.binding;
    await db.batch(
      scraped.map((transaction, index) => {
        const { payload } = bankTransactionRecord("cathaybk", transaction, now);
        return db
          .prepare(
            "INSERT INTO bank_transactions (id, connector_id, account_id, source_id, posted_date, authorized_at, amount, currency, description, counterparty, counterparty_bank_code, counterparty_account_suffix, raw_payload, created_at, updated_at) VALUES (?, 'cathaybk', 'deposit', ?, ?, ?, ?, 'TWD', ?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(
            `e2e-${index}`,
            payload.source_id,
            payload.posted_date,
            payload.authorized_at,
            payload.amount,
            payload.description,
            payload.counterparty,
            payload.counterparty_bank_code,
            payload.counterparty_account_suffix,
            payload.raw_payload,
            now,
            now,
          );
      }),
    );

    const rows = await presented();
    expect(rows.get("e2e-0")).toMatchObject({
      counterparty: "星展 …99999",
      excludedFromCalculation: false,
      classification: { label: "繳卡費（星展信用卡）" },
    });
    expect(rows.get("e2e-1")).toMatchObject({
      counterparty: "台北富邦 …77777",
      excludedFromCalculation: true,
      classification: { source: "own_account" },
    });
    expect(rows.get("e2e-2")).toMatchObject({
      counterparty: "台北富邦 …66666",
      excludedFromCalculation: false,
      ownAccount: undefined,
    });
    const { results } = await db
      .prepare("SELECT raw_payload FROM bank_transactions")
      .all<{ raw_payload: string }>();
    for (const { raw_payload } of results)
      expect(raw_payload).not.toMatch(/\d{6,}/);
  });
});

describe("calculation exclusion precedence", () => {
  it("orders preference, own account kind, classification and defaults", () => {
    expect(
      resolveCalculationExclusion({
        calculationPreference: 0,
        ownAccountKind: "own_account",
      }),
    ).toBe(false);
    expect(
      resolveCalculationExclusion({
        calculationPreference: 1,
        ownAccountKind: "unsynced_card",
      }),
    ).toBe(true);
    expect(resolveCalculationExclusion({ ownAccountKind: "own_account" })).toBe(
      true,
    );
    expect(
      resolveCalculationExclusion({
        ownAccountKind: "unsynced_card",
        classificationExcludedFromCalculation: true,
        description: "繳信用卡款",
      }),
    ).toBe(false);
    expect(resolveCalculationExclusion({ description: "繳信用卡款" })).toBe(
      true,
    );
  });
});
