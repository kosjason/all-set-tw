-- 國泰世華存款端的信用卡繳款描述為「信用卡款 國泰世華卡 信用卡款」，
-- 不含「繳」字，補入系統信用卡繳費規則；使用者改過的 pattern 不覆寫。
UPDATE classification_rules
SET pattern = '信用卡.*繳|信用卡款|繳卡費|credit.?card.*(pay|bill|repay)',
    updated_at = '2026-09-25T00:00:00.000Z'
WHERE id = 'system:bank:creditcard-payment'
  AND pattern = '信用卡.*繳|繳卡費|credit.?card.*(pay|bill|repay)';

-- 以下只修正國泰信用卡帳戶的交易；存款明細的 txnDateTime 是真實時間，不受影響。
-- 信用卡帳單明細只有消費日期，舊版寫入的 +08:00 午夜不是交易時間。
UPDATE bank_transactions
SET authorized_at = substr(authorized_at, 1, 10)
WHERE connector_id = 'cathaybk'
  AND authorized_at LIKE '____-__-__T00:00:00+08:00'
  AND account_id IN (
    SELECT id FROM bank_accounts
    WHERE connector_id = 'cathaybk' AND account_type = 'credit'
  );

UPDATE bank_transactions
SET posted_date = substr(posted_date, 1, 10)
WHERE connector_id = 'cathaybk'
  AND (posted_date LIKE '____-__-__T00:00:00'
    OR posted_date LIKE '____-__-__T00:00:00.000Z')
  AND account_id IN (
    SELECT id FROM bank_accounts
    WHERE connector_id = 'cathaybk' AND account_type = 'credit'
  );

-- 舊版把帳單明細的負數貸項（繳款、退款、回饋）也存成支出；
-- 原始金額為負或屬於繳款區段者，在卡片帳戶應為正數。
UPDATE bank_transactions
SET amount = -amount
WHERE connector_id = 'cathaybk'
  AND amount < 0
  AND json_valid(raw_payload)
  AND (json_extract(raw_payload, '$.amount') < 0
    OR json_extract(raw_payload, '$.detailType') = 'PaymentAmount')
  AND account_id IN (
    SELECT id FROM bank_accounts
    WHERE connector_id = 'cathaybk' AND account_type = 'credit'
  );

-- 與新版 connector 相同，為繳款補上對象，讓信用卡繳費規則歸為轉帳並排除計算。
UPDATE bank_transactions
SET counterparty = '國泰世華信用卡繳款'
WHERE connector_id = 'cathaybk'
  AND counterparty IS NULL
  AND json_valid(raw_payload)
  AND json_extract(raw_payload, '$.detailType') = 'PaymentAmount'
  AND account_id IN (
    SELECT id FROM bank_accounts
    WHERE connector_id = 'cathaybk' AND account_type = 'credit'
  );
