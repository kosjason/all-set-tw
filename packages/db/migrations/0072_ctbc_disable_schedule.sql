-- 中信會擋自動登入（App 回 0131、網銀防機器人），fork 只支援網銀半自動匯入。
-- 關閉既有的中信排程，避免排程把它記為需要處理而在收件匣留下錯誤的驗證待辦。
UPDATE sync_jobs SET enabled = 0 WHERE connector_id = 'ctbc';

-- 清除先前自動同步嘗試留下的失敗或需要處理狀態；有成功紀錄（半自動匯入）時回到成功，
-- 保留 last_success_at。
UPDATE sync_jobs
SET
  last_status = CASE WHEN last_success_at IS NOT NULL THEN 'success' ELSE NULL END,
  last_error = NULL
WHERE connector_id = 'ctbc'
  AND last_status IN ('failed', 'needs_user_action');
