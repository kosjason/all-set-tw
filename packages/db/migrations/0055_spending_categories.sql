-- 新消費分類體系（兩層，只描述「錢花在哪」）。
-- 收入、轉帳、投資與繳卡費改由經濟角色表達：
-- - 舊分類 salary → income.salary（收入子類，推導為收入）。
-- - 舊分類 transfer、investment 不再是分類：個別覆寫改寫成 activity_role_overrides
--   （own_transfer／investment），使用者規則改成帶 economic_role 的規則。
-- - 其餘舊系統分類對應到新 id 後刪除。
-- - 使用者自訂分類（is_system = 0）一律保留 id、名稱與所有引用（覆寫、規則），
--   成為自訂消費分類；只有與新系統分類撞名（NOCASE）者加註「（自訂）」。
-- - 系統規則換成新版預設，但保留使用者的調整：停用（enabled）、優先序（priority）
--   與改過的 pattern 都保留；被拆分或移除的舊系統規則，停用狀態沿用到接替的新規則，
--   改過 pattern 者轉成使用者規則（user:legacy-*）。
-- 所有改變 id 的覆寫與使用者規則、改名的自訂分類、保留下來的自訂 pattern 都記錄在
-- classification_migration_notes（保留原名稱與原 pattern），可由
-- GET /api/classification/migration-notes 查看。
-- 分類 id 與名稱須與 packages/core/src/categories.ts 一致。

PRAGMA defer_foreign_keys = ON;

CREATE TABLE classification_migration_notes (
  id TEXT NOT NULL PRIMARY KEY,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('override', 'rule', 'category')),
  subject_id TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  legacy_category_id TEXT NOT NULL,
  legacy_label TEXT NOT NULL,
  new_category_id TEXT,
  new_economic_role TEXT CHECK (
    new_economic_role IS NULL
    OR new_economic_role IN ('spending', 'income', 'own_transfer', 'investment', 'card_payment')
  ),
  needs_attention INTEGER NOT NULL DEFAULT 0 CHECK (needs_attention IN (0, 1)),
  created_at TEXT NOT NULL,
  -- subject_type = 'category'：自訂分類因撞名改名後的名稱（legacy_label 為原名）。
  new_label TEXT,
  -- subject_type = 'rule'：保留下來的使用者 pattern 與（未套用的）新版預設 pattern。
  legacy_pattern TEXT,
  new_pattern TEXT
);

ALTER TABLE classification_categories
ADD COLUMN parent_id TEXT REFERENCES classification_categories (id);

CREATE TABLE _0055_categories (
  id TEXT NOT NULL PRIMARY KEY,
  label TEXT NOT NULL,
  parent_id TEXT,
  sort_order INTEGER NOT NULL
);

INSERT INTO _0055_categories (id, label, parent_id, sort_order) VALUES
  ('food', '餐飲', NULL, 1),
  ('food.dining', '外食', 'food', 2),
  ('food.drinks', '咖啡飲料', 'food', 3),
  ('food.groceries', '超市雜貨', 'food', 4),
  ('transport', '交通', NULL, 5),
  ('transport.transit', '大眾運輸', 'transport', 6),
  ('transport.ride', '叫車計程車', 'transport', 7),
  ('transport.car', '油資停車', 'transport', 8),
  ('housing', '居住', NULL, 9),
  ('housing.rent', '房租房貸', 'housing', 10),
  ('housing.utilities', '水電瓦斯', 'housing', 11),
  ('housing.telecom', '電信網路', 'housing', 12),
  ('shopping', '購物', NULL, 13),
  ('shopping.daily', '日用品', 'shopping', 14),
  ('shopping.clothing', '服飾', 'shopping', 15),
  ('shopping.online', '網購', 'shopping', 16),
  ('tech', '3C 數位', NULL, 17),
  ('tech.hardware', '3C 硬體', 'tech', 18),
  ('tech.software', '軟體與雲端', 'tech', 19),
  ('lifestyle', '生活娛樂', NULL, 20),
  ('lifestyle.subscriptions', '訂閱服務', 'lifestyle', 21),
  ('lifestyle.entertainment', '娛樂', 'lifestyle', 22),
  ('lifestyle.travel', '旅遊', 'lifestyle', 23),
  ('lifestyle.education', '學習進修', 'lifestyle', 24),
  ('health', '健康保險', NULL, 25),
  ('health.medical', '醫療', 'health', 26),
  ('health.insurance', '保險', 'health', 27),
  ('fees', '稅費手續費', NULL, 28),
  ('fees.tax', '稅金', 'fees', 29),
  ('fees.bank', '手續費', 'fees', 30),
  ('social', '人情', NULL, 31),
  ('social.gifts', '紅包禮金', 'social', 32),
  ('social.donations', '捐款', 'social', 33),
  ('misc', '其他', NULL, 34),
  ('income', '收入', NULL, 100),
  ('income.salary', '薪資', 'income', 101),
  ('income.investment', '股利利息', 'income', 102),
  ('income.other', '其他收入', 'income', 103);

-- 舊分類 → 新分類／角色。new_category_id 與 new_role 皆可為 NULL 之一。
CREATE TABLE _0055_category_map (
  legacy_id TEXT NOT NULL PRIMARY KEY,
  legacy_label TEXT NOT NULL,
  new_category_id TEXT,
  new_role TEXT,
  needs_attention INTEGER NOT NULL DEFAULT 0
);

WITH system_map (legacy_id, new_category_id, new_role) AS (
  VALUES
    ('salary',        'income.salary',           NULL),
    ('transfer',      NULL,                      'own_transfer'),
    ('investment',    NULL,                      'investment'),
    ('food',          'food',                    NULL),
    ('transport',     'transport',               NULL),
    ('shopping',      'shopping',                NULL),
    ('housing',       'housing',                 NULL),
    ('health',        'health.medical',          NULL),
    ('education',     'lifestyle.education',     NULL),
    ('entertainment', 'lifestyle.entertainment', NULL),
    ('fee',           'fees.bank',               NULL),
    ('insurance',     'health.insurance',        NULL),
    ('tax',           'fees.tax',                NULL),
    ('software',      'tech.software',           NULL),
    ('utilities',     'housing',                 NULL),
    ('other-income',  'income.other',            NULL)
)
INSERT INTO _0055_category_map (legacy_id, legacy_label, new_category_id, new_role)
SELECT category.id, category.label, system_map.new_category_id, system_map.new_role
FROM classification_categories category
JOIN system_map ON system_map.legacy_id = category.id;

-- 其他未知的舊系統分類（理論上不存在）歸入「其他」並標記待處理。
INSERT INTO _0055_category_map (legacy_id, legacy_label, new_category_id, new_role, needs_attention)
SELECT category.id, category.label, 'misc', NULL, 1
FROM classification_categories category
WHERE category.is_system = 1
  AND category.id <> 'other'
  AND category.id NOT IN (SELECT legacy_id FROM _0055_category_map)
  AND category.id NOT IN (SELECT id FROM _0055_categories);

-- 舊系統規則的快照（含分類名稱），用來保留使用者對系統規則的調整。
CREATE TABLE _0055_old_system_rules AS
SELECT rule.id, rule.category_id, category.label AS category_label, rule.target_type,
  rule.field, rule.operator, rule.pattern, rule.priority, rule.enabled, rule.description,
  rule.excluded_from_calculation
FROM classification_rules rule
LEFT JOIN classification_categories category ON category.id = rule.category_id
WHERE rule.is_system = 1;

-- 自訂分類與新系統分類撞名時加註「（自訂）」（加註後仍撞名則再附 id），並留下紀錄。
CREATE TABLE _0055_renamed_categories (
  id TEXT NOT NULL PRIMARY KEY,
  old_label TEXT NOT NULL,
  new_label TEXT NOT NULL
);

INSERT INTO _0055_renamed_categories (id, old_label, new_label)
SELECT category.id, category.label,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM classification_categories other
      WHERE other.label = category.label || '（自訂）' COLLATE NOCASE
    ) OR EXISTS (
      SELECT 1 FROM _0055_categories candidate
      WHERE candidate.label = category.label || '（自訂）' COLLATE NOCASE
    )
      THEN category.label || '（自訂 ' || category.id || '）'
    ELSE category.label || '（自訂）'
  END
FROM classification_categories category
WHERE category.is_system = 0
  AND EXISTS (
    SELECT 1 FROM _0055_categories candidate
    WHERE candidate.label = category.label COLLATE NOCASE
  );

INSERT INTO classification_migration_notes
  (id, subject_type, subject_id, target_type, target_id, legacy_category_id, legacy_label,
   new_category_id, new_economic_role, needs_attention, created_at, new_label)
SELECT 'category:0055:' || id, 'category', id, NULL, NULL, id, old_label,
  id, NULL, 0, '2026-09-26T00:00:00.000Z', new_label
FROM _0055_renamed_categories;

UPDATE classification_categories
SET label = (
    SELECT renamed.new_label FROM _0055_renamed_categories renamed
    WHERE renamed.id = classification_categories.id
  ),
  updated_at = '2026-09-26T00:00:00.000Z'
WHERE id IN (SELECT id FROM _0055_renamed_categories);

DROP TABLE _0055_renamed_categories;

-- 暫時改名舊系統分類，避免與新分類名稱（NOCASE 唯一）衝突；稍後刪除或以新名稱覆寫。
UPDATE classification_categories
SET label = label || ' #' || id
WHERE id <> 'other' AND is_system = 1;

INSERT INTO classification_categories
  (id, label, sort_order, is_system, parent_id, created_at, updated_at)
SELECT id, label, sort_order, 1, parent_id, '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z'
FROM _0055_categories
WHERE true
ON CONFLICT (id) DO UPDATE SET
  label = excluded.label,
  sort_order = excluded.sort_order,
  is_system = 1,
  parent_id = excluded.parent_id,
  updated_at = excluded.updated_at;

UPDATE classification_categories
SET label = '未分類', sort_order = 200, parent_id = NULL, updated_at = '2026-09-26T00:00:00.000Z'
WHERE id = 'other';

-- 個別覆寫
INSERT INTO classification_migration_notes
  (id, subject_type, subject_id, target_type, target_id, legacy_category_id, legacy_label,
   new_category_id, new_economic_role, needs_attention, created_at)
SELECT 'override:' || override.id, 'override', override.id, override.target_type, override.target_id,
  map.legacy_id, map.legacy_label, map.new_category_id, map.new_role, map.needs_attention,
  '2026-09-26T00:00:00.000Z'
FROM classification_overrides override
JOIN _0055_category_map map ON map.legacy_id = override.category_id
WHERE map.new_category_id IS NOT map.legacy_id OR map.new_role IS NOT NULL;

INSERT INTO activity_role_overrides
  (target_kind, target_id, economic_role, review_status, created_at, updated_at)
SELECT override.target_type, override.target_id, map.new_role, 'confirmed',
  override.created_at, override.updated_at
FROM classification_overrides override
JOIN _0055_category_map map ON map.legacy_id = override.category_id
WHERE map.new_role IS NOT NULL
  AND override.target_type IN ('bank_transaction', 'invoice')
ON CONFLICT (target_kind, target_id) DO NOTHING;

DELETE FROM classification_overrides
WHERE category_id IN (
  SELECT legacy_id FROM _0055_category_map WHERE new_category_id IS NULL
);

UPDATE classification_overrides
SET category_id = (
    SELECT map.new_category_id FROM _0055_category_map map
    WHERE map.legacy_id = classification_overrides.category_id
  ),
  updated_at = '2026-09-26T00:00:00.000Z'
WHERE category_id IN (
  SELECT legacy_id FROM _0055_category_map
  WHERE new_category_id IS NOT NULL AND new_category_id <> legacy_id
);

-- 規則：分類可為 NULL（只指定角色，或只作為轉帳提示），新增 economic_role 與金額方向。
INSERT INTO classification_migration_notes
  (id, subject_type, subject_id, target_type, target_id, legacy_category_id, legacy_label,
   new_category_id, new_economic_role, needs_attention, created_at)
SELECT 'rule:' || rule.id, 'rule', rule.id, rule.target_type, NULL,
  map.legacy_id, map.legacy_label, map.new_category_id, map.new_role, map.needs_attention,
  '2026-09-26T00:00:00.000Z'
FROM classification_rules rule
JOIN _0055_category_map map ON map.legacy_id = rule.category_id
WHERE rule.is_system = 0
  AND (map.new_category_id IS NOT map.legacy_id OR map.new_role IS NOT NULL);

CREATE TABLE classification_rules_new (
  id TEXT NOT NULL PRIMARY KEY,
  category_id TEXT REFERENCES classification_categories (id),
  economic_role TEXT CHECK (
    economic_role IS NULL
    OR economic_role IN ('spending', 'income', 'own_transfer', 'investment', 'card_payment')
  ),
  target_type TEXT,
  field TEXT NOT NULL,
  operator TEXT NOT NULL,
  pattern TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  enabled INTEGER NOT NULL DEFAULT 1,
  is_system INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'user',
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  excluded_from_calculation INTEGER NOT NULL DEFAULT 0 CHECK (excluded_from_calculation IN (0, 1)),
  amount_direction TEXT NOT NULL DEFAULT 'any' CHECK (amount_direction IN ('any', 'inflow', 'outflow'))
);

INSERT INTO classification_rules_new
  (id, category_id, economic_role, target_type, field, operator, pattern, priority, enabled,
   is_system, source, description, created_at, updated_at, excluded_from_calculation, amount_direction)
SELECT rule.id,
  CASE WHEN map.legacy_id IS NULL THEN rule.category_id ELSE map.new_category_id END,
  map.new_role,
  rule.target_type, rule.field, rule.operator, rule.pattern, rule.priority, rule.enabled,
  rule.is_system, rule.source, rule.description, rule.created_at, rule.updated_at,
  rule.excluded_from_calculation, 'any'
FROM classification_rules rule
LEFT JOIN _0055_category_map map ON map.legacy_id = rule.category_id
WHERE rule.is_system = 0;

DROP TABLE classification_rules;

ALTER TABLE classification_rules_new RENAME TO classification_rules;

CREATE INDEX idx_classification_rules_category
  ON classification_rules (category_id);

CREATE INDEX idx_classification_rules_enabled_priority
  ON classification_rules (enabled, target_type, priority);

-- 只刪除不再使用的舊系統分類；自訂分類保留。
DELETE FROM classification_categories
WHERE id <> 'other'
  AND is_system = 1
  AND id NOT IN (SELECT id FROM _0055_categories);

-- 系統規則：角色規則保留原 id（程式以 id 辨識繳卡費、電支儲值與轉帳提示）；
-- 分類規則改對應新分類，shared 規則同時適用於發票賣方名稱。
-- system:bank:ewallet-topup 的 pattern 須與 core 的 STORED_VALUE_TOP_UP_PATTERN 相同。
INSERT INTO classification_rules
  (id, category_id, economic_role, target_type, field, operator, pattern, priority, enabled,
   is_system, source, description, created_at, updated_at, excluded_from_calculation, amount_direction) VALUES
  ('system:bank:salary-keywords', 'income.salary', NULL, 'bank_transaction', 'any_text', 'regex',
   '薪|salary|payroll|工資|獎金|bonus',
   110, 1, 1, 'system', '薪資相關關鍵字（僅流入）', '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z', 0, 'inflow'),
  ('system:bank:investment-income-keywords', 'income.investment', NULL, 'bank_transaction', 'description', 'regex',
   '^(?!.*(?:退刷|退款|退貨|折抵|利息調整|利息退還|貸款|借款|融資|循環利息|手續費)).*(?:^利息$|利息存入|存款利息|活存利息|定存利息|股息|股利|配息|^interest$|\binterest\s+(?:credit|income)\b|\bdividends?\b)',
   109, 1, 1, 'system', '正金額的利息與股利', '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z', 0, 'inflow'),
  ('system:bank:other-income-keywords', 'income.other', NULL, 'bank_transaction', 'description', 'regex',
   '^(?!.*(?:退刷|退款|退貨|折抵|貸款|借款|融資|手續費)).*(?:現金回饋|回饋金|現金回存|租金補貼|租屋補助|育兒津貼|生育補助|政府補助|稿費|稿酬|接案收入|退稅|\bcashback\b)',
   108, 1, 1, 'system', '正金額的補助、稿費、退稅與現金回饋', '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z', 0, 'inflow'),
  ('system:bank:software-keywords', 'tech.software', NULL, 'bank_transaction', 'description', 'regex',
   '^(?!.*(?:手續費|交易服務費|\bforeign\s+transaction\s+fee\b)).*(?:\b(?:openai|cursor|cloudflare)(?:\b|o[0-9])|\bchatgpt\b|\banthropic\b|\bclaude(?:\.ai|\s+(?:pro|max|subscription))\b|\bgoogle\s*[* ]\s*(?:cloud|one|workspace)\b|\b(?:github|jetbrains|adobe|notion|dropbox)(?:\b|o[0-9])|\b(?:microsoft|office)\s*365\b|\bicloud\b|\baws\b|amazon\s+web\s+services|\bgodaddy\b|\bnamecheap\b|\bgandi\b|\bdigitalocean\b|\blinode\b|\bvercel\b|\bheroku\b)',
   108, 1, 1, 'system', '軟體、AI 訂閱與雲端服務', '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z', 0, 'any'),
  ('system:bank:streaming-keywords', 'lifestyle.subscriptions', NULL, 'bank_transaction', 'description', 'regex',
   '^(?!.*(?:手續費|交易服務費)).*(?:\bnetflix\b|\bspotify\b|\bkkbox\b|disney\s*\+|\byoutube\s*premium\b|friday影音|\blinetv\b)',
   108, 1, 1, 'system', '影音串流訂閱', '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z', 0, 'any'),
  ('system:bank:utilities-keywords', 'housing.utilities', NULL, 'bank_transaction', 'description', 'regex',
   '^(?!.*(?:手續費|交易服務費|購機|手機|設備|門市|商城|購物)).*(?:台灣電力|台灣自來水|臺北自來水|台北自來水|台電|台水|水費|電費|瓦斯費|天然氣費)',
   108, 1, 1, 'system', '水、電與瓦斯費用', '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z', 0, 'any'),
  ('system:bank:telecom-keywords', 'housing.telecom', NULL, 'bank_transaction', 'description', 'regex',
   '^(?!.*(?:手續費|交易服務費|購機|手機|設備|門市|商城|購物)).*(?:中華電信|遠傳電信|台灣大哥大|台灣之星|亞太電信|電信費|電話費|網路費|寬頻費|\bhinet\b)',
   108, 1, 1, 'system', '電信、電話與網路費用', '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z', 0, 'any'),
  ('system:bank:ewallet-topup', NULL, 'own_transfer', 'bank_transaction', 'any_text', 'regex',
   '^(?!.*手續費).*(?:電支.{0,12}儲值|(?:街口|連加|一卡通|全支付|悠遊付|全盈|icash ?pay|line ?pay).{0,8}儲值)',
   107, 1, 1, 'system', '電子支付儲值（轉入自己的電子錢包）', '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z', 1, 'any'),
  ('system:bank:creditcard-payment', NULL, 'card_payment', 'bank_transaction', 'any_text', 'regex',
   '信用卡.*繳|信用卡款|繳卡費|credit.?card.*(pay|bill|repay)',
   106, 1, 1, 'system', '信用卡繳費', '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z', 1, 'any'),
  ('system:bank:transfer-keywords', NULL, NULL, 'bank_transaction', 'any_text', 'regex',
   '轉帳|轉入|轉出|匯款|transfer|remit|atm|跨行',
   105, 1, 1, 'system', '轉帳提示：無法確認對方時標示待確認', '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z', 0, 'any'),
  ('system:shared:drinks-keywords', 'food.drinks', NULL, NULL, 'any_text', 'regex',
   '咖啡|飲料|茶飲|手搖|cafe|coffee|starbucks|星巴克|路易莎|louisa',
   101, 1, 1, 'system', '咖啡與飲料', '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z', 0, 'any'),
  ('system:shared:dining-keywords', 'food.dining', NULL, NULL, 'any_text', 'regex',
   '餐|飯(?!店)|小吃|麵店|麵館|牛肉麵|拉麵|便當|火鍋|早餐|food|restaurant|mcdonald|麥當勞|uber\s*eats|foodpanda',
   100, 1, 1, 'system', '外食', '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z', 0, 'any'),
  ('system:bank:investment-keywords', NULL, 'investment', 'bank_transaction', 'any_text', 'regex',
   '投資|證券|股票|基金|\betf\b|broker|tdcc|交割',
   100, 1, 1, 'system', '投資相關關鍵字', '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z', 0, 'any'),
  ('system:shared:transit-keywords', 'transport.transit', NULL, NULL, 'any_text', 'regex',
   '捷運|高鐵|台鐵|臺鐵|客運|悠遊卡|metro|rail|thsr',
   100, 1, 1, 'system', '大眾運輸', '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z', 0, 'any'),
  ('system:shared:ride-keywords', 'transport.ride', NULL, NULL, 'any_text', 'regex',
   '計程車|大車隊|taxi|uber(?!\s*\*?\s*eats)',
   100, 1, 1, 'system', '叫車與計程車', '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z', 0, 'any'),
  ('system:shared:car-keywords', 'transport.car', NULL, NULL, 'any_text', 'regex',
   '加油|中油|台塑石油|停車|parking|fuel|etag',
   100, 1, 1, 'system', '油資與停車', '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z', 0, 'any'),
  ('system:shared:transport-keywords', 'transport', NULL, NULL, 'any_text', 'regex',
   '交通|transport',
   99, 1, 1, 'system', '其他交通', '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z', 0, 'any'),
  ('system:shared:tax-keywords', 'fees.tax', NULL, NULL, 'any_text', 'regex',
   '稅費|稅款|國稅|稅務局|牌照稅|燃料稅|所得稅|地價稅|房屋稅',
   96, 1, 1, 'system', '稅金', '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z', 0, 'outflow'),
  ('system:shared:insurance-keywords', 'health.insurance', NULL, NULL, 'any_text', 'regex',
   '健保|勞保|保費|保險|人壽|insurance',
   95, 1, 1, 'system', '保險', '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z', 0, 'any'),
  ('system:shared:medical-keywords', 'health.medical', NULL, NULL, 'any_text', 'regex',
   '醫院|診所|牙醫|牙科|藥局|醫療',
   95, 1, 1, 'system', '醫療', '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z', 0, 'any'),
  ('system:shared:housing-keywords', 'housing.rent', NULL, NULL, 'any_text', 'regex',
   '房租|租金|房貸|管理費',
   95, 1, 1, 'system', '房租、房貸與管理費', '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z', 0, 'any'),
  ('system:shared:grocery-keywords', 'food.groceries', NULL, NULL, 'any_text', 'regex',
   '全聯|家樂福|carrefour|好市多|costco|美廉社|超市|market',
   91, 1, 1, 'system', '超市與量販', '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z', 0, 'any'),
  ('system:shared:convenience-keywords', 'food', NULL, NULL, 'any_text', 'regex',
   '超商|7-?eleven|seven|familymart|全家|萊爾富|hi-?life',
   91, 1, 1, 'system', '便利商店（品項可再細分）', '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z', 0, 'any'),
  ('system:shared:electronics-keywords', 'tech.hardware', NULL, NULL, 'any_text', 'regex',
   '燦坤|全國電子|三創|順發3c|apple\s*store|studio\s*a',
   91, 1, 1, 'system', '3C 與家電賣場', '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z', 0, 'any'),
  ('system:shared:online-shopping-keywords', 'shopping.online', NULL, NULL, 'any_text', 'regex',
   'momo|pchome|蝦皮|shopee|酷澎|coupang',
   91, 1, 1, 'system', '網路購物', '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z', 0, 'any'),
  ('system:shared:fee-keywords', 'fees.bank', NULL, NULL, 'any_text', 'regex',
   '手續|年費|fee|charge|利息|interest',
   90, 1, 1, 'system', '手續費與利息支出', '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z', 0, 'any'),
  ('system:shared:shopping-keywords', 'shopping', NULL, NULL, 'any_text', 'regex',
   '購物|商店|百貨|store|shop',
   90, 1, 1, 'system', '其他購物', '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z', 0, 'any');

-- 保留使用者對系統規則的調整（0049、0050 的「使用者改過的不覆寫」在此維持）。
-- _0055_rule_defaults：0055 以前各系統規則曾出現過的上游預設 pattern 與 priority；
-- 舊值不在其中者視為使用者改過。
CREATE TABLE _0055_rule_defaults (
  id TEXT NOT NULL,
  pattern TEXT NOT NULL,
  priority INTEGER NOT NULL
);

INSERT INTO _0055_rule_defaults (id, pattern, priority) VALUES
  ('system:bank:creditcard-payment',
   '信用卡.*繳|信用卡款|繳卡費|credit.?card.*(pay|bill|repay)', 106),
  ('system:bank:creditcard-payment',
   '信用卡.*繳|繳卡費|credit.?card.*(pay|bill|repay)', 106),
  ('system:bank:ewallet-topup',
   '^(?!.*手續費).*(?:電支.{0,12}儲值|(?:街口|連加|一卡通|全支付|悠遊付|全盈|icash ?pay|line ?pay).{0,8}儲值)', 107),
  ('system:bank:food-keywords',
   '餐|飯|咖啡|飲|food|restaurant|cafe|mcdonald|starbucks|ubereats|foodpanda', 100),
  ('system:bank:investment-keywords',
   '投資|證券|股票|基金|etf|broker|tdcc|交割', 100),
  ('system:bank:other-income-keywords',
   '^(?!.*(?:退刷|退款|退貨|折抵|利息調整|利息退還|貸款|借款|融資|循環利息|手續費)).*(?:^利息$|利息存入|存款利息|活存利息|定存利息|股息|股利|配息|現金回饋|回饋金|現金回存|租金補貼|租屋補助|育兒津貼|生育補助|政府補助|稿費|稿酬|接案收入|退稅|^interest$|\binterest\s+(?:credit|income)\b|\bdividends?\b|\bcashback\b)', 108),
  ('system:bank:salary-keywords',
   '薪|salary|payroll|工資|獎金|bonus', 110),
  ('system:bank:shopping-keywords',
   '購物|商店|百貨|超商|market|store|shop|momo|pchome|costco|全聯|統一|seven|family', 90),
  ('system:bank:software-keywords',
   '^(?!.*(?:手續費|交易服務費|\bforeign\s+transaction\s+fee\b)).*(?:\b(?:openai|cursor|cloudflare)(?:\b|o[0-9])|\bchatgpt\b|\banthropic\b|\bclaude(?:\.ai|\s+(?:pro|max|subscription))\b|\bgoogle\s*[* ]\s*(?:cloud|one|workspace)\b|\b(?:github|jetbrains|adobe|notion|dropbox)(?:\b|o[0-9])|\b(?:microsoft|office)\s*365\b|\bicloud\b)', 108),
  ('system:bank:transfer-keywords',
   '轉帳|轉入|轉出|匯款|transfer|remit|atm|跨行', 105),
  ('system:bank:utilities-keywords',
   '^(?!.*(?:手續費|交易服務費|購機|手機|設備|門市|商城|購物)).*(?:中華電信|遠傳電信|台灣大哥大|台灣之星|亞太電信|台灣電力|台灣自來水|臺北自來水|台北自來水|台電|台水|水費|電費|瓦斯費|天然氣費|電信費|電話費|網路費|寬頻費|\bhinet\b)', 108),
  ('system:shared:fee-keywords',
   '手續|管理費|利息|fee|charge|interest', 90),
  ('system:shared:insurance-keywords',
   '健保|勞保|保費|保險|insurance', 95),
  ('system:shared:transport-keywords',
   '交通|捷運|高鐵|台鐵|加油|停車|uber|taxi|metro|rail|parking|fuel', 100);

-- 舊系統規則被拆分或移除時，接替它的新系統規則（同 id 者自動視為接替）。
CREATE TABLE _0055_rule_successors (
  old_id TEXT NOT NULL,
  new_id TEXT NOT NULL
);

INSERT INTO _0055_rule_successors (old_id, new_id) VALUES
  ('system:bank:food-keywords', 'system:shared:drinks-keywords'),
  ('system:bank:food-keywords', 'system:shared:dining-keywords'),
  ('system:bank:shopping-keywords', 'system:shared:shopping-keywords'),
  ('system:bank:shopping-keywords', 'system:shared:grocery-keywords'),
  ('system:bank:shopping-keywords', 'system:shared:convenience-keywords'),
  ('system:bank:shopping-keywords', 'system:shared:online-shopping-keywords'),
  ('system:shared:transport-keywords', 'system:shared:transit-keywords'),
  ('system:shared:transport-keywords', 'system:shared:ride-keywords'),
  ('system:shared:transport-keywords', 'system:shared:car-keywords'),
  ('system:bank:utilities-keywords', 'system:bank:telecom-keywords'),
  ('system:bank:other-income-keywords', 'system:bank:investment-income-keywords');

INSERT INTO _0055_rule_successors (old_id, new_id)
SELECT old.id, old.id
FROM _0055_old_system_rules old
WHERE old.id IN (SELECT id FROM classification_rules WHERE is_system = 1);

-- 停用：使用者停用的舊系統規則，其接替規則也停用。
UPDATE classification_rules
SET enabled = 0
WHERE is_system = 1
  AND id IN (
    SELECT successor.new_id
    FROM _0055_rule_successors successor
    JOIN _0055_old_system_rules old ON old.id = successor.old_id
    WHERE old.enabled = 0
  );

-- 優先序：同 id 且與上游預設不同者保留使用者的值。
UPDATE classification_rules
SET priority = (
  SELECT old.priority FROM _0055_old_system_rules old
  WHERE old.id = classification_rules.id
)
WHERE is_system = 1
  AND id IN (
    SELECT old.id FROM _0055_old_system_rules old
    WHERE NOT EXISTS (
      SELECT 1 FROM _0055_rule_defaults d
      WHERE d.id = old.id AND d.priority = old.priority
    )
  );

-- 被拆分或移除的舊規則只改了優先序（pattern 仍是上游預設）時，使用者的優先序沿用到
-- 所有接替規則（同 id 者已在上面處理）。pattern 被改過者轉成使用者規則並帶原優先序，
-- 接替規則維持新版預設。
UPDATE classification_rules
SET priority = (
  SELECT old.priority
  FROM _0055_rule_successors successor
  JOIN _0055_old_system_rules old ON old.id = successor.old_id
  WHERE successor.new_id = classification_rules.id
    AND successor.old_id <> successor.new_id
)
WHERE is_system = 1
  AND id IN (
    SELECT successor.new_id
    FROM _0055_rule_successors successor
    JOIN _0055_old_system_rules old ON old.id = successor.old_id
    WHERE successor.old_id <> successor.new_id
      AND EXISTS (
        SELECT 1 FROM _0055_rule_defaults d
        WHERE d.id = old.id AND d.pattern = old.pattern
      )
      AND NOT EXISTS (
        SELECT 1 FROM _0055_rule_defaults d
        WHERE d.id = old.id AND d.priority = old.priority
      )
  );

-- pattern：同 id 且使用者改過者保留使用者的 pattern（連同 field／operator），
-- 並記錄未套用的新版預設，使用者可自行決定是否改用。
CREATE TABLE _0055_custom_patterns AS
SELECT old.id, old.category_id, old.category_label, old.target_type, old.field,
  old.operator, old.pattern, old.priority, old.enabled, old.description,
  old.excluded_from_calculation
FROM _0055_old_system_rules old
WHERE NOT EXISTS (
  SELECT 1 FROM _0055_rule_defaults d
  WHERE d.id = old.id AND d.pattern = old.pattern
);

INSERT INTO classification_migration_notes
  (id, subject_type, subject_id, target_type, target_id, legacy_category_id, legacy_label,
   new_category_id, new_economic_role, needs_attention, created_at, legacy_pattern, new_pattern)
SELECT 'rule-pattern:' || custom.id, 'rule', custom.id, custom.target_type, NULL,
  custom.category_id, COALESCE(custom.category_label, custom.category_id),
  rule.category_id, rule.economic_role, 0, '2026-09-26T00:00:00.000Z',
  custom.pattern, rule.pattern
FROM _0055_custom_patterns custom
JOIN classification_rules rule ON rule.id = custom.id AND rule.is_system = 1
WHERE rule.pattern IS NOT custom.pattern
   OR rule.field IS NOT custom.field
   OR rule.operator IS NOT custom.operator;

UPDATE classification_rules
SET
  field = (SELECT custom.field FROM _0055_custom_patterns custom WHERE custom.id = classification_rules.id),
  operator = (SELECT custom.operator FROM _0055_custom_patterns custom WHERE custom.id = classification_rules.id),
  pattern = (SELECT custom.pattern FROM _0055_custom_patterns custom WHERE custom.id = classification_rules.id)
WHERE is_system = 1
  AND id IN (SELECT id FROM _0055_custom_patterns);

-- 被移除的舊系統規則（例如 system:bank:food-keywords）若 pattern 被使用者改過，
-- 轉成使用者規則 user:legacy-<舊 id 去掉 system: 前綴>，分類依舊分類對照。
INSERT INTO classification_rules
  (id, category_id, economic_role, target_type, field, operator, pattern, priority, enabled,
   is_system, source, description, created_at, updated_at, excluded_from_calculation, amount_direction)
SELECT 'user:legacy-' || substr(custom.id, 8),
  CASE WHEN map.legacy_id IS NULL THEN custom.category_id ELSE map.new_category_id END,
  map.new_role,
  custom.target_type, custom.field, custom.operator, custom.pattern, custom.priority,
  custom.enabled, 0, 'user', custom.description, '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z',
  custom.excluded_from_calculation, 'any'
FROM _0055_custom_patterns custom
LEFT JOIN _0055_category_map map ON map.legacy_id = custom.category_id
WHERE custom.id NOT IN (SELECT id FROM classification_rules WHERE is_system = 1);

INSERT INTO classification_migration_notes
  (id, subject_type, subject_id, target_type, target_id, legacy_category_id, legacy_label,
   new_category_id, new_economic_role, needs_attention, created_at, legacy_pattern, new_pattern)
SELECT 'rule-pattern:' || custom.id, 'rule', 'user:legacy-' || substr(custom.id, 8),
  custom.target_type, NULL, custom.category_id,
  COALESCE(custom.category_label, custom.category_id),
  CASE WHEN map.legacy_id IS NULL THEN custom.category_id ELSE map.new_category_id END,
  map.new_role, 0, '2026-09-26T00:00:00.000Z', custom.pattern, NULL
FROM _0055_custom_patterns custom
LEFT JOIN _0055_category_map map ON map.legacy_id = custom.category_id
WHERE custom.id NOT IN (SELECT id FROM classification_rules WHERE is_system = 1);

DROP TABLE _0055_custom_patterns;
DROP TABLE _0055_rule_successors;
DROP TABLE _0055_rule_defaults;
DROP TABLE _0055_old_system_rules;

DROP TABLE _0055_category_map;
DROP TABLE _0055_categories;
