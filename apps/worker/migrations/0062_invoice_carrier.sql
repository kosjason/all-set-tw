-- 電子發票載具：財政部載具表頭查詢（carrierInvChk）每張發票帶有 cardType
-- （載具類別；歸戶在手機條碼下的載具為其實際類別）與 cardNo（載具隱碼）。
-- 隱碼可識別使用者的載具，只保存末 4 碼，用於比對已同步信用卡的末四碼。
ALTER TABLE invoices ADD COLUMN carrier_type TEXT;
ALTER TABLE invoices ADD COLUMN carrier_suffix TEXT
  CHECK (carrier_suffix IS NULL OR length(carrier_suffix) BETWEEN 1 AND 4);

-- 回填：新版連接器把載具寫在 raw_payload.invoice.carrierType／carrierSuffix；
-- 在此之前的資料只保存正規化後的表頭，沒有載具欄位，維持 NULL，待下次同步補上。
UPDATE invoices
SET
  carrier_type = NULLIF(substr(trim(COALESCE(
    json_extract(raw_payload, '$.invoice.carrierType'),
    json_extract(raw_payload, '$.invoice.cardType'),
    ''
  )), 1, 16), ''),
  carrier_suffix = NULLIF(substr(replace(COALESCE(
    json_extract(raw_payload, '$.invoice.carrierSuffix'),
    json_extract(raw_payload, '$.invoice.cardNo'),
    ''
  ), ' ', ''), -4), '')
WHERE json_valid(raw_payload)
  AND carrier_type IS NULL
  AND carrier_suffix IS NULL;
