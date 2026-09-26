import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { resolveCalculationExclusion } from "../../../src/features/bank/calculation-service";
import { resolveClassifications } from "../../../src/features/classification/service";

const migrationsDirectory = fileURLToPath(
  new URL("../../../../../packages/db/migrations/", import.meta.url),
);
const migrationFile = "0049_cathay_credit_card_repairs.sql";
const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function createDatabase() {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  database.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith(".sql") && name < migrationFile)
    .sort()) {
    database.exec(readFileSync(`${migrationsDirectory}/${file}`, "utf8"));
  }
  database.exec(`
    INSERT INTO bank_accounts
      (id, connector_id, source_id, account_type, currency, raw_payload,
       created_at, updated_at)
    VALUES
      ('cathay-card', 'cathaybk', 'credit:cathaybk:main', 'credit', 'TWD',
       '{}', '2026-01-01', '2026-01-01'),
      ('cathay-deposit', 'cathaybk', 'bank:cathaybk:0001', 'savings', 'TWD',
       '{}', '2026-01-01', '2026-01-01');

    INSERT INTO bank_transactions
      (id, connector_id, account_id, source_id, posted_date, authorized_at,
       amount, currency, description, raw_payload, created_at, updated_at)
    VALUES
      ('card-purchase', 'cathaybk', 'cathay-card',
       '2026-09-10T00:00:00:credit:cathaybk:main:115:全家:1',
       '2026-09-10T00:00:00', '2026-09-10T00:00:00+08:00', -115, 'TWD', '全家',
       '{"amount":115,"detailType":"PrimaryCardConsume","cardNo":"1234"}',
       '2026-09-10', '2026-09-10'),
      ('card-payment', 'cathaybk', 'cathay-card',
       '2026-09-15T00:00:00:credit:cathaybk:main:-10853:本行自動扣繳:1',
       '2026-09-15T00:00:00', '2026-09-15T00:00:00+08:00', -10853, 'TWD',
       '本行自動扣繳',
       '{"amount":-10853,"detailType":"PaymentAmount","cardNo":""}',
       '2026-09-15', '2026-09-15'),
      ('card-refund', 'cathaybk', 'cathay-card',
       '2026-09-12T00:00:00:credit:cathaybk:main:-200:退款:1',
       '2026-09-12T00:00:00', '2026-09-12T00:00:00+08:00', -200, 'TWD', '退款',
       '{"amount":-200,"detailType":"PrimaryCardConsume","cardNo":"1234"}',
       '2026-09-12', '2026-09-12'),
      ('bank-card-payment', 'cathaybk', 'cathay-deposit',
       '2026-09-15T00:00:00:bank:cathaybk:0001:-10853:信用卡款 國泰世華卡 信用卡款:1',
       '2026-09-15T00:00:00', '2026-09-15T00:00:00+08:00', -10853, 'TWD',
       '信用卡款 國泰世華卡 信用卡款', '{"amount":-10853}',
       '2026-09-15', '2026-09-15');
  `);
  return database;
}

function applyRepair(database: DatabaseSync) {
  database.exec(
    readFileSync(`${migrationsDirectory}/${migrationFile}`, "utf8"),
  );
}

function asD1(database: DatabaseSync) {
  return {
    prepare(sql: string) {
      let params: SQLInputValue[] = [];
      return {
        bind(...values: SQLInputValue[]) {
          params = values;
          return this;
        },
        async raw() {
          return (
            database.prepare(sql).all(...params) as Record<string, unknown>[]
          ).map((row) => Object.values(row));
        },
        async all() {
          return { results: database.prepare(sql).all(...params) };
        },
      };
    },
  } as unknown as D1Database;
}

type TransactionRow = {
  id: string;
  accountType: string;
  sourceId: string;
  postedDate: string;
  authorizedAt: string;
  amount: number;
  description: string;
  counterparty: string | null;
};

function transactions(database: DatabaseSync) {
  return database
    .prepare(
      `SELECT txn.id, account.account_type AS accountType,
              txn.source_id AS sourceId, txn.posted_date AS postedDate,
              txn.authorized_at AS authorizedAt, txn.amount,
              txn.description, txn.counterparty
       FROM bank_transactions txn
       JOIN bank_accounts account ON account.id = txn.account_id
       ORDER BY txn.id`,
    )
    .all() as TransactionRow[];
}

describe("Cathay credit card repair migration", () => {
  it("repairs card dates, credit signs and payment counterparty idempotently", () => {
    const database = createDatabase();
    const before = transactions(database);

    applyRepair(database);
    applyRepair(database);

    const after = transactions(database);
    expect(
      after.map(({ id, postedDate, authorizedAt, amount, counterparty }) => ({
        id,
        postedDate,
        authorizedAt,
        amount,
        counterparty,
      })),
    ).toEqual([
      {
        id: "bank-card-payment",
        postedDate: "2026-09-15T00:00:00",
        authorizedAt: "2026-09-15T00:00:00+08:00",
        amount: -10853,
        counterparty: null,
      },
      {
        id: "card-payment",
        postedDate: "2026-09-15",
        authorizedAt: "2026-09-15",
        amount: 10853,
        counterparty: "國泰世華信用卡繳款",
      },
      {
        id: "card-purchase",
        postedDate: "2026-09-10",
        authorizedAt: "2026-09-10",
        amount: -115,
        counterparty: null,
      },
      {
        id: "card-refund",
        postedDate: "2026-09-12",
        authorizedAt: "2026-09-12",
        amount: 200,
        counterparty: null,
      },
    ]);
    expect(after.map(({ sourceId }) => sourceId)).toEqual(
      before.map(({ sourceId }) => sourceId),
    );
  });

  it("classifies both sides of a Cathay card payment as an excluded transfer", async () => {
    const database = createDatabase();
    applyRepair(database);
    // 分類解析使用最新 schema（0055 起繳卡費為角色規則）。
    for (const file of readdirSync(migrationsDirectory)
      .filter((name) => name.endsWith(".sql") && name > migrationFile)
      .sort())
      database.exec(readFileSync(`${migrationsDirectory}/${file}`, "utf8"));

    const rows = transactions(database);
    const classifications = await resolveClassifications(asD1(database), rows);
    const summary = Object.fromEntries(
      rows.map((row) => {
        const classification = classifications.get(row.id);
        return [
          row.id,
          {
            categoryId: classification?.categoryId,
            economicRole: classification?.economicRole,
            excluded: resolveCalculationExclusion({
              accountType: row.accountType,
              description: row.description,
              counterparty: row.counterparty,
              classificationExcludedFromCalculation:
                classification?.excludedFromCalculation,
            }),
          },
        ];
      }),
    );

    expect(summary).toEqual({
      "bank-card-payment": {
        categoryId: "other",
        economicRole: "card_payment",
        excluded: true,
      },
      "card-payment": {
        categoryId: "other",
        economicRole: "card_payment",
        excluded: true,
      },
      "card-purchase": {
        categoryId: "food",
        economicRole: undefined,
        excluded: false,
      },
      "card-refund": {
        categoryId: "other",
        economicRole: undefined,
        excluded: false,
      },
    });
  });

  it("keeps a user-edited credit card payment rule pattern", () => {
    const database = createDatabase();
    database.exec(
      "UPDATE classification_rules SET pattern = '自訂' WHERE id = 'system:bank:creditcard-payment'",
    );

    applyRepair(database);

    expect(
      database
        .prepare(
          "SELECT pattern FROM classification_rules WHERE id = 'system:bank:creditcard-payment'",
        )
        .get(),
    ).toEqual({ pattern: "自訂" });
  });
});
