-- 中信會擋自動登入（App 回 0131、網銀防機器人），fork 只支援網銀半自動匯入。
-- 關閉既有的中信排程，避免排程把它記為需要處理而在收件匣留下錯誤的驗證待辦。
UPDATE sync_jobs SET enabled = 0 WHERE connector_id = 'ctbc';
