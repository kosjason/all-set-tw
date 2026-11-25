import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestD1 } from "../../helpers/d1";
import { appendCathayDepositTransactions } from "../../../src/sources/cathaybk/connector";
import {
  planCathayDepositIdentity,
  prepareCathayDepositIdentity,
} from "../../../src/sources/cathaybk/repository";
import { persistStagedSyncWrite } from "../../../src/features/sync/persistence";
import { bankTransactionRecord } from "../../../src/features/sync/record-mapper";

// 合成資料：虛構帳號；說明仿照國泰改版前後的空白格式。
const ACCOUNT_SOURCE = "bank:cathaybk:123456789012";
const ACCOUNT_ID = `cathaybk:${ACCOUNT_SOURCE}`;
const WHEN = "2026-10-16T04:22:43";
const OLD_DESC = "轉帳 科技優息          基金配息";
const NEW_DESC = "轉帳     科技優息          基金配息";

function rawId(description: string, occurrence = 1) {
  const sourceId = `${WHEN}:${ACCOUNT_SOURCE}:1890:${description}:${occurrence}`;
  return { sourceId, id: `cathaybk:${ACCOUNT_SOURCE}:${sourceId}` };
}

/** 國泰本次回傳的交易，經 connector 正規化說明後的寫入紀錄。 */
function incoming(descriptions: string[]) {
  const transactions: Parameters<typeof appendCathayDepositTransactions>[0] =
    [];
  appendCathayDepositTransactions(
    transactions,
    descriptions.map((description) => ({
      txnDateTime: WHEN,
      incomeAmt: 1890,
      expendAmt: 0,
      description,
    })) as never,
    ACCOUNT_SOURCE,
    "TWD",
  );
  return transactions.map((transaction) =>
    bankTransactionRecord("cathaybk", transaction, "2026-11-25T00:00:00.000Z"),
  );
}

describe("國泰存款說明正規化", () => {
  it("connector 合併說明的空白，識別碼不受空白格式影響", () => {
    const [a] = incoming([OLD_DESC]);
    const [b] = incoming([NEW_DESC]);
    expect(a!.payload.description).toBe("轉帳 科技優息 基金配息");
    expect(a!.payload.source_id).toBe(b!.payload.source_id);
    expect(a!.payload.posted_date).toBe(WHEN);
  });

  it("本次寫入沿用既有列的 id，重複的舊列併入最早那一列", () => {
    const old = rawId(OLD_DESC);
    const dup = rawId(NEW_DESC);
    const existing = [
      {
        ...old,
        source_id: old.sourceId,
        account_id: ACCOUNT_ID,
        posted_date: WHEN,
        amount: 1890,
        description: OLD_DESC,
        created_at: "2026-09-25T00:00:00.000Z",
      },
      {
        ...dup,
        source_id: dup.sourceId,
        account_id: ACCOUNT_ID,
        posted_date: WHEN,
        amount: 1890,
        description: NEW_DESC,
        created_at: "2026-11-12T00:00:00.000Z",
      },
    ];
    const plan = planCathayDepositIdentity(existing, incoming([NEW_DESC]));
    expect(plan.records[0]).toMatchObject({
      recordKey: old.id,
      payload: { id: old.id, source_id: old.sourceId },
    });
    expect(plan.duplicatePairs).toEqual([[dup.id, old.id]]);
  });

  it("銀行確實有兩筆相同交易時不合併", () => {
    const first = rawId(OLD_DESC, 1);
    const second = rawId(NEW_DESC, 1);
    const existing = [first, second].map((row, index) => ({
      ...row,
      source_id: row.sourceId,
      account_id: ACCOUNT_ID,
      posted_date: WHEN,
      amount: 1890,
      description: index === 0 ? OLD_DESC : NEW_DESC,
      created_at: `2026-10-1${index}T00:00:00.000Z`,
    }));
    const plan = planCathayDepositIdentity(
      existing,
      incoming([NEW_DESC, NEW_DESC]),
    );
    expect(plan.duplicatePairs).toEqual([]);
    // 第一筆沿用最早的列，第二筆（occurrence 2）是新的列。
    expect(plan.records.map((record) => record.payload.id)).toEqual([
      first.id,
      expect.stringMatching(/基金配息:2$/u),
    ]);
  });
});

describe("國泰重複存款交易的合併（隔離 D1）", () => {
  let harness: Awaited<ReturnType<typeof createTestD1>>;
  let db: D1Database;
  beforeAll(async () => {
    harness = await createTestD1();
    db = harness.binding;
  }, 60_000);
  afterAll(async () => {
    await harness?.mf.dispose();
  });
  beforeEach(async () => {
    await db.batch(
      [
        "activity_role_overrides",
        "activity_notes",
        "classification_overrides",
        "bank_transaction_preferences",
        "bank_transactions",
        "bank_accounts",
      ].map((table) => db.prepare(`DELETE FROM ${table}`)),
    );
    await db
      .prepare(
        "INSERT INTO bank_accounts (id, connector_id, source_id, account_type, created_at, updated_at) VALUES (?, 'cathaybk', ?, 'savings', 't', 't')",
      )
      .bind(ACCOUNT_ID, ACCOUNT_SOURCE)
      .run();
  });

  async function insert(
    row: { id: string; sourceId: string },
    description: string,
    createdAt: string,
  ) {
    await db
      .prepare(
        `INSERT INTO bank_transactions
          (id, connector_id, account_id, source_id, amount, currency, description,
           posted_date, status, created_at, updated_at)
         VALUES (?, 'cathaybk', ?, ?, 1890, 'TWD', ?, ?, 'posted', ?, ?)`,
      )
      .bind(
        row.id,
        ACCOUNT_ID,
        row.sourceId,
        description,
        WHEN,
        createdAt,
        createdAt,
      )
      .run();
  }

  async function sync(descriptions: string[]) {
    const identity = await prepareCathayDepositIdentity(
      db,
      incoming(descriptions),
    );
    await persistStagedSyncWrite(db, {
      records: identity.records,
      afterPromoteStatements: identity.mergeStatements,
    });
  }

  async function rows() {
    return (
      await db
        .prepare(
          "SELECT id, description FROM bank_transactions ORDER BY created_at",
        )
        .all<{ id: string; description: string }>()
    ).results;
  }

  it("已重複的配息只留一筆，使用者設定移到保留的那一筆", async () => {
    const old = rawId(OLD_DESC);
    const dup = rawId(NEW_DESC);
    await insert(old, OLD_DESC, "2026-09-25T00:00:00.000Z");
    await insert(dup, NEW_DESC, "2026-11-12T00:00:00.000Z");
    await db
      .prepare(
        "INSERT INTO activity_notes (target_kind, target_id, note, created_at, updated_at) VALUES ('bank_transaction', ?, '00929 配息', 't', 't')",
      )
      .bind(dup.id)
      .run();

    await sync([NEW_DESC]);

    expect(await rows()).toEqual([
      { id: old.id, description: "轉帳 科技優息 基金配息" },
    ]);
    expect(
      (
        await db
          .prepare("SELECT target_id, note FROM activity_notes")
          .all<{ target_id: string; note: string }>()
      ).results,
    ).toEqual([{ target_id: old.id, note: "00929 配息" }]);
  });

  it("沒有重複的舊列只更新說明，不新增一筆", async () => {
    const old = rawId(OLD_DESC);
    await insert(old, OLD_DESC, "2026-09-25T00:00:00.000Z");
    await sync([NEW_DESC]);
    await sync([OLD_DESC]);
    expect(await rows()).toEqual([
      { id: old.id, description: "轉帳 科技優息 基金配息" },
    ]);
  });

  it("新的交易照常新增", async () => {
    await sync([NEW_DESC]);
    expect((await rows()).map((row) => row.description)).toEqual([
      "轉帳 科技優息 基金配息",
    ]);
  });
});
