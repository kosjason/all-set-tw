-- 交易對手帳戶：只保存金融機構代碼與帳號末五碼，不保存完整帳號。
ALTER TABLE bank_transactions ADD COLUMN counterparty_bank_code TEXT
  CHECK (counterparty_bank_code IS NULL OR counterparty_bank_code GLOB '[0-9][0-9][0-9]');
ALTER TABLE bank_transactions ADD COLUMN counterparty_account_suffix TEXT
  CHECK (
    counterparty_account_suffix IS NULL OR (
      length(counterparty_account_suffix) BETWEEN 4 AND 5
      AND counterparty_account_suffix NOT GLOB '*[^0-9]*'
    )
  );

-- 回填既有國泰世華存款交易：轉出優先使用 expendBankId／expendAcctNo，
-- 其餘解析 specialMemo 的「(銀行代碼)帳號；」。規則與
-- apps/worker/src/connectors/cathaybk-deposit-counterparty.ts 相同。
WITH parsed AS (
  SELECT
    id,
    amount,
    trim(COALESCE(json_extract(raw_payload, '$.expendBankId'), '')) AS expend_bank,
    replace(replace(trim(COALESCE(json_extract(raw_payload, '$.expendAcctNo'), '')), ' ', ''), '-', '') AS expend_account,
    trim(replace(replace(COALESCE(json_extract(raw_payload, '$.specialMemo'), ''), '；', ''), ';', '')) AS memo
  FROM bank_transactions
  WHERE connector_id = 'cathaybk'
    AND json_valid(raw_payload)
    AND counterparty_bank_code IS NULL
), candidates AS (
  SELECT
    id,
    CASE
      WHEN amount < 0
        AND expend_bank GLOB '[0-9][0-9][0-9]'
        AND length(expend_account) >= 8
        AND expend_account NOT GLOB '*[^0-9]*'
        AND ltrim(expend_account, '0') <> ''
        THEN expend_bank
      WHEN memo GLOB '([0-9][0-9][0-9])*'
        AND length(memo) >= 13
        AND substr(memo, 6) NOT GLOB '*[^0-9]*'
        AND ltrim(substr(memo, 6), '0') <> ''
        THEN substr(memo, 2, 3)
    END AS bank_code,
    CASE
      WHEN amount < 0
        AND expend_bank GLOB '[0-9][0-9][0-9]'
        AND length(expend_account) >= 8
        AND expend_account NOT GLOB '*[^0-9]*'
        AND ltrim(expend_account, '0') <> ''
        THEN substr(expend_account, -5)
      WHEN memo GLOB '([0-9][0-9][0-9])*'
        AND length(memo) >= 13
        AND substr(memo, 6) NOT GLOB '*[^0-9]*'
        AND ltrim(substr(memo, 6), '0') <> ''
        THEN substr(memo, -5)
    END AS account_suffix
  FROM parsed
)
UPDATE bank_transactions
SET
  counterparty_bank_code = candidates.bank_code,
  counterparty_account_suffix = candidates.account_suffix
FROM candidates
WHERE candidates.id = bank_transactions.id
  AND candidates.bank_code IS NOT NULL;

-- 顯示名稱與 packages/core/src/taiwan-banks.ts 的簡稱一致；未知代碼顯示數字代碼。
UPDATE bank_transactions
SET counterparty = (
    CASE counterparty_bank_code
      WHEN '004' THEN '臺灣銀行'
      WHEN '005' THEN '土地銀行'
      WHEN '006' THEN '合作金庫'
      WHEN '007' THEN '第一銀行'
      WHEN '008' THEN '華南銀行'
      WHEN '009' THEN '彰化銀行'
      WHEN '011' THEN '上海商銀'
      WHEN '012' THEN '台北富邦'
      WHEN '013' THEN '國泰世華'
      WHEN '016' THEN '高雄銀行'
      WHEN '017' THEN '兆豐'
      WHEN '048' THEN '王道銀行'
      WHEN '050' THEN '台灣企銀'
      WHEN '052' THEN '渣打銀行'
      WHEN '053' THEN '台中銀行'
      WHEN '054' THEN '京城銀行'
      WHEN '081' THEN '匯豐銀行'
      WHEN '103' THEN '新光銀行'
      WHEN '108' THEN '陽信銀行'
      WHEN '700' THEN '中華郵政'
      WHEN '803' THEN '聯邦'
      WHEN '805' THEN '遠東商銀'
      WHEN '806' THEN '元大銀行'
      WHEN '807' THEN '永豐'
      WHEN '808' THEN '玉山'
      WHEN '809' THEN '凱基銀行'
      WHEN '810' THEN '星展'
      WHEN '812' THEN '台新'
      WHEN '816' THEN '安泰銀行'
      WHEN '822' THEN '中國信託'
      WHEN '823' THEN '將來銀行'
      WHEN '824' THEN '連線商業銀行'
      WHEN '826' THEN '樂天'
      ELSE counterparty_bank_code
    END
  ) || ' …' || counterparty_account_suffix
WHERE connector_id = 'cathaybk'
  AND counterparty IS NULL
  AND counterparty_bank_code IS NOT NULL
  AND counterparty_account_suffix IS NOT NULL;
