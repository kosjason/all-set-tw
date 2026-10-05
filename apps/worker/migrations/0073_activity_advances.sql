-- 代墊：經濟角色新增 advance（代墊，待收回）與 reimbursement（收回代墊），兩者都不計入
-- 收入與消費；新增 counterparty 記錄對象，只有這兩個角色必須有值、其他角色必須為 NULL。
-- 名稱由 API 正規化（NFKC、去頭尾空白、合併連續空白，1–40 字）。
-- SQLite 無法修改 CHECK，以重建表放寬 activity_role_overrides，保留既有資料。
-- 沒有其他表以 FK 參照此表。
CREATE TABLE activity_role_overrides_new (
  target_kind TEXT NOT NULL CHECK (target_kind IN ('bank_transaction', 'invoice')),
  target_id TEXT NOT NULL,
  economic_role TEXT NOT NULL CHECK (
    economic_role IN (
      'spending', 'income', 'own_transfer', 'investment', 'card_payment', 'excluded',
      'advance', 'reimbursement'
    )
  ),
  review_status TEXT NOT NULL DEFAULT 'confirmed' CHECK (review_status = 'confirmed'),
  duplicate_of_kind TEXT CHECK (
    duplicate_of_kind IS NULL OR duplicate_of_kind IN ('bank_transaction', 'invoice')
  ),
  duplicate_of_id TEXT,
  counterparty TEXT CHECK (
    counterparty IS NULL
    OR (counterparty = trim(counterparty) AND length(counterparty) BETWEEN 1 AND 40)
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (target_kind, target_id),
  CHECK ((duplicate_of_kind IS NULL) = (duplicate_of_id IS NULL)),
  CHECK (NOT (duplicate_of_kind = target_kind AND duplicate_of_id = target_id)),
  CHECK ((economic_role IN ('advance', 'reimbursement')) = (counterparty IS NOT NULL))
);

INSERT INTO activity_role_overrides_new
  (target_kind, target_id, economic_role, review_status, duplicate_of_kind,
   duplicate_of_id, counterparty, created_at, updated_at)
SELECT target_kind, target_id, economic_role, review_status, duplicate_of_kind,
       duplicate_of_id, NULL, created_at, updated_at
FROM activity_role_overrides;

DROP TABLE activity_role_overrides;

ALTER TABLE activity_role_overrides_new RENAME TO activity_role_overrides;

-- 代墊彙總依對象讀取。
CREATE INDEX idx_activity_role_overrides_counterparty
  ON activity_role_overrides (counterparty)
  WHERE counterparty IS NOT NULL;
