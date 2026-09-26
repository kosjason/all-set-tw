-- 中信帳單摘要的 pmtAmt 是「本期間繳掉的上期帳單」，舊版解析器誤存為本期已繳，
-- 並據此標記 is_paid，導致尚未扣款的本期帳單顯示已繳。新版解析器（packages/connectors
-- 的 ctbc.ts）改以「下一期」的 pmtAmt 作為本期已繳，應繳以 currPmtAmt（扣除調整後的
-- 本期應繳）優先。
--
-- 這裡把既有資料位移成新版的結果，而不是清空（清空會讓已過期、無法再匯入的舊帳單
-- 永遠失去已繳紀錄）：
-- - 每期帳單的 paid_amount ＝ 同帳戶、同幣別「下一期」帳單的舊 paid_amount；
--   沒有下一期時為 NULL（下次同步或匯入時由新版寫入）。
-- - statement_amount：raw 有 currentPayment／currPmtAmt 時改為它（與新版解析器一致）。
-- - is_paid 與新版解析器相同：應繳 ≤ 0 為已繳；否則有已繳金額時為「已繳 ≥ 應繳」；
--   都不知道時為 NULL。
-- 帳單 upsert 以 COALESCE 保留舊值，因此必須在此修正。

CREATE TABLE _0064_ctbc_bills (
  id TEXT NOT NULL PRIMARY KEY,
  account_id TEXT NOT NULL,
  currency TEXT NOT NULL,
  billing_period TEXT NOT NULL,
  statement_amount REAL,
  paid_amount REAL
);

-- raw 的應繳可能是數字或含千分位逗號的字串（例如 "12,345"）：去掉逗號與空白後，
-- 只有純數字（可含負號與小數點）才採用，否則沿用原本的 statement_amount。舊的已繳金額
-- 以同樣方式正規化後再位移與比較。
INSERT INTO _0064_ctbc_bills
  (id, account_id, currency, billing_period, statement_amount, paid_amount)
SELECT
  id,
  account_id,
  currency,
  billing_period,
  CASE
    -- 只接受「可選負號＋數字＋至多一個小數點」；1-2、1.2.3、--1 這類格式錯誤的值不採用。
    WHEN raw_amount GLOB '*[0-9]*'
      AND NOT raw_amount GLOB '*[^0-9.-]*'
      AND instr(substr(raw_amount, 2), '-') = 0
      AND length(raw_amount) - length(replace(raw_amount, '.', '')) <= 1
      THEN CAST(raw_amount AS REAL)
    ELSE statement_amount
  END,
  CASE
    WHEN paid_text GLOB '*[0-9]*'
      AND NOT paid_text GLOB '*[^0-9.-]*'
      AND instr(substr(paid_text, 2), '-') = 0
      AND length(paid_text) - length(replace(paid_text, '.', '')) <= 1
      THEN CAST(paid_text AS REAL)
  END
FROM (
  SELECT
    id, account_id, currency, billing_period, statement_amount, paid_amount,
    CASE WHEN json_valid(raw_payload) THEN
      replace(trim(CAST(COALESCE(
        json_extract(raw_payload, '$.currentPayment'),
        json_extract(raw_payload, '$.currPmtAmt')
      ) AS TEXT)), ',', '')
    END AS raw_amount,
    replace(trim(CAST(paid_amount AS TEXT)), ',', '') AS paid_text
  FROM credit_card_bills
  WHERE connector_id = 'ctbc'
);

UPDATE credit_card_bills
SET
  statement_amount = (
    SELECT bill.statement_amount FROM _0064_ctbc_bills bill
    WHERE bill.id = credit_card_bills.id
  ),
  paid_amount = (
    SELECT next.paid_amount
    FROM _0064_ctbc_bills bill
    JOIN _0064_ctbc_bills next
      ON next.account_id = bill.account_id
     AND next.currency = bill.currency
     AND next.billing_period
       = strftime('%Y-%m', bill.billing_period || '-01', '+1 month')
    WHERE bill.id = credit_card_bills.id
  )
WHERE connector_id = 'ctbc';

UPDATE credit_card_bills
SET is_paid = CASE
  WHEN statement_amount IS NOT NULL AND statement_amount <= 0 THEN 1
  WHEN statement_amount IS NOT NULL AND paid_amount IS NOT NULL
    THEN paid_amount >= statement_amount
  ELSE NULL
END
WHERE connector_id = 'ctbc';

DROP TABLE _0064_ctbc_bills;
