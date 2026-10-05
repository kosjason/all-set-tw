-- 本月可花改為使用者設定的每月消費預算（預算 − 已花 − 固定支出待扣），不再以收入扣儲蓄目標推算。
-- SQLite 無法刪除有 CHECK 的欄位，以重建表移除 savings_target_*、新增 monthly_budget；
-- 保留既有的預期收入與年繳總額。沒有其他表以 FK 參照此表。
CREATE TABLE budget_settings_new (
  id TEXT PRIMARY KEY NOT NULL CHECK (id = 'default'),
  monthly_budget REAL CHECK (monthly_budget IS NULL OR monthly_budget >= 0),
  expected_income REAL CHECK (expected_income IS NULL OR expected_income >= 0),
  annual_reserve REAL NOT NULL DEFAULT 0 CHECK (annual_reserve >= 0),
  updated_at TEXT NOT NULL
);

INSERT INTO budget_settings_new (id, monthly_budget, expected_income, annual_reserve, updated_at)
SELECT id, NULL, expected_income, annual_reserve, updated_at FROM budget_settings;

DROP TABLE budget_settings;
ALTER TABLE budget_settings_new RENAME TO budget_settings;
