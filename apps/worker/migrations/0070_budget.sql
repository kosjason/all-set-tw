-- 1. 本月可花的設定（單列）：預期月收入、儲蓄目標、年繳準備金。
--    expected_income 為 NULL 時由近 3 個完整月份的收入推算。
CREATE TABLE budget_settings (
  id TEXT PRIMARY KEY NOT NULL CHECK (id = 'default'),
  expected_income REAL CHECK (expected_income IS NULL OR expected_income >= 0),
  savings_target_type TEXT NOT NULL DEFAULT 'amount' CHECK (savings_target_type IN ('amount', 'percent')),
  savings_target_value REAL NOT NULL DEFAULT 0 CHECK (
    savings_target_value >= 0 AND (savings_target_type = 'amount' OR savings_target_value <= 100)
  ),
  annual_reserve REAL NOT NULL DEFAULT 0 CHECK (annual_reserve >= 0),
  updated_at TEXT NOT NULL
);

-- 2. 使用者對商家是否為固定支出的判斷。merchant_key 與 merchant_rules 相同（ban:<統編> 或
--    name:<正規化名稱>），不設 FK：商家來自活動推導，沒有獨立的商家表。
--    kind：monthly 每月固定、annual 年繳（由年繳準備金支付，不扣本月可花）、not_fixed 不是固定支出
--    （不再列入候選）。expected_amount 為 NULL 時以近 3 個月該商家每月消費的中位數估計。
CREATE TABLE budget_merchants (
  merchant_key TEXT PRIMARY KEY NOT NULL CHECK (length(merchant_key) BETWEEN 1 AND 200),
  kind TEXT NOT NULL CHECK (kind IN ('monthly', 'annual', 'not_fixed')),
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 200),
  expected_amount REAL CHECK (expected_amount IS NULL OR expected_amount >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
