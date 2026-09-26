-- 使用者回饋「分類沒有捐款？」：新增系統分類「捐款」，排在「其他」之前。
INSERT INTO classification_categories
  (id, label, sort_order, is_system, parent_id, created_at, updated_at) VALUES
  ('donation', '捐款', 8, 1, NULL, '2026-09-27T00:00:00.000Z', '2026-09-27T00:00:00.000Z')
ON CONFLICT (id) DO UPDATE SET
  label = excluded.label,
  sort_order = excluded.sort_order,
  is_system = 1,
  parent_id = NULL,
  updated_at = excluded.updated_at;

UPDATE classification_categories
SET sort_order = 9, updated_at = '2026-09-27T00:00:00.000Z'
WHERE id = 'misc';

-- 已記住的慈善機構商家規則原本歸在「其他」，改為「捐款」；使用者改過的其他分類不動。
UPDATE merchant_aliases
SET category_id = 'donation', updated_at = '2026-09-27T00:00:00.000Z'
WHERE category_id = 'misc'
  AND (merchant_key LIKE '%基金會%' OR merchant_key LIKE '%捐款%'
    OR merchant_key LIKE '%慈濟%' OR merchant_key LIKE '%家扶%'
    OR merchant_key LIKE '%世界展望會%' OR merchant_key LIKE '%紅十字%'
    OR merchant_key LIKE '%donation%');
