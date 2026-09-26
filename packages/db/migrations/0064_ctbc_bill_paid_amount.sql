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
  statement_amount INTEGER,
  paid_amount INTEGER
);

INSERT INTO _0064_ctbc_bills
  (id, account_id, currency, billing_period, statement_amount, paid_amount)
SELECT
  id,
  account_id,
  currency,
  billing_period,
  COALESCE(
    CASE WHEN json_valid(raw_payload) THEN
      COALESCE(
        json_extract(raw_payload, '$.currentPayment'),
        json_extract(raw_payload, '$.currPmtAmt')
      )
    END,
    statement_amount
  ),
  paid_amount
FROM credit_card_bills
WHERE connector_id = 'ctbc';

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
