import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { parseTaishinCreditCardData } from "@taiwan-fin-hub/connectors";
import { afterEach, describe, expect, it } from "vitest";
import {
  persistStagedSyncWrite,
  type SyncWriteRecord,
} from "../../../src/features/sync/persistence";
import {
  bankAccountRecord,
  bankTransactionRecord,
} from "../../../src/features/sync/record-mapper";
import { prepareTaishinLifecycleWrite } from "../../../src/features/sync/taishin-lifecycle";

const migrationsDirectory = fileURLToPath(
  new URL("../../../../../packages/db/migrations/", import.meta.url),
);
const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

/** Minimal D1 facade over node:sqlite with an atomic batch. */
function createD1() {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  database.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    database.exec(readFileSync(`${migrationsDirectory}/${file}`, "utf8"));
  }
  const statement = (sql: string) => {
    let values: unknown[] = [];
    const execute = () => {
      const expanded: unknown[] = [];
      const rewritten = sql.replace(/\?(\d+)/g, (_, index) => {
        expanded.push(values[Number(index) - 1]);
        return "?";
      });
      const query = expanded.length > 0 ? rewritten : sql;
      const params = (expanded.length > 0 ? expanded : values) as never[];
      if (/^\s*SELECT\b/i.test(query)) {
        return {
          success: true,
          meta: { changes: 0 },
          results: database.prepare(query).all(...params),
        };
      }
      const result = database.prepare(query).run(...params);
      return {
        success: true,
        meta: { changes: Number(result.changes) },
        results: [],
      };
    };
    const prepared = {
      bind(...next: unknown[]) {
        values = next;
        return prepared;
      },
      execute,
      async all() {
        return execute();
      },
      async run() {
        return execute();
      },
    };
    return prepared;
  };
  const d1 = {
    prepare: statement,
    async batch(statements: Array<{ execute: () => unknown }>) {
      database.exec("BEGIN");
      try {
        const results = statements.map((item) => item.execute());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database;
  return { database, d1 };
}

const summary = { value: {}, error: null };

function bill(
  details: Array<{
    description: string;
    amount: string;
    date: string;
    card?: string;
    country?: string;
  }>,
) {
  return {
    value: {
      showAccoutnYM: "2026/09",
      newAcctDetailList: details.map((detail) => ({
        order: `信用卡 (卡號末四碼:${detail.card ?? "4321"})`,
        detail: [
          {
            showOutDesc: detail.description,
            showOutCurrency: "新臺幣",
            showOutPostDate: "2026/09/17",
            showOutTXNDate: detail.date,
            showOutAmt: detail.amount,
            showOutCountry: detail.country ?? "US",
          },
        ],
      })),
    },
    error: null,
  };
}

function realtime(rows: unknown[][], card = "4321") {
  return {
    value: {
      fmtRealTxListMap: [
        { cardname: `信用卡 (卡號末四碼:${card})`, txlist: rows },
      ],
    },
    error: null,
  };
}

const authorization = (
  date: string,
  time: string,
  category: string,
  amount: string,
) => [date, time, category, amount, "US", "成功"];

function syncRecords(payloads: {
  bills?: unknown[];
  realtime?: unknown;
}): SyncWriteRecord[] {
  const data = parseTaishinCreditCardData({
    summary,
    bills: payloads.bills ?? [],
    realtime: payloads.realtime,
  });
  const now = "2026-09-26T00:00:00.000Z";
  return [
    ...data.bankAccounts.map((account) =>
      bankAccountRecord("taishin", account, now),
    ),
    ...data.bankTransactions.map((transaction) =>
      bankTransactionRecord("taishin", transaction, now),
    ),
  ];
}

async function sync(
  d1: D1Database,
  payloads: Parameters<typeof syncRecords>[0],
  now = new Date("2026-09-26T00:00:00.000Z"),
) {
  const write = await prepareTaishinLifecycleWrite(
    d1,
    syncRecords(payloads),
    now,
  );
  await persistStagedSyncWrite(d1, {
    records: write.records,
    afterPromoteStatements: write.afterPromoteStatements,
  });
  return write;
}

function transactions(database: DatabaseSync) {
  return database
    .prepare(
      `SELECT id, status, authorized_at AS authorizedAt, amount, description
       FROM bank_transactions ORDER BY authorized_at, id`,
    )
    .all() as Array<{
    id: string;
    status: string;
    authorizedAt: string;
    amount: number;
    description: string;
  }>;
}

const softwarePosted = {
  description: "SAMPLE SOFTWARE 0000-00",
  amount: "793",
  date: "2026/09/15",
};

describe("Taishin pending/posted lifecycle persistence", () => {
  it("replaces a stored authorization that already left the realtime list and keeps user settings", async () => {
    const { database, d1 } = createD1();
    await sync(d1, {
      realtime: realtime([
        authorization(
          "2026/09/15",
          "18:05:02",
          "電腦、電腦外圍用具、軟體",
          "793",
        ),
      ]),
    });
    const [pending] = transactions(database);
    expect(pending).toMatchObject({ status: "pending", amount: -793 });
    database.exec(`
      INSERT INTO classification_overrides VALUES
        ('user-category', 'bank_transaction', '${pending!.id}', 'shopping', '2026-09-16', '2026-09-16');
      INSERT INTO bank_transaction_preferences VALUES
        ('${pending!.id}', 1, '2026-09-16', '2026-09-16');
      INSERT INTO activity_role_overrides
        (target_kind, target_id, economic_role, created_at, updated_at)
      VALUES ('bank_transaction', '${pending!.id}', 'investment', '2026-09-16', '2026-09-16');
      INSERT INTO activity_notes
        (target_kind, target_id, note, created_at, updated_at)
      VALUES ('bank_transaction', '${pending!.id}', '年度軟體授權', '2026-09-16', '2026-09-16');
      INSERT INTO invoices (id, connector_id, source_id, invoice_date, amount, created_at, updated_at)
      VALUES ('invoice-1', 'einvoice', 'invoice-1', '2026-09-15', 793, 'now', 'now');
      INSERT INTO invoice_transaction_preferences VALUES
        ('invoice-1', '${pending!.id}', 'linked', 'now', 'now');
    `);

    // The bank no longer lists the authorization once the bill shows it.
    await sync(d1, {
      bills: [bill([softwarePosted])],
      realtime: realtime([]),
    });

    const rows = transactions(database);
    expect(rows).toEqual([
      expect.objectContaining({
        status: "posted",
        amount: -793,
        description: "SAMPLE SOFTWARE 0000-00",
        authorizedAt: "2026-09-15T18:05:02+08:00",
      }),
    ]);
    const postedId = rows[0]!.id;
    expect(
      database
        .prepare(
          "SELECT target_id, category_id FROM classification_overrides WHERE target_type = 'bank_transaction'",
        )
        .all(),
    ).toEqual([{ target_id: postedId, category_id: "shopping" }]);
    expect(
      database
        .prepare(
          "SELECT transaction_id, excluded_from_calculation FROM bank_transaction_preferences",
        )
        .all(),
    ).toEqual([{ transaction_id: postedId, excluded_from_calculation: 1 }]);
    expect(
      database
        .prepare("SELECT target_id, economic_role FROM activity_role_overrides")
        .all(),
    ).toEqual([{ target_id: postedId, economic_role: "investment" }]);
    expect(
      database.prepare("SELECT target_id, note FROM activity_notes").all(),
    ).toEqual([{ target_id: postedId, note: "年度軟體授權" }]);
    expect(
      database
        .prepare("SELECT transaction_id FROM invoice_transaction_preferences")
        .all(),
    ).toEqual([{ transaction_id: postedId }]);

    // Later syncs keep one row and the adopted time.
    await sync(d1, {
      bills: [bill([softwarePosted])],
      realtime: realtime([]),
    });
    expect(transactions(database)).toEqual(rows);
  });

  it("does not write an authorization whose posted row was stored by an earlier sync", async () => {
    const { database, d1 } = createD1();
    await sync(d1, { bills: [bill([softwarePosted])] });
    // Bill fetch skipped this time; the realtime list still shows the purchase.
    await sync(d1, {
      realtime: realtime([
        authorization(
          "2026/09/15",
          "18:05:02",
          "電腦、電腦外圍用具、軟體",
          "793",
        ),
      ]),
    });

    expect(transactions(database)).toEqual([
      expect.objectContaining({
        status: "posted",
        description: "SAMPLE SOFTWARE 0000-00",
      }),
    ]);
  });

  it("keeps both stored authorizations when two share the card, amount and window", async () => {
    const { database, d1 } = createD1();
    await sync(d1, {
      realtime: realtime([
        authorization("2026/09/15", "12:00:00", "餐飲", "150"),
        authorization("2026/09/16", "12:00:00", "餐飲", "150"),
      ]),
    });
    await sync(d1, {
      bills: [
        bill([{ description: "某餐廳", amount: "150", date: "2026/09/15" }]),
      ],
      realtime: realtime([]),
    });

    expect(
      transactions(database)
        .map(({ status }) => status)
        .sort(),
    ).toEqual(["pending", "pending", "posted"]);
  });

  it("keeps the authorization when its user category conflicts with the posted row", async () => {
    const { database, d1 } = createD1();
    await sync(d1, { bills: [bill([softwarePosted])] });
    const postedId = transactions(database)[0]!.id;
    database.exec(`
      INSERT INTO bank_transactions
        (id, connector_id, account_id, source_id, authorized_at, amount, currency,
         description, raw_payload, status, created_at, updated_at)
      VALUES ('stored-pending', 'taishin', 'taishin:credit:taishin:main',
        'taishin:card:tx:v2:stored', '2026-09-15T10:00:00+08:00', -793, 'TWD', '其他交易',
        '{"cardLast4":"4321","country":"US"}', 'pending', 'now', 'now');
      INSERT INTO classification_overrides VALUES
        ('pending-category', 'bank_transaction', 'stored-pending', 'shopping', 'now', 'now'),
        ('posted-category', 'bank_transaction', '${postedId}', 'food', 'now', 'now');
    `);

    const write = await sync(d1, { bills: [bill([softwarePosted])] });

    expect(write.links).toHaveLength(1);
    expect(transactions(database).map(({ id }) => id)).toEqual([
      "stored-pending",
      postedId,
    ]);
  });

  it("drops a user duplicate marker between the authorization and its posted row", async () => {
    const { database, d1 } = createD1();
    await sync(d1, { bills: [bill([softwarePosted])] });
    const postedId = transactions(database)[0]!.id;
    database.exec(`
      INSERT INTO bank_transactions
        (id, connector_id, account_id, source_id, authorized_at, amount, currency,
         description, raw_payload, status, created_at, updated_at)
      VALUES ('stored-pending', 'taishin', 'taishin:credit:taishin:main',
        'taishin:card:tx:v2:stored', '2026-09-15T10:00:00+08:00', -793, 'TWD', '其他交易',
        '{"cardLast4":"4321","country":"US"}', 'pending', 'now', 'now');
      INSERT INTO activity_role_overrides
        (target_kind, target_id, economic_role, duplicate_of_kind, duplicate_of_id, created_at, updated_at)
      VALUES ('bank_transaction', '${postedId}', 'spending', 'bank_transaction', 'stored-pending', 'now', 'now');
    `);

    await sync(d1, { bills: [bill([softwarePosted])] });

    expect(transactions(database).map(({ id }) => id)).toEqual([postedId]);
    expect(
      database
        .prepare(
          "SELECT target_id, economic_role, duplicate_of_id FROM activity_role_overrides",
        )
        .all(),
    ).toEqual([
      { target_id: postedId, economic_role: "spending", duplicate_of_id: null },
    ]);
  });

  it("keeps an authorization that stays unposted beyond fourteen days", async () => {
    const { database, d1 } = createD1();
    await sync(d1, {
      realtime: realtime([
        authorization("2026/08/20", "09:00:00", "其他交易", "205"),
      ]),
    });
    const write = await sync(
      d1,
      {
        bills: [
          bill([{ description: "某商店", amount: "205", date: "2026/09/15" }]),
        ],
        realtime: realtime([]),
      },
      new Date("2026-09-26T00:00:00.000Z"),
    );

    expect(write.links).toEqual([]);
    expect(transactions(database).map(({ status }) => status)).toEqual([
      "pending",
      "posted",
    ]);
  });
});
