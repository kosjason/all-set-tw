import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestD1 } from "../../helpers/d1";
import type { SyncWriteRecord } from "../../../src/features/sync/persistence";
import {
  prepareTaishinMaskedIdentityMerge,
  taishinMaskedSourceId,
} from "../../../src/sources/taishin/repository";

// 合成資料：描述含長串數字的訂閱扣款，與含身分證格式的遊戲儲值。
const RAW_APPLE = "APPLE.COM/BILLA1111 222233";
const MASKED_APPLE = "APPLE.COM/BILLA****2233";
const OLD_APPLE_ID =
  "taishin:card:tx:v2:TWD:2026-06-17:-90:9999:applecombilla1111222233:1";
const NEW_APPLE_ID =
  "taishin:card:tx:v2:TWD:2026-06-17:-90:9999:applecombilla****2233:1";

describe("台新識別碼遮罩前後的對應", () => {
  it("只替換描述段，保留幣別、日期、金額、末四碼與 occurrence", () => {
    expect(taishinMaskedSourceId(OLD_APPLE_ID, RAW_APPLE)).toBe(NEW_APPLE_ID);
    expect(
      taishinMaskedSourceId(
        "taishin:card:tx:v2:TWD:2026-06-19:-360:8888:nintendocca123456789kyoto:2",
        "Nintendo CA123456789 Kyoto",
      ),
    ).toBe(
      "taishin:card:tx:v2:TWD:2026-06-19:-360:8888:nintendoc身分證已遮罩kyoto:2",
    );
  });

  it("沒有可遮罩內容時識別碼不變，格式不符時不處理", () => {
    const plain =
      "taishin:card:tx:v2:TWD:2026-06-17:-70:9999:連支*可不可熟成紅茶taipei:1";
    expect(taishinMaskedSourceId(plain, "連支＊可不可熟成紅茶Taipei")).toBe(
      plain,
    );
    expect(
      taishinMaskedSourceId("taishin:card:statement:2026-09:TWD", "x"),
    ).toBeNull();
    expect(
      taishinMaskedSourceId("taishin:card:tx:v2:TWD:bad:-1:9999:x:1", "x"),
    ).toBeNull();
  });
});

describe("台新舊識別碼合併（隔離 D1）", () => {
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
        "invoice_transaction_preferences",
        "bank_transaction_preferences",
        "classification_overrides",
        "bank_transactions",
        "bank_accounts",
      ].map((t) => db.prepare(`DELETE FROM ${t}`)),
    );
    await db
      .prepare(
        "INSERT INTO bank_accounts (id, connector_id, source_id, account_type, created_at, updated_at) VALUES ('card', 'taishin', 'credit:taishin:main', 'credit', 't', 't')",
      )
      .run();
  });

  async function insert(id: string, sourceId: string, description: string) {
    await db
      .prepare(
        `INSERT INTO bank_transactions
          (id, connector_id, account_id, source_id, amount, currency, description,
           posted_date, authorized_at, status, created_at, updated_at)
         VALUES (?, 'taishin', 'card', ?, -90, 'TWD', ?, '2026-06-17', '2026-06-17',
           'posted', 't', 't')`,
      )
      .bind(id, sourceId, description)
      .run();
  }

  function record(id: string, sourceId: string): SyncWriteRecord {
    return {
      entityType: "bank_transaction",
      recordKey: id,
      payload: {
        id,
        account_id: "card",
        source_id: sourceId,
        status: "posted",
      },
    };
  }

  async function ids() {
    const rows = await db
      .prepare("SELECT id FROM bank_transactions ORDER BY id")
      .all<{ id: string }>();
    return rows.results.map((row) => row.id);
  }

  it("舊列併入新版識別碼的列，並帶走使用者的分類與代墊設定", async () => {
    await insert("old", OLD_APPLE_ID, RAW_APPLE);
    await insert("new", NEW_APPLE_ID, MASKED_APPLE);
    await db.batch([
      db.prepare(
        "INSERT INTO classification_overrides VALUES ('override:bank_transaction:old', 'bank_transaction', 'old', 'entertainment', 't', 't')",
      ),
      db.prepare(
        "INSERT INTO activity_role_overrides (target_kind, target_id, economic_role, counterparty, created_at, updated_at) VALUES ('bank_transaction', 'old', 'advance', '虛構朋友', 't', 't')",
      ),
    ]);

    await db.batch(
      await prepareTaishinMaskedIdentityMerge(db, [
        record("new", NEW_APPLE_ID),
      ]),
    );

    expect(await ids()).toEqual(["new"]);
    expect(
      await db
        .prepare(
          "SELECT target_id, category_id FROM classification_overrides WHERE target_type = 'bank_transaction'",
        )
        .all(),
    ).toMatchObject({
      results: [{ target_id: "new", category_id: "entertainment" }],
    });
    expect(
      await db
        .prepare(
          "SELECT target_id, economic_role, counterparty FROM activity_role_overrides",
        )
        .all(),
    ).toMatchObject({
      results: [
        {
          target_id: "new",
          economic_role: "advance",
          counterparty: "虛構朋友",
        },
      ],
    });
  });

  it("描述不同的同日同額交易不合併", async () => {
    await insert(
      "other",
      "taishin:card:tx:v2:TWD:2026-06-17:-90:9999:另一家店55556666777:1",
      "另一家店55556666777",
    );
    await insert("new", NEW_APPLE_ID, MASKED_APPLE);
    expect(
      await prepareTaishinMaskedIdentityMerge(db, [
        record("new", NEW_APPLE_ID),
      ]),
    ).toEqual([]);
    expect(await ids()).toEqual(["new", "other"]);
  });

  it("本次仍以舊識別碼寫入的列不合併", async () => {
    await insert("old", OLD_APPLE_ID, RAW_APPLE);
    await insert("new", NEW_APPLE_ID, MASKED_APPLE);
    expect(
      await prepareTaishinMaskedIdentityMerge(db, [
        record("old", OLD_APPLE_ID),
        record("new", NEW_APPLE_ID),
      ]),
    ).toEqual([]);
  });

  it("即時授權列不以描述重算識別碼，也不併入入帳列", async () => {
    // 授權列的識別碼取自消費類別，描述是店名；以描述重算會剛好等於入帳列的識別碼。
    await db
      .prepare(
        `INSERT INTO bank_transactions
          (id, connector_id, account_id, source_id, amount, currency, description,
           authorized_at, status, created_at, updated_at)
         VALUES ('auth', 'taishin', 'card',
           'taishin:card:tx:v2:TWD:2026-06-17:-90:9999:其他交易:1', -90, 'TWD',
           '連支*可不可熟成紅茶taipei', '2026-06-17T12:00:00+08:00', 'pending', 't', 't')`,
      )
      .run();
    const postedId =
      "taishin:card:tx:v2:TWD:2026-06-17:-90:9999:連支*可不可熟成紅茶taipei:1";
    await insert("new", postedId, "連支*可不可熟成紅茶taipei");
    expect(
      await prepareTaishinMaskedIdentityMerge(db, [record("new", postedId)]),
    ).toEqual([]);
  });
});
