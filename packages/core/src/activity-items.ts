import type { ActivityItem } from "./activity-types";
import { formatCounterpartyAccount, isTaiwanBankCode } from "./taiwan-banks";
import { compareActivityItems, isActivityDateTime } from "./activity-list";
import type {
  MatchingTransaction,
  MatchingInvoice,
  InvoiceTransactionMatches,
} from "./activity-matching";
import { tradeEconomicRole, type EconomicRoleFields } from "./economic-role";
import {
  bankMerchantIdentity,
  invoiceMerchantIdentity,
  type MerchantIdentity,
} from "./merchant";
import type { InvoiceMatchInfo } from "./invoice-dedupe";
import {
  invoiceAmountTwd,
  isForeignCurrencyInvoice,
  normalizeInvoiceCurrency,
} from "./invoice-currency";
export interface ActivityAccount {
  id: string;
  institutionName?: string | null;
  accountName?: string | null;
  accountType?: string | null;
  accountLast4?: string | null;
}
export interface ActivityTransaction
  extends MatchingTransaction, Partial<EconomicRoleFields> {
  accountId: string;
  institutionName?: string | null;
  accountName?: string | null;
  accountLast4?: string | null;
  status: string;
  counterpartyBankCode?: string | null;
  counterpartyAccountSuffix?: string | null;
  /** 對方帳戶符合「我的其他帳戶」時由 API 提供。 */
  ownAccount?: {
    id: string;
    kind: "own_account" | "unsynced_card";
    label: string;
  };
  excludedFromCalculation?: boolean;
  classification?: {
    label: string;
    categoryId: string;
    source: ActivityItem["classificationSource"];
    ruleId?: string;
  };
}
export interface ActivityInvoice extends MatchingInvoice {
  sellerName?: string | null;
  /** 賣方統編（可辨識時）；商家 key 以統編優先。 */
  sellerBan?: string | null;
  invoiceNumber?: string | null;
}
export interface ActivityTrade {
  id: string;
  name?: string | null;
  symbol?: string | null;
  tradeDate?: string | null;
  postedDate?: string | null;
  transactionName?: string | null;
  transactionCode?: string | null;
  quantity?: number | null;
  price?: number | null;
  amount?: number | null;
  currency: string;
}
const formatNumber = (value: number) =>
  new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 0 }).format(value);
/** 轉帳對方帳戶的方向標示，例如「→ 台北富邦 …66666」或「← 永豐 …88888」。 */
export function counterpartyAccountLabel(transaction: {
  amount: number;
  counterpartyBankCode?: string | null;
  counterpartyAccountSuffix?: string | null;
}) {
  const bankCode = transaction.counterpartyBankCode;
  const accountSuffix = transaction.counterpartyAccountSuffix;
  if (!isTaiwanBankCode(bankCode) || !accountSuffix) return undefined;
  const direction = transaction.amount < 0 ? "→" : "←";
  return `${direction} ${formatCounterpartyAccount({ bankCode, accountSuffix })}`;
}
function normalizeFinancialDate(value?: string) {
  if (!value) return "";
  const roc = value.match(/^0(\d{3})-(\d{2})-(\d{2})(.*)$/);
  return roc ? `${Number(roc[1]) + 1911}-${roc[2]}-${roc[3]}${roc[4]}` : value;
}
export interface BuildActivityItemsOptions {
  /**
   * 提供時輸出經濟角色：發票套用此對照表，已配對的發票也列為獨立項目
   * （duplicateOf 指向交易、不計入金額），投資交易標示為 investment。
   */
  roles?: {
    invoices: ReadonlyMap<string, EconomicRoleFields>;
    /** 預設 true；搜尋等沿用「發票併入交易」顯示時設為 false。 */
    includeMatchedInvoices?: boolean;
    /** 提供時輸出發票的 matchStatus 與交易的 matchedInvoiceId。 */
    invoiceMatches?: ReadonlyMap<string, InvoiceMatchInfo>;
  };
  /**
   * 系統匯率（幣別 → 1 單位折合新台幣）。提供時每個銀行／信用卡／發票項目帶
   * `amountTwd`（缺匯率為 null）；已配對外幣發票的刷卡項目以換算值填 invoiceAmount。
   */
  exchangeRates?: Readonly<Record<string, number>>;
}

const roundCents = (value: number) => Math.round(value * 100) / 100 || 0;

/** 依系統匯率換算的台幣金額；缺匯率為 null。 */
function amountTwdProps(
  amount: number,
  currency: string,
  rates: Readonly<Record<string, number>> | undefined,
) {
  if (!rates) return {};
  const converted = invoiceAmountTwd({ amount, currency }, rates);
  return { amountTwd: converted == null ? null : roundCents(converted) };
}

/**
 * 已配對發票在刷卡／銀行項目上的金額：TWD 發票為原金額；外幣發票為換算後的
 * 台幣（缺匯率時省略），並另帶原幣與幣別。
 */
function matchedInvoiceAmountProps(
  invoice: ActivityInvoice | undefined,
  rates: Readonly<Record<string, number>> | undefined,
) {
  if (!invoice) return { invoiceAmount: undefined };
  if (!isForeignCurrencyInvoice(invoice))
    return { invoiceAmount: invoice.amount };
  const converted = invoiceAmountTwd(invoice, rates);
  return {
    invoiceAmount: converted == null ? undefined : Math.round(converted),
    invoiceCurrency: normalizeInvoiceCurrency(invoice.currency),
    invoiceOriginalAmount: invoice.amount,
  };
}
function merchantProps(identity?: MerchantIdentity) {
  if (!identity) return {};
  return {
    merchantKey: identity.merchantKey,
    displayName: identity.name,
    merchantName: identity.name,
    ...(identity.paymentMethod
      ? { merchantPaymentMethod: identity.paymentMethod }
      : {}),
  };
}

/** 交易的商家：已配對發票者以發票為準，否則由交易文字推得。 */
export function activityTransactionMerchant(
  transaction: Pick<ActivityTransaction, "description" | "counterparty">,
  matchedInvoice?: Pick<ActivityInvoice, "sellerName" | "sellerBan">,
) {
  const own = bankMerchantIdentity(transaction);
  const invoice = matchedInvoice
    ? invoiceMerchantIdentity(matchedInvoice)
    : undefined;
  if (!invoice) return own;
  // 發票沒有電子支付資訊，保留交易端辨識到的付款方式。
  return own?.paymentMethod
    ? { ...invoice, paymentMethod: own.paymentMethod }
    : invoice;
}

function roleProps(fields?: Partial<EconomicRoleFields>) {
  if (!fields?.economicRole) return {};
  return {
    economicRole: fields.economicRole,
    reviewStatus: fields.reviewStatus ?? "auto",
    duplicateOf: fields.duplicateOf ?? null,
    investmentEventKind: fields.investmentEventKind ?? null,
    roleReason: fields.roleReason ?? "sign",
  };
}
function invoiceMatchProps(info?: InvoiceMatchInfo) {
  if (!info) return {};
  return {
    matchStatus: info.matchStatus,
    matchedTransactionId: info.matchedTransactionId,
    matchScore: info.matchScore,
  };
}
export function buildActivityItems(
  activityBankTransactions: ActivityTransaction[],
  invoices: ActivityInvoice[],
  trades: ActivityTrade[],
  accounts: ReadonlyMap<string, ActivityAccount>,
  invoiceMatches: InvoiceTransactionMatches<ActivityInvoice>,
  options: BuildActivityItemsOptions = {},
): ActivityItem[] {
  const roles = options.roles;
  const rates = options.exchangeRates;
  const includeMatchedInvoices =
    roles != null && roles.includeMatchedInvoices !== false;
  return [
    ...activityBankTransactions.map((t) => {
      const account = accounts.get(t.accountId);
      const matchedInvoice = invoiceMatches.transactionToInvoice.get(t.id);
      const isCard =
        account?.accountType === "credit" || t.accountType === "credit";
      const hasAuthorizationTime = isActivityDateTime(
        t.authorizedAt ?? undefined,
      );
      const invoiceTime = isActivityDateTime(matchedInvoice?.invoiceDate)
        ? matchedInvoice.invoiceDate
        : undefined;
      const institutionName =
        t.institutionName ??
        account?.institutionName ??
        (isCard ? "信用卡" : "銀行");
      const accountLast4 = t.accountLast4 ?? account?.accountLast4;
      const accountName =
        t.accountName ??
        account?.accountName ??
        (accountLast4 ? `末四碼 ${accountLast4}` : "");
      return {
        id: t.id,
        source: isCard ? ("card" as const) : ("bank" as const),
        date: invoiceTime ?? t.authorizedAt ?? t.postedDate ?? "",
        dateHasTime: hasAuthorizationTime || invoiceTime != null,
        title: t.description ?? t.counterparty ?? "銀行交易",
        searchText: [
          t.counterparty,
          matchedInvoice?.sellerName,
          matchedInvoice ? "電子發票" : undefined,
          accountLast4,
          isCard ? "信用卡" : "銀行",
        ]
          .filter(Boolean)
          .join(" "),
        subtitle: [institutionName, accountName, matchedInvoice?.invoiceNumber]
          .filter(Boolean)
          .join(" · "),
        institutionName,
        accountName,
        amount: t.amount,
        currency: t.currency,
        category: t.classification?.label ?? "未分類",
        categoryId: t.classification?.categoryId ?? "other",
        counterpartyAccount: counterpartyAccountLabel(t),
        ownAccountTransfer: t.ownAccount
          ? {
              kind: t.ownAccount.kind,
              label: t.ownAccount.label,
              marker:
                t.ownAccount.kind === "unsynced_card"
                  ? "未同步的卡片"
                  : t.amount < 0
                    ? "轉到自己的帳戶"
                    : "來自自己的帳戶",
            }
          : undefined,
        classificationPattern: t.counterparty ?? t.description ?? undefined,
        classificationSource: t.classification?.source ?? "fallback",
        classificationRuleId: t.classification?.ruleId,
        transactionId: t.id,
        invoiceId: matchedInvoice?.id,
        ...matchedInvoiceAmountProps(matchedInvoice, rates),
        ...amountTwdProps(t.amount, t.currency, rates),
        excludedFromCalculation: t.excludedFromCalculation,
        status: t.status,
        ...merchantProps(activityTransactionMerchant(t, matchedInvoice)),
        ...roleProps(t),
        ...(roles?.invoiceMatches
          ? {
              matchedInvoiceId: matchedInvoice?.id ?? null,
              matchScore: matchedInvoice
                ? (roles.invoiceMatches.get(matchedInvoice.id)?.matchScore ??
                  null)
                : null,
            }
          : {}),
      };
    }),
    ...invoices
      .filter(
        (i) =>
          includeMatchedInvoices ||
          !invoiceMatches.invoiceToTransactionId.has(i.id),
      )
      .map((i) => {
        const currency = normalizeInvoiceCurrency(i.currency);
        return {
          id: i.id,
          source: "invoice" as const,
          date: i.invoiceDate,
          dateHasTime: isActivityDateTime(i.invoiceDate),
          title: i.sellerName ?? "電子發票",
          subtitle: i.invoiceNumber ?? "",
          institutionName: "電子發票",
          accountName: i.invoiceNumber ?? "",
          // 外幣發票：amount／currency 為原幣，amountTwd 為依系統匯率換算的台幣。
          amount: i.amount,
          currency,
          ...amountTwdProps(i.amount, currency, rates),
          category: "發票",
          invoiceId: i.id,
          invoiceAmount: i.amount,
          status: "已開立",
          ...merchantProps(invoiceMerchantIdentity(i)),
          ...roleProps(roles?.invoices.get(i.id)),
          ...invoiceMatchProps(roles?.invoiceMatches?.get(i.id)),
        };
      }),
    ...trades.map((t) => {
      const accountName = [
        t.transactionName ?? t.transactionCode,
        t.quantity != null ? `${formatNumber(t.quantity)} 股` : undefined,
      ]
        .filter(Boolean)
        .join(" · ");
      return {
        id: t.id,
        source: "investment" as const,
        date: normalizeFinancialDate(t.tradeDate ?? t.postedDate ?? undefined),
        dateHasTime: false,
        title: t.name ?? t.symbol ?? "投資交易",
        searchText: t.symbol ?? undefined,
        subtitle: accountName,
        institutionName: "投資",
        accountName,
        amount: t.price === 1 ? undefined : (t.amount ?? undefined),
        currency: t.currency,
        category: "投資",
        status: "已完成",
        ...(roles ? roleProps(tradeEconomicRole(t)) : {}),
      };
    }),
  ].sort(compareActivityItems);
}
