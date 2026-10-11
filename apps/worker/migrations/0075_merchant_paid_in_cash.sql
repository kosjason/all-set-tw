-- 商家規則新增「這家都付現金」：勾選後，這家沒有配對到刷卡／銀行交易的發票視為現金付款，
-- 讀取時與手記的現金支出一樣從尚未細分的提款扣（見 shared/cash-expenses.ts），
-- 不再和提款重複計算。發票本身照常依分類計入消費。
ALTER TABLE merchant_aliases
  ADD COLUMN paid_in_cash INTEGER NOT NULL DEFAULT 0 CHECK (paid_in_cash IN (0, 1));
