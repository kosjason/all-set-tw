import { taiwanBankName, type ConnectorId } from "@taiwan-fin-hub/core";

const ESUN_BANK_CODE = "808";
const CATHAYBK_BANK_CODE = "013";
const CTBC_BANK_CODE = "822";
const SKBANK_BANK_CODE = "103";
const OBANK_BANK_CODE = "048";
const HNCB_BANK_CODE = "008";
const KGIBANK_BANK_CODE = "809";
const FIRSTBANK_BANK_CODE = "007";

type BankDisplayRow = {
  sourceId?: string;
  accountSourceId?: string;
  connectorId?: string;
  institutionName?: string | null;
  accountName?: string | null;
  accountType?: string | null;
  bankCode?: string | null;
  accountLast4?: string | null;
};

export function deriveBankMatchKey(
  connectorId: ConnectorId,
  sourceId: string,
): { bankCode: string | null; last4: string | null } {
  if (connectorId === "esun" && sourceId.startsWith("bank:esun:")) {
    const last4 = sourceId.split(":")[2]?.replace(/\D/g, "").slice(-4) ?? "";
    return { bankCode: ESUN_BANK_CODE, last4: last4 || null };
  }
  if (connectorId === "cathaybk" && sourceId.startsWith("bank:cathaybk:")) {
    const last4 = sourceId.split(":")[2]?.replace(/\D/g, "").slice(-4) ?? "";
    return { bankCode: CATHAYBK_BANK_CODE, last4: last4 || null };
  }
  if (connectorId === "sinopac" && sourceId.startsWith("bank:sinopac:")) {
    const last4 = sourceId.split(":")[2]?.replace(/\D/g, "").slice(-4) ?? "";
    return { bankCode: "807", last4: last4 || null };
  }
  if (connectorId === "ctbc" && sourceId.startsWith("bank:ctbc:")) {
    const last4 = sourceId.split(":")[2]?.replace(/\D/g, "").slice(-4) ?? "";
    return { bankCode: CTBC_BANK_CODE, last4: last4 || null };
  }
  if (connectorId === "skbank" && sourceId.startsWith("bank:skbank:")) {
    const last4 = sourceId.split(":")[2]?.replace(/\D/g, "").slice(-4) ?? "";
    return { bankCode: SKBANK_BANK_CODE, last4: last4 || null };
  }
  if (connectorId === "obank" && sourceId.startsWith("bank:obank:")) {
    const last4 = sourceId.split(":")[3]?.replace(/\D/g, "").slice(-4) ?? "";
    return { bankCode: OBANK_BANK_CODE, last4: last4 || null };
  }
  if (connectorId === "firstbank" && sourceId.startsWith("bank:firstbank:")) {
    const last4 = sourceId.split(":")[2]?.replace(/\D/g, "").slice(-4) ?? "";
    return { bankCode: FIRSTBANK_BANK_CODE, last4: last4 || null };
  }
  if (connectorId === "hncb" && sourceId.startsWith("bank:hncb:")) {
    const last4 = sourceId.split(":")[2]?.replace(/\D/g, "").slice(-4) ?? "";
    return { bankCode: HNCB_BANK_CODE, last4: last4 || null };
  }
  if (connectorId === "kgibank" && sourceId.startsWith("bank:kgibank:")) {
    const last4 = sourceId.split(":")[2]?.replace(/\D/g, "").slice(-4) ?? "";
    return { bankCode: KGIBANK_BANK_CODE, last4: last4 || null };
  }
  const match = sourceId.match(/^settlement:([^:]+):([^:]+)/);
  const last4 = match?.[2]?.replace(/\D/g, "").slice(-4) ?? "";
  return match
    ? { bankCode: match[1], last4: last4 || null }
    : { bankCode: null, last4: null };
}

export function normalizeBankAccountDisplay<T extends BankDisplayRow>(
  row: T,
): T {
  return row.accountType === "credit" ? row : normalizeDepositDisplay(row);
}

export function normalizeBankTransactionDisplay<T extends BankDisplayRow>(
  row: T,
): T {
  return row.accountType === "credit" ? row : normalizeDepositDisplay(row);
}

function normalizeDepositDisplay<T extends BankDisplayRow>(row: T): T {
  const sourceId = row.accountSourceId ?? row.sourceId ?? "";
  const settlement = parseBankAccountSource(sourceId);
  const bankCode =
    row.bankCode ??
    settlement.bankCode ??
    (row.connectorId === "esun"
      ? ESUN_BANK_CODE
      : row.connectorId === "cathaybk"
        ? CATHAYBK_BANK_CODE
        : row.connectorId === "ctbc"
          ? CTBC_BANK_CODE
          : row.connectorId === "skbank"
            ? SKBANK_BANK_CODE
            : row.connectorId === "obank"
              ? OBANK_BANK_CODE
              : row.connectorId === "firstbank"
                ? FIRSTBANK_BANK_CODE
                : row.connectorId === "hncb"
                  ? HNCB_BANK_CODE
                  : row.connectorId === "kgibank"
                    ? KGIBANK_BANK_CODE
                    : undefined);
  const accountSuffix = accountSuffixFromSourceId(sourceId);
  return {
    ...row,
    institutionName: taiwanBankName(bankCode) || row.institutionName,
    accountName:
      row.accountType === "time_deposit" && row.accountName
        ? accountSuffix
          ? `${row.accountName} · ${accountSuffix}`
          : row.accountName
        : accountSuffix || row.accountName,
  };
}

function parseBankAccountSource(sourceId: string): {
  bankCode?: string;
  account?: string;
} {
  const settlement = sourceId.match(/^settlement:([^:]+):([^:]+)/);
  if (settlement) return { bankCode: settlement[1], account: settlement[2] };
  const esun = sourceId.match(/^bank:esun:([^:]+)/);
  if (esun) return { bankCode: ESUN_BANK_CODE, account: esun[1] };
  const cathaybk = sourceId.match(/^bank:cathaybk:([^:]+)/);
  if (cathaybk) return { bankCode: CATHAYBK_BANK_CODE, account: cathaybk[1] };
  const sinopac = sourceId.match(/^bank:sinopac:([^:]+)/);
  if (sinopac) return { bankCode: "807", account: sinopac[1] };
  const ctbc = sourceId.match(/^bank:ctbc:([^:]+)/);
  if (ctbc) return { bankCode: CTBC_BANK_CODE, account: ctbc[1] };
  const skbank = sourceId.match(/^bank:skbank:([^:]+)/);
  if (skbank) return { bankCode: SKBANK_BANK_CODE, account: skbank[1] };
  const obank = sourceId.match(/^bank:obank:[^:]+:([^:]+)/);
  if (obank) return { bankCode: OBANK_BANK_CODE, account: obank[1] };
  const firstbank = sourceId.match(/^bank:firstbank:([^:]+):/);
  if (firstbank)
    return { bankCode: FIRSTBANK_BANK_CODE, account: firstbank[1] };
  const hncb = sourceId.match(/^bank:hncb:([^:]+)/);
  if (hncb) return { bankCode: HNCB_BANK_CODE, account: hncb[1] };
  const kgibank = sourceId.match(/^bank:kgibank:([^:]+)/);
  if (kgibank) return { bankCode: KGIBANK_BANK_CODE, account: kgibank[1] };
  return {};
}

function accountSuffixFromSourceId(sourceId: string) {
  const account = parseBankAccountSource(sourceId).account;
  const digits = account?.replace(/\D/g, "") ?? "";
  if (!digits) return undefined;
  const suffix = digits.slice(-5);
  return `末${suffix.length <= 4 ? "四" : "五"}碼 ${suffix}`;
}
