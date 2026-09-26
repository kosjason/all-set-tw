import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  ActivityExportResponse,
  ActivityItem,
  ActivityMonthSummary,
  ActivityNoteRow,
  ActivitySourceRecord,
  InboxItem,
} from "@taiwan-fin-hub/core";
import { activityRoutes } from "../../../src/features/activity/route";
import { activityNoteRoutes } from "../../../src/features/activity-notes/route";
import { activityRoleRoutes } from "../../../src/features/activity-roles/route";
import { bankRoutes } from "../../../src/features/bank/route";
import { classificationRoutes } from "../../../src/features/classification/route";
import { getInbox } from "../../../src/features/inbox/service";
import { merchantRoutes } from "../../../src/features/merchants/route";
import { honoFactory } from "../../../src/platform/hono";
import { apiErrorResponse } from "../../../src/platform/http";
import type { Env } from "../../../src/platform/env";
import { createTestD1 } from "../../../../../packages/db/testing/d1";

// 合成資料：假帳號、假卡號、虛構商家；情境取自真實使用方式但不含任何真實資料。
const now = "2026-09-30T00:00:00.000Z";
const NOW = new Date("2026-09-30T04:00:00.000Z");
const FULL_ACCOUNT_NUMBER = "0012345678901";
const CARD_NUMBER = "4311-2345-6789-0123";

type Tx = {
  id: string;
  account?: "dep-a" | "card-a";
  day: string;
  amount: number;
  description: string;
};

const transactions: Tx[] = [
  { id: "rmb", day: "2026-09-02", amount: -50000, description: "跨行轉出" },
  {
    id: "transfer-b",
    day: "2026-09-03",
    amount: 22000,
    description: "轉帳存入",
  },
  {
    id: "test-transfer",
    day: "2026-09-04",
    amount: -1,
    description: "跨行轉出",
  },
  {
    id: "godaddy",
    account: "card-a",
    day: "2026-09-05",
    amount: -899,
    description: `GODADDY.COM ${CARD_NUMBER}`,
  },
  {
    id: "heyi",
    account: "card-a",
    day: "2026-09-06",
    amount: -150,
    description: "合毅食堂",
  },
  {
    id: "drink",
    account: "card-a",
    day: "2026-09-06",
    amount: -60,
    description: "真芳國際飲品",
  },
  {
    id: "mystery",
    account: "card-a",
    day: "2026-09-07",
    amount: -999,
    description: "某某有限公司",
  },
  {
    id: "lunch",
    account: "card-a",
    day: "2026-09-08",
    amount: -350,
    description: "已田商行",
  },
  {
    id: "void-tx",
    account: "card-a",
    day: "2026-09-09",
    amount: -699,
    description: "無名商號",
  },
  // 優先序：個別覆寫 → 商家規則 → 使用者規則 → 自動建議。
  {
    id: "p-user",
    account: "card-a",
    day: "2026-09-10",
    amount: -100,
    description: "好味食堂",
  },
  {
    id: "p-merchant",
    account: "card-a",
    day: "2026-09-10",
    amount: -110,
    description: "阿成食堂",
  },
  {
    id: "p-rule",
    account: "card-a",
    day: "2026-09-10",
    amount: -120,
    description: "阿華食堂",
  },
];

const invoices = [
  {
    id: "inv-lunch",
    day: "2026-09-08",
    amount: 350,
    seller: "已田商行",
    raw: { invoice: { sellerID: "33333333" }, detail: { invStatus: "開立" } },
    items: [["排骨便當", 300] as const, ["紅茶", 50] as const],
  },
  {
    id: "inv-void",
    day: "2026-09-09",
    amount: 699,
    seller: "無名商號",
    raw: { detail: { invStatus: "作廢" } },
    items: [],
  },
];

type Item = ActivityItem & { id: string };

describe("activity notes, excluded role and auto-applied categories", () => {
  let harness: Awaited<ReturnType<typeof createTestD1>>;
  let env: Env;
  const app = honoFactory.createApp();
  app.route("/api", activityRoutes);
  app.route("/api", activityRoleRoutes);
  app.route("/api", activityNoteRoutes);
  app.route("/api", bankRoutes);
  app.route("/api", merchantRoutes);
  app.route("/api", classificationRoutes);
  app.onError(apiErrorResponse);

  beforeAll(async () => {
    harness = await createTestD1();
    const db = harness.binding;
    env = { DB: db } as Env;
    await db.batch([
      db
        .prepare(
          "INSERT INTO bank_accounts (id, connector_id, source_id, institution_name, account_name, account_last4, account_type, created_at, updated_at) VALUES ('dep-a', 'esun', ?2, '某銀行', ?3, '8901', 'savings', ?1, ?1), ('card-a', 'esun', 'card:esun:4321', '某銀行', '鈦金卡', '4321', 'credit', ?1, ?1)",
        )
        .bind(
          now,
          `bank:esun:${FULL_ACCOUNT_NUMBER}`,
          `活期存款 ${FULL_ACCOUNT_NUMBER}`,
        ),
      ...transactions.map((tx) =>
        db
          .prepare(
            "INSERT INTO bank_transactions (id, connector_id, account_id, source_id, posted_date, amount, currency, description, raw_payload, created_at, updated_at) VALUES (?1, 'esun', ?2, ?1, ?3, ?4, 'TWD', ?5, ?6, ?7, ?7)",
          )
          .bind(
            tx.id,
            tx.account ?? "dep-a",
            tx.day,
            tx.amount,
            tx.description,
            JSON.stringify({ secret: "raw-payload-marker" }),
            now,
          ),
      ),
      ...invoices.map((invoice) =>
        db
          .prepare(
            "INSERT INTO invoices (id, connector_id, source_id, invoice_date, seller_name, amount, raw_payload, created_at, updated_at) VALUES (?1, 'einvoice', ?1, ?2, ?3, ?4, ?5, ?6, ?6)",
          )
          .bind(
            invoice.id,
            invoice.day,
            invoice.seller,
            invoice.amount,
            JSON.stringify(invoice.raw),
            now,
          ),
      ),
      ...invoices.flatMap((invoice) =>
        invoice.items.map(([description, amount], index) =>
          db
            .prepare(
              "INSERT INTO invoice_line_items (id, invoice_id, connector_id, invoice_source_id, source_id, line_number, description, amount, created_at, updated_at) VALUES (?1, ?2, 'einvoice', ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
            )
            .bind(
              `${invoice.id}:${index + 1}`,
              invoice.id,
              String(index + 1),
              index + 1,
              description,
              amount,
              now,
            ),
        ),
      ),
    ]);
  }, 60_000);

  afterAll(async () => {
    await harness?.mf.dispose();
  });

  function send(method: string, path: string, body?: unknown) {
    return app.request(
      path,
      {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      env,
    );
  }

  async function get<T>(path: string) {
    const response = await app.request(path, {}, env);
    expect(response.status).toBe(200);
    return (await response.json()) as T;
  }

  async function month() {
    const body = await get<{ items: Item[]; summary: ActivityMonthSummary }>(
      "/api/activity/items?month=2026-09",
    );
    return {
      ...body,
      byId: new Map(body.items.map((item) => [item.id, item])),
    };
  }

  async function search(q: string) {
    const body = await get<{ items: Item[] }>(
      `/api/activity/search?${new URLSearchParams({ q })}`,
    );
    return body.items.map((item) => item.id).sort();
  }

  it("auto-applies category suggestions with categorySource", async () => {
    const { byId, items, summary } = await month();
    expect(byId.get("heyi")).toMatchObject({
      categoryId: "food",
      category: "餐飲",
      categorySource: "auto_suggestion",
      suggestedCategoryId: "food",
      suggestionSource: "merchant_keywords",
    });
    expect(byId.get("drink")).toMatchObject({
      categoryId: "food",
      categorySource: "auto_suggestion",
    });
    expect(byId.get("lunch")).toMatchObject({
      categoryId: "food",
      categorySource: "auto_suggestion",
      suggestionSource: "item_keywords",
    });
    expect(byId.get("mystery")).toMatchObject({
      categoryId: "other",
      categorySource: "none",
    });
    // 非消費沒有消費分類。
    expect(byId.get("transfer-b")?.categorySource).toBe("none");
    expect(summary.spendingByCategory.food).toBe(
      150 + 60 + 350 + 100 + 110 + 120,
    );

    // 合成 9 月情境：自動套用前（none + auto_suggestion）與套用後（none）的未分類率。
    const spending = items.filter(
      (item) => item.economicRole === "spending" && !item.duplicateOf,
    );
    const before = spending.filter(
      (item) =>
        item.categorySource === "none" ||
        item.categorySource === "auto_suggestion",
    ).length;
    const after = spending.filter(
      (item) => item.categorySource === "none",
    ).length;
    console.info(
      `[9 月合成情境] 消費 ${spending.length} 筆；未分類 套用前 ${before}（${Math.round((before / spending.length) * 100)}%）→ 套用後 ${after}（${Math.round((after / spending.length) * 100)}%）`,
    );
    expect(after).toBeLessThan(before);
  });

  it("keeps user overrides, merchant rules and user rules ahead of auto suggestions", async () => {
    expect(
      (
        await send(
          "PUT",
          "/api/classification/overrides/bank_transaction/p-user",
          { categoryId: "misc" },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await send(
          "PUT",
          `/api/merchants/${encodeURIComponent("name:阿成食堂")}`,
          { categoryId: "entertainment" },
        )
      ).status,
    ).toBe(200);
    const rule = await send("POST", "/api/classification/rules", {
      categoryId: "misc",
      field: "any_text",
      operator: "contains",
      pattern: "阿華",
      priority: 900,
    });
    expect(rule.status).toBeLessThan(300);

    const { byId } = await month();
    expect(byId.get("p-user")).toMatchObject({
      categoryId: "misc",
      categorySource: "user",
    });
    expect(byId.get("p-merchant")).toMatchObject({
      categoryId: "entertainment",
      categorySource: "merchant_rule",
    });
    expect(byId.get("p-rule")).toMatchObject({
      categoryId: "misc",
      categorySource: "rule",
    });
    for (const id of ["p-user", "p-merchant", "p-rule"])
      expect(byId.get(id)?.suggestedCategoryId).toBeUndefined();
  });

  it("creates, lists, searches and deletes notes", async () => {
    const put = await send("PUT", "/api/activity/notes/bank_transaction/rmb", {
      note: "  跟朋友A買人民幣，存富邦華一\r\n  ",
    });
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({
      targetKind: "bank_transaction",
      targetId: "rmb",
      note: "跟朋友A買人民幣，存富邦華一",
    });
    await send("PUT", "/api/activity/notes/bank_transaction/transfer-b", {
      note: "朋友B 換 RMB 5,000",
    });
    // 發票上的備註也顯示在已配對的刷卡交易。
    await send("PUT", "/api/activity/notes/invoice/inv-lunch", {
      note: "午餐會議",
    });

    expect(
      (
        await send("PUT", "/api/activity/notes/bank_transaction/missing", {
          note: "x",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await send("PUT", "/api/activity/notes/bank_transaction/rmb", {
          note: "字".repeat(1001),
        })
      ).status,
    ).toBe(400);
    expect(
      (await send("PUT", "/api/activity/notes/trade/rmb", { note: "x" }))
        .status,
    ).toBe(400);

    const notes = await get<ActivityNoteRow[]>(
      "/api/activity/notes?month=2026-09",
    );
    expect(
      notes.map(({ targetKind, targetId, note, date }) => ({
        targetKind,
        targetId,
        note,
        date,
      })),
    ).toEqual([
      {
        targetKind: "invoice",
        targetId: "inv-lunch",
        note: "午餐會議",
        date: "2026-09-08",
      },
      {
        targetKind: "bank_transaction",
        targetId: "transfer-b",
        note: "朋友B 換 RMB 5,000",
        date: "2026-09-03",
      },
      {
        targetKind: "bank_transaction",
        targetId: "rmb",
        note: "跟朋友A買人民幣，存富邦華一",
        date: "2026-09-02",
      },
    ]);
    expect(await get("/api/activity/notes?month=2026-08")).toEqual([]);
    expect(
      (await app.request("/api/activity/notes?month=2026-13", {}, env)).status,
    ).toBe(400);

    const { byId } = await month();
    expect(byId.get("rmb")).toMatchObject({
      note: "跟朋友A買人民幣，存富邦華一",
      noteTarget: { kind: "bank_transaction", id: "rmb" },
    });
    expect(byId.get("lunch")).toMatchObject({
      note: "午餐會議",
      noteTarget: { kind: "invoice", id: "inv-lunch" },
    });
    expect(byId.get("inv-lunch")).toMatchObject({
      duplicateOf: { kind: "bank_transaction", id: "lunch" },
      note: "午餐會議",
    });
    expect(byId.get("heyi")).toMatchObject({ note: null, noteTarget: null });

    expect(await search("朋友A")).toEqual(["rmb"]);
    expect(await search("rmb 5,000")).toEqual(["transfer-b"]);
    expect(await search("午餐會議")).toEqual(["lunch"]);

    const sources = await get<{ records: ActivitySourceRecord[] }>(
      "/api/activity/sources?month=2026-09&source=bank",
    );
    expect(
      sources.records.find((record) => record.id === "transfer-b")?.note,
    ).toBe("朋友B 換 RMB 5,000");
    const bank = await get<{
      transactions: Array<Record<string, unknown> & { id: string }>;
    }>("/api/bank?month=2026-09");
    const bankById = new Map(bank.transactions.map((row) => [row.id, row]));
    expect(bankById.get("rmb")).toMatchObject({
      note: "跟朋友A買人民幣，存富邦華一",
      categorySource: "none",
    });
    expect(bankById.get("lunch")).toMatchObject({
      note: "午餐會議",
      categoryId: "food",
      categorySource: "auto_suggestion",
    });

    // 空字串刪除；DELETE 不存在的備註回 404。
    const cleared = await send(
      "PUT",
      "/api/activity/notes/bank_transaction/transfer-b",
      { note: "   " },
    );
    expect(await cleared.json()).toEqual({
      targetKind: "bank_transaction",
      targetId: "transfer-b",
      note: null,
    });
    expect(
      (await send("DELETE", "/api/activity/notes/bank_transaction/transfer-b"))
        .status,
    ).toBe(404);
    expect(
      (await send("DELETE", "/api/activity/notes/invoice/inv-lunch")).status,
    ).toBe(200);
    expect(await search("午餐會議")).toEqual([]);
    expect((await month()).byId.get("transfer-b")?.note).toBeNull();
  });

  it("marks activities as excluded with an override that also writes a note", async () => {
    const before = await month();
    const response = await send(
      "PUT",
      "/api/activity/role-overrides/bank_transaction/godaddy",
      {
        economicRole: "excluded",
        note: "GoDaddy SSL 自動續約，實際未扣款",
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      targetKind: "bank_transaction",
      targetId: "godaddy",
      economicRole: "excluded",
      reviewStatus: "confirmed",
      note: "GoDaddy SSL 自動續約，實際未扣款",
    });
    // 不帶 note 時保留原本的備註。
    await send("PUT", "/api/activity/role-overrides/bank_transaction/godaddy", {
      economicRole: "excluded",
    });

    const after = await month();
    const godaddy = after.byId.get("godaddy")!;
    // 列表仍列出。
    expect(godaddy).toMatchObject({
      economicRole: "excluded",
      reviewStatus: "confirmed",
      roleReason: "override",
      note: "GoDaddy SSL 自動續約，實際未扣款",
    });
    expect(godaddy.suggestedCategoryId).toBeUndefined();
    expect(after.summary.spending).toBe(before.summary.spending - 899);
    expect(after.summary.excludedAmount).toBe(
      before.summary.excludedAmount + 899,
    );
    expect(after.summary.excludedCount).toBe(before.summary.excludedCount + 1);
    for (const field of [
      "income",
      "ownTransfer",
      "cardPayment",
      "investment",
      "duplicateExcluded",
    ] as const)
      expect(after.summary[field]).toBe(before.summary[field]);
    expect(after.summary.activityCount).toBe(before.summary.activityCount - 1);
    expect(after.summary.spendingByCategory.tech ?? 0).toBe(
      (before.summary.spendingByCategory.tech ?? 0) - 899,
    );
    expect(await search("實際未扣款")).toEqual(["godaddy"]);

    // override 驗證：未知角色回 400；規則不能指定 excluded。
    expect(
      (
        await send(
          "PUT",
          "/api/activity/role-overrides/bank_transaction/godaddy",
          { economicRole: "refund" },
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await send(
          "PUT",
          "/api/activity/role-overrides/bank_transaction/godaddy",
          { economicRole: "excluded", note: "字".repeat(1001) },
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await send("PUT", `/api/merchants/${encodeURIComponent("name:某某")}`, {
          economicRole: "excluded",
        })
      ).status,
    ).toBe(400);
  });

  it("automatically excludes voided invoices", async () => {
    const { byId, summary } = await month();
    expect(byId.get("inv-void")).toMatchObject({
      economicRole: "excluded",
      reviewStatus: "auto",
      roleReason: "invoice_voided",
      duplicateOf: null,
      matchStatus: "unmatched",
    });
    // 作廢發票沒有吃掉同額同日的刷卡交易。
    expect(byId.get("void-tx")).toMatchObject({
      economicRole: "spending",
      matchedInvoiceId: null,
    });
    expect(byId.get("inv-lunch")?.economicRole).toBe("spending");
    // 699（作廢發票）+ 899（GoDaddy）。
    expect(summary.excludedAmount).toBe(699 + 899);
    expect(summary.excludedCount).toBe(2);
    expect(summary.dedupe.invoicesUnmatched).toBe(0);
    expect(summary.dedupe.invoicesMerged).toBe(1);
  });

  it("ignores excluded activities in the inbox", async () => {
    const reviewIds = (items: InboxItem[]) =>
      items
        .filter((item) => item.kind === "needs_review")
        .map((item) => item.id)
        .sort();
    const beforeInbox = await getInbox(harness.binding, NOW);
    // 轉帳提示（跨行轉出、轉帳存入）都是待確認。
    expect(reviewIds(beforeInbox.items)).toEqual([
      "needs_review:bank:rmb",
      "needs_review:bank:test-transfer",
      "needs_review:bank:transfer-b",
    ]);
    const { items } = await month();
    const expectedUncategorized = items.filter(
      (item) =>
        item.economicRole === "spending" &&
        item.transactionId &&
        !item.duplicateOf &&
        item.categorySource === "none" &&
        item.classificationRuleId !== "system:bank:transfer-keywords",
    );
    expect(expectedUncategorized.map((item) => item.id).sort()).toEqual([
      "mystery",
      "void-tx",
    ]);
    const uncategorized = (inboxItems: InboxItem[]) =>
      inboxItems.find((item) => item.kind === "uncategorized")?.count ?? 0;
    expect(uncategorized(beforeInbox.items)).toBe(2);

    for (const id of ["test-transfer", "mystery"])
      await send("PUT", `/api/activity/role-overrides/bank_transaction/${id}`, {
        economicRole: "excluded",
      });
    const afterInbox = await getInbox(harness.binding, NOW);
    expect(reviewIds(afterInbox.items)).toEqual([
      "needs_review:bank:rmb",
      "needs_review:bank:transfer-b",
    ]);
    expect(uncategorized(afterInbox.items)).toBe(1);
  });

  it("exports a compact LLM view without account numbers or raw data", async () => {
    const response = await app.request(
      "/api/activity/export?from=2026-09&to=2026-09",
      {},
      env,
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    for (const secret of [
      FULL_ACCOUNT_NUMBER,
      CARD_NUMBER,
      "2345",
      "raw-payload-marker",
      "rawPayload",
      "raw_payload",
      "sourceId",
      "bank:esun",
      "33333333",
    ])
      expect(text).not.toContain(secret);
    const body = JSON.parse(text) as ActivityExportResponse;
    expect(body).toMatchObject({
      from: "2026-09",
      to: "2026-09",
      currency: "TWD",
    });
    expect(body.months).toHaveLength(1);
    expect(body.months[0]).toMatchObject({
      month: "2026-09",
      excludedCount: 4,
      excludedAmount: 699 + 899 + 1 + 999,
    });
    // 已配對的發票不另列；投資明細不列。
    expect(body.items.some((item) => item.displayName === "已田商行")).toBe(
      true,
    );
    expect(body.items).toHaveLength(transactions.length + 1);
    const rmb = body.items.find((item) => item.amountTwd === -50000)!;
    expect(rmb).toEqual({
      date: "2026-09-02",
      source: "bank",
      amountTwd: -50000,
      currency: "TWD",
      displayName: expect.any(String),
      categoryId: "other",
      categoryLabel: "未分類",
      categorySource: "none",
      economicRole: "spending",
      reviewStatus: "needs_review",
      note: "跟朋友A買人民幣，存富邦華一",
      itemsPreview: [],
      account: "玉山銀行 末四碼 8901",
    });
    const godaddy = body.items.find((item) => item.amountTwd === -899)!;
    expect(godaddy).toMatchObject({
      source: "card",
      economicRole: "excluded",
      note: "GoDaddy SSL 自動續約，實際未扣款",
      account: "某銀行 鈦金卡",
    });
    const lunch = body.items.find((item) => item.amountTwd === -350)!;
    expect(lunch).toMatchObject({
      categoryId: "food",
      categoryLabel: "餐飲",
      categorySource: "auto_suggestion",
      itemsPreview: ["排骨便當", "紅茶"],
    });
    const voided = body.items.find((item) => item.source === "invoice")!;
    expect(voided).toMatchObject({
      amountTwd: -699,
      economicRole: "excluded",
      account: "電子發票",
    });
    expect(Object.keys(voided).sort()).toEqual(
      [
        "account",
        "amountTwd",
        "categoryId",
        "categoryLabel",
        "categorySource",
        "currency",
        "date",
        "displayName",
        "economicRole",
        "itemsPreview",
        "note",
        "reviewStatus",
        "source",
      ].sort(),
    );

    for (const query of [
      "from=2026-09",
      "from=2026-10&to=2026-09",
      "from=2025-01&to=2026-09",
    ])
      expect(
        (await app.request(`/api/activity/export?${query}`, {}, env)).status,
      ).toBe(400);
  });
});
