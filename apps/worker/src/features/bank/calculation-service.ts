import {
  bankTransactionExists,
  upsertCalculationPreference,
} from "./calculation-repository";

export type CalculationTransaction = {
  transferPeerId?: string | null;
  accountType?: string | null;
  description?: string | null;
  counterparty?: string | null;
  calculationPreference?: number | null;
  classificationExcludedFromCalculation?: boolean | null;
  /** 對方帳戶符合使用者宣告的「我的其他帳戶」時的種類。 */
  ownAccountKind?: "own_account" | "unsynced_card";
};

export class BankTransactionNotFoundError extends Error {}

const DEPOSIT_CARD_AUTOPAY_MEMO =
  /^(中信|中國信託|國泰世華|國泰|玉山|台新|永豐|富邦|台北富邦|星展|華南|第一|合庫|兆豐|匯豐|渣打|凱基|聯邦|遠東|元大|新光|王道|樂天)卡$/;

function calculationText(transaction: CalculationTransaction) {
  const normalized =
    `${transaction.description ?? ""} ${transaction.counterparty ?? ""}`
      .normalize("NFKC")
      .toLowerCase();
  return {
    compact: normalized.replace(/[\s\p{P}\p{S}]+/gu, ""),
    words: normalized.replace(/[^a-z0-9]+/g, " ").trim(),
  };
}

export function isDefaultCalculationExcluded(
  transaction: CalculationTransaction,
) {
  if (transaction.accountType === "time_deposit" && transaction.transferPeerId)
    return true;
  return isCardPaymentText(transaction);
}

/** 描述文字為繳信用卡費：存款端的扣款，或信用卡端的繳款入帳。 */
export function isCardPaymentText(transaction: CalculationTransaction) {
  const { compact, words } = calculationText(transaction);
  const paddedWords = ` ${words} `;

  if (compact.includes("卡費") || compact.includes("繳卡款")) return true;
  if (compact.includes("繳信用卡")) return true;
  if (
    compact.includes("信用卡") &&
    ["繳款", "扣款", "還款", "自扣", "自動扣繳"].some((keyword) =>
      compact.includes(keyword),
    )
  )
    return true;
  if (paddedWords.includes(" card payment ")) return true;
  // 存款端自動扣繳本行卡費時，摘要只有「銀行簡稱＋卡」，例如中信存款的「中信卡」。
  if (
    transaction.accountType !== "credit" &&
    DEPOSIT_CARD_AUTOPAY_MEMO.test(compact)
  )
    return true;

  if (transaction.accountType === "credit") {
    if (
      ["繳款入帳", "自扣已入帳", "本行扣繳", "自動扣繳"].some((keyword) =>
        compact.includes(keyword),
      )
    )
      return true;
    if (paddedWords.includes(" payment received ")) return true;
  }

  return false;
}

export function resolveCalculationExclusion(
  transaction: CalculationTransaction,
) {
  if (
    transaction.calculationPreference === 0 ||
    transaction.calculationPreference === 1
  ) {
    return transaction.calculationPreference === 1;
  }
  // 自有帳戶互轉不計收支；未同步卡片的繳款是唯一的消費紀錄，一律計入。
  if (transaction.ownAccountKind === "own_account") return true;
  if (transaction.ownAccountKind === "unsynced_card") return false;
  if (transaction.classificationExcludedFromCalculation) return true;
  return isDefaultCalculationExcluded(transaction);
}

export async function setCalculationPreference(
  db: D1Database,
  transactionId: string,
  excludedFromCalculation: boolean,
) {
  if (!(await bankTransactionExists(db, transactionId))) {
    throw new BankTransactionNotFoundError();
  }
  await upsertCalculationPreference(
    db,
    transactionId,
    excludedFromCalculation,
    new Date().toISOString(),
  );
}
