/**
 * 商家識別：把發票賣方與銀行／信用卡的原始商家字串整理成穩定的 merchantKey
 * 與可讀的預設名稱。merchantKey 是商家規則（別名、分類、角色）的 key：
 * - 發票有賣方統編時為 `ban:<8 碼統編>`（同一公司不同門市共用）。
 * - 其餘為 `name:<正規化名稱>`：NFKC（全形轉半形）、去除電支序號與長數字、
 *   「股份有限公司」之後的分公司／門市字樣、尾端「門市／分店／店」，並統一小寫、
 *   移除空白與標點。
 * - LINE Pay「連支＊X」「連加＊X」取 X 為商家並標記付款方式。
 */

export type MerchantPaymentMethod = "line_pay" | "jko_pay" | "pxpay_plus";

export interface MerchantIdentity {
  merchantKey: string;
  /** 清理後的預設顯示名稱。 */
  name: string;
  paymentMethod?: MerchantPaymentMethod;
}

const BAN_PATTERN = /^\d{8}$/;
const MERCHANT_KEY_PATTERN = /^(?:ban:\d{8}|name:[^\s]{1,120})$/u;

export function isMerchantKey(value: string) {
  return MERCHANT_KEY_PATTERN.test(value);
}

export function normalizeSellerBan(value?: string | null) {
  const ban = (value ?? "").normalize("NFKC").trim();
  return BAN_PATTERN.test(ban) ? ban : undefined;
}

/** 電子支付的商家前綴（NFKC 後 `＊` 已是 `*`）。 */
const WALLET_PREFIXES: Array<[RegExp, MerchantPaymentMethod]> = [
  [/^(?:連支|連加|line\s*pay(?:\s*money)?)\s*\*\s*(.+)$/iu, "line_pay"],
  [/^(?:街口(?:支付)?)\s*\*\s*(.+)$/u, "jko_pay"],
  [/^(?:全支付|px\s*pay(?:\s*plus)?)\s*\*\s*(.+)$/iu, "pxpay_plus"],
];

/** 只有交易類型、沒有商家資訊的描述；遇到時改用另一個欄位。 */
const GENERIC_TEXT =
  /^(?:信用卡消費|信用卡|消費|轉帳|轉帳支出|轉帳存入|跨行轉帳|網路轉帳|行動銀行轉帳|電支交易|扣款|自動扣款|提款|存款|atm.*|pos.*|刷卡|簽帳|一般消費|國外消費|繳費|代繳)$/iu;

const LEGAL_ENTITY =
  /(?:股份有限公司|有限公司|\(股\)(?:公司)?|\(股\)|企業社|工作室股份|co\.?,?\s*ltd\.?|inc\.?|corp\.?|limited)/iu;
// 單獨的「店」只在前面不是店種（商店、書店、飯店、飲料店、小吃店、麵包店、服飾店、眼鏡店…）時才視為門市字樣。
const BRANCH_SUFFIX =
  /(?:分公司|門市部|門市|分店|直營店|營業所|服務處|加盟店|專賣店|(?<![商書飯藥酒花茶麵餐果菜貨品啡料飲吃包飾鏡])店)$/u;
const LOCATION_TOKEN =
  /\s+\S*(?:分公司|門市|分店|直營店|營業所|店)$|\s+(?:台北|臺北|新北|台中|臺中|高雄|台南|臺南|桃園|新竹|基隆|taipei(?:\s+city)?|new taipei|taichung|kaohsiung|tainan|taoyuan|hsinchu|tw|twn|taiwan)$/iu;
/** 英文刷卡描述「BRAND *DETAIL 其他資訊」只保留品牌與第一個明細字。 */
const CARD_DESCRIPTOR =
  /^([a-z0-9][a-z0-9 .&'-]{1,30}?)\s*\*\s*([a-z0-9][a-z0-9.&'-]*)/iu;

function stripDecorations(value: string) {
  return (
    value
      .normalize("NFKC")
      .replace(/　/g, " ")
      // 電支交易描述：「電支交易 連加電支儲值 P0000000000000000…」。
      .replace(/^\s*電支交易\s*/u, "")
      .replace(/\bP\d{8,}\S*/giu, " ")
      .replace(/\d{6,}/gu, " ")
      .replace(/[…]+/gu, " ")
      .replace(/\s+/gu, " ")
      .trim()
  );
}

function trimPunctuation(value: string) {
  return value.replace(/^[\s\-_/*.#:,，、|]+|[\s\-_/*.#:,，、|]+$/gu, "");
}

/**
 * 清理商家原始字串為可讀名稱，並辨識電子支付前綴。
 * 例：「已田商行股份有限公司承德路門市」→「已田商行」、「連支＊老王牛肉麵」→「老王牛肉麵」。
 */
export function cleanMerchantName(raw?: string | null): {
  name: string;
  paymentMethod?: MerchantPaymentMethod;
} {
  let name = stripDecorations(raw ?? "");
  let paymentMethod: MerchantPaymentMethod | undefined;
  for (const [pattern, method] of WALLET_PREFIXES) {
    const match = name.match(pattern);
    if (match) {
      name = match[1];
      paymentMethod = method;
      break;
    }
  }
  const descriptor = paymentMethod ? null : name.match(CARD_DESCRIPTOR);
  if (descriptor) name = `${descriptor[1].trim()} *${descriptor[2]}`;
  const legal = name.match(LEGAL_ENTITY);
  if (legal?.index != null && legal.index > 0)
    name = name.slice(0, legal.index);
  for (let step = 0; step < 3; step += 1) {
    const before = name;
    name = trimPunctuation(name);
    const token = name.replace(LOCATION_TOKEN, "");
    if (token !== name && trimPunctuation(token).length >= 2) name = token;
    const suffix = name.replace(BRANCH_SUFFIX, "");
    if (suffix !== name && trimPunctuation(suffix).length >= 2) name = suffix;
    name = name.replace(/\([^()]*\)$/u, "").trim();
    if (name === before) break;
  }
  return { name: trimPunctuation(name), paymentMethod };
}

/** 名稱正規化成 key：小寫，只保留文字與數字。 */
export function normalizeMerchantName(name: string) {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .slice(0, 120);
}

function nameIdentity(raw?: string | null): MerchantIdentity | undefined {
  const cleaned = cleanMerchantName(raw);
  const normalized = normalizeMerchantName(cleaned.name);
  if (!normalized) return undefined;
  return {
    merchantKey: `name:${normalized}`,
    name: cleaned.name,
    ...(cleaned.paymentMethod ? { paymentMethod: cleaned.paymentMethod } : {}),
  };
}

/** 發票賣方：統編優先，沒有統編時以名稱。 */
export function invoiceMerchantIdentity(invoice: {
  sellerName?: string | null;
  sellerBan?: string | null;
}): MerchantIdentity | undefined {
  const ban = normalizeSellerBan(invoice.sellerBan);
  const byName = nameIdentity(invoice.sellerName);
  if (ban)
    return {
      merchantKey: `ban:${ban}`,
      name: byName?.name ?? ban,
    };
  return byName;
}

/**
 * 銀行／信用卡交易：對方名稱優先（信用卡描述常為「信用卡消費」），
 * 遇到只有交易類型的文字時改用描述。
 */
export function bankMerchantIdentity(transaction: {
  description?: string | null;
  counterparty?: string | null;
}): MerchantIdentity | undefined {
  const candidates = [transaction.counterparty, transaction.description]
    .map((value) => value?.normalize("NFKC").trim())
    .filter((value): value is string => Boolean(value));
  const specific = candidates.filter((value) => !GENERIC_TEXT.test(value));
  // 電子支付前綴帶有真正的商家，優先於對方名稱（常為支付業者）。
  const wallet = specific.find((value) =>
    WALLET_PREFIXES.some(([pattern]) => pattern.test(stripDecorations(value))),
  );
  for (const value of wallet ? [wallet, ...specific] : specific) {
    const identity = nameIdentity(value);
    if (identity) return identity;
  }
  return undefined;
}

const DISCOUNT_LINE = /折扣|折價|折讓|優惠券|找零|小計|合計|紅利折抵|點數折抵/u;
const UNIT =
  "個|入|杯|包|瓶|罐|盒|件|份|組|片|支|顆|張|袋|粒|條|本|雙|捲|串|台|盒裝|kg|g|ml|l|cc|公斤|公克|克|毫升|公升";
const QUANTITY_SUFFIXES = [
  new RegExp(`\\s*[x×*]\\s*\\d+(?:\\.\\d+)?\\s*(?:${UNIT})?\\s*$`, "iu"),
  new RegExp(`\\s*\\d+(?:\\.\\d+)?\\s*(?:${UNIT})\\s*$`, "iu"),
  /\s*@\s*\d+(?:\.\d+)?\s*$/u,
];

/**
 * 發票品項名稱清理：去除條碼、促銷標記、數量與單位。
 * 例：「4710088412345 鮮奶茶(大) x2」→「鮮奶茶(大)」、「衛生紙 3 包」→「衛生紙」。
 */
export function cleanInvoiceItemName(description?: string | null) {
  let name = (description ?? "")
    .normalize("NFKC")
    .replace(/　/g, " ")
    .replace(/【[^】]*】|\[[^\]]*\]/gu, " ")
    .replace(/^\*[^*\s]{1,6}\*\s*/u, "")
    .replace(/^[\s*#＊]+/u, "")
    .replace(/^\d{6,}\s*/u, "")
    .replace(/\s*\d{6,}$/u, "")
    .replace(/\s+/gu, " ")
    .trim();
  for (let step = 0; step < 3; step += 1) {
    const before = name;
    for (const pattern of QUANTITY_SUFFIXES) name = name.replace(pattern, "");
    name = name.trim();
    if (name === before) break;
  }
  name = name.replace(/^[\s\-_/*.#:]+|[\s\-_/*.#:]+$/gu, "");
  if (!name || /^[\d\s.]+$/u.test(name)) return undefined;
  return name;
}

export interface InvoiceItemLike {
  description: string;
  amount?: number | null;
}

/** 可分類的品項（排除折扣、負數與空白名稱），保留原順序。 */
export function meaningfulInvoiceItems<T extends InvoiceItemLike>(items: T[]) {
  const result: Array<{ name: string; item: T }> = [];
  for (const item of items) {
    if (item.amount != null && item.amount <= 0) continue;
    if (DISCOUNT_LINE.test(item.description)) continue;
    const name = cleanInvoiceItemName(item.description);
    if (name) result.push({ name, item });
  }
  return result;
}

/** 前 N 個不重複的清理後品項名稱。 */
export function invoiceItemsPreview(items: InvoiceItemLike[], limit = 3) {
  const names: string[] = [];
  for (const { name } of meaningfulInvoiceItems(items)) {
    if (!names.includes(name)) names.push(name);
    if (names.length >= limit) break;
  }
  return names;
}
