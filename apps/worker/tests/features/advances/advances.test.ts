import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ActivityMonthSummary } from "@taiwan-fin-hub/shared";
import { activityRoutes } from "../../../src/features/activity/route";
import { activityRoleRoutes } from "../../../src/features/activity-roles/route";
import { advanceRoutes } from "../../../src/features/advances/route";
import { getAdvances } from "../../../src/features/advances/service";
import { carryRoleOverrideAndNoteStatements } from "../../../src/features/sync/transaction-merge";
import { honoFactory } from "../../../src/platform/hono";
import { apiErrorResponse } from "../../../src/platform/http";
import type { Env } from "../../../src/platform/env";
import { createTestD1 } from "../../helpers/d1";

// 合成資料：幫朋友刷卡代墊手機，朋友之後轉帳還款（多給 220）。
const NOW = new Date("2026-10-04T04:00:00.000Z");
const CREATED = "2026-09-01T00:00:00.000Z";

describe("advances", () => {
  let harness: Awaited<ReturnType<typeof createTestD1>>;
  let db: D1Database;
  const app = honoFactory.createApp();
  app.route("/api", activityRoutes);
  app.route("/api", activityRoleRoutes);
  app.route("/api", advanceRoutes);
  app.onError(apiErrorResponse);
  const request = (path: string, init?: RequestInit) =>
    app.request(`http://localhost/api${path}`, init, {
      DB: db,
    } as unknown as Env);
  const setRole = (id: string, body: unknown) =>
    request(
      `/activity/role-overrides/bank_transaction/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    harness = await createTestD1();
    db = harness.binding;
    const tx = (
      id: string,
      account: string,
      day: string,
      amount: number,
      description: string,
      status = "posted",
    ) =>
      db
        .prepare(
          "INSERT INTO bank_transactions (id, connector_id, account_id, source_id, posted_date, authorized_at, amount, currency, description, status, created_at, updated_at) VALUES (?1, 'taishin', ?2, ?1, ?3, ?3, ?4, 'TWD', ?5, ?6, ?7, ?7)",
        )
        .bind(id, account, day, amount, description, status, CREATED);
    await db.batch([
      db
        .prepare(
          "INSERT INTO bank_accounts (id, connector_id, source_id, institution_name, account_name, account_type, created_at, updated_at) VALUES ('dep', 'taishin', 'bank:taishin:000099998888', '虛構銀行', '虛構活存', 'savings', ?1, ?1), ('card', 'taishin', 'credit:taishin:main', '虛構銀行', '虛構信用卡', 'credit', ?1, ?1)",
        )
        .bind(CREATED),
      tx("phone", "card", "2026-09-29", -31300, "虛構電信門市"),
      tx("repay", "dep", "2026-09-29", 31520, "轉帳存入"),
      tx("lunch", "card", "2026-09-30", -200, "虛構便當"),
      tx("old-pending", "card", "2026-10-01", -500, "虛構咖啡", "pending"),
      tx("new-posted", "card", "2026-10-01", -500, "虛構咖啡"),
    ]);
  }, 60_000);

  afterAll(async () => {
    vi.useRealTimers();
    await harness?.mf.dispose();
  });

  it("requires a counterparty only for advance roles", async () => {
    expect((await setRole("phone", { economicRole: "advance" })).status).toBe(
      400,
    );
    expect(
      (await setRole("phone", { economicRole: "advance", counterparty: "   " }))
        .status,
    ).toBe(400);
    expect(
      (
        await setRole("lunch", {
          economicRole: "spending",
          counterparty: "Irene",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await setRole("phone", {
          economicRole: "advance",
          counterparty: "x".repeat(41),
        })
      ).status,
    ).toBe(400);
  });

  it("keeps advances and reimbursements out of income and spending", async () => {
    const advance = await setRole("phone", {
      economicRole: "advance",
      counterparty: "  Ｉrene  ",
    });
    expect(advance.status).toBe(200);
    expect(await advance.json()).toMatchObject({ counterparty: "Irene" });
    expect(
      (
        await setRole("repay", {
          economicRole: "reimbursement",
          counterparty: "irene",
        })
      ).status,
    ).toBe(200);

    const summary = (await (
      await request("/activity/summary?month=2026-09")
    ).json()) as { months: ActivityMonthSummary[] };
    expect(summary.months[0]).toMatchObject({
      spending: 200,
      income: 0,
      advanceAmount: 31300,
      advanceCount: 1,
      reimbursementAmount: 31520,
      reimbursementCount: 1,
    });

    const items = (await (
      await request("/activity/items?month=2026-09")
    ).json()) as { items: Array<{ id: string; advanceCounterparty?: string }> };
    expect(items.items.find((item) => item.id === "phone")).toMatchObject({
      advanceCounterparty: "Irene",
    });
  });

  it("matches the e-invoice of an advance instead of counting it as spending", async () => {
    await db
      .prepare(
        "INSERT INTO invoices (id, connector_id, source_id, invoice_date, seller_name, amount, raw_payload, created_at, updated_at) VALUES ('inv-phone', 'einvoice', 'inv-phone', '2026-09-29', '虛構電信門市', 31300, ?1, ?2, ?2)",
      )
      .bind(JSON.stringify({ detail: { invStatus: "開立" } }), CREATED)
      .run();
    const summary = (await (
      await request("/activity/summary?month=2026-09")
    ).json()) as { months: ActivityMonthSummary[] };
    // 發票併入代墊的刷卡，不另算消費，代墊也只算一次。
    expect(summary.months[0]).toMatchObject({
      spending: 200,
      advanceAmount: 31300,
      advanceCount: 1,
    });
    const items = (await (
      await request("/activity/items?month=2026-09")
    ).json()) as {
      items: Array<{ id: string; duplicateOf?: { id: string } | null }>;
    };
    expect(
      items.items.find((item) => item.id === "inv-phone")?.duplicateOf,
    ).toMatchObject({ id: "phone" });
    const advances = await getAdvances(db, NOW);
    expect(
      advances.counterparties[0]!.entries.map((entry) => entry.id),
    ).toEqual(["phone", "repay"]);
  });

  it("sums each counterparty across months, case-insensitively", async () => {
    const response = await request("/activity/advances");
    expect(response.status).toBe(200);
    const advances = await getAdvances(db, NOW);
    expect(advances.counterparties).toHaveLength(1);
    expect(advances.counterparties[0]!.name.toLowerCase()).toBe("irene");
    expect(advances.counterparties[0]).toMatchObject({
      balances: { TWD: -220 },
      advanced: { TWD: 31300 },
      reimbursed: { TWD: 31520 },
    });
    expect(
      advances.counterparties[0]!.entries.map((entry) => entry.id),
    ).toEqual(["phone", "repay"]);
    expect(advances.outstanding).toEqual({ TWD: -220 });
  });

  it("moves an advance and its note to the posted transaction", async () => {
    expect(
      (
        await setRole("old-pending", {
          economicRole: "advance",
          counterparty: "Bob",
          note: "幫 Bob 買咖啡",
        })
      ).status,
    ).toBe(200);
    await db.batch(
      carryRoleOverrideAndNoteStatements(
        db,
        JSON.stringify([
          { id: "old-pending", matched_transaction_id: "new-posted" },
        ]),
        "$.id",
        "$.matched_transaction_id",
      ),
    );
    const role = await db
      .prepare(
        "SELECT economic_role, counterparty FROM activity_role_overrides WHERE target_id = 'new-posted'",
      )
      .first();
    const note = await db
      .prepare("SELECT note FROM activity_notes WHERE target_id = 'new-posted'")
      .first();
    expect(role).toEqual({ economic_role: "advance", counterparty: "Bob" });
    expect(note).toEqual({ note: "幫 Bob 買咖啡" });
  });

  it("rejects rows that break the counterparty constraint", async () => {
    await expect(
      db
        .prepare(
          "INSERT INTO activity_role_overrides (target_kind, target_id, economic_role, created_at, updated_at) VALUES ('bank_transaction', 'lunch', 'advance', ?1, ?1)",
        )
        .bind(CREATED)
        .run(),
    ).rejects.toThrow();
    await expect(
      db
        .prepare(
          "INSERT INTO activity_role_overrides (target_kind, target_id, economic_role, counterparty, created_at, updated_at) VALUES ('bank_transaction', 'lunch', 'spending', 'x', ?1, ?1)",
        )
        .bind(CREATED)
        .run(),
    ).rejects.toThrow();
  });
});
