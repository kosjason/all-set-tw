-- 中信信用卡原本全部寫在單一 credit:ctbc:<幣別> 帳戶（例如 credit:ctbc:TWD）。
-- 新版改為每張有消費的實體卡一個帳戶 credit:ctbc:<末四碼>（外幣為
-- credit:ctbc:<末四碼>:<幣別>），合併帳單、應繳快照、繳款與無法歸卡的明細
-- 放在摘要帳戶 credit:ctbc:main（外幣為 credit:ctbc:main:<幣別>）。
--
-- 交易只改 account_id，保留 id 與 source_id，使用者的分類、排除計算、
-- 發票配對與經濟角色覆寫都以交易 id 參照，因此不受影響；之後同步以
-- (connector_id, account_id, source_id) upsert 到同一列。帳戶名稱與卡片清單
-- 由下次同步更新。

-- 1. 舊版未出帳明細的卡號為 `4444_0` 形式，未記錄 cardLast4；同一舊帳戶只
--    出現一張實體卡時，這些明細必屬該卡，先補上末四碼。
UPDATE bank_transactions
SET raw_payload = json_set(
  raw_payload,
  '$.cardLast4',
  (
    SELECT json_extract(other.raw_payload, '$.cardLast4')
    FROM bank_transactions other
    WHERE other.account_id = bank_transactions.account_id
      AND json_valid(other.raw_payload)
      AND json_extract(other.raw_payload, '$.cardLast4')
        GLOB '[0-9][0-9][0-9][0-9]'
      AND json_extract(other.raw_payload, '$.cardLast4') <> '0000'
    LIMIT 1
  )
)
WHERE connector_id = 'ctbc'
  AND account_id IN (
    SELECT id FROM bank_accounts
    WHERE connector_id = 'ctbc'
      AND account_type = 'credit'
      AND source_id GLOB 'credit:ctbc:[A-Z][A-Z][A-Z]'
  )
  AND json_valid(raw_payload)
  AND json_extract(raw_payload, '$.cardLast4') IS NULL
  AND (
    SELECT COUNT(DISTINCT json_extract(other.raw_payload, '$.cardLast4'))
    FROM bank_transactions other
    WHERE other.account_id = bank_transactions.account_id
      AND json_valid(other.raw_payload)
      AND json_extract(other.raw_payload, '$.cardLast4')
        GLOB '[0-9][0-9][0-9][0-9]'
      AND json_extract(other.raw_payload, '$.cardLast4') <> '0000'
  ) = 1;

-- 2. 每張有交易的實體卡建立帳戶；卡名取自舊帳戶 raw 的卡片清單（若有）。
WITH legacy AS (
  SELECT id, currency, created_at, updated_at,
    CASE WHEN json_valid(raw_payload) THEN raw_payload ELSE '{}' END AS raw
  FROM bank_accounts
  WHERE connector_id = 'ctbc'
    AND account_type = 'credit'
    AND source_id GLOB 'credit:ctbc:[A-Z][A-Z][A-Z]'
),
cards AS (
  SELECT DISTINCT
    legacy.id AS legacy_id,
    legacy.currency,
    legacy.raw,
    legacy.created_at,
    legacy.updated_at,
    json_extract(t.raw_payload, '$.cardLast4') AS last4
  FROM bank_transactions t
  JOIN legacy ON legacy.id = t.account_id
  WHERE json_valid(t.raw_payload)
    AND json_extract(t.raw_payload, '$.cardLast4') GLOB '[0-9][0-9][0-9][0-9]'
    AND json_extract(t.raw_payload, '$.cardLast4') <> '0000'
),
named AS (
  SELECT
    CASE currency
      WHEN 'TWD' THEN 'credit:ctbc:' || last4
      ELSE 'credit:ctbc:' || last4 || ':' || currency
    END AS source_id,
    last4,
    currency,
    created_at,
    updated_at,
    (
      SELECT json_extract(card.value, '$.cardName')
      FROM json_each(cards.raw, '$.cards') card
      WHERE json_extract(card.value, '$.cardLast4') = cards.last4
      LIMIT 1
    ) AS card_name,
    (
      SELECT json_extract(card.value, '$.positiveOrAttached')
      FROM json_each(cards.raw, '$.cards') card
      WHERE json_extract(card.value, '$.cardLast4') = cards.last4
      LIMIT 1
    ) AS positive_or_attached
  FROM cards
)
INSERT INTO bank_accounts (
  id, connector_id, source_id, institution_name, account_name, account_type,
  currency, raw_payload, created_at, updated_at
)
SELECT
  'ctbc:' || source_id,
  'ctbc',
  source_id,
  '中國信託商業銀行',
  COALESCE(card_name, '中國信託信用卡 ' || last4)
    || CASE currency WHEN 'TWD' THEN '' ELSE '（' || currency || '）' END,
  'credit',
  currency,
  json_object(
    'cardLast4', last4,
    'cardName', card_name,
    'positiveOrAttached', positive_or_attached
  ),
  created_at,
  updated_at
FROM named
WHERE true
ON CONFLICT (connector_id, source_id) DO NOTHING;

-- 3. 合併帳單摘要帳戶，保留舊帳戶的額度與卡片清單。
INSERT INTO bank_accounts (
  id, connector_id, source_id, institution_name, account_name, account_type,
  currency, credit_limit, raw_payload, created_at, updated_at
)
SELECT
  'ctbc:' || summary_source_id,
  'ctbc',
  summary_source_id,
  COALESCE(institution_name, '中國信託商業銀行'),
  CASE currency
    WHEN 'TWD' THEN '中國信託信用卡（合併帳單）'
    ELSE '中國信託信用卡（合併帳單，' || currency || '）'
  END,
  'credit',
  currency,
  credit_limit,
  json_object(
    'summary', json('true'),
    'cards', json(
      CASE
        WHEN json_valid(raw_payload)
          AND json_type(raw_payload, '$.cards') = 'array'
          THEN json_extract(raw_payload, '$.cards')
        ELSE '[]'
      END
    ),
    'migratedFrom', source_id
  ),
  created_at,
  updated_at
FROM (
  SELECT *,
    CASE currency
      WHEN 'TWD' THEN 'credit:ctbc:main'
      ELSE 'credit:ctbc:main:' || currency
    END AS summary_source_id
  FROM bank_accounts
  WHERE connector_id = 'ctbc'
    AND account_type = 'credit'
    AND source_id GLOB 'credit:ctbc:[A-Z][A-Z][A-Z]'
)
WHERE true
ON CONFLICT (connector_id, source_id) DO NOTHING;

-- 4. 交易依 raw 的卡片末四碼搬到實體卡帳戶；繳款（末四碼 0000）與無法歸卡者
--    搬到摘要帳戶。
UPDATE bank_transactions
SET account_id = COALESCE(
  (
    SELECT card.id
    FROM bank_accounts legacy
    JOIN bank_accounts card
      ON card.connector_id = 'ctbc'
     AND card.source_id = 'credit:ctbc:'
       || (
         CASE WHEN json_valid(bank_transactions.raw_payload)
           THEN json_extract(bank_transactions.raw_payload, '$.cardLast4')
         END
       )
       || CASE legacy.currency WHEN 'TWD' THEN '' ELSE ':' || legacy.currency END
    WHERE legacy.id = bank_transactions.account_id
      AND (
        CASE WHEN json_valid(bank_transactions.raw_payload)
          THEN json_extract(bank_transactions.raw_payload, '$.cardLast4')
        END
      ) <> '0000'
  ),
  (
    SELECT summary.id
    FROM bank_accounts legacy
    JOIN bank_accounts summary
      ON summary.connector_id = 'ctbc'
     AND summary.source_id = CASE legacy.currency
       WHEN 'TWD' THEN 'credit:ctbc:main'
       ELSE 'credit:ctbc:main:' || legacy.currency
     END
    WHERE legacy.id = bank_transactions.account_id
  )
)
WHERE connector_id = 'ctbc'
  AND account_id IN (
    SELECT id FROM bank_accounts
    WHERE connector_id = 'ctbc'
      AND account_type = 'credit'
      AND source_id GLOB 'credit:ctbc:[A-Z][A-Z][A-Z]'
  );

-- 5. 帳單與餘額快照是合併計算，搬到摘要帳戶並把 source_id 前綴換成摘要帳戶。
UPDATE credit_card_bills
SET
  source_id = (
    SELECT CASE
      WHEN substr(credit_card_bills.source_id, 1, length(legacy.source_id))
        = legacy.source_id
        THEN summary.source_id
          || substr(credit_card_bills.source_id, length(legacy.source_id) + 1)
      ELSE credit_card_bills.source_id
    END
    FROM bank_accounts legacy
    JOIN bank_accounts summary
      ON summary.connector_id = 'ctbc'
     AND summary.source_id = CASE legacy.currency
       WHEN 'TWD' THEN 'credit:ctbc:main'
       ELSE 'credit:ctbc:main:' || legacy.currency
     END
    WHERE legacy.id = credit_card_bills.account_id
  ),
  account_id = (
    SELECT summary.id
    FROM bank_accounts legacy
    JOIN bank_accounts summary
      ON summary.connector_id = 'ctbc'
     AND summary.source_id = CASE legacy.currency
       WHEN 'TWD' THEN 'credit:ctbc:main'
       ELSE 'credit:ctbc:main:' || legacy.currency
     END
    WHERE legacy.id = credit_card_bills.account_id
  )
WHERE connector_id = 'ctbc'
  AND account_id IN (
    SELECT id FROM bank_accounts
    WHERE connector_id = 'ctbc'
      AND account_type = 'credit'
      AND source_id GLOB 'credit:ctbc:[A-Z][A-Z][A-Z]'
  );

UPDATE bank_balance_snapshots
SET
  source_id = (
    SELECT CASE
      WHEN substr(bank_balance_snapshots.source_id, 1, length(legacy.source_id))
        = legacy.source_id
        THEN summary.source_id
          || substr(
            bank_balance_snapshots.source_id,
            length(legacy.source_id) + 1
          )
      ELSE bank_balance_snapshots.source_id
    END
    FROM bank_accounts legacy
    JOIN bank_accounts summary
      ON summary.connector_id = 'ctbc'
     AND summary.source_id = CASE legacy.currency
       WHEN 'TWD' THEN 'credit:ctbc:main'
       ELSE 'credit:ctbc:main:' || legacy.currency
     END
    WHERE legacy.id = bank_balance_snapshots.account_id
  ),
  account_id = (
    SELECT summary.id
    FROM bank_accounts legacy
    JOIN bank_accounts summary
      ON summary.connector_id = 'ctbc'
     AND summary.source_id = CASE legacy.currency
       WHEN 'TWD' THEN 'credit:ctbc:main'
       ELSE 'credit:ctbc:main:' || legacy.currency
     END
    WHERE legacy.id = bank_balance_snapshots.account_id
  )
WHERE connector_id = 'ctbc'
  AND account_id IN (
    SELECT id FROM bank_accounts
    WHERE connector_id = 'ctbc'
      AND account_type = 'credit'
      AND source_id GLOB 'credit:ctbc:[A-Z][A-Z][A-Z]'
  );

-- 6. 標記為舊帳戶重複來源的帳戶（canonical_account_id 指向舊帳戶，例如手動匯入的
--    同一張卡）改指同幣別的摘要帳戶，維持「重複來源不重複計算」；不可設為 NULL，
--    否則這些帳戶會重新出現並重複計入。之後移除已清空的舊帳戶；仍被參照者
--    （理論上不會發生）保留不動。
UPDATE bank_accounts
SET canonical_account_id = (
  SELECT summary.id
  FROM bank_accounts legacy
  JOIN bank_accounts summary
    ON summary.connector_id = 'ctbc'
   AND summary.source_id = CASE legacy.currency
     WHEN 'TWD' THEN 'credit:ctbc:main'
     ELSE 'credit:ctbc:main:' || legacy.currency
   END
  WHERE legacy.id = bank_accounts.canonical_account_id
)
WHERE canonical_account_id IN (
  SELECT id FROM bank_accounts
  WHERE connector_id = 'ctbc'
    AND account_type = 'credit'
    AND source_id GLOB 'credit:ctbc:[A-Z][A-Z][A-Z]'
);

-- 摘要帳戶本身不能指向自己（只有在摘要帳戶先前已存在且指向舊帳戶時才會發生）。
UPDATE bank_accounts
SET canonical_account_id = NULL
WHERE connector_id = 'ctbc'
  AND canonical_account_id = id;

DELETE FROM bank_accounts
WHERE connector_id = 'ctbc'
  AND account_type = 'credit'
  AND source_id GLOB 'credit:ctbc:[A-Z][A-Z][A-Z]'
  AND NOT EXISTS (
    SELECT 1 FROM bank_transactions t WHERE t.account_id = bank_accounts.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM credit_card_bills b WHERE b.account_id = bank_accounts.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM bank_balance_snapshots s WHERE s.account_id = bank_accounts.id
  );
