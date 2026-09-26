-- Stored-value top-ups into the user's own e-wallet are transfers: the e-wallet
-- purchases they fund are counted once through their e-invoices.
-- INSERT OR IGNORE keeps an existing row (including any user adjustment) intact.
-- The pattern must stay identical to STORED_VALUE_TOP_UP_PATTERN in
-- packages/core/src/activity-matching.ts.
INSERT OR IGNORE INTO classification_rules
  (id, category_id, target_type, field, operator, pattern, priority, enabled, is_system, source, description, excluded_from_calculation, created_at, updated_at) VALUES
  ('system:bank:ewallet-topup', 'transfer', 'bank_transaction', 'any_text', 'regex',
   '^(?!.*手續費).*(?:電支.{0,12}儲值|(?:街口|連加|一卡通|全支付|悠遊付|全盈|icash ?pay|line ?pay).{0,8}儲值)',
   107, 1, 1, 'system', '電子支付儲值（轉入自己的電子錢包）', 1,
   '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z');
