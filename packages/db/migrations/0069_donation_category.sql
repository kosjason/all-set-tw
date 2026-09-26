-- 使用者回饋「分類沒有捐款？」：系統分類「捐款」（donation）排在「其他」之前。
-- 0067 已建立 donation 並把舊的 social.donations 對到它，這裡只是冪等的補齊：
-- 1. 與「捐款」撞名（NOCASE）的自訂分類先加註「（自訂）」並留下紀錄；
-- 2. 建立或更新 donation、把 misc 排到最後。
-- 不改動任何商家規則或覆寫：使用者刻意設為「其他」的商家（包括慈善機構）維持不變。

CREATE TABLE _0069_renamed_categories (
  id TEXT NOT NULL PRIMARY KEY,
  old_label TEXT NOT NULL,
  new_label TEXT NOT NULL
);

INSERT INTO _0069_renamed_categories (id, old_label, new_label)
SELECT category.id, category.label,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM classification_categories other
      WHERE other.label = category.label || '（自訂）' COLLATE NOCASE
    )
      THEN category.label || '（自訂 ' || category.id || '）'
    ELSE category.label || '（自訂）'
  END
FROM classification_categories category
WHERE category.is_system = 0
  AND category.id <> 'donation'
  AND category.label = '捐款' COLLATE NOCASE;

INSERT INTO classification_migration_notes
  (id, subject_type, subject_id, target_type, target_id, legacy_category_id, legacy_label,
   new_category_id, new_economic_role, needs_attention, created_at, new_label)
SELECT 'category:0069:' || id, 'category', id, NULL, NULL, id, old_label,
  id, NULL, 0, '2026-09-27T00:00:00.000Z', new_label
FROM _0069_renamed_categories
WHERE true
ON CONFLICT (id) DO NOTHING;

UPDATE classification_categories
SET label = (
    SELECT renamed.new_label FROM _0069_renamed_categories renamed
    WHERE renamed.id = classification_categories.id
  ),
  updated_at = '2026-09-27T00:00:00.000Z'
WHERE id IN (SELECT id FROM _0069_renamed_categories);

DROP TABLE _0069_renamed_categories;

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

