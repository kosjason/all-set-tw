-- 現金支出：使用者手動記的現金消費（金額、分類、日期、說明）。提款仍先以「其他」計入
-- 消費；現金支出在讀取時從尚未細分的提款扣（同月份優先，再扣上個月），把提款拆成
-- 實際分類。分配不落地，因此沒有連到 bank_transactions 的欄位。
-- category_id 指向 classification_categories；API 只接受消費分類。
-- 日期用 IS 比對 date()：不存在的日期（如 2026-19-39）date() 回 NULL，用 = 會讓 CHECK 通過。
CREATE TABLE cash_expenses (
  id TEXT NOT NULL PRIMARY KEY,
  expense_date TEXT NOT NULL CHECK (
    expense_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'
    AND expense_date IS date(expense_date)
  ),
  amount INTEGER NOT NULL CHECK (
    typeof(amount) = 'integer' AND amount BETWEEN 1 AND 10000000
  ),
  category_id TEXT NOT NULL REFERENCES classification_categories (id),
  description TEXT CHECK (
    description IS NULL
    OR (description = trim(description) AND length(description) BETWEEN 1 AND 100)
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 活動依月份讀取。
CREATE INDEX idx_cash_expenses_date ON cash_expenses (expense_date, created_at);
