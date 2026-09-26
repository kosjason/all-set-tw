-- 1. 活動備註：使用者為單筆活動（銀行／信用卡交易或電子發票）寫下原因，供自己與 LLM 參考。
--    target_kind + target_id 與 activity_role_overrides 相同是多型參照，因此不設 FK；
--    活動不存在時備註不影響任何金額。空字串不保存（API 以空字串表示刪除）。
CREATE TABLE activity_notes (
  target_kind TEXT NOT NULL CHECK (target_kind IN ('bank_transaction', 'invoice')),
  target_id TEXT NOT NULL,
  note TEXT NOT NULL CHECK (length(note) BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (target_kind, target_id)
);

-- 2. 經濟角色新增 excluded（不計入：沒有實際付款、已退款作廢、測試等）。
--    SQLite 無法修改 CHECK，以重建表放寬 activity_role_overrides.economic_role，保留既有資料。
--    沒有其他表以 FK 參照此表。
CREATE TABLE activity_role_overrides_new (
  target_kind TEXT NOT NULL CHECK (target_kind IN ('bank_transaction', 'invoice')),
  target_id TEXT NOT NULL,
  economic_role TEXT NOT NULL CHECK (
    economic_role IN ('spending', 'income', 'own_transfer', 'investment', 'card_payment', 'excluded')
  ),
  review_status TEXT NOT NULL DEFAULT 'confirmed' CHECK (review_status = 'confirmed'),
  duplicate_of_kind TEXT CHECK (
    duplicate_of_kind IS NULL OR duplicate_of_kind IN ('bank_transaction', 'invoice')
  ),
  duplicate_of_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (target_kind, target_id),
  CHECK ((duplicate_of_kind IS NULL) = (duplicate_of_id IS NULL)),
  CHECK (NOT (duplicate_of_kind = target_kind AND duplicate_of_id = target_id))
);

INSERT INTO activity_role_overrides_new
  (target_kind, target_id, economic_role, review_status, duplicate_of_kind,
   duplicate_of_id, created_at, updated_at)
SELECT target_kind, target_id, economic_role, review_status, duplicate_of_kind,
       duplicate_of_id, created_at, updated_at
FROM activity_role_overrides;

DROP TABLE activity_role_overrides;

ALTER TABLE activity_role_overrides_new RENAME TO activity_role_overrides;
