-- 商家模型：merchant_key 由程式在讀取時推導（見 packages/core/src/merchant.ts），
-- 發票以賣方統編（ban:<統編>）優先，銀行／信用卡以正規化名稱（name:<名稱>）。
-- 使用者可為商家設定顯示名稱、分類與經濟角色；分類或角色即為「商家規則」，
-- 在讀取時回溯套用到該商家所有交易，不改寫原始交易或發票。
CREATE TABLE merchant_aliases (
  merchant_key TEXT NOT NULL PRIMARY KEY CHECK (
    merchant_key GLOB 'ban:[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
    OR (merchant_key GLOB 'name:?*' AND length(merchant_key) <= 125)
  ),
  display_name TEXT CHECK (display_name IS NULL OR length(trim(display_name)) > 0),
  category_id TEXT REFERENCES classification_categories (id),
  economic_role TEXT CHECK (
    economic_role IS NULL
    OR economic_role IN ('spending', 'income', 'own_transfer', 'investment', 'card_payment')
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_merchant_aliases_category ON merchant_aliases (category_id);

-- 發票賣方統編保存在電子發票 raw payload（清單 API 的 sellerID／sellerBan）；
-- 以 virtual generated column 正規化成 8 碼統編，不改動同步寫入流程。
ALTER TABLE invoices ADD COLUMN seller_ban TEXT GENERATED ALWAYS AS (
  CASE
    WHEN json_valid(raw_payload)
      AND trim(COALESCE(
        json_extract(raw_payload, '$.invoice.sellerID'),
        json_extract(raw_payload, '$.invoice.sellerBan'),
        json_extract(raw_payload, '$.sellerID'),
        json_extract(raw_payload, '$.sellerBan'),
        json_extract(raw_payload, '$.detail.sellerBan'),
        ''
      )) GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
    THEN trim(COALESCE(
      json_extract(raw_payload, '$.invoice.sellerID'),
      json_extract(raw_payload, '$.invoice.sellerBan'),
      json_extract(raw_payload, '$.sellerID'),
      json_extract(raw_payload, '$.sellerBan'),
      json_extract(raw_payload, '$.detail.sellerBan')
    ))
  END
) VIRTUAL;
