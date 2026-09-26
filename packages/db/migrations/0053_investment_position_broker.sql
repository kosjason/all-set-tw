-- 集保同一證券可分屬不同券商帳戶（例如兩家券商各持有 0050）；持倉需保存券商
-- 代碼與名稱，前端才能區分同名持倉。只保存券商層級資訊，不保存完整券商帳號。
ALTER TABLE investment_positions ADD COLUMN broker_no TEXT;
ALTER TABLE investment_positions ADD COLUMN broker_name TEXT;

-- 回填既有集保證券持倉：其 source_id 為 `券商代碼:券商帳號:代號:日期`
-- （恰有三個冒號）。基金持倉 source_id 只有兩個冒號，不在回填範圍。
UPDATE investment_positions
SET broker_no = substr(source_id, 1, instr(source_id, ':') - 1)
WHERE connector_id = 'tdcc'
  AND broker_no IS NULL
  AND instr(source_id, ':') > 1
  AND length(source_id) - length(replace(source_id, ':', '')) = 3;

-- 券商名稱沿用同一券商代碼最近一次投資交易所記錄的名稱；沒有交易時保持 NULL，
-- 下次集保同步會以來源資料覆寫。
UPDATE investment_positions
SET broker_name = (
  SELECT tx.broker_name
  FROM investment_transactions tx
  WHERE tx.connector_id = investment_positions.connector_id
    AND tx.broker_no = investment_positions.broker_no
    AND tx.broker_name IS NOT NULL
    AND trim(tx.broker_name) <> ''
  ORDER BY tx.updated_at DESC, tx.id DESC
  LIMIT 1
)
WHERE connector_id = 'tdcc'
  AND broker_no IS NOT NULL
  AND broker_name IS NULL;
