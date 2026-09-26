import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { CATEGORY_DEFINITIONS } from "@taiwan-fin-hub/core";

const migrationsDirectory = fileURLToPath(
  new URL("../../../../../packages/db/migrations/", import.meta.url),
);
const migrationFiles = readdirSync(migrationsDirectory)
  .filter((name) => name.endsWith(".sql"))
  .sort();
const databases: DatabaseSync[] = [];
const now = "2026-09-01T00:00:00.000Z";

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function migrate(database: DatabaseSync, filter: (name: string) => boolean) {
  for (const file of migrationFiles.filter(filter))
    database.exec(readFileSync(`${migrationsDirectory}/${file}`, "utf8"));
}

function legacyDatabase() {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  database.exec("PRAGMA foreign_keys = ON");
  migrate(database, (name) => name < "0055");
  database.exec(`
    INSERT INTO classification_categories (id, label, sort_order, is_system, created_at, updated_at) VALUES
      ('user:coffee', '咖啡', 20, 0, '${now}', '${now}'),
      ('user:pet', '寵物', 21, 0, '${now}', '${now}'),
      ('user:pay', '薪水', 22, 0, '${now}', '${now}'),
      ('user:trip', '旅遊', 23, 0, '${now}', '${now}'),
      ('user:gadget', '3C家電', 24, 0, '${now}', '${now}');
    INSERT INTO bank_accounts (id, connector_id, source_id, account_type, created_at, updated_at)
      VALUES ('acct', 'esun', 'acct', 'savings', '${now}', '${now}');
  `);
  const insertTransaction = database.prepare(
    "INSERT INTO bank_transactions (id, connector_id, account_id, source_id, posted_date, amount, currency, description, created_at, updated_at) VALUES (?, 'esun', 'acct', ?, '2026-08-01', -100, 'TWD', '測試', ?, ?)",
  );
  const insertOverride = database.prepare(
    "INSERT INTO classification_overrides (id, target_type, target_id, category_id, created_at, updated_at) VALUES (?, 'bank_transaction', ?, ?, ?, ?)",
  );
  const overrides: Array<[string, string]> = [
    ["t-salary", "salary"],
    ["t-transfer", "transfer"],
    ["t-invest", "investment"],
    ["t-health", "health"],
    ["t-coffee", "user:coffee"],
    ["t-pet", "user:pet"],
    ["t-pay", "user:pay"],
    ["t-trip", "user:trip"],
    ["t-other", "other"],
    ["t-food", "food"],
    ["t-utilities", "utilities"],
    ["t-software", "software"],
    ["t-gadget", "user:gadget"],
  ];
  for (const [id, categoryId] of overrides) {
    insertTransaction.run(id, id, now, now);
    insertOverride.run(`override:${id}`, id, categoryId, now, now);
  }
  // 使用者已對這筆設定角色：遷移不覆寫。
  database.exec(`
    INSERT INTO activity_role_overrides (target_kind, target_id, economic_role, created_at, updated_at)
      VALUES ('bank_transaction', 't-transfer', 'spending', '${now}', '${now}');
    INSERT INTO classification_rules (id, category_id, target_type, field, operator, pattern, priority, enabled, is_system, source, excluded_from_calculation, created_at, updated_at) VALUES
      ('user:landlord', 'transfer', 'bank_transaction', 'any_text', 'contains', '房東', 200, 1, 0, 'user', 1, '${now}', '${now}'),
      ('user:pet-shop', 'user:pet', NULL, 'any_text', 'contains', '寵物店', 199, 1, 0, 'user', 0, '${now}', '${now}'),
      ('user:bills', 'utilities', NULL, 'any_text', 'contains', '管委會', 198, 0, 0, 'user', 0, '${now}', '${now}');
  `);
  return database;
}

describe("0055 spending categories migration", () => {
  it("maps legacy overrides, role categories and user categories", () => {
    const database = legacyDatabase();
    migrate(database, (name) => name >= "0055");

    const overrides = Object.fromEntries(
      (
        database
          .prepare(
            "SELECT target_id, category_id FROM classification_overrides ORDER BY target_id",
          )
          .all() as Array<{ target_id: string; category_id: string }>
      ).map((row) => [row.target_id, row.category_id]),
    );
    expect(overrides).toEqual({
      // 跑完全部遷移：0055 的兩層分類再由 0067 併成 8 個頂層。
      "t-coffee": "food",
      "t-food": "food",
      "t-gadget": "tech",
      "t-software": "tech",
      "t-health": "health",
      "t-other": "other",
      "t-pay": "income.salary",
      "t-pet": "misc",
      "t-salary": "income.salary",
      "t-trip": "entertainment",
      "t-utilities": "housing",
    });
    // 轉帳、投資改成角色覆寫；既有的使用者角色覆寫保留。
    expect(
      database
        .prepare(
          "SELECT target_id, economic_role FROM activity_role_overrides ORDER BY target_id",
        )
        .all(),
    ).toEqual([
      { target_id: "t-invest", economic_role: "investment" },
      { target_id: "t-transfer", economic_role: "spending" },
    ]);

    const notes = database
      .prepare(
        "SELECT subject_type, subject_id, target_id, legacy_category_id, legacy_label, new_category_id, new_economic_role, needs_attention FROM classification_migration_notes ORDER BY id",
      )
      .all();
    expect(notes).toContainEqual({
      subject_type: "override",
      subject_id: "override:t-pet",
      target_id: "t-pet",
      legacy_category_id: "user:pet",
      legacy_label: "寵物",
      new_category_id: "misc",
      new_economic_role: null,
      needs_attention: 1,
    });
    expect(notes).toContainEqual(
      expect.objectContaining({
        subject_id: "override:t-transfer",
        legacy_label: "轉帳",
        new_category_id: null,
        new_economic_role: "own_transfer",
        needs_attention: 0,
      }),
    );
    expect(notes).toContainEqual(
      expect.objectContaining({
        subject_type: "rule",
        subject_id: "user:pet-shop",
        legacy_label: "寵物",
        new_category_id: "misc",
        needs_attention: 1,
      }),
    );
    // 沒變動的覆寫不記錄。
    expect(notes.some((note) => note.subject_id === "override:t-food")).toBe(
      false,
    );

    expect(
      database
        .prepare(
          "SELECT id, category_id, economic_role, excluded_from_calculation, enabled FROM classification_rules WHERE is_system = 0 ORDER BY id",
        )
        .all(),
    ).toEqual([
      {
        id: "user:bills",
        category_id: "housing",
        economic_role: null,
        excluded_from_calculation: 0,
        enabled: 0,
      },
      {
        id: "user:landlord",
        category_id: null,
        economic_role: "own_transfer",
        excluded_from_calculation: 1,
        enabled: 1,
      },
      {
        id: "user:pet-shop",
        category_id: "misc",
        economic_role: null,
        excluded_from_calculation: 0,
        enabled: 1,
      },
    ]);

    const categories = database
      .prepare(
        "SELECT id, label, parent_id FROM classification_categories ORDER BY sort_order, id",
      )
      .all();
    expect(categories).toEqual(
      CATEGORY_DEFINITIONS.map((category) => ({
        id: category.id,
        label: category.label,
        parent_id: category.parentId,
      })),
    );
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("keeps role rules by id and exposes seller BANs from invoice payloads", () => {
    const database = legacyDatabase();
    migrate(database, (name) => name >= "0055");
    expect(
      database
        .prepare(
          "SELECT id, category_id, economic_role, amount_direction FROM classification_rules WHERE id IN ('system:bank:creditcard-payment', 'system:bank:ewallet-topup', 'system:bank:transfer-keywords', 'system:bank:salary-keywords') ORDER BY id",
        )
        .all(),
    ).toEqual([
      {
        id: "system:bank:creditcard-payment",
        category_id: null,
        economic_role: "card_payment",
        amount_direction: "any",
      },
      {
        id: "system:bank:ewallet-topup",
        category_id: null,
        economic_role: "own_transfer",
        amount_direction: "any",
      },
      {
        id: "system:bank:salary-keywords",
        category_id: "income.salary",
        economic_role: null,
        amount_direction: "inflow",
      },
      {
        id: "system:bank:transfer-keywords",
        category_id: null,
        economic_role: null,
        amount_direction: "any",
      },
    ]);

    const insert = database.prepare(
      "INSERT INTO invoices (id, connector_id, source_id, invoice_date, seller_name, amount, raw_payload, created_at, updated_at) VALUES (?, 'einvoice', ?, '2026-09-01', '某商店', 100, ?, ?, ?)",
    );
    insert.run(
      "inv-1",
      "inv-1",
      '{"invoice":{"sellerID":"12345678"}}',
      now,
      now,
    );
    insert.run("inv-2", "inv-2", '{"sellerBan":"87654321"}', now, now);
    insert.run("inv-3", "inv-3", '{"invoice":{"sellerID":"123"}}', now, now);
    insert.run("inv-4", "inv-4", "not json", now, now);
    insert.run("inv-5", "inv-5", null, now, now);
    expect(
      database.prepare("SELECT id, seller_ban FROM invoices ORDER BY id").all(),
    ).toEqual([
      { id: "inv-1", seller_ban: "12345678" },
      { id: "inv-2", seller_ban: "87654321" },
      { id: "inv-3", seller_ban: null },
      { id: "inv-4", seller_ban: null },
      { id: "inv-5", seller_ban: null },
    ]);
    expect(() =>
      database.exec(
        `INSERT INTO merchant_aliases (merchant_key, display_name, created_at, updated_at) VALUES ('ban:12', 'x', '${now}', '${now}')`,
      ),
    ).toThrow(/CHECK/i);
  });
});

const LEGACY_TO_0067: Array<[string, string]> = [
  ["food.dining", "food"],
  ["food.drinks", "food"],
  ["food.groceries", "food"],
  ["transport.transit", "transport"],
  ["transport.ride", "transport"],
  ["transport.car", "transport"],
  ["housing.rent", "housing"],
  ["housing.utilities", "housing"],
  ["housing.telecom", "housing"],
  ["shopping.daily", "shopping"],
  ["shopping.clothing", "shopping"],
  ["shopping.online", "shopping"],
  ["tech.hardware", "tech"],
  ["tech.software", "tech"],
  ["lifestyle", "entertainment"],
  ["lifestyle.subscriptions", "entertainment"],
  ["lifestyle.entertainment", "entertainment"],
  ["lifestyle.travel", "entertainment"],
  ["lifestyle.education", "misc"],
  ["health.medical", "health"],
  ["health.insurance", "health"],
  ["social", "misc"],
  ["social.gifts", "misc"],
  ["social.donations", "misc"],
  ["fees", "misc"],
  ["fees.tax", "misc"],
  ["fees.bank", "misc"],
  // 沒有對照的頂層與收入子類不變。
  ["food", "food"],
  ["health", "health"],
  ["misc", "misc"],
  ["income.salary", "income.salary"],
  ["other", "other"],
];

describe("0067 simplify spending categories migration", () => {
  it("maps every old category id to one of the eight top-level categories", () => {
    const database = legacyDatabase();
    migrate(database, (name) => name >= "0055" && name < "0067");
    const insertTransaction = database.prepare(
      "INSERT INTO bank_transactions (id, connector_id, account_id, source_id, posted_date, amount, currency, description, created_at, updated_at) VALUES (?, 'esun', 'acct', ?, '2026-08-01', -100, 'TWD', '測試', ?, ?)",
    );
    const insertOverride = database.prepare(
      "INSERT INTO classification_overrides (id, target_type, target_id, category_id, created_at, updated_at) VALUES (?, 'bank_transaction', ?, ?, ?, ?)",
    );
    const insertRule = database.prepare(
      "INSERT INTO classification_rules (id, category_id, target_type, field, operator, pattern, priority, enabled, is_system, source, excluded_from_calculation, created_at, updated_at) VALUES (?, ?, NULL, 'any_text', 'contains', ?, 150, 1, 0, 'user', 0, ?, ?)",
    );
    const insertAlias = database.prepare(
      "INSERT INTO merchant_aliases (merchant_key, category_id, created_at, updated_at) VALUES (?, ?, ?, ?)",
    );
    for (const [oldId] of LEGACY_TO_0067) {
      const key = `m67-${oldId}`;
      insertTransaction.run(key, key, now, now);
      insertOverride.run(`override:${key}`, key, oldId, now, now);
      insertRule.run(`rule:${key}`, oldId, key, now, now);
      insertAlias.run(`name:${key.replace(/\W/g, "")}`, oldId, now, now);
    }
    database.exec(`
      INSERT INTO classification_migration_notes (id, subject_type, subject_id, legacy_category_id, legacy_label, new_category_id, needs_attention, created_at)
        VALUES ('note:m67', 'override', 'x', 'legacy', '舊分類', 'lifestyle.travel', 0, '${now}');
      INSERT INTO classification_categories (id, label, sort_order, is_system, created_at, updated_at)
        VALUES ('user:fun', '醫療保險', 300, 0, '${now}', '${now}');
    `);

    migrate(database, (name) => name >= "0067" && name < "0068");

    const rows = (sql: string) =>
      Object.fromEntries(
        (database.prepare(sql).all() as Array<Record<string, string>>).map(
          (row) => Object.values(row) as [string, string],
        ),
      );
    const expected = (prefix: string) =>
      Object.fromEntries(
        LEGACY_TO_0067.map(([oldId, newId]) => [`${prefix}${oldId}`, newId]),
      );
    expect(
      rows(
        "SELECT target_id, category_id FROM classification_overrides WHERE target_id LIKE 'm67-%'",
      ),
    ).toEqual(expected("m67-"));
    expect(
      rows(
        "SELECT pattern, category_id FROM classification_rules WHERE id LIKE 'rule:m67-%'",
      ),
    ).toEqual(expected("m67-"));
    expect(
      rows(
        "SELECT merchant_key, category_id FROM merchant_aliases WHERE merchant_key LIKE 'name:m67%'",
      ),
    ).toEqual(
      Object.fromEntries(
        LEGACY_TO_0067.map(([oldId, newId]) => [
          `name:m67${oldId.replace(/\W/g, "")}`,
          newId,
        ]),
      ),
    );
    expect(
      database
        .prepare(
          "SELECT new_category_id FROM classification_migration_notes WHERE id = 'note:m67'",
        )
        .get(),
    ).toEqual({ new_category_id: "entertainment" });
    // 系統規則也全部改指新 id。
    expect(
      database
        .prepare(
          "SELECT id, category_id FROM classification_rules WHERE is_system = 1 AND category_id IS NOT NULL AND category_id NOT LIKE 'income.%' AND category_id NOT IN ('food', 'transport', 'housing', 'shopping', 'tech', 'entertainment', 'health', 'misc')",
        )
        .all(),
    ).toEqual([]);
    // 分類表只剩 8 個消費頂層、收入、未分類與自訂分類；撞名的自訂分類加註。
    expect(
      database
        .prepare(
          "SELECT id, label, parent_id FROM classification_categories ORDER BY sort_order, id",
        )
        .all(),
    ).toEqual([
      ...CATEGORY_DEFINITIONS.filter(
        // 捐款由 0069 新增，不在 0067 的結果裡。
        (row) => row.sortOrder < 200 && row.id !== "donation",
      ).map((row) => ({
        id: row.id,
        label: row.label,
        parent_id: row.parentId,
      })),
      { id: "other", label: "未分類", parent_id: null },
      { id: "user:fun", label: "醫療保險（自訂）", parent_id: null },
    ]);
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
