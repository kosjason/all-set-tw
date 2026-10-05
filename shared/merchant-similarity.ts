/**
 * 發票賣方與刷卡／銀行交易商家字串的相似度，只供發票配對評分使用。
 *
 * 中文名稱先經商家主檔的正規化（{@link cleanMerchantName}：公司型態與其後的
 * 分公司／門市、電支序號、電子支付前綴），這裡只再去掉刷卡描述的通路字樣，
 * 保留「兩個字串是否指同一家店」的保守判斷。
 */

import { cleanMerchantName } from "./merchant";

/** Legal suffixes and descriptor noise that never identify a merchant. */
export const MERCHANT_STOPWORDS = new Set([
  "and",
  "asia",
  "bill",
  "billing",
  "branch",
  "com",
  "company",
  "corp",
  "corporation",
  "digital",
  "distribution",
  "gmbh",
  "group",
  "holdings",
  "inc",
  "international",
  "limited",
  "llc",
  "ltd",
  "net",
  "online",
  "opco",
  "pacific",
  "pay",
  "payment",
  "pbc",
  "plc",
  "pte",
  "purchase",
  "service",
  "services",
  "shop",
  "store",
  "subscr",
  "subscription",
  "taiwan",
  "the",
  "www",
]);

/** Seller brands whose card descriptor uses a different but equivalent brand. */
export const MERCHANT_ALIASES: Record<string, string[]> = {
  valve: ["steam", "steamgames", "steampowered"],
  anthropic: ["claude"],
};

/** 商家正規化後仍可能殘留、但不識別商家的通路字詞。 */
const CJK_NOISE =
  /有限責任|公司|總店|(?:台灣|臺灣)分行|信用卡消費|消費|簽帳|刷卡|國內|網路|線上|電支交易|行動支付/gu;

/** 拉丁字母商家代號，去除法定字尾與描述雜訊。 */
export function merchantTokens(value?: string | null) {
  return (value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(
      (token) =>
        token.length >= 3 &&
        /[a-z]/u.test(token) &&
        !MERCHANT_STOPWORDS.has(token),
    );
}

/** 只保留中日韓文字的商家名稱：沿用商家主檔的正規化，再去掉刷卡描述雜訊。 */
export function normalizeMerchantText(value?: string | null) {
  return cleanMerchantName(value)
    .name.replace(/臺/gu, "台")
    .replace(CJK_NOISE, " ")
    .replace(/[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu, "");
}

function longestCommonSubstring(left: string, right: string) {
  let best = 0;
  let previous = new Array<number>(right.length + 1).fill(0);
  for (let i = 1; i <= left.length; i += 1) {
    const current = new Array<number>(right.length + 1).fill(0);
    for (let j = 1; j <= right.length; j += 1)
      if (left[i - 1] === right[j - 1]) {
        current[j] = previous[j - 1] + 1;
        if (current[j] > best) best = current[j];
      }
    previous = current;
  }
  return best;
}

/**
 * 中文商家名稱相似度：以最長共同子字串衡量。刷卡描述常只有品牌簡稱
 * （「全支付﹘全聯」），發票賣方則是完整公司名（「全聯實業…旅順分公司」）。
 */
function cjkSimilarity(seller: string, text: string): MerchantSimilarity {
  const left = normalizeMerchantText(seller);
  const right = normalizeMerchantText(text);
  const shorter = Math.min(left.length, right.length);
  if (shorter < 2) return "none";
  const common = longestCommonSubstring(left, right);
  if (common >= 4 || common === shorter) return "strong";
  if (common >= 2 && common / shorter >= 0.4) return "partial";
  return "none";
}

/** 拉丁字母品牌（含別名）是否出現在交易描述。 */
export function latinMerchantMatch(seller: string, text: string) {
  const sellerTokens = merchantTokens(seller).flatMap((token) => [
    token,
    ...(MERCHANT_ALIASES[token] ?? []),
  ]);
  if (!sellerTokens.length) return false;
  const textTokens = merchantTokens(text);
  // 刷卡描述常把訂單碼或城市黏在品牌後（"SUBSCRO6882"），長品牌可作為前綴。
  return sellerTokens.some((seller) =>
    textTokens.some(
      (token) =>
        token === seller || (seller.length >= 4 && token.startsWith(seller)),
    ),
  );
}

export type MerchantSimilarity = "strong" | "partial" | "none";

/**
 * 發票賣方（名稱或統編）與交易商家字串的相似度等級：
 * - strong：統編出現在交易文字、拉丁品牌相符，或中文名稱一方包含另一方／
 *   最長共同子字串 ≥ 4 字。
 * - partial：最長共同子字串 ≥ 2 字且至少佔較短名稱的 40%。
 * - none：其餘。
 */
export function merchantSimilarity(
  seller: { sellerName?: string | null; sellerBan?: string | null },
  transactionText?: string | null,
): MerchantSimilarity {
  const text = transactionText ?? "";
  if (!text.trim()) return "none";
  const ban = seller.sellerBan?.trim();
  if (ban && /^\d{8}$/u.test(ban) && text.includes(ban)) return "strong";
  const name = seller.sellerName ?? "";
  if (!name.trim()) return "none";
  if (latinMerchantMatch(name, text)) return "strong";
  return cjkSimilarity(name, text);
}
