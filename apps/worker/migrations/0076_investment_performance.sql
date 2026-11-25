-- 投資績效：集保交易只有股數沒有成交價，成本以交易所收盤價推算。
-- security_prices 快取證交所／櫃買中心的每日收盤價（未還原除權息與分割），
-- 由排程每次少量補抓，不在讀取 API 時連外。
CREATE TABLE security_prices (
  symbol TEXT NOT NULL CHECK (length(symbol) BETWEEN 1 AND 20),
  trade_date TEXT NOT NULL CHECK (
    trade_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'
    AND trade_date IS date(trade_date)
  ),
  close REAL NOT NULL CHECK (close > 0),
  exchange TEXT NOT NULL CHECK (exchange IN ('twse', 'tpex')),
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (symbol, trade_date)
);

-- 每檔每個月的抓取紀錄。final = 1 表示抓取時該月已結束，之後不再重抓；
-- error 只代表那次沒拿到（被限流、改版、網路錯誤），稍後重試，不當成沒有資料。
CREATE TABLE security_price_months (
  symbol TEXT NOT NULL CHECK (length(symbol) BETWEEN 1 AND 20),
  month TEXT NOT NULL CHECK (
    month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'
    AND date(month || '-01') IS NOT NULL
  ),
  exchange TEXT NOT NULL CHECK (exchange IN ('twse', 'tpex')),
  status TEXT NOT NULL CHECK (status IN ('ok', 'empty', 'error')),
  final INTEGER NOT NULL DEFAULT 0 CHECK (final IN (0, 1)),
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (symbol, month)
);

-- 使用者填的期初成本：集保最早紀錄之前就有的持股，預設以當天收盤價估算。
-- holding_key 為「券商代號:帳號:代號」。
CREATE TABLE investment_opening_costs (
  holding_key TEXT NOT NULL PRIMARY KEY CHECK (length(holding_key) BETWEEN 1 AND 100),
  cost INTEGER NOT NULL CHECK (
    typeof(cost) = 'integer' AND cost BETWEEN 1 AND 10000000000
  ),
  updated_at TEXT NOT NULL
);
