import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

const migrationsDirectory = fileURLToPath(
  new URL("../../../../../packages/db/migrations/", import.meta.url),
);
const migrationFile = "0064_ctbc_bill_paid_amount.sql";
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
  return database;
}

function insertAccount(
  database: DatabaseSync,
  connectorId: string,
  id: string,
  currency = "TWD",
) {
  database
    .prepare(
      `INSERT INTO bank_accounts
        (id, connector_id, source_id, institution_name, account_name,
         account_type, currency, raw_payload, created_at, updated_at)
       VALUES (?, ?, ?, '虛構銀行', '虛構卡', 'credit', ?, '{}',
               '2026-09-01', '2026-09-01')`,
    )
    .run(id, connectorId, id, currency);
}

function insertBill(
  database: DatabaseSync,
  {
    connectorId = "ctbc",
    accountId,
    period,
    statementAmount,
    paidAmount,
    isPaid,
    currency = "TWD",
    raw = {},
  }: {
    connectorId?: string;
    accountId: string;
    period: string;
    statementAmount: number | null;
    paidAmount: number | null;
    isPaid: number | null;
    currency?: string;
    raw?: unknown;
  },
) {
  database
    .prepare(
      `INSERT INTO credit_card_bills
        (id, connector_id, account_id, source_id, billing_period,
         statement_amount, paid_amount, is_paid, currency, raw_payload,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '2026-09-01', '2026-09-01')`,
    )
    .run(
      `${accountId}:${period}`,
      connectorId,
      accountId,
      `${accountId}:bill:${period}`,
      period,
      statementAmount,
      paidAmount,
      isPaid,
      currency,
      JSON.stringify(raw),
    );
}

function bills(database: DatabaseSync) {
  return database
    .prepare(
      `SELECT id, statement_amount AS statementAmount, paid_amount AS paidAmount,
              is_paid AS isPaid
       FROM credit_card_bills ORDER BY id`,
    )
    .all();
}

describe("0064 CTBC bill paid amount shift", () => {
  it("把舊版存成本期的已繳位移到上一期，最新一期留空", () => {
    const database = createDatabase();
    insertAccount(database, "ctbc", "ctbc-main");
    insertAccount(database, "ctbc", "ctbc-main-usd", "USD");
    insertAccount(database, "cathaybk", "cathay-main");
    // 舊版：每期的 paid_amount 其實是「本期間繳掉的上期帳單」（pmtAmt）。
    insertBill(database, {
      accountId: "ctbc-main",
      period: "2026-07",
      statementAmount: 5000,
      paidAmount: 4000,
      isPaid: 0,
      raw: { billAmt: 5000, currPmtAmt: 4800, pmtAmt: 4000 },
    });
    insertBill(database, {
      accountId: "ctbc-main",
      period: "2026-08",
      statementAmount: 3000,
      paidAmount: 4800,
      isPaid: 1,
      raw: { billAmt: 3000, currPmtAmt: 3000, pmtAmt: 4800 },
    });
    insertBill(database, {
      accountId: "ctbc-main",
      period: "2026-09",
      statementAmount: 2000,
      paidAmount: 1000,
      isPaid: 0,
      raw: { billAmt: 2000, currentPayment: 2500, pmtAmt: 1000 },
    });
    // 外幣帳單不與台幣帳單互相位移；應繳 0 的帳單視為已繳。
    insertBill(database, {
      accountId: "ctbc-main-usd",
      period: "2026-08",
      statementAmount: 0,
      paidAmount: 30,
      isPaid: 1,
      currency: "USD",
    });
    insertBill(database, {
      connectorId: "cathaybk",
      accountId: "cathay-main",
      period: "2026-09",
      statementAmount: 1000,
      paidAmount: 3000,
      isPaid: 1,
    });

    database.exec(
      readFileSync(`${migrationsDirectory}/${migrationFile}`, "utf8"),
    );

    expect(bills(database)).toEqual([
      // 國泰不受影響。
      {
        id: "cathay-main:2026-09",
        statementAmount: 1000,
        paidAmount: 3000,
        isPaid: 1,
      },
      // 外幣：沒有下一期，應繳 0 仍視為已繳。
      {
        id: "ctbc-main-usd:2026-08",
        statementAmount: 0,
        paidAmount: null,
        isPaid: 1,
      },
      // 7 月：應繳改為 currPmtAmt 4800，已繳取 8 月的舊值 4800。
      {
        id: "ctbc-main:2026-07",
        statementAmount: 4800,
        paidAmount: 4800,
        isPaid: 1,
      },
      // 8 月：已繳取 9 月的舊值 1000，小於應繳 3000。
      {
        id: "ctbc-main:2026-08",
        statementAmount: 3000,
        paidAmount: 1000,
        isPaid: 0,
      },
      // 9 月：沒有下一期，已繳留空；應繳改為 currentPayment 2500。
      {
        id: "ctbc-main:2026-09",
        statementAmount: 2500,
        paidAmount: null,
        isPaid: null,
      },
    ]);
  });

  it("跨年位移，並把字串金額（千分位）轉成數字", () => {
    const database = createDatabase();
    insertAccount(database, "ctbc", "ctbc-main");
    insertBill(database, {
      accountId: "ctbc-main",
      period: "2026-12",
      statementAmount: 20000,
      paidAmount: 1000,
      isPaid: 0,
      raw: { billAmt: 20000, currPmtAmt: "12,345", pmtAmt: 1000 },
    });
    insertBill(database, {
      accountId: "ctbc-main",
      period: "2027-01",
      statementAmount: 500,
      paidAmount: 12345,
      isPaid: 1,
      raw: { billAmt: 500, currentPayment: " 1,500 ", pmtAmt: 12345 },
    });
    // 無法解析的應繳字串不採用，沿用原本的 statement_amount。
    insertBill(database, {
      accountId: "ctbc-main",
      period: "2027-02",
      statementAmount: 800,
      paidAmount: 1500,
      isPaid: 1,
      raw: { currPmtAmt: "N/A" },
    });

    database.exec(
      readFileSync(`${migrationsDirectory}/${migrationFile}`, "utf8"),
    );

    expect(bills(database)).toEqual([
      // 12 月的已繳取 1 月的舊值；字串 "12,345" 視為 12345。
      {
        id: "ctbc-main:2026-12",
        statementAmount: 12345,
        paidAmount: 12345,
        isPaid: 1,
      },
      {
        id: "ctbc-main:2027-01",
        statementAmount: 1500,
        paidAmount: 1500,
        isPaid: 1,
      },
      {
        id: "ctbc-main:2027-02",
        statementAmount: 800,
        paidAmount: null,
        isPaid: null,
      },
    ]);
  });
  it("格式錯誤的金額字串（1-2、1.2.3、--1）不採用，沿用原值", () => {
    const database = createDatabase();
    insertAccount(database, "ctbc", "ctbc-main");
    for (const [period, value] of [
      ["2026-03", "1-2"],
      ["2026-04", "1.2.3"],
      ["2026-05", "--1"],
    ] as const)
      insertBill(database, {
        accountId: "ctbc-main",
        period,
        statementAmount: 700,
        paidAmount: null,
        isPaid: null,
        raw: { currPmtAmt: value },
      });

    database.exec(
      readFileSync(`${migrationsDirectory}/${migrationFile}`, "utf8"),
    );

    expect(bills(database).map((bill) => bill.statementAmount)).toEqual([
      700, 700, 700,
    ]);
  });
});
