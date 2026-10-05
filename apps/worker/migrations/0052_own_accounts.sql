-- 使用者宣告、但無法同步的自有帳戶；只保存金融機構代碼與帳號末 4–5 碼。
-- kind：own_account 為自己的存款／電子錢包（互轉不計收支）；
-- unsynced_card 為未同步的信用卡（轉入卡片的款項仍計入支出，另標示名稱）。
CREATE TABLE own_accounts (
  id TEXT NOT NULL PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'own_account' CHECK (kind IN ('own_account', 'unsynced_card')),
  bank_code TEXT NOT NULL CHECK (bank_code GLOB '[0-9][0-9][0-9]'),
  account_suffix TEXT NOT NULL CHECK (
    length(account_suffix) BETWEEN 4 AND 5
    AND account_suffix NOT GLOB '*[^0-9]*'
  ),
  label TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (bank_code, account_suffix)
);
