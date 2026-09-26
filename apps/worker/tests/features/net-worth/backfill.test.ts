import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  planDepositBackfill,
  type BackfillAccountInput,
  type BackfillTransactionInput,
} from "../../../src/features/net-worth/backfill";
import { calculateBankDepositValue } from "../../../src/features/net-worth/repository";
import {
  backfillBankDepositSnapshots,
  ensureBankDepositHistoryToday,
  getNetWorthChartHistory,
  refreshBankDepositHistory,
} from "../../../src/features/net-worth/service";

// ---------------------------------------------------------------------------
// 純計算：planDepositBackfill
// ---------------------------------------------------------------------------

function account(
  overrides: Partial<BackfillAccountInput> & { id: string },
): BackfillAccountInput {
  return {
    connectorId: "esun",
    accountLast4: overrides.id.slice(-4),
    openedDate: null,
    anchor: {
      balance: 1000,
      currency: "TWD",
      asOfAt: "2026-09-10T02:00:00.000Z",
    },
    ...overrides,
  };
}

function tx(
  accountId: string,
  authorizedAt: string,
  amount: number,
  balance?: number,
  extra: Partial<BackfillTransactionInput> = {},
): BackfillTransactionInput {
  return {
    accountId,
    postedDate: authorizedAt.slice(0, 10),
    authorizedAt,
    amount,
    currency: "TWD",
    rawPayload: JSON.stringify(balance === undefined ? {} : { balance }),
    ...extra,
  };
}

function balances(
  plan: ReturnType<typeof planDepositBackfill>,
  accountId: string,
) {
  return Object.fromEntries(
    plan.snapshots
      .filter((snapshot) => snapshot.accountId === accountId)
      .map((snapshot) => [snapshot.date, snapshot.balance]),
  );
}

describe("planDepositBackfill", () => {
  it("uses the day-end running balance and carries it over quiet days", () => {
    const plan = planDepositBackfill({
      accounts: [account({ id: "a-1111" })],
      transactions: [
        tx("a-1111", "2026-09-05T09:00:00+08:00", 500, 1100),
        // 同日兩筆：排序相同也能由鏈的終點找到日終餘額。
        tx("a-1111", "2026-09-07T10:00:00+08:00", -300, 800),
        tx("a-1111", "2026-09-07T10:00:00+08:00", 200, 1000),
      ],
      syncMonths: 3,
    });
    expect(balances(plan, "a-1111")).toEqual({
      "2026-09-05": 1100,
      "2026-09-06": 1100,
      "2026-09-07": 1000,
      "2026-09-08": 1000,
      "2026-09-09": 1000,
    });
    expect(plan.accounts[0]).toMatchObject({
      status: "backfilled",
      from: "2026-09-05",
      to: "2026-09-09",
      days: 5,
      methods: { running_balance: 5 },
      crossCheck: { comparedDays: 5, mismatchDays: 0 },
    });
  });

  it("reverses transaction sums from the first real snapshot when no running balance exists", () => {
    const plan = planDepositBackfill({
      accounts: [account({ id: "b-2222", connectorId: "obank" })],
      transactions: [
        tx("b-2222", "2026-09-06", -200),
        tx("b-2222", "2026-09-08", 300),
        // 錨點當天、時間早於錨點的交易算在錨點之前；晚於錨點的不影響。
        tx("b-2222", "2026-09-10T09:00:00+08:00", 50),
        tx("b-2222", "2026-09-10T20:00:00+08:00", 999),
      ],
      syncMonths: 3,
    });
    expect(balances(plan, "b-2222")).toEqual({
      "2026-09-06": 650,
      "2026-09-07": 650,
      "2026-09-08": 950,
      "2026-09-09": 950,
    });
    expect(plan.accounts[0]).toMatchObject({
      methods: { reverse_sum: 4 },
    });
    expect(plan.accounts[0]!.crossCheck).toBeUndefined();
  });

  it("prefers the real snapshot when running balances disagree", () => {
    const plan = planDepositBackfill({
      accounts: [account({ id: "c-3333" })],
      transactions: [
        tx("c-3333", "2026-09-07T10:00:00+08:00", 100, 900),
        // 缺一筆交易：9/08 的交易後餘額與倒推值不一致。
        tx("c-3333", "2026-09-08T10:00:00+08:00", 50, 1200),
      ],
      syncMonths: 3,
    });
    // 倒推：9/08 = 1000；9/07 = 1000 − 50 = 950。
    expect(balances(plan, "c-3333")).toEqual({
      "2026-09-07": 950,
      "2026-09-08": 1000,
      "2026-09-09": 1000,
    });
    expect(plan.accounts[0]).toMatchObject({
      status: "backfilled",
      methods: { reverse_sum: 3 },
      crossCheck: {
        comparedDays: 3,
        mismatchDays: 3,
        firstMismatch: "2026-09-07",
        lastMismatch: "2026-09-09",
      },
    });
  });

  it("extends trusted accounts without transactions from the earliest transaction day and respects opened dates", () => {
    const plan = planDepositBackfill({
      accounts: [
        account({ id: "d-4444" }),
        account({
          id: "e-5555",
          connectorId: "cathaybk",
          anchor: {
            balance: 70,
            currency: "TWD",
            asOfAt: "2026-09-10T02:00:00.000Z",
          },
        }),
        account({
          id: "f-6666",
          connectorId: "skbank",
          openedDate: "2026-09-08",
          anchor: {
            balance: 5000,
            currency: "TWD",
            asOfAt: "2026-09-10T02:00:00.000Z",
          },
        }),
      ],
      transactions: [tx("d-4444", "2026-09-07T10:00:00+08:00", 1000, 1000)],
      syncMonths: 3,
    });
    expect(balances(plan, "d-4444")).toEqual({
      "2026-09-07": 1000,
      "2026-09-08": 1000,
      "2026-09-09": 1000,
    });
    expect(balances(plan, "e-5555")).toEqual({
      "2026-09-07": 70,
      "2026-09-08": 70,
      "2026-09-09": 70,
    });
    expect(balances(plan, "f-6666")).toEqual({
      "2026-09-08": 5000,
      "2026-09-09": 5000,
    });
  });

  it("carries incomplete-detail accounts back flat instead of deriving from their transactions", () => {
    const plan = planDepositBackfill({
      accounts: [
        account({ id: "hncb-1357", connectorId: "hncb" }),
        account({ id: "ctbc-2468", connectorId: "ctbc" }),
        account({ id: "esun-none", anchor: null }),
        account({ id: "esun-usd" }),
        account({ id: "esun-1234" }),
      ],
      transactions: [
        // 中信網銀匯入只取到零星明細：即使交易後餘額剛好對得上也不推算。
        tx("ctbc-2468", "2026-09-02", -500, 1000, {
          rawPayload: JSON.stringify({ balanceAmt: 1000 }),
        }),
        tx("esun-usd", "2026-09-05T10:00:00+08:00", 10, 1000, {
          currency: "USD",
        }),
        tx("esun-1234", "2026-09-08T10:00:00+08:00", 10, 1000),
      ],
      syncMonths: 3,
    });
    const byId = Object.fromEntries(
      plan.accounts.map((report) => [report.accountId, report]),
    );
    // 明細不完整或不抓明細的帳戶：以第一筆真實快照往前延伸，不用零星明細推算。
    for (const id of ["hncb-1357", "ctbc-2468"])
      expect(byId[id]).toMatchObject({
        status: "backfilled",
        methods: { carry_back: byId[id]!.days },
      });
    const ctbc = plan.snapshots.filter(
      (snapshot) => snapshot.accountId === "ctbc-2468",
    );
    expect(ctbc.length).toBeGreaterThan(0);
    expect(new Set(ctbc.map((snapshot) => snapshot.balance))).toEqual(
      new Set([ctbc[0]!.balance]),
    );
    expect(ctbc.every((snapshot) => snapshot.method === "carry_back")).toBe(
      true,
    );
    expect(byId["esun-none"]).toMatchObject({ reason: "no_real_snapshot" });
    expect(byId["esun-usd"]).toMatchObject({ reason: "mixed_currency" });
    expect(byId["esun-1234"]).toMatchObject({ status: "backfilled" });
    expect(
      plan.snapshots
        .filter((snapshot) => snapshot.method !== "carry_back")
        .every((snapshot) => snapshot.accountId === "esun-1234"),
    ).toBe(true);
  });

  it("only backfills within the synced detail window", () => {
    const plan = planDepositBackfill({
      accounts: [
        account({
          id: "a-9999",
          anchor: {
            balance: 1000,
            currency: "TWD",
            asOfAt: "2026-09-10T02:00:00.000Z",
          },
        }),
      ],
      transactions: [tx("a-9999", "2026-05-01T10:00:00+08:00", 10, 1000)],
      syncMonths: 3,
    });
    expect(plan.accounts[0]).toMatchObject({
      from: "2026-06-10",
      to: "2026-09-09",
    });
  });
});

// ---------------------------------------------------------------------------
// D1 整合：寫入、冪等、真實快照優先、延續到今天、外幣換算、圖表標示
// ---------------------------------------------------------------------------

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
    private readonly database: DatabaseSync,
    readonly sql: string,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  private query() {
    return expandNumberedParams(this.sql, this.values);
  }

  async run() {
    return this.execute();
  }

  async all<T>() {
    return this.execute() as unknown as { results: T[] };
  }

  async raw() {
    const query = this.query();
    return (
      this.database
        .prepare(query.sql)
        .all(...(query.values as never[])) as Record<string, unknown>[]
    ).map((row) => Object.values(row));
  }

  async first<T>() {
    const query = this.query();
    return (
      (this.database
        .prepare(query.sql)
        .get(...(query.values as never[])) as T) ?? null
    );
  }

  execute() {
    const query = this.query();
    if (/^\s*(SELECT|WITH)\b/i.test(query.sql)) {
      return {
        success: true,
        meta: { changes: 0 },
        results: this.database
          .prepare(query.sql)
          .all(...(query.values as never[])),
      };
    }
    const result = this.database
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

  constructor() {
    this.database.exec("PRAGMA foreign_keys = ON");
    const migrationsDirectory = fileURLToPath(
      new URL("../../../../../packages/db/migrations/", import.meta.url),
    );
    for (const file of readdirSync(migrationsDirectory)
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      this.database.exec(
        readFileSync(`${migrationsDirectory}/${file}`, "utf8"),
      );
    }
  }

  prepare(sql: string) {
    return new SqliteStatement(this.database, sql);
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

const databases: SqliteD1[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

const NOW = "2026-09-10T00:00:00.000Z";

function createDb() {
  const db = new SqliteD1();
  databases.push(db);
  return db;
}

function insertAccount(
  db: SqliteD1,
  id: string,
  connectorId: string,
  currency = "TWD",
) {
  db.database
    .prepare(
      `INSERT INTO bank_accounts
        (id, connector_id, source_id, account_type, currency, account_last4, created_at, updated_at)
       VALUES (?, ?, ?, 'savings', ?, ?, ?, ?)`,
    )
    .run(id, connectorId, id, currency, id.slice(-4), NOW, NOW);
}

function insertSnapshot(
  db: SqliteD1,
  accountId: string,
  connectorId: string,
  sourceId: string,
  balance: number,
  asOfAt: string,
  currency = "TWD",
) {
  db.database
    .prepare(
      `INSERT INTO bank_balance_snapshots
        (id, connector_id, account_id, source_id, balance, currency, as_of_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      `${accountId}:${sourceId}`,
      connectorId,
      accountId,
      sourceId,
      balance,
      currency,
      asOfAt,
      NOW,
      NOW,
    );
}

function insertTransaction(
  db: SqliteD1,
  accountId: string,
  connectorId: string,
  authorizedAt: string,
  amount: number,
  raw: Record<string, unknown>,
  currency = "TWD",
) {
  db.database
    .prepare(
      `INSERT INTO bank_transactions
        (id, connector_id, account_id, source_id, posted_date, authorized_at, amount, currency, raw_payload, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      `${accountId}:${authorizedAt}`,
      connectorId,
      accountId,
      authorizedAt,
      authorizedAt.slice(0, 10),
      authorizedAt,
      amount,
      currency,
      JSON.stringify(raw),
      NOW,
      NOW,
    );
}

function derivedRows(db: SqliteD1) {
  return db.database
    .prepare(
      `SELECT account_id, source_id, balance, as_of_at, raw_payload
       FROM bank_balance_snapshots
       WHERE source_id LIKE 'derived-balance:%'
       ORDER BY account_id, source_id`,
    )
    .all() as Array<{
    account_id: string;
    source_id: string;
    balance: number;
    as_of_at: string;
    raw_payload: string;
  }>;
}

function depositHistory(db: SqliteD1) {
  return Object.fromEntries(
    (
      db.database
        .prepare(
          `SELECT date, net_worth FROM net_worth_history
           WHERE source = 'bank' AND asset_type = 'deposit' ORDER BY date`,
        )
        .all() as Array<{ date: string; net_worth: number }>
    ).map((row) => [row.date, row.net_worth]),
  );
}

function seedTwoAccounts(db: SqliteD1) {
  insertAccount(db, "esun-1111", "esun");
  insertAccount(db, "cathay-usd-2222", "cathaybk", "USD");
  db.database
    .prepare(
      `INSERT INTO exchange_rates (currency, rate_to_twd, updated_at) VALUES ('USD', 30, ?)`,
    )
    .run(NOW);
  // 真實快照：9/08 10:00（台北）第一次同步。
  insertSnapshot(
    db,
    "esun-1111",
    "esun",
    "real-1",
    1000,
    "2026-09-08T02:00:00.000Z",
  );
  insertSnapshot(
    db,
    "cathay-usd-2222",
    "cathaybk",
    "real-1",
    100,
    "2026-09-08T02:00:00.000Z",
    "USD",
  );
  insertTransaction(db, "esun-1111", "esun", "2026-09-05T09:00:00+08:00", 400, {
    balance: 900,
  });
  insertTransaction(db, "esun-1111", "esun", "2026-09-07T09:00:00+08:00", 100, {
    balance: 1000,
  });
  insertTransaction(
    db,
    "cathay-usd-2222",
    "cathaybk",
    "2026-09-06T09:00:00+08:00",
    -20,
    {},
    "USD",
  );
}

describe("bank deposit backfill with D1", () => {
  it("writes reproducible derived snapshots, keeps real snapshots and continues to today", async () => {
    const db = createDb();
    seedTwoAccounts(db);
    const d1 = db as unknown as D1Database;

    const result = await refreshBankDepositHistory(
      d1,
      new Date("2026-09-10T04:00:00.000Z"),
    );
    expect(result.backfill?.accounts).toMatchObject([
      {
        accountLast4: "2222",
        status: "backfilled",
        from: "2026-09-05",
        to: "2026-09-07",
        methods: { reverse_sum: 3 },
      },
      {
        accountLast4: "1111",
        status: "backfilled",
        from: "2026-09-05",
        to: "2026-09-07",
        methods: { running_balance: 3 },
        crossCheck: { mismatchDays: 0 },
      },
    ]);

    const rows = derivedRows(db);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({
      account_id: "cathay-usd-2222",
      source_id: "derived-balance:2026-09-05",
      balance: 120,
      as_of_at: "2026-09-05T15:59:59.000Z",
    });
    expect(JSON.parse(rows[3]!.raw_payload)).toEqual({
      derived: true,
      method: "running_balance",
    });

    // USD 以匯率 30 換算；9/08 之後沒有同步仍延續到今天（台北 9/10）。
    expect(depositHistory(db)).toEqual({
      "2026-09-05": 900 + 120 * 30,
      "2026-09-06": 900 + 100 * 30,
      "2026-09-07": 1000 + 100 * 30,
      "2026-09-08": 1000 + 100 * 30,
      "2026-09-09": 1000 + 100 * 30,
      "2026-09-10": 1000 + 100 * 30,
    });

    // 記憶體內逐日計算與既有 SQL 計算（calculateBankDepositValue）一致。
    for (const [date, value] of Object.entries(depositHistory(db))) {
      expect(await calculateBankDepositValue(d1, date)).toBe(value);
    }

    // 重跑冪等：數量與內容不變。
    await backfillBankDepositSnapshots(d1, new Date("2026-09-11T00:00:00Z"));
    expect(
      derivedRows(db).map(({ source_id, balance, account_id }) => ({
        source_id,
        balance,
        account_id,
      })),
    ).toEqual(
      rows.map(({ source_id, balance, account_id }) => ({
        source_id,
        balance,
        account_id,
      })),
    );

    // 真實快照不被刪除或覆寫。
    const real = db.database
      .prepare(
        `SELECT count(*) AS count FROM bank_balance_snapshots WHERE source_id = 'real-1'`,
      )
      .get() as { count: number };
    expect(real.count).toBe(2);

    const chart = await getNetWorthChartHistory(d1);
    expect(
      chart
        .filter((row) => "derived" in row)
        .map((row) => row.date)
        .sort(),
    ).toEqual(["2026-09-05", "2026-09-06", "2026-09-07"]);
  });

  it("drops stale derived rows when the window or the anchor changes", async () => {
    const db = createDb();
    seedTwoAccounts(db);
    const d1 = db as unknown as D1Database;
    // 舊版推算留下、已不在推算區間內的列。
    insertSnapshot(
      db,
      "esun-1111",
      "esun",
      "derived-balance:2026-06-01",
      1,
      "2026-06-01T15:59:59.000Z",
    );
    await backfillBankDepositSnapshots(d1, new Date(NOW));
    expect(
      derivedRows(db).some(
        (row) => row.source_id === "derived-balance:2026-06-01",
      ),
    ).toBe(false);

    // 更早的真實快照出現後，錨點前移，舊推算值不再使用。
    insertSnapshot(
      db,
      "esun-1111",
      "esun",
      "real-0",
      555,
      "2026-09-06T02:00:00.000Z",
    );
    await backfillBankDepositSnapshots(d1, new Date(NOW));
    expect(
      derivedRows(db)
        .filter((row) => row.account_id === "esun-1111")
        .map((row) => row.source_id),
    ).toEqual(["derived-balance:2026-09-05"]);
  });

  it("adds today's point from the scheduler using the latest known balance", async () => {
    const db = createDb();
    seedTwoAccounts(db);
    const d1 = db as unknown as D1Database;
    await refreshBankDepositHistory(d1, new Date("2026-09-08T04:00:00.000Z"));
    expect(Object.keys(depositHistory(db)).at(-1)).toBe("2026-09-08");

    const result = await ensureBankDepositHistoryToday(
      d1,
      new Date("2026-09-10T17:00:00.000Z"),
    );
    // 台北時間已是 9/11。
    expect(result).toMatchObject({ from: "2026-09-09", to: "2026-09-11" });
    expect(depositHistory(db)["2026-09-11"]).toBe(1000 + 100 * 30);
    expect(
      await ensureBankDepositHistoryToday(
        d1,
        new Date("2026-09-10T18:00:00.000Z"),
      ),
    ).toEqual({ dates: 0 });
  });
});
