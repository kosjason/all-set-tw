import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestD1 } from "../../helpers/d1";
import { prepareTaishinAuthorizationWrite } from "../../../src/sources/taishin/authorizations";

// 合成資料：即時消費清單用公司登記名稱，帳單用商家簡稱，同卡同日同額。
describe("台新授權與入帳：店名寫法不同（隔離 D1）", () => {
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

  async function card(
    id: string,
    status: "pending" | "posted",
    description: string,
    authorizedAt: string,
    sourceId = `taishin:card:tx:v2:TWD:2026-09-24:-810:9999:${id}:1`,
    raw: Record<string, unknown> = {},
  ) {
    await db
      .prepare(
        `INSERT INTO bank_transactions
          (id, connector_id, account_id, source_id, amount, currency, description,
           authorized_at, posted_date, status, raw_payload, created_at, updated_at)
         VALUES (?, 'taishin', 'card', ?, -810, 'TWD', ?, ?, '2026-09-24', ?, ?, 't', 't')`,
      )
      .bind(
        id,
        sourceId,
        description,
        authorizedAt,
        status,
        JSON.stringify({ cardLast4: "9999", ...raw }),
      )
      .run();
  }

  async function linkedTo(id: string) {
    return db
      .prepare(
        "SELECT matched_transaction_id FROM bank_transactions WHERE id = ?",
      )
      .bind(id)
      .first("matched_transaction_id");
  }

  it("同卡同日同額且雙向唯一時配對，並把代墊角色與備註帶到入帳列", async () => {
    await card(
      "auth",
      "pending",
      "虛構媒體科技股份有限公司",
      "2026-09-24T12:30:00+08:00",
    );
    await card("posted", "posted", "虛構購物－ＥＣTAIPE", "2026-09-24");
    await db.batch([
      db.prepare(
        "INSERT INTO activity_role_overrides (target_kind, target_id, economic_role, counterparty, created_at, updated_at) VALUES ('bank_transaction', 'auth', 'advance', '虛構朋友', 't', 't')",
      ),
      db.prepare(
        "INSERT INTO activity_notes (target_kind, target_id, note, created_at, updated_at) VALUES ('bank_transaction', 'auth', '幫朋友買', 't', 't')",
      ),
    ]);

    const write = await prepareTaishinAuthorizationWrite(db, []);
    await db.batch(write.afterPromoteStatements);

    expect(
      await db
        .prepare(
          "SELECT matched_transaction_id FROM bank_transactions WHERE id = 'auth'",
        )
        .first("matched_transaction_id"),
    ).toBe("posted");
    expect(
      await db
        .prepare(
          "SELECT economic_role, counterparty FROM activity_role_overrides WHERE target_id = 'posted'",
        )
        .first(),
    ).toEqual({ economic_role: "advance", counterparty: "虛構朋友" });
    expect(
      await db
        .prepare("SELECT note FROM activity_notes WHERE target_id = 'posted'")
        .first("note"),
    ).toBe("幫朋友買");
  });

  it("同卡同日同額有兩筆入帳時不配對", async () => {
    await card(
      "auth",
      "pending",
      "虛構媒體科技股份有限公司",
      "2026-09-24T12:30:00+08:00",
    );
    await card("posted-a", "posted", "虛構購物－ＥＣTAIPE", "2026-09-24");
    await card("posted-b", "posted", "另一家虛構商店", "2026-09-24");

    const write = await prepareTaishinAuthorizationWrite(db, []);
    expect(write.afterPromoteStatements).toEqual([]);
  });

  it("店名不明且入帳附近另有同額授權時不配對", async () => {
    await card(
      "auth",
      "pending",
      "台新信用卡交易",
      "2026-09-24T12:30:00+08:00",
    );
    await card(
      "other",
      "pending",
      "另一家虛構商店",
      "2026-09-25T09:00:00+08:00",
    );
    await card("posted", "posted", "虛構購物－ＥＣTAIPE", "2026-09-24");

    const write = await prepareTaishinAuthorizationWrite(db, []);
    expect(write.afterPromoteStatements).toEqual([]);
  });

  it("國外商家帳單消費日差一天、店名相符且唯一時配對", async () => {
    await card(
      "auth",
      "pending",
      "EXAMPLE.COM/BILL",
      "2026-09-25T02:19:58+08:00",
    );
    await card("posted", "posted", "EXAMPLE.COM/BILLA1234", "2026-09-24");

    const write = await prepareTaishinAuthorizationWrite(db, []);
    await db.batch(write.afterPromoteStatements);
    expect(await linkedTo("auth")).toBe("posted");
  });

  it("差一天但店名不同時不配對", async () => {
    await card(
      "auth",
      "pending",
      "虛構媒體科技股份有限公司",
      "2026-09-25T12:30:00+08:00",
    );
    await card("posted", "posted", "虛構購物－ＥＣTAIPE", "2026-09-24");

    const write = await prepareTaishinAuthorizationWrite(db, []);
    expect(write.afterPromoteStatements).toEqual([]);
  });

  it("舊識別碼列即將被新版識別碼取代時，授權配到新列", async () => {
    const description = "EXAMPLE.COM/BILLA1111 222233";
    await card(
      "auth",
      "pending",
      "EXAMPLE.COM/BILL",
      "2026-09-24T13:32:22+08:00",
    );
    await card(
      "old",
      "posted",
      description,
      "2026-09-24",
      "taishin:card:tx:v2:TWD:2026-09-24:-810:9999:examplecombilla1111222233:1",
    );
    const newSourceId =
      "taishin:card:tx:v2:TWD:2026-09-24:-810:9999:examplecombilla****2233:1";
    const write = await prepareTaishinAuthorizationWrite(db, [
      {
        entityType: "bank_transaction",
        recordKey: "new",
        payload: {
          id: "new",
          connector_id: "taishin",
          account_id: "card",
          source_id: newSourceId,
          amount: -810,
          currency: "TWD",
          description: "EXAMPLE.COM/BILLA****2233",
          authorized_at: "2026-09-24",
          posted_date: "2026-09-24",
          status: "posted",
          raw_payload: JSON.stringify({ cardLast4: "9999" }),
        },
      },
    ]);
    await card(
      "new",
      "posted",
      "EXAMPLE.COM/BILLA****2233",
      "2026-09-24",
      newSourceId,
    );
    await db.batch(write.afterPromoteStatements);
    expect(await linkedTo("auth")).toBe("new");
  });

  it("清單沒有店名、授權晚兩天送到銀行時，附近唯一的同額入帳配對", async () => {
    await card(
      "auth",
      "pending",
      "其他交易",
      "2026-09-26T18:30:41+08:00",
      undefined,
      { identityDescription: "其他交易" },
    );
    await card("posted", "posted", "虛構自動加值－台北車站", "2026-09-24");

    const write = await prepareTaishinAuthorizationWrite(db, []);
    await db.batch(write.afterPromoteStatements);
    expect(await linkedTo("auth")).toBe("posted");
    // 授權時刻是銀行收到的時間，入帳列保留帳單消費日。
    expect(
      await db
        .prepare(
          "SELECT authorized_at FROM bank_transactions WHERE id = 'posted'",
        )
        .first("authorized_at"),
    ).toBe("2026-09-24");
  });

  it("清單沒有店名但附近有兩筆同額入帳，或入帳附近另有同額授權時不配對", async () => {
    await card(
      "auth",
      "pending",
      "其他交易",
      "2026-09-26T18:30:41+08:00",
      undefined,
      { identityDescription: "其他交易" },
    );
    await card("posted-a", "posted", "虛構自動加值－台北車站", "2026-09-24");
    await card("posted-b", "posted", "另一家虛構商店", "2026-09-27");
    expect(
      (await prepareTaishinAuthorizationWrite(db, [])).afterPromoteStatements,
    ).toEqual([]);

    await db
      .prepare("DELETE FROM bank_transactions WHERE id = 'posted-b'")
      .run();
    await card(
      "named",
      "pending",
      "另一家虛構商店",
      "2026-09-23T09:00:00+08:00",
      undefined,
      { identityDescription: "其他交易" },
    );
    expect(
      (await prepareTaishinAuthorizationWrite(db, [])).afterPromoteStatements,
    ).toEqual([]);
  });

  it("有店名但與入帳不同、日期又不同時不配對", async () => {
    await card(
      "auth",
      "pending",
      "虛構媒體科技股份有限公司",
      "2026-09-26T12:30:00+08:00",
      undefined,
      { identityDescription: "其他交易" },
    );
    await card("posted", "posted", "虛構購物－ＥＣTAIPE", "2026-09-24");
    expect(
      (await prepareTaishinAuthorizationWrite(db, [])).afterPromoteStatements,
    ).toEqual([]);
  });
});
