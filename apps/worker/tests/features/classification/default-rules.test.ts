import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  isStoredValueTopUp,
  STORED_VALUE_TOP_UP_PATTERN,
} from "@taiwan-fin-hub/core";
import { resolveClassifications } from "../../../src/features/classification/service";

const migrationsDirectory = fileURLToPath(
  new URL("../../../../../packages/db/migrations/", import.meta.url),
);
const migrationFiles = readdirSync(migrationsDirectory)
  .filter((name) => name.endsWith(".sql"))
  .sort();
const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function createDatabase(before = "0040") {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  database.exec("PRAGMA foreign_keys = ON");
  for (const file of migrationFiles.filter((name) => name < before)) {
    database.exec(readFileSync(`${migrationsDirectory}/${file}`, "utf8"));
  }
  return database;
}

function asD1(database: DatabaseSync) {
  return {
    prepare(sql: string) {
      let params: SQLInputValue[] = [];
      return {
        bind(...values: SQLInputValue[]) {
          params = values;
          return this;
        },
        async raw() {
          return (
            database.prepare(sql).all(...params) as Record<string, unknown>[]
          ).map((row) => Object.values(row));
        },
        async all() {
          return { results: database.prepare(sql).all(...params) };
        },
      };
    },
  } as unknown as D1Database;
}

describe("default classification rules", () => {
  it("classifies merchant and income descriptions using migrated rule priority", async () => {
    const cases: Array<[string, number, string]> = [
      ["OPENAI *CHATGPT SUBSCRO123456 SAN FR", -100, "tech"],
      ["OPENAIO123456 SAN FR", -100, "tech"],
      ["CURSOR, AI POWERED IDEO123456 CURSOR", -100, "tech"],
      ["CLOUDFLAREO123456 SAN FR", -100, "tech"],
      ["GOOGLE*CLOUD EXAMPLEO123456 CC GOO", -100, "tech"],
      ["Microsoft 365", -100, "tech"],
      ["中華電信股份有限公司個人家庭分TAIPEI", -100, "housing"],
      ["遠傳電信股份有限公司TAIPEI", -100, "housing"],
      ["信用卡消費折抵_遠傳電信股份有限公司", 100, "housing"],
      ["轉帳代繳台灣電力電費", -100, "housing"],
      ["瓦斯費", -100, "housing"],
      ["利息存入", 100, "income.investment"],
      ["利息", 100, "income.investment"],
      ["證券股利匯款", 100, "income.investment"],
      ["租金補貼轉入", 100, "income.other"],
      ["現金回饋", 100, "income.other"],
      ["利息", -100, "misc"],
      ["APPLE.COM/BILL", -100, "other"],
      ["GOOGLE*YOUTUBE", -100, "other"],
      ["電腦軟體/PXPAY PLUS CO LTD", -100, "other"],
      ["OPENAI 國外交易手續費", -100, "misc"],
      ["遠傳電信購機", -100, "other"],
      ["現金回饋退款", 100, "other"],
      ["一月薪資入帳", 126000, "income.salary"],
      ["全聯福利中心", -500, "food"],
      ["星巴克信義店", -150, "food"],
      ["好食餐飲有限公司", -300, "food"],
      ["台南晶英酒店飯店", -3000, "other"],
      ["台北捷運扣款", -42, "transport"],
      ["UBER *TRIP", -250, "transport"],
      ["UBER EATS", -250, "food"],
      ["中油加油站", -1200, "transport"],
      ["南山人壽保險費", -12680, "health"],
      ["牙醫診所", -800, "health"],
      ["牌照稅", -4800, "misc"],
      ["NETFLIX.COM", -390, "entertainment"],
      ["AWS EMEA", -300, "tech"],
      ["GODADDY.COM DOMAIN", -500, "tech"],
      ["燦坤3C 內湖店", -9000, "tech"],
    ];
    const transactions = cases.map(([description, amount], index) => ({
      id: `transaction-${index}`,
      sourceId: `source-${index}`,
      description,
      amount,
    }));
    const results = await resolveClassifications(
      asD1(createDatabase("9999")),
      transactions,
    );
    for (const [index, [description, , categoryId]] of cases.entries()) {
      expect(results.get(`transaction-${index}`)?.categoryId, description).toBe(
        categoryId,
      );
    }
    const sourceOnly = await resolveClassifications(
      asD1(createDatabase("9999")),
      [
        {
          id: "source-only",
          sourceId: "openai",
          description: "未辨識交易",
          amount: -100,
        },
      ],
    );
    expect(sourceOnly.get("source-only")?.categoryId).toBe("other");
  });

  it("preserves an existing same-name category and supports migration reruns", async () => {
    const database = createDatabase("0038");
    database.exec(
      "INSERT INTO classification_categories VALUES ('user:software', '軟體服務', 15, 0, 'original', 'original')",
    );
    for (let run = 0; run < 2; run++) {
      for (const file of migrationFiles.filter(
        (name) => name >= "0038" && name < "0040",
      )) {
        database.exec(readFileSync(`${migrationsDirectory}/${file}`, "utf8"));
      }
    }
    expect(
      database
        .prepare(
          "SELECT category_id FROM classification_rules WHERE id = 'system:bank:software-keywords'",
        )
        .get()?.category_id,
    ).toBe("user:software");
    expect(
      database
        .prepare(
          "SELECT is_system FROM classification_categories WHERE id = 'user:software'",
        )
        .get()?.is_system,
    ).toBe(0);
  });

  it("treats e-wallet stored-value top-ups as excluded transfers", async () => {
    const cases: Array<[string, number, string, boolean]> = [
      ["電支交易 街口儲值 P202609050001", -1000, "other", true],
      ["電支交易 連加電支儲值 P202609050002", -500, "other", true],
      ["一卡通儲值", -300, "other", true],
      ["全支付儲值", -200, "other", true],
      ["LINE Pay 儲值", -200, "other", true],
      ["電支交易 街口支付 P202609050003", -120, "other", false],
      ["電支儲值手續費", -10, "misc", false],
      ["統一超商", -60, "food", false],
    ];
    const results = await resolveClassifications(
      asD1(createDatabase("9999")),
      cases.map(([description, amount], index) => ({
        id: `transaction-${index}`,
        sourceId: `source-${index}`,
        description,
        amount,
      })),
    );
    for (const [
      index,
      [description, , categoryId, excluded],
    ] of cases.entries()) {
      const result = results.get(`transaction-${index}`);
      expect(result?.categoryId, description).toBe(categoryId);
      expect(Boolean(result?.excludedFromCalculation), description).toBe(
        excluded,
      );
      // 電支儲值是轉到自己的電子錢包：角色規則，不是消費分類。
      expect(result?.economicRole, description).toBe(
        excluded ? "own_transfer" : undefined,
      );
      expect(isStoredValueTopUp({ description }), description).toBe(excluded);
    }
  });

  it("keeps the e-wallet rule pattern in sync with invoice matching", () => {
    const rule = createDatabase("9999")
      .prepare(
        "SELECT pattern, category_id, economic_role, excluded_from_calculation, is_system FROM classification_rules WHERE id = 'system:bank:ewallet-topup'",
      )
      .get();
    expect(rule).toEqual({
      pattern: STORED_VALUE_TOP_UP_PATTERN,
      category_id: null,
      economic_role: "own_transfer",
      excluded_from_calculation: 1,
      is_system: 1,
    });
  });

  it("does not overwrite an existing e-wallet rule when the migration reruns", () => {
    const database = createDatabase("9999");
    database.exec(
      "UPDATE classification_rules SET enabled = 0, updated_at = 'changed' WHERE id = 'system:bank:ewallet-topup'",
    );
    database.exec(
      readFileSync(
        `${migrationsDirectory}/0050_ewallet_topup_transfer_rule.sql`,
        "utf8",
      ),
    );
    expect(
      database
        .prepare(
          "SELECT enabled, updated_at FROM classification_rules WHERE id = 'system:bank:ewallet-topup'",
        )
        .get(),
    ).toEqual({ enabled: 0, updated_at: "changed" });
  });

  it("keeps demo rules consistent with migrated defaults", () => {
    const database = createDatabase("9999");
    const sql =
      "SELECT * FROM classification_rules WHERE is_system = 1 ORDER BY id";
    const categories =
      "SELECT id, label, sort_order, parent_id FROM classification_categories ORDER BY id";
    const expected = database.prepare(sql).all();
    const expectedCategories = database.prepare(categories).all();
    database.exec(
      readFileSync(
        new URL("../../../../../packages/db/seeds/demo.sql", import.meta.url),
        "utf8",
      ),
    );
    expect(expected.length).toBeGreaterThan(20);
    expect(database.prepare(sql).all()).toEqual(expected);
    expect(database.prepare(categories).all()).toEqual(expectedCategories);
  });

  it("keeps the demo e-wallet top-up rule consistent with its migration", () => {
    const database = createDatabase("9999");
    const sql =
      "SELECT * FROM classification_rules WHERE id = 'system:bank:ewallet-topup'";
    const expected = database.prepare(sql).all();
    database.exec(
      readFileSync(
        new URL("../../../../../packages/db/seeds/demo.sql", import.meta.url),
        "utf8",
      ),
    );
    expect(expected).toHaveLength(1);
    expect(database.prepare(sql).all()).toEqual(expected);
  });
});
