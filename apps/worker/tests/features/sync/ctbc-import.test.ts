import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CtbcPayloads } from "@taiwan-fin-hub/connectors";
import { decryptJson, encryptJson } from "../../../src/platform/crypto";
import type { Env } from "../../../src/platform/env";

const mocks = vi.hoisted(() => ({ ctbcSync: vi.fn() }));

vi.mock("@taiwan-fin-hub/connectors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@taiwan-fin-hub/connectors")>()),
  createCtbcConnector: () => ({
    id: "ctbc",
    name: "中國信託商業銀行",
    sync: mocks.ctbcSync,
  }),
}));

import {
  CTBC_DEPOSIT_TRANSACTIONS_UNAVAILABLE_WARNING,
  CtbcImportPayloadError,
  importCtbcPayloads,
} from "../../../src/features/sync/ctbc-import";
import { parseCtbcData } from "@taiwan-fin-hub/connectors";
import {
  syncCtbc,
  withManualSyncLock,
} from "../../../src/features/sync/service";

const MIGRATIONS_DIRECTORY = fileURLToPath(
  new URL("../../../../../packages/db/migrations/", import.meta.url),
);

/** This Node sqlite bind API only accepts anonymous `?`; expand D1 `?1` placeholders. */
function expandNumberedParams(sql: string, values: unknown[]) {
  const expanded: unknown[] = [];
  const rewritten = sql.replace(/\?(\d+)/g, (_, index) => {
    expanded.push(values[Number(index) - 1]);
    return "?";
  });
  return expanded.length > 0
    ? { sql: rewritten, values: expanded }
    : { sql, values };
}

class SqliteStatement {
  private values: unknown[] = [];

  constructor(
    private readonly owner: SqliteD1,
    readonly sql: string,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async run() {
    return this.execute();
  }

  async all<T>() {
    return this.execute() as unknown as { results: T[] };
  }

  async raw() {
    this.owner.executedSql.push(this.sql);
    const query = expandNumberedParams(this.sql, this.values);
    return (
      this.owner.database
        .prepare(query.sql)
        .all(...(query.values as never[])) as Record<string, unknown>[]
    ).map((row) => Object.values(row));
  }

  async first<T>() {
    this.owner.executedSql.push(this.sql);
    const query = expandNumberedParams(this.sql, this.values);
    return (
      (this.owner.database
        .prepare(query.sql)
        .get(...(query.values as never[])) as T) ?? null
    );
  }

  execute() {
    this.owner.executedSql.push(this.sql);
    const query = expandNumberedParams(this.sql, this.values);
    if (/^\s*(SELECT|WITH)\b/i.test(query.sql)) {
      return {
        success: true,
        meta: { changes: 0 },
        results: this.owner.database
          .prepare(query.sql)
          .all(...(query.values as never[])),
      };
    }
    const result = this.owner.database
      .prepare(query.sql)
      .run(...(query.values as never[]));
    return {
      success: true,
      meta: { changes: Number(result.changes) },
      results: [],
    };
  }
}

class SqliteD1 {
  readonly database = new DatabaseSync(":memory:");
  readonly executedSql: string[] = [];

  /** `beforeMigration` stops before that file so a test can seed legacy rows. */
  constructor(beforeMigration?: string) {
    this.database.exec("PRAGMA foreign_keys = ON");
    for (const file of readdirSync(MIGRATIONS_DIRECTORY)
      .filter(
        (name) =>
          name.endsWith(".sql") && (!beforeMigration || name < beforeMigration),
      )
      .sort()) {
      this.applyMigration(file);
    }
  }

  applyMigration(file: string) {
    this.database.exec(readFileSync(`${MIGRATIONS_DIRECTORY}/${file}`, "utf8"));
  }

  prepare(sql: string) {
    return new SqliteStatement(this, sql);
  }

  async batch(statements: D1PreparedStatement[]) {
    this.database.exec("BEGIN");
    try {
      const results = statements.map((statement) =>
        (statement as unknown as SqliteStatement).execute(),
      );
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  close() {
    this.database.close();
  }
}

const ENCRYPTION_KEY = "test-encryption-key-for-ctbc-import";
const NOW = new Date("2026-09-20T04:00:00.000Z");
// Synthetic fixture: fake account numbers, fake merchants, fake card.
const FAKE_ACCOUNT = "000011112222";

function payloads(): CtbcPayloads {
  return {
    depositOverview: {
      code: "0000",
      rsData: {
        twdAcctSummaryResponse: {
          demDepBalSummaryResponse: {
            infoList: [
              {
                accountId: FAKE_ACCOUNT,
                balance: "50,000",
                availableBalance: "49,000",
                acctType: "活期儲蓄存款",
                accountNickName: "測試帳戶",
              },
            ],
          },
        },
      },
    },
    depositTransactions: {
      rsData: {
        detailList: [
          {
            sourceAccountId: FAKE_ACCOUNT,
            trnDtFull: "2026/09/10 09:00:00",
            memo1: "測試薪資",
            crAmt: "30,000",
            dbAmt: "0",
            balanceAmt: "50,000",
            defaultSeq: "001",
          },
          {
            sourceAccountId: FAKE_ACCOUNT,
            trnDtFull: "2026/09/12",
            memo1: "測試提款",
            crAmt: "0",
            dbAmt: "2,000",
            balanceAmt: "48,000",
            defaultSeq: "002",
          },
        ],
      },
    },
    creditCards: {
      rsData: {
        cardDataList: [
          {
            cardNo: "4000000000000002",
            cardNoSuffixFour: "0002",
            positiveOrAttached: "正卡",
            cardName: "測試卡",
          },
        ],
        curDataList: [{ curName: "新臺幣", curCode: "TWD" }],
        billData: {
          TWD: {
            "202608": {
              summary: {
                currPmtAmt: "1,200",
                minPmtAmt: "120",
                pmtExpDt: "2026/09/05",
                billDt: "2026/08/20",
                prevBal: "0",
                billAmt: "1,200",
                pmtAmt: "0",
                adjust: "0",
              },
              bills: [
                {
                  purchaseDt: "2026/08/08",
                  postingDt: "2026/08/10",
                  merchantChiName: "假想商店",
                  occCurCode: "TWD",
                  authCode: "FAKE01",
                  foreignAmt: "1,200",
                  cardNo: "4000000000000002",
                  ntAmt: "1,200",
                  sorting: "0001",
                },
              ],
            },
          },
        },
      },
    },
    unbilled: { rsData: { allItems: [] } },
    realtime: {
      rsData: {
        allItems: [
          {
            origCurCode: "TWD",
            authCode: "FAKE02",
            merchName: "虛構咖啡",
            txnType: "消費",
            cardNo: "4000000000000002",
            txnDate: "20260918",
            txnAmt: "150",
            cardNoSuffixFour: "0002",
          },
        ],
        noMore: true,
      },
    },
  };
}

const databases: SqliteD1[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const db of databases.splice(0)) db.close();
});

beforeEach(() => {
  mocks.ctbcSync.mockReset();
});

function createEnv() {
  const db = new SqliteD1();
  databases.push(db);
  return {
    db,
    env: {
      DB: db as unknown as D1Database,
      CONFIG_ENCRYPTION_KEY: ENCRYPTION_KEY,
    } as Env,
  };
}

async function insertSettings(
  db: SqliteD1,
  config: Record<string, unknown>,
  cursor: string | null = null,
) {
  db.database
    .prepare(
      `INSERT INTO connector_settings
        (id, connector_id, encrypted_config, public_config, sync_cursor, created_at, updated_at)
       VALUES ('ctbc-settings', 'ctbc', ?, NULL, ?, '2026-01-01', '2026-01-01')`,
    )
    .run(await encryptJson(config, ENCRYPTION_KEY), cursor);
}

function settingsRow(db: SqliteD1) {
  return db.database
    .prepare(
      "SELECT encrypted_config, public_config, sync_cursor FROM connector_settings WHERE connector_id = 'ctbc'",
    )
    .get() as
    | {
        encrypted_config: string;
        public_config: string | null;
        sync_cursor: string | null;
      }
    | undefined;
}

function financialRows(db: SqliteD1) {
  const select = (sql: string) => db.database.prepare(sql).all();
  return {
    accounts: select(
      "SELECT id, source_id, account_name, account_type, currency, canonical_account_id, raw_payload FROM bank_accounts WHERE connector_id = 'ctbc' ORDER BY id",
    ),
    snapshots: select(
      "SELECT id, account_id, balance, available_balance, as_of_at FROM bank_balance_snapshots WHERE connector_id = 'ctbc' ORDER BY id",
    ),
    transactions: select(
      "SELECT id, account_id, source_id, posted_date, authorized_at, amount, description, status, matched_transaction_id FROM bank_transactions WHERE connector_id = 'ctbc' ORDER BY id",
    ),
    bills: select(
      "SELECT id, account_id, billing_period, statement_amount, minimum_payment, payment_due_date FROM credit_card_bills WHERE connector_id = 'ctbc' ORDER BY id",
    ),
  };
}

describe("importCtbcPayloads", () => {
  it("writes parsed records and creates an empty settings row when missing", async () => {
    const { db, env } = createEnv();

    const outcome = await importCtbcPayloads(env, payloads(), { now: NOW });

    expect(outcome).toMatchObject({
      success: true,
      connectorId: "ctbc",
      scope: "all",
      cursorUpdated: false,
    });
    expect(outcome.warnings).toBeUndefined();
    const rows = financialRows(db);
    // Combined-bill summary account plus one account for the card with activity.
    expect(
      rows.accounts.map((row) => [row.source_id, row.account_type]),
    ).toEqual([
      [expect.stringMatching(/^bank:ctbc:/), "savings"],
      ["credit:ctbc:0002", "credit"],
      ["credit:ctbc:main", "credit"],
    ]);
    expect(rows.transactions.length).toBeGreaterThanOrEqual(3);
    expect(rows.bills).toHaveLength(1);
    expect(outcome.records).toBe(
      rows.accounts.length +
        rows.snapshots.length +
        rows.transactions.length +
        rows.bills.length,
    );

    const settings = settingsRow(db);
    expect(settings).toBeDefined();
    expect(settings?.sync_cursor).toBeNull();
    await expect(
      decryptJson(settings!.encrypted_config, ENCRYPTION_KEY),
    ).resolves.toEqual({});
  });

  it("leaves existing credentials and cursor untouched", async () => {
    const { db, env } = createEnv();
    const stored = {
      userId: "Z000000000",
      account: "fake-user",
      password: "fake-pass",
    };
    await insertSettings(db, stored, "prior-cursor");
    const before = settingsRow(db);

    await importCtbcPayloads(env, payloads(), { now: NOW });

    expect(settingsRow(db)).toEqual(before);
    await expect(
      decryptJson(before!.encrypted_config, ENCRYPTION_KEY),
    ).resolves.toEqual(stored);
  });

  it("reports unavailable deposit transactions as a warning", async () => {
    const { env } = createEnv();
    const input = payloads();
    input.depositTransactions = { rsData: { detailList: [] } };

    const outcome = await importCtbcPayloads(env, input, {
      now: NOW,
      depositTransactionsUnavailable: true,
    });

    expect(outcome.warnings).toEqual([
      CTBC_DEPOSIT_TRANSACTIONS_UNAVAILABLE_WARNING,
    ]);
  });

  it("rejects payloads without any account and writes nothing", async () => {
    const { db, env } = createEnv();

    await expect(
      importCtbcPayloads(
        env,
        {
          depositOverview: { rsData: { note: FAKE_ACCOUNT } },
          depositTransactions: {},
          creditCards: {},
        },
        { now: NOW },
      ),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof CtbcImportPayloadError &&
        !error.message.includes(FAKE_ACCOUNT),
    );
    expect(settingsRow(db)).toBeUndefined();
    expect(financialRows(db).accounts).toEqual([]);
  });

  it("writes the same financial rows as the automatic CTBC sync", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const automatic = createEnv();
    const imported = createEnv();
    const credentials = {
      userId: "Z000000000",
      account: "fake-user",
      password: "fake-pass",
    };
    await insertSettings(automatic.db, credentials);
    await insertSettings(imported.db, credentials);
    mocks.ctbcSync.mockImplementation(async () => ({
      records: [],
      ...parseCtbcData(payloads(), new Date()),
      cursor: JSON.stringify({ syncedAt: NOW.toISOString() }),
    }));

    const syncOutcome = await syncCtbc(automatic.env, "manual");
    const importOutcome = await importCtbcPayloads(imported.env, payloads());

    expect(financialRows(imported.db)).toEqual(financialRows(automatic.db));
    expect(importOutcome.records).toBe(syncOutcome.records);
    expect(importOutcome.newRecords).toEqual(syncOutcome.newRecords);
    // Only the automatic sync advances its cursor.
    expect(settingsRow(automatic.db)?.sync_cursor).toContain("syncedAt");
    expect(settingsRow(imported.db)?.sync_cursor).toBeNull();
  });

  it("records the import as the connector's latest successful sync", async () => {
    const { db, env } = createEnv();

    await withManualSyncLock(env, "ctbc", "all", () =>
      importCtbcPayloads(env, payloads(), {
        depositTransactionsUnavailable: true,
      }),
    );

    const job = db.database
      .prepare(
        "SELECT last_status, last_success_at, last_error, locked_by FROM sync_jobs WHERE id = 'ctbc:all'",
      )
      .get() as Record<string, unknown>;
    expect(job.last_status).toBe("success");
    expect(job.last_success_at).toEqual(expect.any(String));
    expect(job.last_error).toBe(CTBC_DEPOSIT_TRANSACTIONS_UNAVAILABLE_WARNING);
    expect(job.locked_by).toBeNull();
  });
});

describe("importCtbcPayloads after the per-card account migration", () => {
  const SPLIT_MIGRATION = "0061_ctbc_credit_card_accounts.sql";
  const sha256 = (value: string) =>
    createHash("sha256").update(value, "utf8").digest("hex");
  // Realtime (qu041) and unbilled (qu006) shapes for one purchase; the realtime
  // authorization code carries a suffix the unbilled feed does not.
  const realtimeItem = {
    authCode: "246810 Y",
    merchName: "虛構購物網股份有限公司",
    txnType: "非實體卡交易",
    cardNo: "4000000000004444",
    cardNoSuffixFour: "4444",
    txnDateTime: "2026/09/11 01:01",
    txnDate: "20260911",
    txnAmt: 688,
  };
  const unbilledItem = {
    authCode: "246810",
    purchaseDt: "20260911",
    postingDt: "20260914",
    purchaseAmt: 688,
    description: "虛構購物網",
    cardNoSuffixFour: "4444_0",
    acwRefNbr: "FAKE-REF-1",
    sourceCurrency: "TWD",
  };
  const cardPayloads = (
    realtime: unknown[],
    unbilled: unknown[],
  ): CtbcPayloads => ({
    depositOverview: {},
    depositTransactions: {},
    creditCards: {
      rsData: {
        cardDataList: [
          {
            cardNoSuffixFour: "4444_0",
            cardNo: "4000-00**-****-4444",
            cardName: "虛構航空卡",
            positiveOrAttached: "正卡",
          },
        ],
      },
    },
    unbilled: { rsData: { allItems: unbilled } },
    realtime: { rsData: { allItems: realtime } },
  });

  /**
   * Seeds what the previous parser stored: an authorization and its unbilled
   * posted row side by side on the single `credit:ctbc:TWD` account.
   */
  function legacyDatabase() {
    const db = new SqliteD1(SPLIT_MIGRATION);
    databases.push(db);
    const pendingSourceId = parseCtbcData(cardPayloads([realtimeItem], []))
      .bankTransactions[0]!.sourceId;
    const postedSourceId = parseCtbcData(cardPayloads([], [unbilledItem]))
      .bankTransactions[0]!.sourceId;
    const legacyAccount = "ctbc:credit:ctbc:TWD";
    db.database.exec(`
      INSERT INTO bank_accounts
        (id, connector_id, source_id, account_type, currency, raw_payload,
         created_at, updated_at)
      VALUES ('${legacyAccount}', 'ctbc', 'credit:ctbc:TWD', 'credit', 'TWD',
              '{"cards":[]}', '2026-09-01', '2026-09-01');
    `);
    const insert = db.database.prepare(
      `INSERT INTO bank_transactions
        (id, connector_id, account_id, source_id, posted_date, authorized_at,
         amount, currency, description, status, raw_payload, created_at,
         updated_at)
       VALUES (?, 'ctbc', ?, ?, ?, ?, -688, 'TWD', ?, ?, ?, '2026-09-15',
               '2026-09-15')`,
    );
    insert.run(
      `${legacyAccount}:${pendingSourceId}`,
      legacyAccount,
      pendingSourceId,
      null,
      "2026-09-11T01:01:00+08:00",
      "虛構購物網股份有限公司",
      "pending",
      JSON.stringify({
        cardLast4: "4444",
        authorizationHash: sha256("246810 Y"),
        syncSourceId: pendingSourceId,
      }),
    );
    insert.run(
      `${legacyAccount}:${postedSourceId}`,
      legacyAccount,
      postedSourceId,
      "2026-09-14",
      "2026-09-11",
      "虛構購物網",
      "posted",
      JSON.stringify({
        authorizationHash: sha256("246810"),
        syncSourceId: postedSourceId,
      }),
    );
    db.database.exec(`
      INSERT INTO classification_overrides
        (id, target_type, target_id, category_id, created_at, updated_at)
      VALUES ('override-posted', 'bank_transaction',
              '${legacyAccount}:${postedSourceId}', 'shopping',
              '2026-09-15', '2026-09-15');
    `);
    db.applyMigration(SPLIT_MIGRATION);
    return {
      db,
      env: {
        DB: db as unknown as D1Database,
        CONFIG_ENCRYPTION_KEY: ENCRYPTION_KEY,
      } as Env,
    };
  }

  function purchaseRows(db: SqliteD1) {
    return db.database
      .prepare(
        `SELECT txn.id, account.source_id AS account, txn.status,
                txn.description, txn.authorized_at AS authorizedAt,
                txn.posted_date AS postedDate, override.category_id AS category
         FROM bank_transactions txn
         JOIN bank_accounts account ON account.id = txn.account_id
         LEFT JOIN classification_overrides override
           ON override.target_type = 'bank_transaction'
          AND override.target_id = txn.id
         WHERE txn.connector_id = 'ctbc' AND txn.amount = -688`,
      )
      .all();
  }

  for (const [label, realtime] of [
    ["while the authorization is still listed", [realtimeItem]],
    ["after the authorization left the realtime feed", []],
  ] as const) {
    it(`replaces a stored authorization with its posted row ${label}`, async () => {
      const { db, env } = legacyDatabase();
      expect(purchaseRows(db)).toHaveLength(2);

      await importCtbcPayloads(
        env,
        cardPayloads([...realtime], [unbilledItem]),
        { now: NOW },
      );

      expect(purchaseRows(db)).toEqual([
        {
          id: expect.any(String),
          account: "credit:ctbc:4444",
          status: "posted",
          description: "虛構購物網",
          authorizedAt: "2026-09-11T01:01:00+08:00",
          postedDate: "2026-09-14",
          category: "shopping",
        },
      ]);
      expect(
        db.database
          .prepare(
            "SELECT source_id FROM bank_accounts WHERE connector_id = 'ctbc' ORDER BY source_id",
          )
          .all()
          .map((row) => row.source_id),
      ).toEqual(["credit:ctbc:4444", "credit:ctbc:main"]);
    });
  }
});
