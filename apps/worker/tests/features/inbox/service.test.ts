import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { InboxItem, InboxResponse } from "@taiwan-fin-hub/core";
import { inboxRoutes } from "../../../src/features/inbox/route";
import { getInbox } from "../../../src/features/inbox/service";
import { honoFactory } from "../../../src/platform/hono";
import { apiErrorResponse } from "../../../src/platform/http";
import type { Env } from "../../../src/platform/env";
import { createTestD1 } from "../../../../../packages/db/testing/d1";
import {
  CREATED,
  NOW,
  seedCards,
  transactionStatement,
  type Tx,
} from "../cards/fixtures";

const dep = (tx: Omit<Tx, "account" | "connector">): Tx => ({
  ...tx,
  account: "dep",
  connector: "cathaybk",
});

const inboxTransactions: Tx[] = [
  // 給別人或未登記帳戶的轉帳：待確認。
  dep({
    id: "to-friend",
    day: "2026-09-15",
    amount: -27000,
    description: "跨行轉出",
  }),
  dep({
    id: "to-friend-aug",
    day: "2026-08-20",
    amount: -5000,
    description: "跨行轉出",
  }),
  // 兩個月前的待確認不列入。
  dep({
    id: "to-friend-july",
    day: "2026-07-15",
    amount: -9000,
    description: "跨行轉出",
  }),
  // 繳未同步的富邦卡：推不出已同步的發卡行 → 待確認。
  dep({
    id: "fubon-card",
    day: "2026-09-05",
    amount: -3000,
    description: "信用卡款",
    counterparty: "富邦卡",
  }),
  // 發票前後各一天都有同額消費 → 配對歧義。
  dep({
    id: "bakery-a",
    day: "2026-09-21",
    amount: -450,
    description: "麵包工坊甲",
  }),
  dep({
    id: "bakery-b",
    day: "2026-09-23",
    amount: -450,
    description: "麵包工坊乙",
  }),
  // 兩個月前的未分類不列入。
  {
    id: "c1111-july",
    account: "cathay-1111",
    connector: "cathaybk",
    day: "2026-07-10",
    amount: -100,
    description: "雜貨舖",
  },
];

function kinds(inbox: InboxResponse) {
  return inbox.items.map((item) => item.kind);
}

function find(inbox: InboxResponse, predicate: (item: InboxItem) => boolean) {
  return inbox.items.find(predicate);
}

describe("inbox", () => {
  let harness: Awaited<ReturnType<typeof createTestD1>>;
  let db: D1Database;

  beforeAll(async () => {
    harness = await createTestD1();
    db = harness.binding;
    await seedCards(db);
    await db.batch([
      ...inboxTransactions.map((tx) => transactionStatement(db, tx)),
      db
        .prepare(
          "INSERT INTO invoices (id, connector_id, source_id, invoice_date, seller_name, amount, created_at, updated_at) VALUES ('inv-bakery', 'einvoice', 'inv-bakery', '2026-09-22', '麵包工坊', 450, ?1, ?1)",
        )
        .bind(CREATED),
      ...[
        "cathaybk",
        "taishin",
        "ctbc",
        "esun",
        "sinopac",
        "hncb",
        "kgibank",
      ].map((connector) =>
        db
          .prepare(
            "INSERT INTO connector_settings (id, connector_id, encrypted_config, created_at, updated_at) VALUES (?1, ?1, 'x', ?2, ?2)",
          )
          .bind(connector, CREATED),
      ),
      db.prepare(
        "UPDATE sync_jobs SET last_status = 'failed', last_error = '華南網銀暫時無法連線。', last_run_at = '2026-09-25T20:00:00.000Z' WHERE id = 'hncb:all'",
      ),
      db.prepare(
        "UPDATE sync_jobs SET last_status = 'needs_user_action', last_error = '需要輸入簡訊 OTP。', last_run_at = '2026-09-25T21:00:00.000Z' WHERE id = 'kgibank:all'",
      ),
      // 沒有設定的來源即使殘留失敗狀態也不列入。
      db.prepare(
        "UPDATE sync_jobs SET last_status = 'failed', last_error = 'x', last_run_at = '2026-09-25T20:00:00.000Z' WHERE id = 'firstbank:all'",
      ),
    ]);
  }, 60_000);

  afterAll(async () => {
    await harness?.mf.dispose();
  });

  it("aggregates every kind with blocking items first", async () => {
    const inbox = await getInbox(db, NOW);
    expect(inbox.months).toEqual(["2026-08", "2026-09"]);
    expect(inbox.unavailable).toEqual([]);
    expect(kinds(inbox)).toEqual([
      "connector_needs_user_action",
      "connector_error",
      "card_due_unpaid",
      "card_due_unpaid",
      "card_due_unpaid",
      "ctbc_import_stale",
      "needs_review",
      "needs_review",
      "needs_review",
      "duplicate_ambiguous",
      "uncategorized",
    ]);
    expect(inbox.counts).toEqual({ blocking: 6, tidy: 5 });

    expect(
      find(inbox, (item) => item.kind === "connector_error"),
    ).toMatchObject({
      severity: "blocking",
      title: "華南銀行同步失敗",
      detail: "華南網銀暫時無法連線。",
      target: { view: "data-sources", query: { connector: "hncb" } },
    });
    expect(
      find(inbox, (item) => item.kind === "connector_needs_user_action"),
    ).toMatchObject({
      title: "凱基銀行需要你完成驗證",
      detail: "需要輸入簡訊 OTP。",
      action: { kind: "open_connector" },
    });
    expect(
      find(inbox, (item) => item.kind === "ctbc_import_stale"),
    ).toMatchObject({
      severity: "blocking",
      detail: expect.stringContaining("15 天"),
      action: { kind: "run_ctbc_import" },
    });
  });

  it("lists unpaid or partially paid bills due within seven days", async () => {
    const inbox = await getInbox(db, NOW);
    const due = inbox.items.filter((item) => item.kind === "card_due_unpaid");
    // 國泰（部分繳、5 天）、中信（未繳、4 天）、玉山（推估、7 天）；台新已繳；永豐狀態不明。
    expect(due.map((item) => item.target.query?.issuer).sort()).toEqual([
      "cathaybk",
      "ctbc",
      "esun",
    ]);
    expect(
      due.find((item) => item.target.query?.issuer === "cathaybk"),
    ).toMatchObject({
      title: "國泰世華銀行卡費尚未繳清",
      amount: 20000,
      target: { view: "cards" },
    });
    expect(
      due.find((item) => item.target.query?.issuer === "esun")?.detail,
    ).toContain("推估");
  });

  it("limits activity items to this and last month", async () => {
    const inbox = await getInbox(db, NOW);
    const review = inbox.items.filter((item) => item.kind === "needs_review");
    expect(review.map((item) => item.id).sort()).toEqual([
      "needs_review:bank:fubon-card",
      "needs_review:bank:to-friend",
      "needs_review:bank:to-friend-aug",
    ]);
    expect(
      review.find((item) => item.id === "needs_review:bank:fubon-card"),
    ).toMatchObject({
      detail: expect.stringContaining("未同步的卡片"),
      amount: 3000,
      target: {
        view: "activity",
        query: { month: "2026-09", activity: "bank:fubon-card" },
      },
    });
    expect(
      find(inbox, (item) => item.kind === "duplicate_ambiguous"),
    ).toMatchObject({
      id: "duplicate_ambiguous:invoice:inv-bakery",
      severity: "tidy",
      amount: 450,
    });
    const uncategorized = find(inbox, (item) => item.kind === "uncategorized")!;
    expect(uncategorized).toMatchObject({
      severity: "tidy",
      target: {
        view: "activity",
        query: { month: "2026-09", uncategorized: "1" },
      },
    });
    // 只算 categorySource = none：麵包工坊、咖啡豆專賣等由商家關鍵字自動套用分類，
    // 不再算未分類；便當店由系統規則分為外食。8 月 1 筆、9 月 1 筆；
    // 7 月的雜貨舖不列入；轉帳提示的待確認活動不另算未分類。
    expect(uncategorized).toMatchObject({
      count: 2,
      title: "2 筆消費尚未分類",
      detail: "2026-08 1 筆、2026-09 1 筆",
    });
  });

  it("drops items once they are resolved", async () => {
    const before = await getInbox(db, NOW);
    const uncategorized = find(
      before,
      (item) => item.kind === "uncategorized",
    )!;
    const monthItems = await harness.binding
      .prepare(
        "SELECT id FROM bank_transactions WHERE id NOT IN ('c1111-july') AND COALESCE(authorized_at, posted_date) >= '2026-08-01'",
      )
      .all<{ id: string }>();
    await db.batch([
      db.prepare(
        "UPDATE sync_jobs SET last_status = 'success', last_error = NULL WHERE id IN ('hncb:all', 'kgibank:all')",
      ),
      db.prepare(
        "UPDATE sync_jobs SET last_success_at = '2026-09-25T12:00:00.000Z' WHERE id = 'ctbc:all'",
      ),
      // 中信本期由存款端「中信卡」自動扣繳。
      transactionStatement(
        db,
        dep({
          id: "ctbc-pay",
          day: "2026-09-25",
          amount: -5000,
          description: "中信卡",
        }),
      ),
      ...["to-friend", "to-friend-aug", "fubon-card"].map((id) =>
        db
          .prepare(
            "INSERT INTO activity_role_overrides (target_kind, target_id, economic_role, review_status, created_at, updated_at) VALUES ('bank_transaction', ?1, 'own_transfer', 'confirmed', ?2, ?2)",
          )
          .bind(id, CREATED),
      ),
      db
        .prepare(
          "INSERT INTO invoice_transaction_preferences (invoice_id, transaction_id, decision, created_at, updated_at) VALUES ('inv-bakery', NULL, 'separate', ?1, ?1)",
        )
        .bind(CREATED),
      ...monthItems.results.map((row) =>
        db
          .prepare(
            "INSERT OR IGNORE INTO classification_overrides (id, target_type, target_id, category_id, created_at, updated_at) VALUES (?1, 'bank_transaction', ?2, 'food', ?3, ?3)",
          )
          .bind(`override:bank_transaction:${row.id}`, row.id, CREATED),
      ),
    ]);
    const after = await getInbox(db, NOW);
    expect(uncategorized.count).toBeGreaterThan(0);
    // 國泰（部分繳）與玉山（推估未繳）仍待繳，其餘都已處理。
    expect(kinds(after)).toEqual(["card_due_unpaid", "card_due_unpaid"]);
    expect(after.counts).toEqual({ blocking: 2, tidy: 0 });
  });

  it("serves the inbox over HTTP", async () => {
    const app = honoFactory.createApp();
    app.route("/api", inboxRoutes);
    app.onError(apiErrorResponse);
    const response = await app.request("/api/inbox", {}, { DB: db } as Env);
    expect(response.status).toBe(200);
    const body = (await response.json()) as InboxResponse;
    expect(body).toHaveProperty("counts.blocking");
    expect(Array.isArray(body.items)).toBe(true);
  });
});
