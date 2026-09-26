/**
 * 信用卡頁與收件匣共用的合成資料（假卡號末四碼、假帳號）。
 * 基準時間：台北 2026-09-26。
 */
export const NOW = new Date("2026-09-26T04:00:00.000Z");
export const CREATED = "2026-09-01T00:00:00.000Z";

type Account = {
  id: string;
  connector: string;
  sourceId: string;
  name: string;
  type: "credit" | "savings";
  bankCode?: string;
  raw?: unknown;
};

export const accounts: Account[] = [
  {
    id: "dep",
    connector: "cathaybk",
    sourceId: "bank:cathaybk:000012345678",
    name: "國泰臺幣帳戶",
    type: "savings",
    bankCode: "013",
  },
  // 國泰：4 張實體卡共用一張帳單，帳單與繳款掛在摘要帳戶。
  {
    id: "cathay-main",
    connector: "cathaybk",
    sourceId: "credit:cathaybk:main",
    name: "國泰信用卡",
    type: "credit",
    // 與連接器相同：總覽頁的卡號清單放在摘要帳戶的 raw，不應重複列卡。
    raw: { cardLast4s: ["1111", "2222", "3333", "4444"] },
  },
  ...["1111", "2222", "3333", "4444"].map((last4) => ({
    id: `cathay-${last4}`,
    connector: "cathaybk",
    sourceId: `credit:cathaybk:${last4}`,
    name: `國泰信用卡 ${last4}`,
    type: "credit" as const,
    raw: { cardLast4: last4 },
  })),
  {
    id: "taishin-card",
    connector: "taishin",
    sourceId: "credit:taishin:main",
    name: "台新信用卡",
    type: "credit",
    raw: { cardLast4s: ["5555", "6666"] },
  },
  {
    id: "ctbc-card",
    connector: "ctbc",
    sourceId: "credit:ctbc:TWD",
    name: "中國信託信用卡",
    type: "credit",
    raw: { cards: [{ cardLast4: "7777", cardName: "LINE Pay卡" }] },
  },
  {
    id: "esun-card",
    connector: "esun",
    sourceId: "credit:esun:8888",
    name: "玉山信用卡",
    type: "credit",
  },
  {
    id: "sinopac-card",
    connector: "sinopac",
    sourceId: "credit:sinopac:9999",
    name: "永豐信用卡",
    type: "credit",
  },
];

type Bill = {
  account: string;
  connector: string;
  period: string;
  amount?: number;
  minimum?: number;
  paid?: number;
  isPaid?: boolean;
  closing?: string;
  due?: string;
};

export const bills: Bill[] = [
  {
    account: "cathay-main",
    connector: "cathaybk",
    period: "2026-09",
    amount: 30000,
    minimum: 3000,
    closing: "2026-09-06",
    due: "2026-10-01",
    isPaid: false,
  },
  {
    account: "cathay-main",
    connector: "cathaybk",
    period: "2026-08",
    amount: 20000,
    closing: "2026-08-06",
    isPaid: true,
  },
  {
    account: "taishin-card",
    connector: "taishin",
    period: "2026-09",
    amount: 8000,
    minimum: 800,
    closing: "2026-09-10",
    due: "2026-09-28",
  },
  {
    account: "ctbc-card",
    connector: "ctbc",
    period: "2026-09",
    amount: 5000,
    minimum: 1000,
    paid: 0,
    closing: "2026-09-12",
    due: "2026-09-30",
  },
  // 玉山：本期沒有帳單總額，以上期結帳日之後到本期結帳日的刷卡推估。
  {
    account: "esun-card",
    connector: "esun",
    period: "2026-08",
    amount: 1000,
    closing: "2026-08-15",
    due: "2026-09-02",
    isPaid: true,
  },
  {
    account: "esun-card",
    connector: "esun",
    period: "2026-09",
    closing: "2026-09-15",
    due: "2026-10-03",
  },
  // 永豐：只有一期且沒有金額，也沒有已繳旗標 → 無法判斷。
  {
    account: "sinopac-card",
    connector: "sinopac",
    period: "2026-09",
    closing: "2026-09-16",
    due: "2026-10-04",
  },
];

export type Tx = {
  id: string;
  account: string;
  connector: string;
  day: string;
  posted?: string;
  amount: number;
  description: string;
  counterparty?: string;
  status?: "pending" | "posted";
  raw?: unknown;
};

export const transactions: Tx[] = [
  // 國泰本期部分繳款：存款端扣款與卡片端入帳同一筆錢，只算一次。
  {
    id: "cathay-pay-bank",
    account: "dep",
    connector: "cathaybk",
    day: "2026-09-20",
    amount: -10000,
    description: "信用卡款",
    counterparty: "國泰世華卡",
  },
  {
    id: "cathay-pay-card",
    account: "cathay-main",
    connector: "cathaybk",
    day: "2026-09-20",
    amount: 10000,
    description: "本行自動扣繳",
    counterparty: "國泰世華信用卡繳款",
  },
  // 國泰未出帳：結帳日（09-06）之後。
  {
    id: "c1111-shop",
    account: "cathay-1111",
    connector: "cathaybk",
    day: "2026-09-10",
    amount: -1200,
    description: "咖啡豆專賣",
  },
  {
    id: "c1111-refund",
    account: "cathay-1111",
    connector: "cathaybk",
    day: "2026-09-12",
    amount: 200,
    description: "咖啡豆專賣退貨",
  },
  {
    id: "c2222-pending",
    account: "cathay-2222",
    connector: "cathaybk",
    day: "2026-09-20",
    amount: -800,
    description: "線上訂閱",
    status: "pending",
  },
  // 結帳日前刷卡、結帳日前入帳：已出帳，不算未出帳。
  {
    id: "c3333-billed",
    account: "cathay-3333",
    connector: "cathaybk",
    day: "2026-09-05",
    amount: -500,
    description: "書店",
  },
  // 結帳日前刷卡、結帳日後入帳：屬於下一期。
  {
    id: "c4444-late-post",
    account: "cathay-4444",
    connector: "cathaybk",
    day: "2026-09-05",
    posted: "2026-09-08",
    amount: -300,
    description: "停車場",
  },
  // 台新：多卡共用帳戶，以 raw cardLast4 分卡；本期已由存款端繳清。
  {
    id: "taishin-pay",
    account: "dep",
    connector: "cathaybk",
    day: "2026-09-15",
    amount: -8000,
    description: "台新卡費",
  },
  {
    id: "t5555-shop",
    account: "taishin-card",
    connector: "taishin",
    day: "2026-09-15",
    amount: -600,
    description: "文具店",
    raw: { cardLast4: "5555" },
  },
  {
    id: "t6666-pending",
    account: "taishin-card",
    connector: "taishin",
    day: "2026-09-20",
    amount: -400,
    description: "便當店",
    status: "pending",
    raw: { cardLast4: "6666" },
  },
  // 玉山本期推估：08-16 ～ 09-15 的刷卡淨額。
  {
    id: "esun-a",
    account: "esun-card",
    connector: "esun",
    day: "2026-08-20",
    amount: -1500,
    description: "家電行",
  },
  {
    id: "esun-b",
    account: "esun-card",
    connector: "esun",
    day: "2026-09-14",
    amount: -500,
    description: "花店",
  },
];

function institutionName(account: Account) {
  return {
    cathaybk: "國泰世華銀行",
    taishin: "台新銀行",
    ctbc: "中國信託商業銀行",
    esun: "玉山銀行",
    sinopac: "永豐銀行",
  }[account.connector];
}

export function accountStatement(db: D1Database, account: Account) {
  return db
    .prepare(
      "INSERT INTO bank_accounts (id, connector_id, source_id, institution_name, account_name, account_type, bank_code, raw_payload, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
    )
    .bind(
      account.id,
      account.connector,
      account.sourceId,
      institutionName(account) ?? null,
      account.name,
      account.type,
      account.bankCode ?? null,
      account.raw ? JSON.stringify(account.raw) : null,
      CREATED,
    );
}

export function transactionStatement(db: D1Database, tx: Tx) {
  return db
    .prepare(
      "INSERT INTO bank_transactions (id, connector_id, account_id, source_id, posted_date, authorized_at, amount, currency, description, counterparty, status, raw_payload, created_at, updated_at) VALUES (?1, ?2, ?3, ?1, ?4, ?5, ?6, 'TWD', ?7, ?8, ?9, ?10, ?11, ?11)",
    )
    .bind(
      tx.id,
      tx.connector,
      tx.account,
      tx.status === "pending" ? null : (tx.posted ?? tx.day),
      tx.day,
      tx.amount,
      tx.description,
      tx.counterparty ?? null,
      tx.status ?? "posted",
      tx.raw ? JSON.stringify(tx.raw) : null,
      CREATED,
    );
}

/** 寫入信用卡頁的基本資料；中信上次匯入是 16 天前。 */
export async function seedCards(db: D1Database) {
  await db.batch([
    ...accounts.map((account) => accountStatement(db, account)),
    ...bills.map((bill) =>
      db
        .prepare(
          "INSERT INTO credit_card_bills (id, connector_id, account_id, source_id, billing_period, statement_amount, minimum_payment, paid_amount, is_paid, payment_due_date, statement_closing_date, currency, created_at, updated_at) VALUES (?1, ?2, ?3, ?1, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'TWD', ?11, ?11)",
        )
        .bind(
          `${bill.account}:${bill.period}`,
          bill.connector,
          bill.account,
          bill.period,
          bill.amount ?? null,
          bill.minimum ?? null,
          bill.paid ?? null,
          bill.isPaid == null ? null : bill.isPaid ? 1 : 0,
          bill.due ?? null,
          bill.closing ?? null,
          CREATED,
        ),
    ),
    ...transactions.map((tx) => transactionStatement(db, tx)),
    db
      .prepare(
        "UPDATE sync_jobs SET last_success_at = ?1, last_status = 'success', last_run_at = ?1 WHERE id IN ('cathaybk:all', 'taishin:all', 'esun:all', 'sinopac:all')",
      )
      .bind("2026-09-25T22:00:00.000Z"),
    db
      .prepare(
        "UPDATE sync_jobs SET last_success_at = ?1, last_status = 'success', last_run_at = ?1 WHERE id = 'ctbc:all'",
      )
      .bind("2026-09-10T12:00:00.000Z"),
  ]);
}
