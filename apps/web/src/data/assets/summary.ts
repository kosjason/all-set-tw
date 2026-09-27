import type { ExchangeRateRow, ManualAssetRow } from "@/data/assets/types";
import type { BankAccountRow, BankData } from "@/data/bank/types";
import type { InvestmentRow } from "@/data/investments/types";
import { missingExchangeRateCurrencies } from "@/shared/format/financial";

const CONNECTOR_BANK_CODES: Record<string, string> = {
  firstbank: "007",
  hncb: "008",
  cathaybk: "013",
  obank: "048",
  skbank: "103",
  sinopac: "807",
  esun: "808",
  taishin: "812",
  ctbc: "822",
  kgibank: "809",
  megabank: "017",
};

export interface InstitutionAssetGroup {
  key: string;
  institution: string;
  accounts: BankAccountRow[];
  cards: BankAccountRow[];
  assetTotalTwd: number;
  debtTotalTwd: number;
  hasUnknownCardBalance: boolean;
  /**
   * 沒有自己餘額、欠款併入同一資料來源合併帳單帳戶的卡片 id。銀行每期只開一張合併帳單，
   * 共用額度與欠款只記在合併帳單帳戶，各卡本來就沒有餘額，不算資料不完整。
   */
  combinedBillCardIds: string[];
  foreignCurrencies: string[];
}

export interface AssetSummary {
  deposits: BankAccountRow[];
  cards: BankAccountRow[];
  bankTotal: number;
  investmentTotal: number;
  manualTotal: number;
  cardDebt: number;
  hasUnknownCardBalance: boolean;
  grossAssets: number;
  /** 佔比分母：各機構存款、投資、其他資產各自取正值後加總，透支不會拉低分母。 */
  positiveAssetTotal: number;
  netWorth: number;
  institutionGroups: InstitutionAssetGroup[];
  /** 資產（不含信用卡負債）依原始幣別折合新台幣，缺匯率的幣別不列入。 */
  currencyBreakdown: Array<{ currency: string; totalTwd: number }>;
  missingCurrencies: string[];
}

function institutionKey(account: BankAccountRow) {
  const bankCode =
    account.bankCode ?? CONNECTOR_BANK_CODES[account.connectorId];
  return bankCode ? `bank:${bankCode}` : `connector:${account.connectorId}`;
}

/** 同一資料來源已有帳戶記錄餘額（合併帳單）時，沒有餘額的其他卡視為併入該帳單。 */
function combinedBillCardIds(cards: BankAccountRow[]) {
  const connectorsWithBalance = new Set(
    cards
      .filter((card) => card.balance != null)
      .map((card) => card.connectorId),
  );
  return cards
    .filter(
      (card) =>
        card.balance == null && connectorsWithBalance.has(card.connectorId),
    )
    .map((card) => card.id);
}

export function calculateAssetSummary({
  bank,
  investments,
  manualAssets,
  rates,
}: {
  bank: BankData;
  investments: InvestmentRow[];
  manualAssets: ManualAssetRow[];
  rates?: ExchangeRateRow[];
}): AssetSummary {
  const rateValues = Object.fromEntries(
    (rates ?? []).map((rate) => [rate.currency, rate.rateTwd]),
  );
  const toTwd = (value: number, currency: string) =>
    currency === "TWD" ? value : value * (rateValues[currency] ?? 0);
  const deposits = bank.accounts.filter(
    (account) => account.accountType !== "credit",
  );
  const cards = bank.accounts.filter(
    (account) => account.accountType === "credit",
  );
  const missingCurrencies = missingExchangeRateCurrencies(
    [
      ...deposits.map((account) => ({
        currency: account.currency,
        amount: account.balance ?? 0,
      })),
      ...cards.map((account) => ({
        currency: account.currency,
        amount: Math.abs(account.balance ?? 0),
      })),
      ...investments.map((item) => ({
        currency: item.currency,
        amount: (item.marketValue ?? 0) + (item.cashBalance ?? 0),
      })),
      ...manualAssets.map((item) => ({
        currency: item.currency,
        amount: item.value ?? 0,
      })),
    ],
    rateValues,
  );
  const bankTotal = deposits.reduce(
    (sum, account) => sum + toTwd(account.balance ?? 0, account.currency),
    0,
  );
  const investmentTotal = investments.reduce(
    (sum, item) =>
      sum +
      toTwd((item.marketValue ?? 0) + (item.cashBalance ?? 0), item.currency),
    0,
  );
  const manualTotal = manualAssets.reduce(
    (sum, item) => sum + toTwd(item.value ?? 0, item.currency),
    0,
  );
  const cardDebt = cards.reduce(
    (sum, account) =>
      sum + Math.abs(toTwd(account.balance ?? 0, account.currency)),
    0,
  );
  const grossAssets = bankTotal + investmentTotal + manualTotal;
  const currencyTotals = new Map<string, number>();
  for (const { currency, amount } of [
    ...deposits.map((account) => ({
      currency: account.currency,
      amount: account.balance ?? 0,
    })),
    ...investments.map((item) => ({
      currency: item.currency,
      amount: (item.marketValue ?? 0) + (item.cashBalance ?? 0),
    })),
    ...manualAssets.map((item) => ({
      currency: item.currency,
      amount: item.value ?? 0,
    })),
  ]) {
    if (currency !== "TWD" && rateValues[currency] == null) continue;
    currencyTotals.set(
      currency,
      (currencyTotals.get(currency) ?? 0) + toTwd(amount, currency),
    );
  }
  const currencyBreakdown = [...currencyTotals]
    .map(([currency, totalTwd]) => ({ currency, totalTwd }))
    .filter((item) => item.totalTwd > 0)
    .sort((a, b) => b.totalTwd - a.totalTwd);

  const groups = bank.accounts.reduce<Record<string, BankAccountRow[]>>(
    (result, account) => {
      (result[institutionKey(account)] ??= []).push(account);
      return result;
    },
    {},
  );
  const institutionGroups = Object.entries(groups)
    .map(([key, groupedAccounts]) => {
      const accounts = groupedAccounts.filter(
        (account) => account.accountType !== "credit",
      );
      const cards = groupedAccounts.filter(
        (account) => account.accountType === "credit",
      );
      return {
        key,
        institution:
          groupedAccounts.find((account) => account.institutionName)
            ?.institutionName ??
          groupedAccounts[0]?.connectorId ??
          "金融機構",
        accounts: [...accounts].sort(
          (a, b) =>
            toTwd(b.balance ?? 0, b.currency) -
            toTwd(a.balance ?? 0, a.currency),
        ),
        cards: [...cards].sort(
          (a, b) =>
            Math.abs(toTwd(b.balance ?? 0, b.currency)) -
            Math.abs(toTwd(a.balance ?? 0, a.currency)),
        ),
        assetTotalTwd: accounts.reduce(
          (sum, account) => sum + toTwd(account.balance ?? 0, account.currency),
          0,
        ),
        combinedBillCardIds: combinedBillCardIds(cards),
        hasUnknownCardBalance: cards.some(
          (card) =>
            card.balance == null &&
            !combinedBillCardIds(cards).includes(card.id),
        ),
        debtTotalTwd: cards.reduce(
          (sum, account) =>
            sum + Math.abs(toTwd(account.balance ?? 0, account.currency)),
          0,
        ),
        foreignCurrencies: [
          ...new Set(
            groupedAccounts
              .map((account) => account.currency)
              .filter((currency) => currency !== "TWD"),
          ),
        ],
      };
    })
    .sort(
      (a, b) =>
        b.assetTotalTwd - a.assetTotalTwd ||
        b.debtTotalTwd - a.debtTotalTwd ||
        a.institution.localeCompare(b.institution, "zh-TW"),
    );

  const positiveAssetTotal =
    institutionGroups.reduce(
      (sum, group) => sum + Math.max(group.assetTotalTwd, 0),
      0,
    ) +
    Math.max(investmentTotal, 0) +
    Math.max(manualTotal, 0);

  return {
    deposits,
    cards,
    bankTotal,
    investmentTotal,
    manualTotal,
    cardDebt,
    hasUnknownCardBalance: institutionGroups.some(
      (group) => group.hasUnknownCardBalance,
    ),
    grossAssets,
    positiveAssetTotal,
    netWorth: grossAssets - cardDebt,
    institutionGroups,
    currencyBreakdown,
    missingCurrencies,
  };
}
