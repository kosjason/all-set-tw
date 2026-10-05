-- 使用者對活動經濟角色的覆寫。角色本身在讀取時推導（不改寫交易或發票），
-- 只有使用者確認過的角色與重複關係會持久化；覆寫一律視為 review_status = confirmed。
-- target_kind + target_id 為多型參照（bank_transaction／invoice），因此不設 FK；
-- 讀取時以活動 id 比對，找不到的覆寫不影響任何金額。
CREATE TABLE activity_role_overrides (
  target_kind TEXT NOT NULL CHECK (target_kind IN ('bank_transaction', 'invoice')),
  target_id TEXT NOT NULL,
  economic_role TEXT NOT NULL CHECK (
    economic_role IN ('spending', 'income', 'own_transfer', 'investment', 'card_payment')
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
