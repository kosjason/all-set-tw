import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// 分類遷移（0055、0067、0069）不得遺失使用者資料：自訂分類、系統規則的使用者調整、
// 舊捐款分類的引用。全部為合成資料。
// 支援的升級路徑是從已發布的 0048 起全新套用；0049–0069 未曾發布，只有維護者本機跑過
// 舊版 0055／0067／0069（另行手動修補），因此不測試「舊版 0067 已套用」的路徑。
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

function createDatabase() {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  database.exec("PRAGMA foreign_keys = ON");
  return database;
}

function migrate(database: DatabaseSync, filter: (name: string) => boolean) {
  for (const file of migrationFiles.filter(filter))
    database.exec(readFileSync(`${migrationsDirectory}/${file}`, "utf8"));
}

function all(database: DatabaseSync, sql: string) {
  return database.prepare(sql).all() as Array<Record<string, unknown>>;
}

function insertTransaction(database: DatabaseSync, id: string) {
  database
    .prepare(
      "INSERT INTO bank_transactions (id, connector_id, account_id, source_id, posted_date, amount, currency, description, created_at, updated_at) VALUES (?, 'esun', 'acct', ?, '2026-08-01', -100, 'TWD', '測試', ?, ?)",
    )
    .run(id, id, now, now);
}

function insertOverride(
  database: DatabaseSync,
  targetId: string,
  categoryId: string,
) {
  database
    .prepare(
      "INSERT INTO classification_overrides (id, target_type, target_id, category_id, created_at, updated_at) VALUES (?, 'bank_transaction', ?, ?, ?, ?)",
    )
    .run(`override:${targetId}`, targetId, categoryId, now, now);
}

/** 0055 以前的資料庫，含自訂分類與使用者調整過的系統規則。 */
function legacyDatabase() {
  const database = createDatabase();
  migrate(database, (name) => name < "0055");
  database.exec(`
    INSERT INTO bank_accounts (id, connector_id, source_id, account_type, created_at, updated_at)
      VALUES ('acct', 'esun', 'acct', 'savings', '${now}', '${now}');
    INSERT INTO classification_categories (id, label, sort_order, is_system, created_at, updated_at) VALUES
      ('user:unused', '寵物', 20, 0, '${now}', '${now}'),
      ('user:used', '家庭', 21, 0, '${now}', '${now}'),
      ('user:donate', '捐款', 22, 0, '${now}', '${now}'),
      ('user:fun', '旅遊', 23, 0, '${now}', '${now}');
  `);
  for (const [targetId, categoryId] of [
    ["t-used", "user:used"],
    ["t-donate", "user:donate"],
  ] as const) {
    insertTransaction(database, targetId);
    insertOverride(database, targetId, categoryId);
  }
  database.exec(`
    INSERT INTO classification_rules (id, category_id, target_type, field, operator, pattern, priority, enabled, is_system, source, excluded_from_calculation, created_at, updated_at) VALUES
      ('user:family-rule', 'user:used', NULL, 'any_text', 'contains', '家用', 150, 1, 0, 'user', 0, '${now}', '${now}'),
      ('user:fun-rule', 'user:fun', NULL, 'any_text', 'contains', 'KTV', 150, 1, 0, 'user', 0, '${now}', '${now}');
  `);
  return database;
}

describe("0055–0069 keep user categories", () => {
  it("keeps unused, referenced and colliding custom categories with notes", () => {
    const database = legacyDatabase();
    migrate(database, (name) => name >= "0055");

    expect(
      all(
        database,
        "SELECT id, label, is_system, parent_id FROM classification_categories WHERE id LIKE 'user:%' ORDER BY id",
      ),
    ).toEqual([
      {
        id: "user:donate",
        label: "捐款（自訂）",
        is_system: 0,
        parent_id: null,
      },
      { id: "user:fun", label: "旅遊（自訂）", is_system: 0, parent_id: null },
      { id: "user:unused", label: "寵物", is_system: 0, parent_id: null },
      { id: "user:used", label: "家庭", is_system: 0, parent_id: null },
    ]);
    // 引用不變。
    expect(
      all(
        database,
        "SELECT target_id, category_id FROM classification_overrides ORDER BY target_id",
      ),
    ).toEqual([
      { target_id: "t-donate", category_id: "user:donate" },
      { target_id: "t-used", category_id: "user:used" },
    ]);
    expect(
      all(
        database,
        "SELECT id, category_id FROM classification_rules WHERE is_system = 0 ORDER BY id",
      ),
    ).toEqual([
      { id: "user:family-rule", category_id: "user:used" },
      { id: "user:fun-rule", category_id: "user:fun" },
    ]);
    // 撞名改名都有紀錄（0055 的系統分類有「捐款」「旅遊」；「娛樂」在每個版本都是系統分類
    // 名稱，自訂分類不可能叫「娛樂」，撞名處理同一段 SQL）。
    expect(
      all(
        database,
        "SELECT id, subject_type, subject_id, legacy_label, new_label FROM classification_migration_notes WHERE subject_type = 'category' ORDER BY id",
      ),
    ).toEqual([
      {
        id: "category:0055:user:donate",
        subject_type: "category",
        subject_id: "user:donate",
        legacy_label: "捐款",
        new_label: "捐款（自訂）",
      },
      {
        id: "category:0055:user:fun",
        subject_type: "category",
        subject_id: "user:fun",
        legacy_label: "旅遊",
        new_label: "旅遊（自訂）",
      },
    ]);
    expect(all(database, "PRAGMA foreign_key_check")).toEqual([]);
  });

  it("renames a custom 捐款 in 0069 when the name is not held by donation", () => {
    // 全新路徑下 0067 已建立 donation，自訂分類不可能叫「捐款」；這裡人為讓出名稱，
    // 驗證 0069 的防禦性撞名處理。
    const database = createDatabase();
    migrate(database, (name) => name < "0069");
    database.exec(`
      UPDATE classification_categories SET label = '捐款（暫）' WHERE id = 'donation';
      INSERT INTO classification_categories (id, label, sort_order, is_system, created_at, updated_at)
        VALUES ('user:gift', '捐款', 300, 0, '${now}', '${now}');
    `);
    migrate(database, (name) => name.startsWith("0069_"));

    expect(
      all(
        database,
        "SELECT id, label, is_system FROM classification_categories WHERE id IN ('donation', 'user:gift') ORDER BY id",
      ),
    ).toEqual([
      { id: "donation", label: "捐款", is_system: 1 },
      { id: "user:gift", label: "捐款（自訂）", is_system: 0 },
    ]);
    expect(
      all(
        database,
        "SELECT id, legacy_label, new_label FROM classification_migration_notes WHERE subject_type = 'category'",
      ),
    ).toEqual([
      {
        id: "category:0069:user:gift",
        legacy_label: "捐款",
        new_label: "捐款（自訂）",
      },
    ]);
    expect(all(database, "PRAGMA foreign_key_check")).toEqual([]);
  });
});

describe("0055 keeps user adjustments to system rules", () => {
  it("adds no pattern notes and keeps defaults for an untouched database", () => {
    const database = createDatabase();
    migrate(database, () => true);
    expect(
      all(database, "SELECT id FROM classification_migration_notes"),
    ).toEqual([]);
    expect(
      all(
        database,
        "SELECT COUNT(*) AS count FROM classification_rules WHERE enabled = 0 OR is_system = 0",
      ),
    ).toEqual([{ count: 0 }]);
    expect(all(database, "PRAGMA foreign_key_check")).toEqual([]);
  });

  it("keeps enabled, priority and customised patterns", () => {
    const database = legacyDatabase();
    database.exec(`
      -- 停用：同 id 保留停用。
      UPDATE classification_rules SET enabled = 0 WHERE id = 'system:bank:salary-keywords';
      -- 停用被拆分的舊規則：接替的新規則也停用。
      UPDATE classification_rules SET enabled = 0 WHERE id = 'system:bank:shopping-keywords';
      -- 調整優先序。
      UPDATE classification_rules SET priority = 50 WHERE id = 'system:shared:insurance-keywords';
      -- 改 pattern：同 id 保留使用者 pattern。
      UPDATE classification_rules SET pattern = '信用卡.*繳|自訂卡費' WHERE id = 'system:bank:creditcard-payment';
      -- 改 pattern 的被移除規則：轉成使用者規則。
      UPDATE classification_rules SET pattern = '餐|自訂小吃', priority = 120 WHERE id = 'system:bank:food-keywords';
    `);
    migrate(database, (name) => name >= "0055");

    const rules = Object.fromEntries(
      all(
        database,
        "SELECT id, category_id, economic_role, pattern, priority, enabled, is_system FROM classification_rules",
      ).map((row) => [row.id, row]),
    );
    expect(rules["system:bank:salary-keywords"]).toMatchObject({
      enabled: 0,
      priority: 110,
    });
    for (const id of [
      "system:shared:shopping-keywords",
      "system:shared:grocery-keywords",
      "system:shared:convenience-keywords",
      "system:shared:online-shopping-keywords",
    ])
      expect(rules[id]).toMatchObject({ enabled: 0 });
    // 沒有被停用的規則不受影響。
    expect(rules["system:shared:dining-keywords"]).toMatchObject({
      enabled: 1,
    });
    expect(rules["system:shared:insurance-keywords"]).toMatchObject({
      priority: 50,
      enabled: 1,
    });
    // 沒有調整的優先序採用新版預設（交通由 100 改為 99）。
    expect(rules["system:shared:transport-keywords"]).toMatchObject({
      priority: 99,
    });
    expect(rules["system:bank:creditcard-payment"]).toMatchObject({
      pattern: "信用卡.*繳|自訂卡費",
      economic_role: "card_payment",
      is_system: 1,
    });
    expect(rules["user:legacy-bank:food-keywords"]).toMatchObject({
      category_id: "food",
      pattern: "餐|自訂小吃",
      priority: 120,
      enabled: 1,
      is_system: 0,
    });

    expect(
      all(
        database,
        "SELECT id, subject_id, legacy_category_id, legacy_label, new_category_id, new_economic_role, legacy_pattern, new_pattern FROM classification_migration_notes WHERE id LIKE 'rule-pattern:%' ORDER BY id",
      ),
    ).toEqual([
      {
        id: "rule-pattern:system:bank:creditcard-payment",
        subject_id: "system:bank:creditcard-payment",
        legacy_category_id: "transfer",
        legacy_label: "轉帳",
        new_category_id: null,
        new_economic_role: "card_payment",
        legacy_pattern: "信用卡.*繳|自訂卡費",
        new_pattern:
          "信用卡.*繳|信用卡款|繳卡費|credit.?card.*(pay|bill|repay)",
      },
      {
        id: "rule-pattern:system:bank:food-keywords",
        subject_id: "user:legacy-bank:food-keywords",
        legacy_category_id: "food",
        legacy_label: "餐飲",
        new_category_id: "food",
        new_economic_role: null,
        legacy_pattern: "餐|自訂小吃",
        new_pattern: null,
      },
    ]);
    expect(all(database, "PRAGMA foreign_key_check")).toEqual([]);
  });
});

describe("0055 system rule defaults", () => {
  it("covers every system rule id that existed before 0055", () => {
    const database = createDatabase();
    migrate(database, (name) => name < "0055");
    const legacyIds = all(
      database,
      "SELECT id FROM classification_rules WHERE is_system = 1 ORDER BY id",
    ).map((row) => String(row.id));
    const sql = readFileSync(
      `${migrationsDirectory}/0055_spending_categories.sql`,
      "utf8",
    );
    const start = sql.indexOf("INSERT INTO _0055_rule_defaults");
    const block = sql.slice(start, sql.indexOf(";", start));
    const defaultIds = new Set(
      [...block.matchAll(/\('(system:[^']+)',/g)].map((match) => match[1]),
    );
    expect(legacyIds.length).toBeGreaterThan(0);
    expect(legacyIds.filter((id) => !defaultIds.has(id))).toEqual([]);
  });

  it("carries a priority-only change of a split or removed rule to every successor", () => {
    const database = legacyDatabase();
    database.exec(`
      -- 被拆分（同 id 仍存在）：同 id 與拆出的規則都沿用。
      UPDATE classification_rules SET priority = 42 WHERE id = 'system:shared:transport-keywords';
      -- 被移除：所有接替規則沿用。
      UPDATE classification_rules SET priority = 130 WHERE id = 'system:bank:food-keywords';
    `);
    migrate(database, (name) => name >= "0055");
    const priorities = Object.fromEntries(
      all(
        database,
        "SELECT id, priority FROM classification_rules WHERE is_system = 1",
      ).map((row) => [row.id, row.priority]),
    );
    expect(priorities).toMatchObject({
      "system:shared:transport-keywords": 42,
      "system:shared:transit-keywords": 42,
      "system:shared:ride-keywords": 42,
      "system:shared:car-keywords": 42,
      "system:shared:drinks-keywords": 130,
      "system:shared:dining-keywords": 130,
      // 沒有調整的規則維持新版預設。
      "system:shared:grocery-keywords": 91,
    });
    // pattern 沒改過：不轉成使用者規則、不留 pattern 紀錄。
    expect(
      all(
        database,
        "SELECT id FROM classification_rules WHERE id LIKE 'user:legacy-%'",
      ),
    ).toEqual([]);
    expect(
      all(
        database,
        "SELECT id FROM classification_migration_notes WHERE subject_type = 'rule'",
      ),
    ).toEqual([]);
  });
});

describe("0067 moves the legacy donation category to donation", () => {
  it("lands overrides, rules, aliases and notes of social.donations on donation", () => {
    const database = legacyDatabase();
    migrate(database, (name) => name >= "0055" && name < "0067");
    insertTransaction(database, "t-social-donation");
    insertOverride(database, "t-social-donation", "social.donations");
    database.exec(`
      INSERT INTO classification_rules (id, category_id, target_type, field, operator, pattern, priority, enabled, is_system, source, excluded_from_calculation, created_at, updated_at)
        VALUES ('user:donation-rule', 'social.donations', NULL, 'any_text', 'contains', '善款', 150, 1, 0, 'user', 0, '${now}', '${now}');
      INSERT INTO merchant_aliases (merchant_key, category_id, created_at, updated_at)
        VALUES ('name:某某協會', 'social.donations', '${now}', '${now}');
      INSERT INTO classification_migration_notes (id, subject_type, subject_id, legacy_category_id, legacy_label, new_category_id, needs_attention, created_at)
        VALUES ('note:donation', 'override', 'x', 'legacy', '舊分類', 'social.donations', 0, '${now}');
    `);
    migrate(database, (name) => name >= "0067");

    expect(
      all(
        database,
        "SELECT category_id FROM classification_overrides WHERE target_id = 't-social-donation'",
      ),
    ).toEqual([{ category_id: "donation" }]);
    expect(
      all(
        database,
        "SELECT category_id FROM classification_rules WHERE id = 'user:donation-rule'",
      ),
    ).toEqual([{ category_id: "donation" }]);
    expect(
      all(
        database,
        "SELECT category_id FROM merchant_aliases WHERE merchant_key = 'name:某某協會'",
      ),
    ).toEqual([{ category_id: "donation" }]);
    expect(
      all(
        database,
        "SELECT new_category_id FROM classification_migration_notes WHERE id = 'note:donation'",
      ),
    ).toEqual([{ new_category_id: "donation" }]);
    expect(all(database, "PRAGMA foreign_key_check")).toEqual([]);
  });

  it("0069 is idempotent after 0067 and keeps merchant rules set to 其他", () => {
    // 只驗證全新路徑：舊版 0067 已套用的路徑不是支援情境（見檔案開頭說明）。
    const database = legacyDatabase();
    migrate(database, (name) => name >= "0055" && name < "0067");
    database.exec(`
      INSERT INTO classification_categories (id, label, sort_order, is_system, created_at, updated_at)
        VALUES ('user:care', '醫療保險', 300, 0, '${now}', '${now}');
      INSERT INTO merchant_aliases (merchant_key, category_id, created_at, updated_at) VALUES
        ('name:家扶基金會', 'misc', '${now}', '${now}'),
        ('name:慈濟', 'social.gifts', '${now}', '${now}'),
        ('name:紅包店', 'social.gifts', '${now}', '${now}'),
        ('name:測試基金會', 'health.medical', '${now}', '${now}');
    `);
    insertTransaction(database, "t-gift");
    insertOverride(database, "t-gift", "social.gifts");
    migrate(database, (name) => name >= "0067" && name < "0069");

    const snapshots = [
      "SELECT id, label, sort_order, is_system, parent_id, created_at, updated_at FROM classification_categories ORDER BY id",
      "SELECT merchant_key, category_id, economic_role, updated_at FROM merchant_aliases ORDER BY merchant_key",
      "SELECT id, target_id, category_id FROM classification_overrides ORDER BY id",
      "SELECT id, category_id, economic_role, pattern, priority, enabled FROM classification_rules ORDER BY id",
      "SELECT * FROM classification_migration_notes ORDER BY id",
    ];
    const before = snapshots.map((sql) => all(database, sql));
    migrate(database, (name) => name.startsWith("0069_"));
    // 0067 已完成 0069 的所有工作，0069 不改變任何資料。
    expect(snapshots.map((sql) => all(database, sql))).toEqual(before);

    // 使用者設為「其他」的慈善商家規則不被改動。
    expect(
      all(
        database,
        "SELECT merchant_key, category_id FROM merchant_aliases ORDER BY merchant_key",
      ),
    ).toEqual([
      { merchant_key: "name:家扶基金會", category_id: "misc" },
      { merchant_key: "name:慈濟", category_id: "misc" },
      { merchant_key: "name:測試基金會", category_id: "health" },
      { merchant_key: "name:紅包店", category_id: "misc" },
    ]);
    expect(
      all(
        database,
        "SELECT id, label FROM classification_categories WHERE id = 'user:care'",
      ),
    ).toEqual([{ id: "user:care", label: "醫療保險（自訂）" }]);
    expect(
      all(
        database,
        "SELECT id FROM classification_migration_notes WHERE subject_id = 'user:care'",
      ),
    ).toEqual([{ id: "category:0067:user:care" }]);
    expect(all(database, "PRAGMA foreign_key_check")).toEqual([]);
  });
});
