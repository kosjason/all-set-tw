export interface TaiwanBank {
  /** 三碼金融機構代碼。 */
  code: string;
  /** 帳戶與機構顯示使用的名稱。 */
  name: string;
  /** 交易對手等空間有限處使用的簡稱。 */
  shortName: string;
}

/** 常見臺灣金融機構代碼；未列入的代碼顯示為數字代碼。 */
export const TAIWAN_BANKS: readonly TaiwanBank[] = [
  { code: "004", name: "台灣銀行", shortName: "臺灣銀行" },
  { code: "005", name: "土地銀行", shortName: "土地銀行" },
  { code: "006", name: "合作金庫銀行", shortName: "合作金庫" },
  { code: "007", name: "第一銀行", shortName: "第一銀行" },
  { code: "008", name: "華南銀行", shortName: "華南銀行" },
  { code: "009", name: "彰化銀行", shortName: "彰化銀行" },
  { code: "011", name: "上海商銀", shortName: "上海商銀" },
  { code: "012", name: "台北富邦銀行", shortName: "台北富邦" },
  { code: "013", name: "國泰世華銀行", shortName: "國泰世華" },
  { code: "016", name: "高雄銀行", shortName: "高雄銀行" },
  { code: "017", name: "兆豐銀行", shortName: "兆豐" },
  { code: "048", name: "王道銀行", shortName: "王道銀行" },
  { code: "050", name: "台灣企銀", shortName: "台灣企銀" },
  { code: "052", name: "渣打銀行", shortName: "渣打銀行" },
  { code: "053", name: "台中銀行", shortName: "台中銀行" },
  { code: "054", name: "京城銀行", shortName: "京城銀行" },
  { code: "081", name: "匯豐銀行", shortName: "匯豐銀行" },
  { code: "103", name: "新光銀行", shortName: "新光銀行" },
  { code: "108", name: "陽信銀行", shortName: "陽信銀行" },
  { code: "700", name: "中華郵政", shortName: "中華郵政" },
  { code: "803", name: "聯邦銀行", shortName: "聯邦" },
  { code: "805", name: "遠東銀行", shortName: "遠東商銀" },
  { code: "806", name: "元大銀行", shortName: "元大銀行" },
  { code: "807", name: "永豐銀行", shortName: "永豐" },
  { code: "808", name: "玉山銀行", shortName: "玉山" },
  { code: "809", name: "凱基銀行", shortName: "凱基銀行" },
  { code: "810", name: "星展銀行", shortName: "星展" },
  { code: "812", name: "台新銀行", shortName: "台新" },
  { code: "816", name: "安泰銀行", shortName: "安泰銀行" },
  { code: "822", name: "中國信託銀行", shortName: "中國信託" },
  { code: "823", name: "將來銀行", shortName: "將來銀行" },
  { code: "824", name: "連線銀行", shortName: "連線商業銀行" },
  { code: "826", name: "樂天銀行", shortName: "樂天" },
];

const banksByCode = new Map(TAIWAN_BANKS.map((bank) => [bank.code, bank]));

/** 交易對手帳戶的遮罩識別：只保留金融機構代碼與帳號末碼。 */
export interface CounterpartyAccount {
  bankCode: string;
  /** 帳號末五碼；不得保存完整帳號。 */
  accountSuffix: string;
}

export const COUNTERPARTY_ACCOUNT_SUFFIX_LENGTH = 5;
const MIN_ACCOUNT_DIGITS = 8;

export function isTaiwanBankCode(value: unknown): value is string {
  return typeof value === "string" && /^\d{3}$/.test(value);
}

export function taiwanBankName(code?: string | null) {
  return code ? banksByCode.get(code)?.name : undefined;
}

/** 已知代碼回傳簡稱，未知代碼回傳原始三碼。 */
export function taiwanBankShortName(code: string) {
  return banksByCode.get(code)?.shortName ?? code;
}

/**
 * 由代碼與完整帳號推導遮罩後的交易對手；完整帳號只在此函式內使用，不會出現在回傳值。
 * 帳號必須全為數字（允許空白與連字號分隔）、長度足夠且不是全 0。
 */
export function deriveCounterpartyAccount(
  bankCode: unknown,
  accountNumber: unknown,
): CounterpartyAccount | undefined {
  if (typeof bankCode !== "string" || typeof accountNumber !== "string")
    return undefined;
  const code = bankCode.trim();
  const account = accountNumber.trim().replace(/[\s-]/g, "");
  if (!isTaiwanBankCode(code)) return undefined;
  if (!/^\d+$/.test(account) || account.length < MIN_ACCOUNT_DIGITS)
    return undefined;
  if (/^0+$/.test(account)) return undefined;
  return {
    bankCode: code,
    accountSuffix: account.slice(-COUNTERPARTY_ACCOUNT_SUFFIX_LENGTH),
  };
}

/** 解析銀行備註中的「(012)0000123456；」格式；備註若是名稱而非帳號則回傳 undefined。 */
export function parseBankAccountMemo(
  memo: unknown,
): CounterpartyAccount | undefined {
  if (typeof memo !== "string") return undefined;
  const match = memo
    .normalize("NFKC")
    .replace(/[;；]/g, "")
    .trim()
    .match(/^\((\d{3})\)\s*([\d\s-]+)$/);
  return match ? deriveCounterpartyAccount(match[1], match[2]) : undefined;
}

/** 顯示用交易對手，例如「台北富邦 …66666」。 */
export function formatCounterpartyAccount(account: CounterpartyAccount) {
  return `${taiwanBankShortName(account.bankCode)} …${account.accountSuffix}`;
}

/** 將文字中長度 6 碼以上的數字串遮罩為「…末五碼」，供 raw 診斷資料使用。 */
export function maskAccountNumbers(value: string) {
  return value.replace(
    /\d{6,}/g,
    (digits) => `…${digits.slice(-COUNTERPARTY_ACCOUNT_SUFFIX_LENGTH)}`,
  );
}

/** 使用者宣告的自有帳戶：只保存代碼與末 4–5 碼。 */
export interface OwnAccountIdentity {
  bankCode: string;
  accountSuffix: string;
}

export const OWN_ACCOUNT_SUFFIX_PATTERN = /^\d{4,5}$/;

export function isValidOwnAccountSuffix(value: unknown): value is string {
  return typeof value === "string" && OWN_ACCOUNT_SUFFIX_PATTERN.test(value);
}

export function matchesOwnAccount(
  counterparty: CounterpartyAccount,
  ownAccount: OwnAccountIdentity,
) {
  return (
    counterparty.bankCode === ownAccount.bankCode &&
    isValidOwnAccountSuffix(ownAccount.accountSuffix) &&
    counterparty.accountSuffix.endsWith(ownAccount.accountSuffix)
  );
}

/** 找出與交易對手相符的自有帳戶；多筆相符時以末碼較長（較精確）者優先。 */
export function findOwnAccount<T extends OwnAccountIdentity>(
  counterparty: CounterpartyAccount | null | undefined,
  ownAccounts: readonly T[],
): T | undefined {
  if (!counterparty) return undefined;
  let best: T | undefined;
  for (const ownAccount of ownAccounts) {
    if (!matchesOwnAccount(counterparty, ownAccount)) continue;
    if (!best || ownAccount.accountSuffix.length > best.accountSuffix.length)
      best = ownAccount;
  }
  return best;
}

/**
 * own_account：自己的存款／電子錢包，互轉不計入收支。
 * unsynced_card：未同步的信用卡，轉入款項是唯一的消費紀錄，仍計入支出。
 */
export const OWN_ACCOUNT_KINDS = ["own_account", "unsynced_card"] as const;
export type OwnAccountKind = (typeof OWN_ACCOUNT_KINDS)[number];

/** 「我的其他帳戶」API 回應。 */
export interface OwnAccount extends OwnAccountIdentity {
  id: string;
  kind: OwnAccountKind;
  label: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OwnAccountInput {
  kind: OwnAccountKind;
  bankCode: string;
  accountSuffix: string;
  label?: string | null;
}

/** 連接器對應的發卡／開戶銀行代碼（電子發票、集保不是銀行）。 */
export const CONNECTOR_BANK_CODES: Readonly<Record<string, string>> = {
  esun: "808",
  cathaybk: "013",
  sinopac: "807",
  taishin: "812",
  ctbc: "822",
  skbank: "103",
  obank: "048",
  hncb: "008",
  firstbank: "007",
  kgibank: "809",
};

/** 交易描述常見的銀行俗稱；與正式名稱、簡稱一起比對。 */
const BANK_TEXT_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ["台銀", "004"],
  ["土銀", "005"],
  ["合庫", "006"],
  ["一銀", "007"],
  ["華南", "008"],
  ["彰銀", "009"],
  ["富邦", "012"],
  ["國泰", "013"],
  ["兆豐", "017"],
  ["台企", "050"],
  ["渣打", "052"],
  ["匯豐", "081"],
  ["新光", "103"],
  ["聯邦", "803"],
  ["遠銀", "805"],
  ["遠東", "805"],
  ["元大", "806"],
  ["永豐", "807"],
  ["玉山", "808"],
  ["凱基", "809"],
  ["星展", "810"],
  ["台新", "812"],
  ["中信", "822"],
  ["中國信託", "822"],
  ["樂天", "826"],
];

const BANK_TEXT_PATTERNS = [
  ...TAIWAN_BANKS.flatMap((bank) => [
    [bank.name, bank.code] as const,
    [bank.shortName, bank.code] as const,
  ]),
  ...BANK_TEXT_ALIASES,
]
  .map(([text, code]) => [text.replace(/臺/g, "台"), code] as const)
  // 長的名稱先比對並從文字移除，避免短名稱重複命中。
  .sort((left, right) => right[0].length - left[0].length);

/** 從描述文字找出唯一提到的銀行代碼；提到多家或都沒提到時回傳 undefined。 */
export function taiwanBankCodeFromText(text?: string | null) {
  let remaining = (text ?? "").normalize("NFKC").replace(/臺/g, "台");
  const codes = new Set<string>();
  for (const [name, code] of BANK_TEXT_PATTERNS) {
    if (!remaining.includes(name)) continue;
    codes.add(code);
    remaining = remaining.split(name).join(" ");
  }
  return codes.size === 1 ? [...codes][0] : undefined;
}

/** 顯示用名稱：優先使用者自訂名稱，否則為「台新 …12345」。 */
export function ownAccountDisplayName(
  ownAccount: OwnAccountIdentity & { label?: string | null },
) {
  return (
    ownAccount.label?.trim() ||
    `${taiwanBankShortName(ownAccount.bankCode)} …${ownAccount.accountSuffix}`
  );
}
