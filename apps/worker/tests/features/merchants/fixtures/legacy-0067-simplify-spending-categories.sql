-- 分類簡化（2026-09 使用者回饋「分類太多太細，不知道選哪個」）：消費分類只剩 8 個頂層、
-- 沒有子類：food 餐飲、transport 交通、housing 居住、shopping 購物、tech 3C 數位、
-- entertainment 娛樂、health 醫療保險、misc 其他。收入子類（income.*）與 other（未分類）不變。
--
-- 對照（舊 → 新）：
--   food.*                         → food
--   transport.*                    → transport
--   housing.*                      → housing
--   shopping.*                     → shopping
--   tech.*（硬體、軟體與雲端）     → tech
--   lifestyle、lifestyle.subscriptions／entertainment／travel → entertainment
--   lifestyle.education            → misc（學習進修歸其他）
--   health.*                       → health
--   social、social.*（紅包、捐款）→ misc
--   fees、fees.*（稅金、手續費）   → misc
--   misc.*                         → misc
--   0055 以前的遺留 id（education、entertainment、software、fee、tax、insurance、utilities）
--   若仍被引用，也一併對照（entertainment 沿用為新 id）。
-- 涵蓋所有引用分類 id 的表：classification_overrides、classification_rules、merchant_aliases、
-- classification_migration_notes（new_category_id）。使用者自訂分類（user:*）不變。
-- 分類 id、名稱與順序須與 packages/core/src/categories.ts 一致。

PRAGMA defer_foreign_keys = ON;

CREATE TABLE _0067_category_map (
  old_id TEXT NOT NULL PRIMARY KEY,
  new_id TEXT NOT NULL
);

INSERT INTO _0067_category_map (old_id, new_id) VALUES
  ('food.dining', 'food'),
  ('food.drinks', 'food'),
  ('food.groceries', 'food'),
  ('transport.transit', 'transport'),
  ('transport.ride', 'transport'),
  ('transport.car', 'transport'),
  ('housing.rent', 'housing'),
  ('housing.utilities', 'housing'),
  ('housing.telecom', 'housing'),
  ('shopping.daily', 'shopping'),
  ('shopping.clothing', 'shopping'),
  ('shopping.online', 'shopping'),
  ('tech.hardware', 'tech'),
  ('tech.software', 'tech'),
  ('lifestyle', 'entertainment'),
  ('lifestyle.subscriptions', 'entertainment'),
  ('lifestyle.entertainment', 'entertainment'),
  ('lifestyle.travel', 'entertainment'),
  ('lifestyle.education', 'misc'),
  ('health.medical', 'health'),
  ('health.insurance', 'health'),
  ('social', 'misc'),
  ('social.gifts', 'misc'),
  ('social.donations', 'misc'),
  ('fees', 'misc'),
  ('fees.tax', 'misc'),
  ('fees.bank', 'misc'),
  ('misc.cash', 'misc'),
  ('education', 'misc'),
  ('software', 'tech'),
  ('fee', 'misc'),
  ('tax', 'misc'),
  ('insurance', 'health'),
  ('utilities', 'housing');

-- 自訂分類與新名稱（NOCASE 唯一）撞名時先加註，避免新增「娛樂」「醫療保險」失敗。
UPDATE classification_categories
SET label = label || '（自訂）', updated_at = '2026-09-27T00:00:00.000Z'
WHERE is_system = 0
  AND lower(label) IN ('娛樂', '醫療保險');

-- 舊的子類與頂層先改名，讓出「娛樂」等名稱；稍後刪除。
UPDATE classification_categories
SET label = label || ' #' || id
WHERE id IN (SELECT old_id FROM _0067_category_map);

INSERT INTO classification_categories
  (id, label, sort_order, is_system, parent_id, created_at, updated_at) VALUES
  ('food', '餐飲', 1, 1, NULL, '2026-09-27T00:00:00.000Z', '2026-09-27T00:00:00.000Z'),
  ('transport', '交通', 2, 1, NULL, '2026-09-27T00:00:00.000Z', '2026-09-27T00:00:00.000Z'),
  ('housing', '居住', 3, 1, NULL, '2026-09-27T00:00:00.000Z', '2026-09-27T00:00:00.000Z'),
  ('shopping', '購物', 4, 1, NULL, '2026-09-27T00:00:00.000Z', '2026-09-27T00:00:00.000Z'),
  ('tech', '3C 數位', 5, 1, NULL, '2026-09-27T00:00:00.000Z', '2026-09-27T00:00:00.000Z'),
  ('entertainment', '娛樂', 6, 1, NULL, '2026-09-27T00:00:00.000Z', '2026-09-27T00:00:00.000Z'),
  ('health', '醫療保險', 7, 1, NULL, '2026-09-27T00:00:00.000Z', '2026-09-27T00:00:00.000Z'),
  ('misc', '其他', 8, 1, NULL, '2026-09-27T00:00:00.000Z', '2026-09-27T00:00:00.000Z')
ON CONFLICT (id) DO UPDATE SET
  label = excluded.label,
  sort_order = excluded.sort_order,
  is_system = 1,
  parent_id = NULL,
  updated_at = excluded.updated_at;

UPDATE classification_overrides
SET category_id = (SELECT new_id FROM _0067_category_map WHERE old_id = category_id)
WHERE category_id IN (SELECT old_id FROM _0067_category_map);

UPDATE classification_rules
SET category_id = (SELECT new_id FROM _0067_category_map WHERE old_id = category_id)
WHERE category_id IN (SELECT old_id FROM _0067_category_map);

UPDATE merchant_aliases
SET category_id = (SELECT new_id FROM _0067_category_map WHERE old_id = category_id)
WHERE category_id IN (SELECT old_id FROM _0067_category_map);

UPDATE classification_migration_notes
SET new_category_id = (SELECT new_id FROM _0067_category_map WHERE old_id = new_category_id)
WHERE new_category_id IN (SELECT old_id FROM _0067_category_map);

-- 舊分類：先解除 parent 參照（子類指向將刪除的 lifestyle 等頂層），再刪除。
UPDATE classification_categories
SET parent_id = NULL
WHERE parent_id IN (SELECT old_id FROM _0067_category_map);

DELETE FROM classification_categories
WHERE id IN (SELECT old_id FROM _0067_category_map);

DROP TABLE _0067_category_map;
