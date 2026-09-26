-- 中信帳單摘要的 pmtAmt 是「本期間繳掉的上期帳單」，舊版解析器誤存為本期已繳，
-- 並據此標記 is_paid，導致尚未扣款的本期帳單顯示已繳。新版改以「下一期」的 pmtAmt
-- 作為本期已繳，沒有下一期時不寫入；upsert 以 COALESCE 保留舊值，因此先在此清除，
-- 下次同步或匯入時再由新版寫入正確值。
UPDATE credit_card_bills
SET paid_amount = NULL,
    is_paid = NULL
WHERE connector_id = 'ctbc';
