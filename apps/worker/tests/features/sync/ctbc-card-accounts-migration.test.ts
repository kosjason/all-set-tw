import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

const migrationsDirectory = fileURLToPath(
  new URL("../../../../../packages/db/migrations/", import.meta.url),
);
const migrationFile = "0061_ctbc_credit_card_accounts.sql";
const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

// Synthetic rows only; the shapes follow what the pre-split CTBC parser wrote.
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

function applyMigration(database: DatabaseSync) {
  database.exec(
    readFileSync(`${migrationsDirectory}/${migrationFile}`, "utf8"),
  );
}

function insertAccount(
  database: DatabaseSync,
  id: string,
  sourceId: string,
  raw: unknown,
  { connectorId = "ctbc", accountType = "credit", currency = "TWD" } = {},
) {
  database
    .prepare(
      `INSERT INTO bank_accounts
        (id, connector_id, source_id, institution_name, account_name,
         account_type, currency, credit_limit, raw_payload, created_at, updated_at)
       VALUES (?, ?, ?, '中國信託商業銀行', '虛構舊帳戶', ?, ?, 90000, ?,
               '2026-06-01', '2026-09-01')`,
    )
    .run(id, connectorId, sourceId, accountType, currency, JSON.stringify(raw));
}

function insertTransaction(
  database: DatabaseSync,
  id: string,
  accountId: string,
  raw: unknown,
  { status = "posted", amount = -100, connectorId = "ctbc" } = {},
) {
  database
    .prepare(
      `INSERT INTO bank_transactions
        (id, connector_id, account_id, source_id, posted_date, amount,
         currency, description, status, raw_payload, created_at, updated_at)
       VALUES (?, ?, ?, ?, '2026-09-10', ?, 'TWD', '虛構商店', ?, ?,
               '2026-09-10', '2026-09-10')`,
    )
    .run(
      id,
      connectorId,
      accountId,
      `ctbc:card:tx:${id}:1`,
      amount,
      status,
      typeof raw === "string" ? raw : JSON.stringify(raw),
    );
}

function accountOf(database: DatabaseSync, transactionId: string) {
  return (
    database
      .prepare(
        `SELECT account.source_id AS sourceId
         FROM bank_transactions txn
         JOIN bank_accounts account ON account.id = txn.account_id
         WHERE txn.id = ?`,
      )
      .get(transactionId) as { sourceId: string }
  ).sourceId;
}

function ctbcCreditAccounts(database: DatabaseSync) {
  return database
    .prepare(
      `SELECT id, source_id AS sourceId, account_name AS accountName,
              currency, credit_limit AS creditLimit, raw_payload AS raw
       FROM bank_accounts
       WHERE connector_id = 'ctbc' AND account_type = 'credit'
       ORDER BY source_id`,
    )
    .all() as Array<{
    id: string;
    sourceId: string;
    accountName: string;
    currency: string;
    creditLimit: number | null;
    raw: string;
  }>;
}

describe("CTBC credit card account split migration", () => {
  it("moves a single-card account to the card and summary accounts", () => {
    const database = createDatabase();
    insertAccount(database, "ctbc:credit:ctbc:TWD", "credit:ctbc:TWD", {
      cards: [
        {
          cardLast4: "4444",
          cardName: "虛構航空卡",
          positiveOrAttached: "正卡",
        },
        {
          cardLast4: "8888",
          cardName: "虛構未開卡",
          positiveOrAttached: "正卡",
        },
      ],
    });
    insertAccount(
      database,
      "ctbc-deposit",
      "bank:ctbc:1234:abcd",
      {},
      {
        accountType: "savings",
      },
    );
    insertAccount(
      database,
      "cathay-card",
      "credit:cathaybk:main",
      {},
      {
        connectorId: "cathaybk",
      },
    );
    insertTransaction(
      database,
      "pending",
      "ctbc:credit:ctbc:TWD",
      {
        cardLast4: "4444",
        authorizationHash: "legacy-hash",
      },
      { status: "pending" },
    );
    // Unbilled rows stored `4444_0` without a normalized last four digits.
    insertTransaction(database, "unbilled", "ctbc:credit:ctbc:TWD", {
      authorizationHash: "legacy-hash",
    });
    insertTransaction(
      database,
      "payment",
      "ctbc:credit:ctbc:TWD",
      {
        cardLast4: "0000",
      },
      { amount: 3000 },
    );
    insertTransaction(database, "invalid-raw", "ctbc:credit:ctbc:TWD", "{");
    insertTransaction(database, "deposit", "ctbc-deposit", {});
    insertTransaction(
      database,
      "cathay",
      "cathay-card",
      {},
      {
        connectorId: "cathaybk",
      },
    );
    database.exec(`
      INSERT INTO classification_overrides
        (id, target_type, target_id, category_id, created_at, updated_at)
      VALUES ('override-unbilled', 'bank_transaction', 'unbilled', 'shopping',
              '2026-09-10', '2026-09-10');
      INSERT INTO bank_transaction_preferences
        (transaction_id, excluded_from_calculation, created_at, updated_at)
      VALUES ('pending', 1, '2026-09-10', '2026-09-10');
      INSERT INTO credit_card_bills
        (id, connector_id, account_id, source_id, billing_period,
         statement_amount, currency, raw_payload, created_at, updated_at)
      VALUES
        ('bill-08', 'ctbc', 'ctbc:credit:ctbc:TWD',
         'credit:ctbc:TWD:bill:2026-08', '2026-08', 1000, 'TWD', '{}',
         '2026-08-20', '2026-08-20'),
        ('bill-09', 'ctbc', 'ctbc:credit:ctbc:TWD',
         'credit:ctbc:TWD:bill:2026-09', '2026-09', 2000, 'TWD', '{}',
         '2026-09-20', '2026-09-20');
      INSERT INTO bank_balance_snapshots
        (id, connector_id, account_id, source_id, balance, currency, as_of_at,
         raw_payload, created_at, updated_at)
      VALUES ('snapshot', 'ctbc', 'ctbc:credit:ctbc:TWD',
              'credit:ctbc:TWD:2026-09-20T00:00:00.000Z', -2000, 'TWD',
              '2026-09-20T00:00:00.000Z', '{}', '2026-09-20', '2026-09-20');
    `);

    applyMigration(database);
    // A second run (for example a replayed deploy) changes nothing.
    applyMigration(database);

    const accounts = ctbcCreditAccounts(database);
    expect(
      accounts.map(({ id, sourceId, accountName, creditLimit }) => ({
        id,
        sourceId,
        accountName,
        creditLimit,
      })),
    ).toEqual([
      {
        id: "ctbc:credit:ctbc:4444",
        sourceId: "credit:ctbc:4444",
        accountName: "虛構航空卡",
        creditLimit: null,
      },
      {
        id: "ctbc:credit:ctbc:main",
        sourceId: "credit:ctbc:main",
        accountName: "中國信託信用卡（合併帳單）",
        creditLimit: 90000,
      },
    ]);
    expect(JSON.parse(accounts[1]!.raw)).toMatchObject({
      summary: true,
      migratedFrom: "credit:ctbc:TWD",
      cards: [{ cardLast4: "4444" }, { cardLast4: "8888" }],
    });
    expect(accountOf(database, "pending")).toBe("credit:ctbc:4444");
    expect(accountOf(database, "unbilled")).toBe("credit:ctbc:4444");
    expect(accountOf(database, "payment")).toBe("credit:ctbc:main");
    expect(accountOf(database, "invalid-raw")).toBe("credit:ctbc:main");
    expect(accountOf(database, "deposit")).toBe("bank:ctbc:1234:abcd");
    expect(accountOf(database, "cathay")).toBe("credit:cathaybk:main");
    expect(
      JSON.parse(
        (
          database
            .prepare("SELECT raw_payload FROM bank_transactions WHERE id = ?")
            .get("unbilled") as { raw_payload: string }
        ).raw_payload,
      ).cardLast4,
    ).toBe("4444");

    // Transaction ids stay, so user overrides and preferences still apply.
    expect(
      database
        .prepare(
          "SELECT target_id FROM classification_overrides WHERE id = 'override-unbilled'",
        )
        .get(),
    ).toEqual({ target_id: "unbilled" });
    expect(
      database
        .prepare(
          "SELECT excluded_from_calculation FROM bank_transaction_preferences WHERE transaction_id = 'pending'",
        )
        .get(),
    ).toEqual({ excluded_from_calculation: 1 });

    expect(
      database
        .prepare(
          `SELECT id, account_id AS accountId, source_id AS sourceId
           FROM credit_card_bills ORDER BY id`,
        )
        .all(),
    ).toEqual([
      {
        id: "bill-08",
        accountId: "ctbc:credit:ctbc:main",
        sourceId: "credit:ctbc:main:bill:2026-08",
      },
      {
        id: "bill-09",
        accountId: "ctbc:credit:ctbc:main",
        sourceId: "credit:ctbc:main:bill:2026-09",
      },
    ]);
    expect(
      database
        .prepare(
          "SELECT account_id AS accountId, source_id AS sourceId FROM bank_balance_snapshots",
        )
        .get(),
    ).toEqual({
      accountId: "ctbc:credit:ctbc:main",
      sourceId: "credit:ctbc:main:2026-09-20T00:00:00.000Z",
    });
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM bank_accounts WHERE source_id = 'credit:ctbc:TWD'",
        )
        .get(),
    ).toEqual({ count: 0 });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("splits several cards and leaves card-less rows on the summary account", () => {
    const database = createDatabase();
    // Older raw card lists lost the last four digits of `1111_0` style numbers.
    insertAccount(database, "ctbc:credit:ctbc:TWD", "credit:ctbc:TWD", {
      cards: [{ cardName: "虛構甲卡" }],
    });
    insertAccount(
      database,
      "ctbc:credit:ctbc:USD",
      "credit:ctbc:USD",
      {},
      { currency: "USD" },
    );
    insertTransaction(database, "card-a", "ctbc:credit:ctbc:TWD", {
      cardLast4: "1111",
    });
    insertTransaction(database, "card-b", "ctbc:credit:ctbc:TWD", {
      cardLast4: "2222",
    });
    insertTransaction(database, "unknown", "ctbc:credit:ctbc:TWD", {});
    insertTransaction(database, "usd", "ctbc:credit:ctbc:USD", {
      cardLast4: "1111",
    });

    applyMigration(database);

    expect(
      ctbcCreditAccounts(database).map(
        ({ sourceId, accountName, currency }) => [
          sourceId,
          accountName,
          currency,
        ],
      ),
    ).toEqual([
      ["credit:ctbc:1111", "中國信託信用卡 1111", "TWD"],
      ["credit:ctbc:1111:USD", "中國信託信用卡 1111（USD）", "USD"],
      ["credit:ctbc:2222", "中國信託信用卡 2222", "TWD"],
      ["credit:ctbc:main", "中國信託信用卡（合併帳單）", "TWD"],
      ["credit:ctbc:main:USD", "中國信託信用卡（合併帳單，USD）", "USD"],
    ]);
    expect(accountOf(database, "card-a")).toBe("credit:ctbc:1111");
    expect(accountOf(database, "card-b")).toBe("credit:ctbc:2222");
    // With two cards the missing card number cannot be guessed.
    expect(accountOf(database, "unknown")).toBe("credit:ctbc:main");
    expect(accountOf(database, "usd")).toBe("credit:ctbc:1111:USD");
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("points duplicate accounts of the legacy account to the summary account", () => {
    const database = createDatabase();
    insertAccount(database, "ctbc:credit:ctbc:TWD", "credit:ctbc:TWD", {});
    insertAccount(
      database,
      "ctbc:credit:ctbc:USD",
      "credit:ctbc:USD",
      {},
      { currency: "USD" },
    );
    // 手動匯入的重複帳戶以 canonical_account_id 指向舊帳戶，不重複計算。
    insertAccount(
      database,
      "import-twd",
      "credit:ctbc-import:TWD",
      {},
      { connectorId: "ctbc-import" },
    );
    insertAccount(
      database,
      "import-usd",
      "credit:ctbc-import:USD",
      {},
      { connectorId: "ctbc-import", currency: "USD" },
    );
    database.exec(`
      UPDATE bank_accounts SET canonical_account_id = 'ctbc:credit:ctbc:TWD' WHERE id = 'import-twd';
      UPDATE bank_accounts SET canonical_account_id = 'ctbc:credit:ctbc:USD' WHERE id = 'import-usd';
    `);

    applyMigration(database);

    expect(
      database
        .prepare(
          "SELECT id, canonical_account_id AS canonical FROM bank_accounts WHERE id LIKE 'import-%' ORDER BY id",
        )
        .all(),
    ).toEqual([
      { id: "import-twd", canonical: "ctbc:credit:ctbc:main" },
      { id: "import-usd", canonical: "ctbc:credit:ctbc:main:USD" },
    ]);
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM bank_accounts WHERE source_id GLOB 'credit:ctbc:[A-Z][A-Z][A-Z]'",
        )
        .get(),
    ).toEqual({ count: 0 });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("falls back to the TWD summary account, then keeps the legacy account", () => {
    // 步驟 3 一定會建立同幣別摘要帳戶；這裡用 trigger 模擬它不存在，驗證防禦性退路。
    const setup = (dropTwdSummary: boolean) => {
      const database = createDatabase();
      insertAccount(
        database,
        "ctbc:credit:ctbc:USD",
        "credit:ctbc:USD",
        {},
        { currency: "USD" },
      );
      insertAccount(
        database,
        "import-usd",
        "credit:ctbc-import:USD",
        {},
        { connectorId: "ctbc-import", currency: "USD" },
      );
      database.exec(`
        UPDATE bank_accounts SET canonical_account_id = 'ctbc:credit:ctbc:USD' WHERE id = 'import-usd';
        CREATE TRIGGER drop_usd_summary AFTER INSERT ON bank_accounts
          WHEN NEW.source_id = 'credit:ctbc:main:USD'
          BEGIN DELETE FROM bank_accounts WHERE id = NEW.id; END;
      `);
      if (!dropTwdSummary) {
        insertAccount(database, "ctbc:credit:ctbc:main", "credit:ctbc:main", {
          summary: true,
        });
      }
      applyMigration(database);
      return database;
    };

    const withTwd = setup(false);
    expect(
      withTwd
        .prepare(
          "SELECT canonical_account_id AS canonical FROM bank_accounts WHERE id = 'import-usd'",
        )
        .get(),
    ).toEqual({ canonical: "ctbc:credit:ctbc:main" });
    expect(withTwd.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

    // 連台幣摘要帳戶都沒有：維持原值，舊帳戶因仍被參照而保留，不產生懸空參照。
    const withoutSummary = setup(true);
    expect(
      withoutSummary
        .prepare(
          "SELECT canonical_account_id AS canonical FROM bank_accounts WHERE id = 'import-usd'",
        )
        .get(),
    ).toEqual({ canonical: "ctbc:credit:ctbc:USD" });
    expect(
      withoutSummary
        .prepare(
          "SELECT COUNT(*) AS count FROM bank_accounts WHERE id = 'ctbc:credit:ctbc:USD'",
        )
        .get(),
    ).toEqual({ count: 1 });
    expect(withoutSummary.prepare("PRAGMA foreign_key_check").all()).toEqual(
      [],
    );
  });
});
