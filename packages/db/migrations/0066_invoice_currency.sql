-- 外幣電子發票：跨境電商（境外電商）開立的發票以原幣計價，財政部發票明細
-- （raw_payload.detail）帶有 currency（例如 USD）與保留小數的 amount（"10.98"）；
-- invoices.amount 與清單 API 的金額則是截斷成整數的原幣金額（US$10.98 存成 10），
-- 不是新台幣。以 virtual generated column 由 raw payload 推導，不改動同步寫入流程。
--
-- currency：明細 currency 為三碼英文字母時取其大寫，其餘（國內發票沒有此欄）為 TWD。
ALTER TABLE invoices ADD COLUMN currency TEXT GENERATED ALWAYS AS (
  CASE
    WHEN json_valid(raw_payload)
      AND upper(trim(COALESCE(json_extract(raw_payload, '$.detail.currency'), ''))) GLOB '[A-Z][A-Z][A-Z]'
    THEN upper(trim(json_extract(raw_payload, '$.detail.currency')))
    ELSE 'TWD'
  END
) VIRTUAL;

-- original_amount：明細的發票總額（原幣，含小數）；缺少或不是數字時為 NULL。
-- 明細總額也被截斷時，程式改用品項金額加總（見 packages/core/src/invoice-currency.ts）。
ALTER TABLE invoices ADD COLUMN original_amount REAL GENERATED ALWAYS AS (
  CASE
    WHEN json_valid(raw_payload)
      AND trim(COALESCE(CAST(json_extract(raw_payload, '$.detail.amount') AS TEXT), '')) GLOB '*[0-9]*'
      AND trim(CAST(json_extract(raw_payload, '$.detail.amount') AS TEXT)) NOT GLOB '*[^0-9.-]*'
    THEN CAST(trim(CAST(json_extract(raw_payload, '$.detail.amount') AS TEXT)) AS REAL)
  END
) VIRTUAL;
